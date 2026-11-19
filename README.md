# Workshop: AWS Lambda con AWS SAM + CI/CD (GitHub Actions)

Dos ejemplos de funciones Lambda en **Node.js 24**, creados con `sam init`, desplegados con `sam deploy`
y con un pipeline de **CI/CD en GitHub Actions** preparado con `sam pipeline bootstrap`.

| Proyecto | Disparador | Qué hace |
|---|---|---|
| [`todos-api/`](todos-api/) | API Gateway (HTTP API) `GET /todos` | Consulta `https://jsonplaceholder.typicode.com/todos` y devuelve el listado (con filtros `limit`, `userId` y `completed`) |
| [`image-resizer/`](image-resizer/) | Subida de un archivo a S3 | Valida que sea una imagen real y guarda una versión reducida (máx. 800 px de ancho) en otro bucket |

```
Lab 1
  Cliente ──GET /todos──▶ API Gateway (HTTP API) ──▶ TodosFunction ──fetch──▶ jsonplaceholder.typicode.com

Lab 2
  Usuario ──aws s3 cp──▶ bucket uploads ──evento S3──▶ ImageResizerFunction ──PutObject──▶ bucket resized
                                                          │ (si no es imagen válida)
                                                          └──▶ tag validation=rejected en el original
```

## Índice

0. [Requisitos e instalación](#0-requisitos-e-instalación)
1. [Configurar la cuenta AWS](#1-configurar-la-cuenta-aws)
2. [Lab 1 – todos-api (API Gateway + Lambda)](#lab-1--todos-api-api-gateway--lambda)
3. [Lab 2 – image-resizer (S3 + Lambda)](#lab-2--image-resizer-s3--lambda)
4. [Validar las plantillas (cfn-lint)](#validar-las-plantillas-cfn-lint)
5. [Lab 3 – CI/CD con sam pipeline + GitHub Actions](#lab-3--cicd-con-sam-pipeline--github-actions)
6. [Limpieza (¡importante!)](#limpieza-importante)
7. [Windows: diferencias a tener en cuenta](#windows-diferencias-a-tener-en-cuenta)
8. [Troubleshooting](#troubleshooting)

> **Convención de este README.** Todos los comandos `aws` y `sam` usan `--profile TU_PERFIL --region us-east-2`.
> - **`TU_PERFIL`**: reemplázalo por el nombre del perfil de AWS CLI que configuraste en la [sección 1.1](#11-usuario-iam-access-keys-y-perfil-requisito).
>   El instructor, por ejemplo, usa un perfil llamado `jpadmin`; tú usa **el nombre que le hayas puesto al tuyo**.
> - **`us-east-2`**: reemplázalo si tu cuenta tiene otra región (ver [sección 1.2](#12-tu-región)).
> - Los comandos están escritos en **una sola línea** para que funcionen igual en Bash y en PowerShell.

---

## 0. Requisitos e instalación

| Herramienta | Versión | Para qué |
|---|---|---|
| AWS CLI | v2 (≥ 2.32) | Credenciales y comandos `aws` |
| AWS SAM CLI | **≥ 1.173** | `sam init / build / deploy / pipeline` |
| Node.js | **24 LTS** (runtime `nodejs24.x`) | Código y tests |
| Docker Desktop | reciente | `sam local ...` y `sam build --use-container` |
| Git | reciente | Control de versiones |
| Python + `uv` | Python ≥ 3.10 | Instalar `cfn-lint` y `pre-commit` |
| GitHub CLI (`gh`) | opcional | Configurar secrets y ver los workflows desde la terminal |
| **Cuenta AWS + perfil de CLI** | — | **Requisito:** usuario IAM con access keys configurado como perfil ([sección 1.1](#11-usuario-iam-access-keys-y-perfil-requisito)) |
| Cuenta de GitHub | — | Hacer fork del repo y ejecutar el pipeline (Lab 3) |

> ¿Por qué Node 24 y no 26? Node 26 ya es LTS, pero en Lambda `nodejs26.x` todavía está en **preview**
> (sin SLA, no recomendado para producción). `nodejs24.x` es GA y tiene soporte hasta abril de 2028.

### Windows (PowerShell)

```powershell
winget install Amazon.AWSCLI
winget install Amazon.SAM-CLI
winget install Git.Git
winget install Docker.DockerDesktop
winget install astral-sh.uv
winget install GitHub.cli
winget install Schniz.fnm
```

Cierra y vuelve a abrir PowerShell. Luego:

```powershell
# Node.js 24 con fnm (gestor de versiones de Node)
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm install 24
fnm default 24
node --version

# cfn-lint y pre-commit
uv tool install cfn-lint
uv tool install pre-commit
uv tool update-shell
```

- Para que `fnm` funcione en cada sesión, agrega la línea `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression` a tu perfil de PowerShell (`notepad $PROFILE`).
- **Docker Desktop** necesita **WSL 2** activado (`wsl --install` como administrador y reiniciar).
- Si `winget` no está disponible, usa los instaladores MSI: [AWS CLI](https://awscli.amazonaws.com/AWSCLIV2.msi) y [SAM CLI](https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi).

### macOS

```bash
brew install awscli aws-sam-cli git uv gh fnm
brew install --cask docker
fnm install 24 && fnm default 24
uv tool install cfn-lint && uv tool install pre-commit
```

### Linux (x86_64)

```bash
# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install --update

# SAM CLI
curl -L -o sam.zip https://github.com/aws/aws-sam-cli/releases/latest/download/aws-sam-cli-linux-x86_64.zip
unzip sam.zip -d sam-installation && sudo ./sam-installation/install --update

# Node.js 24 con fnm
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24 && fnm default 24

# cfn-lint y pre-commit (uv: https://docs.astral.sh/uv/)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install cfn-lint && uv tool install pre-commit
```

Docker: instala Docker Engine según tu distribución y agrega tu usuario al grupo `docker`.

### Verificación

```bash
aws --version
sam --version
node --version
docker --version
cfn-lint --version
pre-commit --version
```

> Si no quieres usar `uv`, `pip install cfn-lint pre-commit` (o `py -m pip install --user cfn-lint pre-commit` en Windows) también funciona.

---

## 1. Configurar la cuenta AWS

### 1.1 Usuario IAM, access keys y perfil (requisito)

> ⚠️ **Requisito obligatorio antes del workshop.** Todos los comandos `aws` y `sam` usan un **perfil** de AWS CLI
> (`--profile TU_PERFIL`). Ese perfil **no existe hasta que lo crees tú**: cada asistente debe crear en **su propia cuenta**
> un usuario IAM con permisos y sus access keys, y registrarlas como perfil en su computadora.

**Paso 1 – Crear el usuario IAM** (consola de AWS → **IAM** → **Users** → **Create user**):

1. **User name**: el que quieras (p. ej. `workshop-admin`).
2. No marques el acceso a la consola: este usuario es solo para la CLI.
3. **Permissions options** → **Attach policies directly** → marca **`AdministratorAccess`**.
   Durante el workshop se crean roles IAM, buckets, funciones Lambda, APIs y stacks de CloudFormation, así que se necesitan permisos amplios.
4. **Create user**.

**Paso 2 – Crear las access keys** (IAM → Users → tu usuario → pestaña **Security credentials**):

1. **Access keys** → **Create access key**.
2. **Use case**: **Command Line Interface (CLI)** → acepta la confirmación → **Next** → **Create access key**.
3. Copia el **Access key ID** y el **Secret access key**, o usa **Download .csv file**.
   El secret **solo se muestra una vez**; si lo pierdes, crea otra clave.

**Paso 3 – Registrar el perfil en tu computadora.** Elige un nombre de perfil (p. ej. `workshop`). Ese nombre es el que usarás en lugar de `TU_PERFIL` en todos los comandos:

```bash
aws configure --profile TU_PERFIL
```

Responde así:

| Pregunta | Respuesta |
|---|---|
| AWS Access Key ID | El *Access key ID* del paso 2 |
| AWS Secret Access Key | El *Secret access key* del paso 2 |
| Default region name | Tu región (ver [1.2](#12-tu-región)), p. ej. `us-east-2` |
| Default output format | `json` |

Esto guarda las claves en `~/.aws/credentials` (Windows: `%USERPROFILE%\.aws\credentials`) con este formato:

```ini
[workshop]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

**Paso 4 – Verificar.** Debe mostrar tu número de cuenta y el ARN de tu usuario:

```bash
aws sts get-caller-identity --profile TU_PERFIL
```

> **Buenas prácticas con estas claves**
> - Nunca las subas a un repositorio ni las pegues en chats o capturas de pantalla.
> - `samconfig.toml` **no** guarda el perfil a propósito: cada persona usa el suyo con `--profile`.
> - Al terminar el workshop, **desactiva o borra** las access keys (IAM → Users → Security credentials) o el usuario completo.
>
> **Tip:** para no escribir `--profile` en cada comando puedes definir la variable de entorno `AWS_PROFILE`
> (ver [Windows: diferencias](#windows-diferencias-a-tener-en-cuenta)). En este README siempre se escribe explícito para que quede claro qué cuenta se usa.

### 1.2 Tu región

Las cuentas AWS nuevas creadas con la **nueva experiencia de alta** (sin tarjeta, con créditos) son *project accounts*:
AWS les asigna **una región según el país de tu dirección** y la restringe con políticas de la organización (SCP):

| Tu país | Región |
|---|---|
| América (Perú, México, Colombia, Chile, Argentina, EE. UU., …) | `us-east-2` (Ohio) |
| Europa / África / Medio Oriente | `eu-north-1` (Estocolmo) |
| Asia-Pacífico | `ap-southeast-2` (Sídney) |

Para confirmarla: [settings.aws.com](https://settings.aws.com) → **Project** → **Overview** → **Additional info** → **Region**.

Si usas otra región, cámbiala también en `samconfig.toml` (`region = "..."`) de cada proyecto.

> **Otras restricciones de estas cuentas** (relevantes para el Lab 3): no se pueden crear proveedores de identidad IAM
> (`iam:*Provider*`), por lo que **no se puede usar OIDC** entre GitHub y AWS. Por eso usamos `sam pipeline bootstrap`
> con un usuario IAM dedicado. Las cuentas creadas con el alta "advanced" (o con *advanced features* activadas) no tienen esta limitación.

---

## Lab 1 – todos-api (API Gateway + Lambda)

### 1.1 Crear el proyecto con `sam init`

En el repo los proyectos ya existen. Para practicar desde cero, en una carpeta vacía:

```bash
sam init --name todos-api --runtime nodejs24.x --app-template hello-world --dependency-manager npm --architecture arm64 --package-type Zip --structured-logging --no-tracing --no-application-insights --no-interactive
```

> También puedes ejecutar solo `sam init` y responder el asistente interactivo:
> *AWS Quick Start Templates → Hello World Example → nodejs24.x → Zip*.

Sobre la plantilla generada se hicieron estos cambios (compáralos con el repo):

| Cambio | Por qué |
|---|---|
| `Api` (REST) → `AWS::Serverless::HttpApi` | HTTP API es más simple, más rápida y ~70 % más barata para un proxy así |
| Throttling (`burst 10`, `rate 5`) | Protege tu cuenta de abusos |
| `hello-world/` → `todos/` y `axios` → `fetch` nativo | Node 18+ trae `fetch`: cero dependencias |
| `AbortSignal.timeout(5000)` | Nunca esperar indefinidamente a un servicio externo |
| `LogGroup` con `RetentionInDays: 7` | Por defecto los logs se guardan para siempre (y cuestan) |
| `arm64` (Graviton) | Más barato y eficiente que x86_64 |
| Tests con `node:test` | Runner nativo de Node: sin mocha/chai/jest |

### 1.2 Tests

```bash
cd todos-api/todos
npm ci
npm test
cd ..
```

### 1.3 Validar la plantilla

```bash
cfn-lint template.yaml
sam validate --lint --region us-east-2
```

### 1.4 Build y prueba local (requiere Docker)

```bash
sam build --profile TU_PERFIL --region us-east-2
sam local invoke TodosFunction --event events/event.json --profile TU_PERFIL --region us-east-2
sam local start-api --profile TU_PERFIL --region us-east-2
```

Con `sam local start-api` corriendo, en otra terminal:

```bash
curl "http://127.0.0.1:3000/todos?limit=3"
```

> PowerShell: usa `curl.exe` (en Windows PowerShell 5.1, `curl` es un alias de `Invoke-WebRequest`) o `Invoke-RestMethod "http://127.0.0.1:3000/todos?limit=3"`.

### 1.5 Deploy

La primera vez, con el asistente guiado (crea también el API Gateway):

```bash
sam deploy --guided --profile TU_PERFIL --region us-east-2
```

Las siguientes veces basta con:

```bash
sam build --profile TU_PERFIL --region us-east-2 && sam deploy --profile TU_PERFIL --region us-east-2
```

> `samconfig.toml` tiene `confirm_changeset = true`: SAM muestra los cambios (changeset) y pide confirmar con `y`.
> Es una buena práctica para ver qué se va a crear, modificar o **reemplazar** antes de aplicarlo.

> En PowerShell 5.1 `&&` no existe: ejecuta `sam build` y luego `sam deploy ...` por separado (PowerShell 7 sí lo soporta).

Ver la URL del API y probarla:

```bash
sam list stack-outputs --stack-name todos-api --profile TU_PERFIL --region us-east-2
curl "https://<api-id>.execute-api.us-east-2.amazonaws.com/todos?limit=5&completed=true"
```

| Request | Respuesta |
|---|---|
| `/todos` | 200 – los 200 TODOs |
| `/todos?limit=5&userId=1` | 200 – 5 TODOs del usuario 1 |
| `/todos?limit=999` | 400 – parámetro inválido |

### 1.6 Logs

```bash
sam logs --stack-name todos-api --tail --profile TU_PERFIL --region us-east-2
```

Los logs están en **formato JSON** (`LoggingConfig.LogFormat: JSON`): el código hace `console.info({ message, count, ... })`
y el runtime agrega `timestamp`, `level` y `requestId`. En CloudWatch → **Logs Insights** puedes consultarlos por campo:

```
fields @timestamp, level, message.message, message.count
| filter level = "INFO"
| sort @timestamp desc
```

---

## Lab 2 – image-resizer (S3 + Lambda)

### 2.1 Crear el proyecto con `sam init`

```bash
sam init --name image-resizer --runtime nodejs24.x --app-template quick-start-s3 --dependency-manager npm --architecture x86_64 --package-type Zip --no-tracing --no-application-insights --no-interactive
```

(Interactivo: *AWS Quick Start Templates → Quick Start: S3 → nodejs24.x*.)

Cambios principales sobre la plantilla generada:

| Cambio | Por qué |
|---|---|
| **Dos buckets** (`uploads` y `resized`) | Si la función escribiera en el bucket que la dispara, se invocaría a sí misma **en bucle** |
| Nombres de bucket con `!Sub ${AWS::StackName}-uploads-${AWS::AccountId}` | Evita la **dependencia circular** bucket → notificación → función → rol → bucket |
| Policies `S3ReadPolicy` + `S3WritePolicy` + `s3:PutObjectTagging` | Mínimo privilegio |
| Block Public Access + policy que exige HTTPS + expiración a 7 días | Seguridad y costos |
| `sharp` para validar y redimensionar | Valida el **contenido real** (magic bytes), no solo la extensión |
| Arquitectura `x86_64` | `sharp` trae binarios nativos; x86_64 coincide con los runners de GitHub Actions |

Validaciones que hace la función ([`src/handlers/resize.mjs`](image-resizer/src/handlers/resize.mjs)):

1. Extensión permitida: `jpg`, `jpeg`, `png`, `webp`, `gif`.
2. Tamaño ≤ 10 MB (`MaxBytes`) y > 0. Se valida **antes** de descargar el archivo.
3. Contenido: `sharp().metadata()` debe reconocer una imagen de un formato permitido.
4. Si algo falla: el original se etiqueta con `validation=rejected` y `reason=<motivo>` y se registra un `warn` en los logs.
5. Si es válida: `rotate()` (orientación EXIF) + `resize(800)` sin agrandar, y se guarda en el bucket `resized` con la misma key.

### 2.2 Tests, validación y build

```bash
cd image-resizer
npm ci
npm test
cfn-lint template.yaml
sam validate --lint --region us-east-2
```

Build:

```bash
# Linux x86_64 (y el runner de GitHub Actions)
sam build --profile TU_PERFIL --region us-east-2

# Windows / macOS (o Linux ARM): compila dentro de un contenedor Linux para que sharp
# traiga el binario correcto para Lambda (requiere Docker en ejecución)
sam build --use-container --profile TU_PERFIL --region us-east-2
```

> ⚠️ Si en Windows ejecutas `sam build` sin `--use-container`, npm instala el binario de `sharp` **para Windows**
> y la función fallará en Lambda con `Could not load the "sharp" module using the linux-x64 runtime`.

### 2.3 Deploy (crea los dos buckets)

```bash
sam deploy --guided --profile TU_PERFIL --region us-east-2
sam list stack-outputs --stack-name image-resizer --profile TU_PERFIL --region us-east-2
```

Anota `UploadsBucketName` y `ResizedBucketName`.

### 2.4 Probar

```bash
# Subir una imagen
aws s3 cp foto.jpg s3://image-resizer-uploads-<account-id>/foto.jpg --profile TU_PERFIL --region us-east-2

# Ver la versión reducida y descargarla
aws s3 ls s3://image-resizer-resized-<account-id>/ --profile TU_PERFIL --region us-east-2
aws s3 cp s3://image-resizer-resized-<account-id>/foto.jpg foto-reducida.jpg --profile TU_PERFIL --region us-east-2

# Logs en vivo
sam logs --stack-name image-resizer --tail --profile TU_PERFIL --region us-east-2
```

Probar la validación con un archivo que **no** es imagen pero tiene extensión `.jpg`:

```bash
echo "no soy una imagen" > falsa.jpg
aws s3 cp falsa.jpg s3://image-resizer-uploads-<account-id>/falsa.jpg --profile TU_PERFIL --region us-east-2
aws s3api get-object-tagging --bucket image-resizer-uploads-<account-id> --key falsa.jpg --profile TU_PERFIL --region us-east-2
```

Debe mostrar `validation=rejected` y `reason=invalid-image`, y en los logs aparece `Imagen rechazada` con el motivo.

---

## Validar las plantillas (cfn-lint)

SAM genera plantillas de **CloudFormation**. [`cfn-lint`](https://github.com/aws-cloudformation/cfn-lint) es el linter
oficial de AWS: valida tipos de recursos, propiedades, referencias, buenas prácticas y disponibilidad por región.

| Cuándo | Comando |
|---|---|
| A mano, un proyecto | `cfn-lint template.yaml` |
| A mano, todo el repo (usa [`.cfnlintrc`](.cfnlintrc)) | `cfn-lint` |
| Validación SAM + cfn-lint | `sam validate --lint --region us-east-2` |
| **Antes de cada commit** (automático) | `pre-commit install` (una sola vez); luego cada `git commit` ejecuta cfn-lint |
| Todos los hooks a mano | `pre-commit run --all-files` |
| En cada push / PR | Job `Lint y tests` del pipeline de GitHub Actions |

Extensiones útiles en VS Code: **AWS Toolkit** y **CloudFormation Linter** (`kddejong.vscode-cfn-lint`) para ver los errores mientras escribes.

---

## Lab 3 – CI/CD con sam pipeline + GitHub Actions

### 3.1 ¿Cómo se autentica GitHub contra AWS?

```
GitHub Secrets (access key del pipeline user)
        │
        ▼
configure-aws-credentials ──AssumeRole──▶ PipelineExecutionRole   (credenciales temporales, 1 h)
        │
        ▼
sam build → sam deploy --s3-bucket <artifacts> --role-arn <CloudFormationExecutionRole>
                                                     │
                                                     ▼
                         CloudFormation crea Lambda / API GW / S3 con ESE rol
```

`sam pipeline bootstrap` crea (en un stack `aws-sam-cli-managed-dev-pipeline-resources`):

| Recurso | Permisos |
|---|---|
| **Pipeline user** (IAM user + access key guardada en Secrets Manager) | Solo puede asumir el PipelineExecutionRole |
| **PipelineExecutionRole** | Subir artefactos y crear/ejecutar change sets de CloudFormation |
| **CloudFormationExecutionRole** | Crear los recursos de tu plantilla (solo lo asume CloudFormation) |
| **Artifacts bucket** (+ bucket de logs) | Guarda los zips y las plantillas empaquetadas |

**Pipeline user vs OIDC**

| | Pipeline user (este workshop) | OIDC (lo ideal) |
|---|---|---|
| Secreto en GitHub | Access key de larga duración | Ninguno |
| Credenciales en el job | Temporales (tras AssumeRole) | Temporales |
| Si se filtra | La key sirve hasta que la rotes/borres (solo para asumir el rol) | No hay nada que filtrar |
| Restringir a repo/rama | Desde GitHub (Environments) | Desde AWS (trust policy `repo:org/repo:ref:refs/heads/main`) |
| Funciona en cuentas "project" | ✅ | ❌ (SCP bloquea `iam:*Provider*`) |

> En una cuenta sin esa restricción usarías `sam pipeline bootstrap --permissions-provider oidc --oidc-provider github-actions ...`
> y en el workflow `permissions: id-token: write` + `role-to-assume`, sin access keys.

### 3.2 Fork y bootstrap

1. Haz **fork** de este repositorio y clónalo. En tu fork: pestaña **Actions** → *I understand my workflows, go ahead and enable them*.
2. Desde la raíz del repo, crea los recursos del pipeline (una vez, compartidos por ambos proyectos):

```bash
sam pipeline bootstrap --stage dev --permissions-provider iam --no-create-image-repository --no-interactive --no-confirm-changeset --profile TU_PERFIL --region us-east-2
```

> ⚠️ Al terminar, el comando **imprime en pantalla la access key y el secret del pipeline user**.
> No compartas pantalla en ese momento ni pegues esa salida en ningún lado. Si se expone, rótala (ver [Rotar la access key del pipeline user](#rotar-la-access-key-del-pipeline-user)).

3. Lee los outputs y la access key del pipeline user:

```bash
aws cloudformation describe-stacks --stack-name aws-sam-cli-managed-dev-pipeline-resources --query "Stacks[0].Outputs" --output table --profile TU_PERFIL --region us-east-2
aws secretsmanager get-secret-value --secret-id <PipelineUserSecretKey> --query SecretString --output text --profile TU_PERFIL --region us-east-2
```

> `sam pipeline init` (sin `--bootstrap`) genera un workflow oficial de ejemplo a partir de estos recursos.
> En este repo usamos una versión simplificada y comentada: [`.github/workflows/_sam-pipeline.yml`](.github/workflows/_sam-pipeline.yml).

### 3.3 Configurar GitHub

Crea el **Environment** `dev` (Settings → Environments → New environment) y limita el despliegue a la rama `main`
(*Deployment branches and tags → Selected branches → main*). Luego carga los valores (por web o con `gh`):

| Tipo | Nombre | Valor |
|---|---|---|
| Secret (env `dev`) | `AWS_ACCESS_KEY_ID` | `aws_access_key_id` del secreto |
| Secret (env `dev`) | `AWS_SECRET_ACCESS_KEY` | `aws_secret_access_key` del secreto |
| Variable (env `dev`) | `PIPELINE_EXECUTION_ROLE` | Output `PipelineExecutionRole` |
| Variable (env `dev`) | `CLOUDFORMATION_EXECUTION_ROLE` | Output `CloudFormationExecutionRole` |
| Variable (env `dev`) | `ARTIFACTS_BUCKET` | **Nombre** del bucket (última parte del ARN `ArtifactsBucket`) |
| Variable (repositorio) | `AWS_REGION` | `us-east-2` (tu región) |

Con GitHub CLI (desde la carpeta del repo):

```bash
gh secret set AWS_ACCESS_KEY_ID --env dev
gh secret set AWS_SECRET_ACCESS_KEY --env dev
gh variable set PIPELINE_EXECUTION_ROLE --env dev --body "arn:aws:iam::<account-id>:role/..."
gh variable set CLOUDFORMATION_EXECUTION_ROLE --env dev --body "arn:aws:iam::<account-id>:role/..."
gh variable set ARTIFACTS_BUCKET --env dev --body "aws-sam-cli-managed-dev-pipeline-artifactsbucket-..."
gh variable set AWS_REGION --body "us-east-2"
```

(`gh secret set` sin `--body` pide el valor por teclado, así no queda en el historial de la terminal.)

### 3.4 El pipeline

| Archivo | Rol |
|---|---|
| [`.github/workflows/todos-api.yml`](.github/workflows/todos-api.yml) | Se dispara solo si cambia `todos-api/**` |
| [`.github/workflows/image-resizer.yml`](.github/workflows/image-resizer.yml) | Se dispara solo si cambia `image-resizer/**` |
| [`.github/workflows/_sam-pipeline.yml`](.github/workflows/_sam-pipeline.yml) | Workflow reutilizable con los jobs |

Jobs:

1. **Lint y tests** (PRs y push): `cfn-lint` → `sam validate --lint` → `npm ci` → `npm test`.
2. **Deploy a dev** (solo push a `main`, Environment `dev`): credenciales → `sam build` → `sam deploy --role-arn ...`.

Probarlo:

```bash
git checkout -b feature/limite-por-defecto
# ...haz un cambio en todos-api/todos/app.mjs...
git commit -am "feat(todos-api): cambio de prueba"
git push -u origin feature/limite-por-defecto
gh pr create --fill          # corre solo "Lint y tests"
gh pr merge --squash         # al llegar a main corre también "Deploy a dev"
gh run watch
```

Además, [`dependabot.yml`](.github/dependabot.yml) abre PRs semanales para actualizar las actions y las dependencias npm.

---

## Limpieza (¡importante!)

CloudFormation **no puede borrar buckets con objetos**: vacíalos primero.

```bash
aws s3 rm s3://image-resizer-uploads-<account-id> --recursive --profile TU_PERFIL --region us-east-2
aws s3 rm s3://image-resizer-resized-<account-id> --recursive --profile TU_PERFIL --region us-east-2
sam delete --stack-name image-resizer --profile TU_PERFIL --region us-east-2
sam delete --stack-name todos-api --profile TU_PERFIL --region us-east-2
```

Recursos del pipeline: el bucket de artefactos está versionado, así que vacíalo desde la consola de S3 (botón **Empty**) junto con su bucket de logs y luego:

```bash
sam delete --stack-name aws-sam-cli-managed-dev-pipeline-resources --profile TU_PERFIL --region us-east-2
```

Por último, borra los secrets del Environment `dev` en GitHub.

### Rotar la access key del pipeline user

Hazlo si la clave se expuso (p. ej. quedó visible al ejecutar `sam pipeline bootstrap`) y, en general, de forma periódica:

```bash
aws iam list-access-keys --user-name <PipelineUser> --profile TU_PERFIL --region us-east-2
aws iam create-access-key --user-name <PipelineUser> --profile TU_PERFIL --region us-east-2
gh secret set AWS_ACCESS_KEY_ID --env dev
gh secret set AWS_SECRET_ACCESS_KEY --env dev
gh workflow run todos-api.yml
aws iam delete-access-key --user-name <PipelineUser> --access-key-id <clave-anterior> --profile TU_PERFIL --region us-east-2
```

- `<PipelineUser>` es el nombre del usuario: la última parte del output `PipelineUser` del stack de bootstrap (`aws-sam-cli-managed-dev-pipeline-resou-PipelineUser-...`).
- Borra la clave anterior **después** de comprobar que el workflow funciona con la nueva.
- El secreto `PipelineUserSecretKey` de Secrets Manager sigue guardando la clave original. Tras la rotación ya no es válido, así que la fuente de verdad pasa a ser GitHub Secrets.

---

## Windows: diferencias a tener en cuenta

| Tema | Bash (Linux/macOS) | PowerShell (Windows) |
|---|---|---|
| Continuar un comando en otra línea | `\` | `` ` `` (backtick) — en este README todo va en una línea |
| Variable de entorno | `export AWS_PROFILE=TU_PERFIL` | `$env:AWS_PROFILE = "TU_PERFIL"` |
| Encadenar comandos | `cmd1 && cmd2` | PowerShell 7: igual. PowerShell 5.1: `cmd1; if ($?) { cmd2 }` |
| curl | `curl` | `curl.exe` o `Invoke-RestMethod` |
| Crear archivo de texto | `echo "x" > f.jpg` | `"x" \| Out-File f.jpg` |
| Ruta de credenciales AWS | `~/.aws/credentials` | `%USERPROFILE%\.aws\credentials` |
| Build con dependencias nativas (sharp) | `sam build` | `sam build --use-container` |

Otros consejos:

- Usa **PowerShell 7** (`winget install Microsoft.PowerShell`) o **Git Bash**. WSL 2 también funciona y se comporta como Linux.
- Si `sam local` no encuentra Docker, abre Docker Desktop y espera a que diga *Engine running*.
- Evita rutas con espacios o tildes para el repo (p. ej. `C:\dev\aws-sam-lambda-workshop`).

---

## Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| `AccessDenied ... explicit deny in a service control policy` | Estás usando una región distinta de la de tu *project account*. Revisa `--region` y `samconfig.toml` |
| `iam:CreateOpenIDConnectProvider ... explicit deny` | Las cuentas "project" no permiten OIDC. Usa `--permissions-provider iam` |
| `sam build` falla con `npm error ... --unsafe-perm` | SAM CLI antiguo con npm ≥ 12. Actualiza SAM CLI (≥ 1.173) |
| `Could not load the "sharp" module using the linux-x64 runtime` | Se empaquetó el binario de otro SO. Usa `sam build --use-container` |
| `Bucket ... already exists` | Los nombres de bucket son globales. Cambia el nombre del stack en `sam deploy --guided` |
| `sam delete` falla con `The bucket you tried to delete is not empty` | Vacía los buckets (ver [Limpieza](#limpieza-importante)) |
| El workflow falla en `configure-aws-credentials` | Revisa los secrets/variables del Environment `dev` y que el job corra desde `main` |
| `Error: Failed to create changeset ... No updates are to be performed` | No hubo cambios en la plantilla: el pipeline usa `--no-fail-on-empty-changeset` para ignorarlo |

## Recursos

- [AWS SAM Developer Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html)
- [sam pipeline bootstrap](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-pipeline-bootstrap.html)
- [Runtimes de Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
- [Evitar invocaciones recursivas con S3](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html)
- [cfn-lint](https://github.com/aws-cloudformation/cfn-lint)
- [sharp en AWS Lambda](https://sharp.pixelplumbing.com/install#aws-lambda)
- [Regiones de las project accounts](https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html)
