import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stepsFor,
  distance,
  destination,
  withReturn,
  decodePolyline,
  sampleSketch,
  walkingRoute,
  type Point,
} from '../lib/route.ts';
void test('personal stride changes step estimate and rejects invalid inputs', () => {
  assert.equal(stepsFor(7200, 72), 10000);
  assert.equal(stepsFor(7200, 80), 9000);
  assert.throws(() => stepsFor(20, 0));
  assert.throws(() => stepsFor(NaN, 72));
});
void test('return route doubles distance and reverses the same geometry', () => {
  const route = {
    points: [
      [50, 30],
      [51, 31],
      [52, 32],
    ] as Point[],
    meters: 1200,
    seconds: 900,
  };
  const result = withReturn(route);
  assert.equal(result.meters, 2400);
  assert.equal(result.seconds, 1800);
  assert.deepEqual(result.points, [
    [50, 30],
    [51, 31],
    [52, 32],
    [51, 31],
    [50, 30],
  ]);
  assert.equal(route.points.length, 3);
});
void test('spherical destination stays at target radius', () => {
  for (const bearing of [0, 90, 180, 270])
    assert.ok(
      Math.abs(
        distance([50, 30], destination([50, 30], 1500, bearing)) - 1500,
      ) < 0.01,
    );
});
void test('Valhalla polyline uses precision six', () => {
  assert.deepEqual(decodePolyline('??_ibE_ibE'), [
    [0, 0],
    [0.1, 0.1],
  ]);
  assert.throws(() => decodePolyline('_'));
});
void test('long sketch retains endpoints within waypoint budget', () => {
  const points: Point[] = Array.from({ length: 300 }, (_, i) => [
    50 + i * 0.0001,
    30 + Math.sin(i / 20) * 0.01,
  ]);
  const sampled = sampleSketch(points);
  assert.equal(sampled.length, 18);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled.at(-1), points.at(-1));
});
void test('routing requests walking profile; no straight-line fallback on service failure', async () => {
  const original = globalThis.fetch;
  let body: { costing?: string } = {};
  try {
    globalThis.fetch = async (input) => {
      body = JSON.parse(
        new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        ).searchParams.get('json')!,
      );
      return new Response(
        JSON.stringify({
          trip: {
            status: 0,
            legs: [{ shape: '??_ibE_ibE' }],
            summary: { length: 1.25, time: 900 },
          },
        }),
      );
    };
    const result = await walkingRoute(
      [
        [50, 30],
        [50.01, 30.01],
      ],
      new AbortController().signal,
    );
    assert.equal(result.meters, 1250);
    assert.equal(body.costing, 'pedestrian');
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(
      walkingRoute(
        [
          [50, 30],
          [50.01, 30.01],
        ],
        new AbortController().signal,
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});
