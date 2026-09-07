import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStepCount,
  readProfile,
  strideFromHeight,
} from '../lib/profile.ts';
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
void test('empty step fields save zero and zero survives profile reload', () => {
  assert.equal(parseStepCount('', 50000), 0);
  assert.equal(parseStepCount('   ', 100000), 0);
  assert.equal(parseStepCount('12000', 50000), 12000);
  assert.equal(parseStepCount('-20', 50000), 0);
  assert.equal(parseStepCount('50001', 50000), 50000);
  assert.equal(
    readProfile({ goal: 0, done: 0, date: '2026-09-07' }, '2026-09-07').goal,
    0,
  );
});
void test('height estimates one step and old stride is not mistaken for height', () => {
  assert.equal(strideFromHeight(180), 73.8);
  assert.equal(strideFromHeight(160), 65.6);
  assert.throws(() => strideFromHeight(0));
  assert.throws(() => strideFromHeight(NaN));
  assert.equal(
    readProfile({ stride: 80, goal: 12000 }, '2026-09-07').height,
    175,
  );
  assert.equal(
    readProfile({ height: 180, done: 1000, date: '2026-09-06' }, '2026-09-07')
      .done,
    0,
  );
});

function encode(points: Point[]) {
  let lat = 0,
    lon = 0,
    out = '';
  for (const p of points) {
    const next = [Math.round(p[0] * 1e6), Math.round(p[1] * 1e6)];
    for (const delta of [next[0] - lat, next[1] - lon]) {
      let n = delta < 0 ? ~(delta << 1) : delta << 1;
      while (n >= 32) {
        out += String.fromCharCode((32 | (n & 31)) + 63);
        n >>= 5;
      }
      out += String.fromCharCode(n + 63);
    }
    [lat, lon] = next;
  }
  return out;
}
void test('19-point sketch is split at the ten-location limit without losing waypoints', async () => {
  const original = globalThis.fetch;
  const input: Point[] = Array.from({ length: 19 }, (_, i) => [
    50,
    30 + i * 0.0001,
  ]);
  const requests: Point[][] = [];
  try {
    globalThis.fetch = async (url) => {
      const parsed = new URL(
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      );
      const body = JSON.parse(parsed.searchParams.get('json')!) as {
        locations: { lat: number; lon: number }[];
      };
      assert.ok(body.locations.length <= 10);
      const locations = body.locations.map(({ lat, lon }): Point => [lat, lon]);
      requests.push(locations);
      return new Response(
        JSON.stringify({
          trip: {
            status: 0,
            legs: [{ shape: encode(locations) }],
            summary: { length: 1, time: 600 },
          },
        }),
      );
    };
    const result = await walkingRoute(input, new AbortController().signal);
    assert.deepEqual(
      requests.map((r) => r.length),
      [10, 10],
    );
    assert.deepEqual([...requests[0], ...requests[1].slice(1)], input);
    assert.equal(result.meters, 2000);
    assert.equal(result.seconds, 1200);
    assert.deepEqual(result.points[0], input[0]);
    assert.deepEqual(result.points.at(-1), input.at(-1));
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 2) return new Response('', { status: 503 });
      return new Response(
        JSON.stringify({
          trip: {
            status: 0,
            legs: [{ shape: encode(input.slice(0, 10)) }],
            summary: { length: 1, time: 600 },
          },
        }),
      );
    };
    await assert.rejects(walkingRoute(input, new AbortController().signal));
  } finally {
    globalThis.fetch = original;
  }
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
