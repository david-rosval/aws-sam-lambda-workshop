// Tests con el runner nativo de Node.js (node:test). S3 se simula con aws-sdk-client-mock.
// Ejecutar con: npm test
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mockClient } from 'aws-sdk-client-mock';
import { GetObjectCommand, PutObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { handler, s3, decodeKey, precheck } from '../../../src/handlers/resize.mjs';

process.env.DEST_BUCKET = 'resized-bucket';
process.env.MAX_WIDTH = '800';
process.env.MAX_BYTES = String(1024 * 1024);

const s3Mock = mockClient(s3);

const s3Event = (key, size) => ({
  Records: [{ s3: { bucket: { name: 'uploads-bucket' }, object: { key, size } } }],
});

const body = (buffer) => ({ transformToByteArray: async () => new Uint8Array(buffer) });

let bigPng;
before(async () => {
  bigPng = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .png()
    .toBuffer();
});

beforeEach(() => s3Mock.reset());

describe('helpers', () => {
  it('decodeKey decodifica keys URL-encoded', () => {
    assert.equal(decodeKey('mis+fotos/caf%C3%A9.jpg'), 'mis fotos/café.jpg');
  });

  it('precheck valida extensión y tamaño', () => {
    assert.equal(precheck('a.JPG', 100, 1000), null);
    assert.equal(precheck('a.txt', 100, 1000), 'unsupported-extension');
    assert.equal(precheck('a.png', 5000, 1000), 'too-large');
    assert.equal(precheck('a.png', 0, 1000), 'empty-file');
  });
});

describe('handler', () => {
  it('redimensiona una imagen válida y la guarda en el bucket destino', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: body(bigPng) });
    s3Mock.on(PutObjectCommand).resolves({});

    const [result] = await handler(s3Event('fotos/grande.png', bigPng.length));

    assert.equal(result.status, 'resized');
    assert.equal(result.width, 800);
    assert.equal(result.height, 600);

    const put = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    assert.equal(put.Bucket, 'resized-bucket');
    assert.equal(put.Key, 'fotos/grande.png');
    assert.equal(put.ContentType, 'image/png');
    const meta = await sharp(put.Body).metadata();
    assert.equal(meta.width, 800);
  });

  it('no agranda imágenes más pequeñas que MAX_WIDTH', async () => {
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer();
    s3Mock.on(GetObjectCommand).resolves({ Body: body(small) });
    s3Mock.on(PutObjectCommand).resolves({});

    const [result] = await handler(s3Event('chica.jpg', small.length));
    assert.equal(result.width, 200);
  });

  it('rechaza un archivo que no es imagen aunque tenga extensión .jpg', async () => {
    const fake = Buffer.from('esto no es una imagen');
    s3Mock.on(GetObjectCommand).resolves({ Body: body(fake) });
    s3Mock.on(PutObjectTaggingCommand).resolves({});

    const [result] = await handler(s3Event('falsa.jpg', fake.length));

    assert.deepEqual(result, { key: 'falsa.jpg', status: 'rejected', reason: 'invalid-image' });
    assert.equal(s3Mock.commandCalls(PutObjectCommand).length, 0);
    const tags = s3Mock.commandCalls(PutObjectTaggingCommand)[0].args[0].input.Tagging.TagSet;
    assert.deepEqual(tags[0], { Key: 'validation', Value: 'rejected' });
  });

  it('rechaza archivos demasiado grandes sin descargarlos', async () => {
    s3Mock.on(PutObjectTaggingCommand).resolves({});

    const [result] = await handler(s3Event('enorme.png', 50 * 1024 * 1024));

    assert.equal(result.reason, 'too-large');
    assert.equal(s3Mock.commandCalls(GetObjectCommand).length, 0);
  });

  it('rechaza extensiones no permitidas', async () => {
    s3Mock.on(PutObjectTaggingCommand).resolves({});
    const [result] = await handler(s3Event('documento.pdf', 1000));
    assert.equal(result.reason, 'unsupported-extension');
  });

  it('propaga errores inesperados de S3 para que Lambda reintente', async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error('S3 caído'));
    await assert.rejects(handler(s3Event('foto.png', 1000)), /S3 caído/);
  });
});
