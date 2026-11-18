import path from 'node:path';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';

// Cliente creado fuera del handler: se reutiliza entre invocaciones (warm starts)
export const s3 = new S3Client({});

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Formato real detectado por sharp (a partir de los "magic bytes") -> Content-Type
const CONTENT_TYPES = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const config = () => ({
  destBucket: process.env.DEST_BUCKET,
  maxWidth: Number(process.env.MAX_WIDTH ?? 800),
  maxBytes: Number(process.env.MAX_BYTES ?? 10 * 1024 * 1024),
});

// Con LogFormat JSON, el runtime serializa el objeto: queda consultable en Logs Insights (message.reason, etc.)
const log = (level, message, data = {}) => console[level]({ message, ...data });

// Las keys llegan URL-encoded en el evento de S3 (los espacios como "+")
export const decodeKey = (key) => decodeURIComponent(key.replace(/\+/g, ' '));

/** Validación previa, sin descargar el objeto. Devuelve el motivo de rechazo o null. */
export const precheck = (key, size, maxBytes) => {
  if (!ALLOWED_EXTENSIONS.has(path.extname(key).toLowerCase())) return 'unsupported-extension';
  if (size > maxBytes) return 'too-large';
  if (size === 0) return 'empty-file';
  return null;
};

const reject = async (bucket, key, reason) => {
  log('warn', 'Imagen rechazada', { bucket, key, reason });
  await s3.send(
    new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: { TagSet: [{ Key: 'validation', Value: 'rejected' }, { Key: 'reason', Value: reason }] },
    }),
  );
  return { key, status: 'rejected', reason };
};

const processRecord = async (record, { destBucket, maxWidth, maxBytes }) => {
  const bucket = record.s3.bucket.name;
  const key = decodeKey(record.s3.object.key);
  const size = record.s3.object.size ?? 0;

  // 1) Validación barata con los metadatos del evento
  const precheckError = precheck(key, size, maxBytes);
  if (precheckError) return reject(bucket, key, precheckError);

  // 2) Validación del contenido real: la extensión puede mentir
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const input = Buffer.from(await object.Body.transformToByteArray());

  let metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    return reject(bucket, key, 'invalid-image');
  }
  const contentType = CONTENT_TYPES[metadata.format];
  if (!contentType) return reject(bucket, key, 'unsupported-format');

  // 3) Redimensionar: rotate() aplica la orientación EXIF; nunca agrandar imágenes pequeñas
  const output = await sharp(input, { animated: metadata.pages > 1 })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .toFormat(metadata.format)
    .toBuffer({ resolveWithObject: true });

  await s3.send(
    new PutObjectCommand({
      Bucket: destBucket,
      Key: key,
      Body: output.data,
      ContentType: contentType,
      Metadata: { 'source-bucket': bucket, 'original-width': String(metadata.width) },
    }),
  );

  log('info', 'Imagen redimensionada', {
    key,
    format: metadata.format,
    original: { width: metadata.width, height: metadata.height, bytes: input.length },
    resized: { width: output.info.width, height: output.info.height, bytes: output.data.length },
  });
  return { key, status: 'resized', width: output.info.width, height: output.info.height };
};

/**
 * Evento: notificación de S3 (s3:ObjectCreated:*)
 * https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html
 *
 * Los errores de validación NO lanzan excepción (el archivo queda etiquetado como rechazado).
 * Los errores inesperados (p. ej. S3 no disponible) sí lanzan, para que Lambda reintente.
 */
export const handler = async (event) => {
  const cfg = config();
  const results = [];
  for (const record of event.Records ?? []) {
    results.push(await processRecord(record, cfg));
  }
  return results;
};
