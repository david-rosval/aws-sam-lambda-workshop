/**
 * GET /todos  →  proxy a https://jsonplaceholder.typicode.com/todos
 *
 * Query params opcionales:
 *   - limit      número entre 1 y 200 (cantidad máxima de resultados)
 *   - userId     número entero positivo (filtra por usuario)
 *   - completed  "true" | "false" (filtra por estado)
 *
 * Evento: API Gateway HTTP API, payload format 2.0
 * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html
 */

const BASE_URL = process.env.TODOS_BASE_URL ?? 'https://jsonplaceholder.typicode.com';
const UPSTREAM_TIMEOUT_MS = 5000;
const MAX_LIMIT = 200;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Valida y normaliza los query params. Devuelve { error } o { filters }.
 */
export const parseQuery = (query = {}) => {
  const filters = {};

  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return { error: `limit debe ser un entero entre 1 y ${MAX_LIMIT}` };
    }
    filters.limit = limit;
  }

  if (query.userId !== undefined) {
    const userId = Number(query.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      return { error: 'userId debe ser un entero positivo' };
    }
    filters.userId = userId;
  }

  if (query.completed !== undefined) {
    if (query.completed !== 'true' && query.completed !== 'false') {
      return { error: 'completed debe ser "true" o "false"' };
    }
    filters.completed = query.completed === 'true';
  }

  return { filters };
};

export const lambdaHandler = async (event) => {
  const { error, filters } = parseQuery(event.queryStringParameters ?? {});
  if (error) {
    return json(400, { message: error });
  }

  const url = new URL('/todos', BASE_URL);
  if (filters.userId !== undefined) url.searchParams.set('userId', String(filters.userId));
  if (filters.completed !== undefined) url.searchParams.set('completed', String(filters.completed));

  let todos;
  try {
    // fetch es nativo en Node.js 18+: no hace falta axios ni otra dependencia
    const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!response.ok) {
      console.error({ message: 'Upstream respondió con error', status: response.status, url: url.href });
      return json(502, { message: 'Error al consultar el servicio de TODOs' });
    }
    todos = await response.json();
  } catch (err) {
    console.error({ message: 'Fallo al llamar al upstream', error: err.name, detail: err.message });
    return json(502, { message: 'Error al consultar el servicio de TODOs' });
  }

  const items = filters.limit ? todos.slice(0, filters.limit) : todos;
  console.info({ message: 'TODOs devueltos', count: items.length, filters });

  return json(200, { count: items.length, items });
};
