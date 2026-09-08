type Diagnostic = {
  time: string;
  service: string;
  outcome: string;
  status?: number;
  ms: number;
};
const events: Diagnostic[] = [];
export function recordService(
  service: string,
  outcome: string,
  ms = 0,
  status?: number,
) {
  events.push({
    time: new Date().toISOString(),
    service,
    outcome,
    ms: Math.round(ms),
    ...(status ? { status } : {}),
  });
  if (events.length > 30) events.shift();
}
export function diagnosticReport() {
  return JSON.stringify({ app: 'Крок', format: 1, events }, null, 2);
}
export async function routingFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    recordService(
      'routing',
      response.ok ? 'ok' : 'http-error',
      Date.now() - started,
      response.status,
    );
    return response;
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    recordService(
      'routing',
      timeout ? 'timeout' : init.signal?.aborted ? 'cancelled' : 'network',
      Date.now() - started,
    );
    if (init.signal?.aborted && !timeout) throw error;
    throw new Error(
      timeout
        ? 'Сервіс маршрутів не відповів вчасно. Спробуйте пізніше.'
        : 'Сервіс маршрутів недоступний. Перевірте інтернет або спробуйте пізніше.',
    );
  }
}
export class ServiceError extends Error {
  code: string;
  retryable: boolean;
  retryAfter: number;
  constructor(
    code: string,
    message: string,
    retryable = false,
    retryAfter = 0,
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export async function placesRequest<T>(
  url: string,
  body: URLSearchParams,
  signal: AbortSignal,
): Promise<T> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    });
    if (!response.ok) {
      const status = response.status;
      recordService('places', 'http-error', Date.now() - started, status);
      const header = response.headers.get('Retry-After');
      const seconds = header === null ? 0 : Number(header);
      const retryAfter = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Math.max(0, Date.parse(header!) - Date.now()) || 0;
      throw new ServiceError(
        String(status),
        status === 429
          ? 'Сервіс місць обмежив запити. Зачекайте трохи перед новою спробою.'
          : status >= 500
            ? 'Сервіс місць перевантажений або тимчасово недоступний. Спробуйте пізніше.'
            : 'Сервіс місць відхилив запит. Збережіть звіт про помилку.',
        status === 429 || status >= 500,
        retryAfter,
      );
    }
    const data = (await response.json()) as {
      elements?: unknown[];
      remark?: unknown;
    } | null;
    if (!Array.isArray(data?.elements) || data.remark) {
      recordService('places', 'incomplete', Date.now() - started);
      throw new ServiceError(
        'incomplete',
        'Сервіс повернув неповні дані про місця. Спробуйте пізніше.',
        true,
      );
    }
    recordService('places', 'ok', Date.now() - started, response.status);
    return data as T;
  } catch (error) {
    if (signal.aborted) {
      recordService('places', 'cancelled', Date.now() - started);
      throw signal.reason;
    }
    if (error instanceof ServiceError) throw error;
    if (error instanceof SyntaxError) {
      recordService('places', 'invalid-json', Date.now() - started);
      throw new ServiceError(
        'invalid-json',
        'Сервіс місць повернув некоректну відповідь. Спробуйте пізніше.',
        true,
      );
    }
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    recordService(
      'places',
      timeout
        ? 'timeout'
        : error instanceof SyntaxError
          ? 'invalid-json'
          : 'network',
      Date.now() - started,
    );
    throw new ServiceError(
      timeout ? 'timeout' : 'network',
      timeout
        ? 'Сервіс місць не відповів вчасно. Спробуйте пізніше.'
        : 'Не вдалося отримати дані місць. Перевірте інтернет; якщо він працює, спробуйте пізніше.',
      true,
    );
  }
}

export async function retryPlaces<T>(
  request: () => Promise<T>,
  signal: AbortSignal,
  wait = pause,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await request();
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (
        attempt ||
        !(error instanceof ServiceError) ||
        !error.retryable ||
        error.retryAfter > 30000
      )
        throw error;
      recordService('places', 'retry');
      await wait(Math.max(2000, error.retryAfter), signal);
    }
  }
}
