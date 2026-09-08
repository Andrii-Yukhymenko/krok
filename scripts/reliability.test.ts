import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaceCache, FRESH_MS, MAX_AGE_MS } from '../lib/place-cache.ts';
import {
  placesRequest,
  retryPlaces,
  ServiceError,
  diagnosticReport,
  pause,
} from '../lib/service.ts';
import { repeatedRatio, routeScore } from '../lib/route-quality.ts';
import { nearbyPlaces } from '../lib/places.ts';
import type { Point } from '../lib/route.ts';
const source = 'https://overpass-api.de/api/interpreter';
const center: Point = [50, 30];
const place = {
  id: 'way/1',
  name: 'Secret park',
  kind: 'Парк',
  point: [50.001, 30] as Point,
  priority: 3,
};
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
}
void test('cache survives reload, reuses only covered areas and expires after seven days', () => {
  const storage = memory(),
    time = Date.now();
  new PlaceCache(() => storage).put({
    source,
    center,
    radius: 3000,
    time,
    places: [place],
  });
  const reloaded = new PlaceCache(() => storage);
  assert.equal(reloaded.find(source, [50.001, 30], 2000)!.places.length, 1);
  assert.equal(reloaded.find(source, [50.01, 30], 2500), undefined);
  assert.equal(reloaded.find('different-provider', center, 2000), undefined);
  assert.ok(reloaded.find(source, center, 2000, time + FRESH_MS * 2));
  assert.equal(
    reloaded.find(source, center, 2000, time + MAX_AGE_MS),
    undefined,
  );
  reloaded.clear();
  assert.equal(
    new PlaceCache(() => storage).find(source, center, 2000),
    undefined,
  );
});
void test('blocked or corrupt storage cannot break in-memory planning', () => {
  const cache = new PlaceCache(() => {
    throw Error('blocked');
  });
  cache.put({
    source,
    center,
    radius: 1000,
    time: Date.now(),
    places: [place],
  });
  assert.equal(cache.find(source, center, 800)!.places.length, 1);
  assert.equal(
    new PlaceCache(() => ({
      getItem: () => '{broken',
      setItem: () => {},
    })).find(source, center, 800),
    undefined,
  );
});
void test('503 retries once, 429 respects retry-after, invalid response and offline are diagnosed without coordinates', async () => {
  const original = globalThis.fetch,
    signal = new AbortController().signal;
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  let calls = 0;
  const request = () =>
    placesRequest(
      source,
      new URLSearchParams({ data: 'Secret park 50.001,30' }),
      signal,
    );
  try {
    globalThis.fetch = async () => {
      calls++;
      return calls === 1
        ? new Response('', { status: 503 })
        : Response.json({ elements: [] });
    };
    await retryPlaces(request, signal, wait);
    assert.equal(calls, 2);
    assert.deepEqual(waits, [2000]);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('', { status: 429, headers: { 'Retry-After': '8' } });
    };
    await assert.rejects(
      retryPlaces(request, signal, wait),
      (e: unknown) => e instanceof ServiceError && e.code === '429',
    );
    assert.equal(calls, 2);
    assert.equal(waits.at(-1), 8000);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('', { status: 400 });
    };
    await assert.rejects(retryPlaces(request, signal, wait));
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      Response.json({ elements: [], remark: 'runtime exceeded' });
    await assert.rejects(
      request(),
      (e: unknown) => e instanceof ServiceError && e.code === 'incomplete',
    );
    globalThis.fetch = async () => new Response('{broken');
    await assert.rejects(
      request(),
      (e: unknown) => e instanceof ServiceError && e.code === 'invalid-json',
    );
    globalThis.fetch = async () => {
      throw new DOMException('timeout', 'TimeoutError');
    };
    await assert.rejects(
      request(),
      (e: unknown) => e instanceof ServiceError && e.code === 'timeout',
    );
    globalThis.fetch = async () => {
      throw new TypeError('failed fetch');
    };
    await assert.rejects(
      request(),
      (e: unknown) => e instanceof ServiceError && e.code === 'network',
    );
    const report = diagnosticReport();
    assert.ok(report.includes('429') && report.includes('timeout'));
    assert.ok(
      !report.includes('Secret') &&
        !report.includes('50.001') &&
        !report.includes(source),
    );
  } finally {
    globalThis.fetch = original;
  }
});
void test('cancelling a retry delay prevents the next request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const task = retryPlaces(async () => {
    calls++;
    throw new ServiceError('503', 'busy', true);
  }, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(task);
  assert.equal(calls, 1);
  await assert.rejects(async () => pause(100, controller.signal));
});
void test('an outage uses persisted stale places with a visible notice, without retries', async () => {
  const storage = memory();
  new PlaceCache(() => storage).put({
    source,
    center,
    radius: 3000,
    time: Date.now() - 2 * FRESH_MS,
    places: [place],
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  const original = globalThis.fetch;
  let calls = 0,
    notice = '';
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response('', { status: 504 });
    };
    const result = await nearbyPlaces(
      center,
      4000,
      new AbortController().signal,
      (n) => {
        notice = n;
      },
    );
    assert.equal(result[0].id, place.id);
    assert.equal(calls, 1);
    assert.ok(notice.includes('збережені'));
    await nearbyPlaces(center, 4100, new AbortController().signal);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
void test('quality favors similar-length loops but does not reward excessive detours or merge parallel paths', () => {
  const a: Point = [50, 30],
    b: Point = [50.001, 30],
    c: Point = [50.001, 30.001];
  const backtrack = { points: [a, b, c, b, a], meters: 1000, seconds: 800 };
  const loop = { points: [a, b, c, a], meters: 1080, seconds: 850 };
  assert.equal(repeatedRatio(backtrack), 0.5);
  assert.equal(repeatedRatio(loop), 0);
  assert.ok(routeScore(loop, 1000) < routeScore(backtrack, 1000));
  assert.ok(
    routeScore({ ...loop, meters: 1500 }, 1000) > routeScore(backtrack, 1000),
  );
  assert.equal(
    repeatedRatio({
      points: [a, b, [50.001, 30.00001], [50, 30.00001]],
      meters: 230,
      seconds: 180,
    }),
    0,
  );
});
