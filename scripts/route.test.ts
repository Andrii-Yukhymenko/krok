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
  sketchRoute,
  traceSamples,
  cleanSketchSpurs,
  sketchGuides,
  type Point,
} from '../lib/route.ts';
import { directionLane, directionArrows } from '../lib/route-display.ts';

void test('short accidental retrace is removed without shortcuts or inflated distance', () => {
  const a: Point = [50, 30],
    b: Point = [50.001, 30],
    c: Point = [50.001, 30.001],
    d: Point = [50.002, 30];
  const walk = { points: [a, b, c, b, d], meters: 360, seconds: 300 };
  const result = cleanSketchSpurs(walk, [a, b, d]);
  assert.deepEqual(result.points, [a, b, d]);
  assert.ok(result.meters < 360 && result.seconds < 300);
  assert.equal(cleanSketchSpurs(walk, [a, b, c, b, d]), walk);
  const nearB: Point = [b[0] + 0.000015, b[1]];
  const fuzzy = { ...walk, points: [a, b, c, nearB, d] };
  assert.deepEqual(cleanSketchSpurs(fuzzy, [a, b, d]).points, [a, b, d]);
  const loop = { ...walk, points: [a, b, c, d, b, a] };
  assert.equal(cleanSketchSpurs(loop, [a, d, a]), loop);
  const returning = { ...walk, points: [a, b, c, b, a] };
  assert.equal(cleanSketchSpurs(returning, [a, b, c, b, a]), returning);
});
void test('opposite travel directions occupy separate pixel lanes with oriented arrows', () => {
  const forward = directionLane([
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ]);
  const back = directionLane([
    { x: 200, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.equal(forward[0].y, 4);
  assert.equal(back[0].y, -4);
  const f = directionArrows(forward)[0],
    b = directionArrows(back)[0];
  assert.ok(f[1].x > f[0].x);
  assert.ok(b[1].x < b[0].x);
  assert.ok(
    directionLane([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
});
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
void test('loose sketch uses broad through-guides and preserves the contour endpoints', async () => {
  const original = globalThis.fetch;
  const center: Point = [50.45, 30.52];
  const sketch = Array.from({ length: 101 }, (_, i) =>
    destination(center, 400, i * 3.6),
  );
  const loose = sketchGuides(sketch, 'loose'),
    balanced = sketchGuides(sketch, 'balanced');
  assert.ok(loose.anchors.length >= 4 && loose.anchors.length <= 8);
  assert.ok(balanced.anchors.length >= loose.anchors.length);
  assert.deepEqual(loose.anchors[0], sketch[0]);
  assert.deepEqual(loose.anchors.at(-1), sketch.at(-1));
  const radii: number[] = [];
  try {
    globalThis.fetch = async (url) => {
      assert.ok(typeof url === 'string' && url.includes('/route?'));
      const body = JSON.parse(new URL(String(url)).searchParams.get('json')!);
      const middle = body.locations.slice(1, -1);
      assert.ok(
        middle.length &&
          middle.every(
            (p: { type: string; rank_candidates: boolean }) =>
              p.type === 'through' && p.rank_candidates === false,
          ),
      );
      assert.equal(body.locations[0].type, 'break');
      assert.equal(body.costing, 'pedestrian');
      assert.ok(body.costing_options.pedestrian.service_factor >= 4);
      radii.push(middle[0].radius);
      return Response.json({
        trip: {
          status: 0,
          legs: [{ shape: encode(sketch) }],
          summary: { length: 2.6, time: 1900 },
        },
      });
    };
    const walk = await sketchRoute(
      sketch[0],
      sketch,
      new AbortController().signal,
    );
    assert.equal(walk.meters, 2600);
    await sketchRoute(
      sketch[0],
      sketch,
      new AbortController().signal,
      'balanced',
    );
    assert.deepEqual(radii, [200, 100]);
    globalThis.fetch = async () =>
      Response.json({
        trip: {
          status: 0,
          legs: [{ shape: encode(sketch) }],
          summary: { length: 12, time: 9000 },
        },
      });
    await assert.rejects(
      sketchRoute(sketch[0], sketch, new AbortController().signal),
      /обхід/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
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
  assert.ok(sampled.length > 2 && sampled.length < points.length);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled.at(-1), points.at(-1));
});
void test('short noisy straight sketch has two bends rather than 18 compulsory stops', () => {
  const points: Point[] = Array.from({ length: 80 }, (_, i) => [
    50 + i * 0.00001,
    30 + (i % 2) * 0.00002,
  ]);
  assert.equal(sampleSketch(points).length, 2);
  assert.ok(traceSamples(points).length < 10);
  const corner: Point[] = [
    [50, 30],
    [50.002, 30],
    [50.002, 30.002],
  ];
  assert.deepEqual(sampleSketch(corner), corner);
});
void test('sketch matches the line and replaces fragmented matches with a through-route', async () => {
  const original = globalThis.fetch;
  const shape: Point[] = [
    [50, 30],
    [50.001, 30],
    [50.002, 30],
  ];
  let partial = false;
  let fallback = false;
  try {
    globalThis.fetch = async (url, init) => {
      if (partial && typeof url === 'string' && url.includes('/route?')) {
        fallback = true;
        const body = JSON.parse(new URL(url).searchParams.get('json')!);
        assert.ok(body.locations.length <= 8);
        assert.ok(
          body.locations
            .slice(1, -1)
            .every((p: { type: string }) => p.type === 'through'),
        );
        return new Response(
          JSON.stringify({
            trip: {
              status: 0,
              legs: [{ shape: encode(shape) }],
              summary: { length: 0.24, time: 180 },
            },
          }),
        );
      }
      assert.ok(typeof url === 'string' && url.endsWith('/trace_route'));
      assert.equal(init?.method, 'POST');
      const body = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as {
        shape_match: string;
        locations?: unknown;
        shape: { type?: string }[];
        costing_options: { pedestrian: { service_factor: number } };
      };
      assert.equal(body.shape_match, 'map_snap');
      assert.equal(body.locations, undefined);
      assert.ok(body.shape.every((p) => p.type === undefined));
      assert.ok(body.costing_options.pedestrian.service_factor > 1);
      return new Response(
        JSON.stringify({
          trip: {
            status: 0,
            legs: [{ shape: encode(shape) }],
            summary: { length: 0.24, time: 180 },
          },
          ...(partial ? { alternates: [{}] } : {}),
        }),
      );
    };
    const walk = await sketchRoute(
      shape[0],
      shape,
      new AbortController().signal,
      'precise',
    );
    assert.equal(walk.meters, 240);
    partial = true;
    assert.equal(
      (
        await sketchRoute(
          shape[0],
          shape,
          new AbortController().signal,
          'precise',
        )
      ).meters,
      240,
    );
    assert.equal(fallback, true);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(
      sketchRoute(shape[0], shape, new AbortController().signal, 'precise'),
    );
  } finally {
    globalThis.fetch = original;
  }
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
