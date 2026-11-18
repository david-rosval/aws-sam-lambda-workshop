// Tests con el runner nativo de Node.js (node:test): no requiere dependencias.
// Ejecutar con: npm test
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { lambdaHandler, parseQuery } from '../../app.mjs';

const TODOS = [
  { userId: 1, id: 1, title: 'a', completed: false },
  { userId: 1, id: 2, title: 'b', completed: true },
  { userId: 2, id: 3, title: 'c', completed: false },
];

const event = (queryStringParameters) => ({ version: '2.0', rawPath: '/todos', queryStringParameters });

describe('parseQuery', () => {
  it('acepta query vacía', () => {
    assert.deepEqual(parseQuery({}), { filters: {} });
  });

  it('convierte los tipos', () => {
    assert.deepEqual(parseQuery({ limit: '5', userId: '2', completed: 'true' }), {
      filters: { limit: 5, userId: 2, completed: true },
    });
  });

  for (const query of [{ limit: '0' }, { limit: '201' }, { limit: 'abc' }, { userId: '-1' }, { completed: 'yes' }]) {
    it(`rechaza ${JSON.stringify(query)}`, () => {
      assert.ok(parseQuery(query).error);
    });
  }
});

describe('lambdaHandler', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = mock.method(globalThis, 'fetch', async () => Response.json(TODOS));
  });

  afterEach(() => mock.restoreAll());

  it('devuelve 200 con todos los TODOs', async () => {
    const res = await lambdaHandler(event());
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 3);
    assert.deepEqual(body.items, TODOS);
  });

  it('aplica limit y pasa los filtros al upstream', async () => {
    const res = await lambdaHandler(event({ limit: '2', userId: '1', completed: 'false' }));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).count, 2);

    const calledUrl = new URL(fetchMock.mock.calls[0].arguments[0]);
    assert.equal(calledUrl.pathname, '/todos');
    assert.equal(calledUrl.searchParams.get('userId'), '1');
    assert.equal(calledUrl.searchParams.get('completed'), 'false');
  });

  it('devuelve 400 si los parámetros son inválidos (sin llamar al upstream)', async () => {
    const res = await lambdaHandler(event({ limit: '999' }));
    assert.equal(res.statusCode, 400);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('devuelve 502 si el upstream responde con error', async () => {
    fetchMock.mock.mockImplementation(async () => new Response('boom', { status: 500 }));
    const res = await lambdaHandler(event());
    assert.equal(res.statusCode, 502);
  });

  it('devuelve 502 si el upstream no responde (timeout / red)', async () => {
    fetchMock.mock.mockImplementation(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const res = await lambdaHandler(event());
    assert.equal(res.statusCode, 502);
  });
});
