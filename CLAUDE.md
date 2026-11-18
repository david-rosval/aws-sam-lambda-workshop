# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este repo

Material de un **workshop de AWS Lambda con AWS SAM + CI/CD (GitHub Actions)**. Los asistentes lo siguen paso a paso desde el `README.md` (en español, con alternativas para Windows), así que el código debe ser didáctico y el README debe estar sincronizado con cualquier cambio de comandos, recursos o estructura.

Dos proyectos SAM independientes (cada uno con su `template.yaml`, `samconfig.toml` y stack de CloudFormation):

- `todos-api/`: HTTP API (`GET /todos`) → Lambda (`todos/app.mjs`, arm64) → `fetch` a jsonplaceholder. Sin dependencias npm.
- `image-resizer/`: bucket S3 `uploads` → Lambda (`src/handlers/resize.mjs`, x86_64, `sharp`) → bucket S3 `resized`. Si el archivo no es una imagen válida, se etiqueta el original con `validation=rejected`.

## Reglas obligatorias

- **Todo comando `sam` o `aws` lleva `--profile jpadmin --region us-east-2`.** La cuenta es una *project account* de la "nueva experiencia" de AWS, con SCPs gestionados por AWS. Cualquier otra región devuelve `AccessDenied`, y no se pueden crear proveedores IAM OIDC (`iam:*Provider*` denegado).
- **Nunca poner `profile` en `samconfig.toml`.** Los asistentes usan sus propios perfiles; la región sí va en `[default.global.parameters]`.
- **Runtime `nodejs24.x`**: `nodejs26.x` sigue en preview en Lambda.
- **Usar los comandos de SAM** (`sam init`, `sam pipeline bootstrap`, `sam local generate-event`, `sam list stack-outputs`…) en lugar de crear a mano lo que SAM genera: es lo que se enseña.
- **Después de cada cambio en un `template.yaml`, ejecutar `cfn-lint` y `sam validate --lint`.** El hook PostToolUse de `.claude/settings.json` (`.claude/hooks/cfn-lint.sh`) ejecuta cfn-lint automáticamente al editar un `template.yaml`.
- **CI/CD sin OIDC**: autentica con el pipeline user creado por `sam pipeline bootstrap --permissions-provider iam`.

## Comandos

```bash
# Lint de todas las plantillas (usa .cfnlintrc: ambos templates, región us-east-2)
cfn-lint

# Dentro de cada proyecto (todos-api/ o image-resizer/)
sam validate --lint --region us-east-2
sam build --profile jpadmin --region us-east-2
sam local invoke <FunctionLogicalId> --event events/<archivo>.json --profile jpadmin --region us-east-2   # requiere Docker
sam deploy --profile jpadmin --region us-east-2                      # samconfig: confirm_changeset = true
sam logs --stack-name <stack> --tail --profile jpadmin --region us-east-2
sam list stack-outputs --stack-name <stack> --profile jpadmin --region us-east-2

# Tests (runner nativo node:test). todos-api: en todos-api/todos/; image-resizer: en image-resizer/
npm test
node --test --test-name-pattern="rechaza" __tests__/unit/handlers/resize.test.mjs   # un test concreto

# Hooks de pre-commit (cfn-lint)
pre-commit run --all-files
```

`sam build` requiere SAM CLI ≥ 1.173 porque las versiones anteriores pasan `--unsafe-perm`, que npm 12 rechaza.

## Detalles de arquitectura no obvios

- **image-resizer, nombres de bucket:** se construyen con `!Sub ${AWS::StackName}-uploads-${AWS::AccountId}` y las policies de la función y `DEST_BUCKET` repiten ese mismo `!Sub` en lugar de usar `!Ref`. Usar `!Ref` genera una dependencia circular (bucket → notificación S3 → permiso → función → rol → bucket). Si se cambia el patrón del nombre, hay que actualizarlo en todos los lugares.
- **image-resizer, dos buckets separados:** existen a propósito para evitar invocaciones recursivas. No escribir nunca en el bucket que dispara el evento.
- **image-resizer, `sharp` y la arquitectura:** `sharp` tiene binarios nativos. La función es x86_64 para que `npm` en Linux x64 (local o en el runner de GitHub) empaquete el binario correcto. En Windows o macOS se usa `sam build --use-container`.
- **image-resizer, empaquetado:** el `package.json` está en la raíz del proyecto (`CodeUri` implícito `.`), y `"files": ["src/"]` limita lo que se incluye en el zip.
- **Contrato de errores del handler:** los errores de validación no lanzan excepción, solo etiquetan el objeto y registran un `warn`. Los errores inesperados de S3 sí lanzan, para que Lambda reintente.
- **Log groups:** se declaran explícitamente como `/aws/lambda/${Function}`, con 7 días de retención. Mantienen el nombre por defecto para que `sam logs` funcione.
- **Tests:** usan `node:test`. `fetch` se mockea con `mock.method(globalThis, 'fetch')`, y el `S3Client` exportado por el handler (`s3`) con `aws-sdk-client-mock`. La configuración del handler (`config()`) se lee en tiempo de invocación para que los tests puedan fijar las variables de entorno.

## CI/CD

- `.github/workflows/_sam-pipeline.yml` es el workflow reutilizable que llaman `todos-api.yml` e `image-resizer.yml`. Cada uno se dispara con `paths:` de su proyecto. Inputs: `project` y `code-dir` (dónde está `package.json`).
- Tiene dos jobs:
  - `validate` (PRs y push): cfn-lint, `sam validate --lint` y `npm ci && npm test`.
  - `deploy` (solo en `main`, Environment `dev`): usa `configure-aws-credentials` con las access keys del pipeline user y `role-to-assume` sobre el PipelineExecutionRole (`role-skip-session-tagging: true`, porque los roles del bootstrap no permiten `sts:TagSession`), y luego `sam deploy --no-resolve-s3 --s3-bucket ... --role-arn <CloudFormationExecutionRole>`.
- Secrets y variables de GitHub:
  - Environment `dev`: secrets `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`; variables `PIPELINE_EXECUTION_ROLE`, `CLOUDFORMATION_EXECUTION_ROLE` y `ARTIFACTS_BUCKET`.
  - Variable de repositorio: `AWS_REGION`.
- Los recursos del pipeline viven en el stack `aws-sam-cli-managed-dev-pipeline-resources`, y la access key del pipeline user está en Secrets Manager (output `PipelineUserSecretKey`).
- GitHub: cuenta `david-rosval`. El remote usa el alias SSH `github-personal` (`git@github-personal:david-rosval/<repo>.git`). El token de `gh` no tiene scope `workflow`, así que los cambios en `.github/workflows/` se suben por SSH.
