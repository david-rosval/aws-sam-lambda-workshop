# image-resizer

Al subir una imagen al **bucket de uploads**, S3 invoca una Lambda (Node.js 24) que:

1. valida la extensión (`jpg`, `jpeg`, `png`, `webp`, `gif`) y el tamaño (≤ 10 MB);
2. valida el **contenido real** con `sharp` (una extensión `.jpg` no garantiza que sea una imagen);
3. la reduce a un ancho máximo de 800 px (sin agrandar las pequeñas) y la guarda en el **bucket de resized**;
4. si es inválida, etiqueta el objeto original con `validation=rejected` y `reason=<motivo>`.

| Archivo / carpeta | Contenido |
|---|---|
| `template.yaml` | Recursos: 2 buckets S3, función Lambda, permisos y log group |
| `samconfig.toml` | Parámetros por defecto de `sam build` / `sam deploy` (sin profile) |
| `src/handlers/resize.mjs` | Código de la función |
| `__tests__/` | Tests con `node:test` + `aws-sdk-client-mock` |
| `events/event-s3.json` | Evento de ejemplo para `sam local invoke` |

Los pasos completos están en el [README principal](../README.md#lab-2--image-resizer-s3--lambda).
