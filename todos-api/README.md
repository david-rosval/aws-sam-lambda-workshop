# todos-api

Lambda (Node.js 24) detrás de **API Gateway HTTP API** que consulta
`https://jsonplaceholder.typicode.com/todos` y devuelve el listado.

```
GET /todos?limit=5&userId=1&completed=true
```

| Archivo / carpeta | Contenido |
|---|---|
| `template.yaml` | Recursos: HTTP API, función Lambda y log group (retención de 7 días) |
| `samconfig.toml` | Parámetros por defecto de `sam build` / `sam deploy` (sin profile) |
| `todos/app.mjs` | Código de la función (usa `fetch` nativo, sin dependencias) |
| `todos/tests/` | Tests con `node:test` |
| `events/event.json` | Evento de ejemplo para `sam local invoke` |

Los pasos completos están en el [README principal](../README.md#lab-1--todos-api-api-gateway--lambda).

## Probar el endpoint desplegado

```bash
sam list stack-outputs --stack-name todos-api --profile jpadmin --region us-east-2
```
