import test from 'node:test';
import assert from 'node:assert/strict';
import { readSession } from '../lib/session.ts';
import {
  eraseBrush,
  brushSamples,
  brushRanges,
  remainingLines,
  segmentDistance,
} from '../lib/brush-erase.ts';
import { sketchLength, withReturn, type Walk } from '../lib/route.ts';
const walk: Walk = {
  points: [
    [50, 30],
    [50.001, 30],
    [50.002, 30.002],
    [50.003, 30],
    [50.004, 30],
  ],
  meters: 900,
  seconds: 700,
};
const session = {
  version: 1,
  start: walk.points[0],
  startLabel: 'Моя геолокація',
  points: [walk.points.at(-1)],
  sketch: walk.points,
  mustVisit: [],
  walk,
  mode: 'draw',
  back: true,
  precision: 'balanced',
  ideaStyle: 'scenic',
};
void test('reload round-trips a complete route in every mode without doubling its return leg', () => {
  for (const mode of ['point', 'multi', 'draw', 'auto']) {
    const saved = { ...session, mode };
    const restored = readSession(JSON.stringify(saved));
    assert.deepEqual(restored, saved);
    assert.equal(withReturn(restored!.walk!).meters, 1800);
  }
});
void test('invalid, missing and future session data cannot break startup', () => {
  for (const value of [
    null,
    '{',
    'null',
    '{}',
    JSON.stringify({ ...session, version: 2 }),
    JSON.stringify({ ...session, start: [400, 30] }),
    JSON.stringify({ ...session, walk: { ...walk, points: [] } }),
  ])
    assert.equal(readSession(value), null);
});
void test('brush hits long sparse segments and fast drags, preserving separate gaps', () => {
  const points = brushSamples(
    [
      [0, 0],
      [0, 1],
    ],
    (p) => ({ x: p[1] * 200, y: 0 }),
  );
  assert.ok(points.length > 30);
  const hits = new Set<number>();
  points.forEach((p, i) => {
    if (
      segmentDistance(
        { x: p[1] * 200, y: 0 },
        { x: 70, y: -40 },
        { x: 70, y: 40 },
      ) < 12
    )
      hits.add(i);
  });
  const ranges = brushRanges(hits, points.length);
  assert.equal(ranges.length, 1);
  assert.equal(remainingLines(points, ranges).length, 2);
  assert.equal(brushRanges(new Set([2, 15]), 20).length, 2);
  assert.equal(
    segmentDistance({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }),
    0,
  );
});
void test('brush removes a retraced spur locally, keeps the rest and recomputes distance', async () => {
  const spur: Walk = {
    points: [
      [50, 30],
      [50.001, 30],
      [50.002, 30],
      [50.001, 30],
      [50.001, 30.002],
    ],
    meters: 500,
    seconds: 400,
  };
  const copy = structuredClone(spur);
  const result = await eraseBrush(
    { walk: spur, ranges: [[1, 3]] },
    new AbortController().signal,
    async () => {
      throw new Error('no service needed');
    },
  );
  assert.ok(result.walk.meters < spur.meters);
  assert.ok(!result.walk.points.includes(spur.points[2]));
  assert.deepEqual(result.walk.points.at(-1), spur.points.at(-1));
  assert.deepEqual(spur, copy);
});
void test('brush sends the erased road as exclusion and preserves untouched geometry', async () => {
  const result = await eraseBrush(
    { walk, ranges: [[1, 3]] },
    new AbortController().signal,
    async (points, signal, exclude) => {
      assert.deepEqual(exclude, [walk.points[2]]);
      return { points, meters: 220, seconds: 160 };
    },
  );
  assert.deepEqual(result.walk.points.slice(0, 2), walk.points.slice(0, 2));
  assert.deepEqual(result.walk.points.slice(-2), walk.points.slice(-2));
  const fraction =
    1 - sketchLength(walk.points.slice(1, 4)) / sketchLength(walk.points);
  assert.equal(result.walk.meters, walk.meters * fraction + 220);
});
void test('the same erased road is rejected even when returned as a sparse segment', async () => {
  const straight: Walk = {
    points: [
      [50, 30],
      [50.001, 30],
      [50.002, 30],
      [50.003, 30],
      [50.004, 30],
    ],
    meters: 445,
    seconds: 320,
  };
  await assert.rejects(
    eraseBrush(
      { walk: straight, ranges: [[1, 3]] },
      new AbortController().signal,
      async (points) => ({ points, meters: 222, seconds: 160 }),
    ),
    /Обхід/,
  );
});
void test('failed requests and aborted strokes leave source unchanged', async () => {
  const copy = structuredClone(walk);
  await assert.rejects(
    eraseBrush(
      { walk, ranges: [[1, 3]] },
      new AbortController().signal,
      async () => {
        throw new Error('offline');
      },
    ),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    eraseBrush({ walk, ranges: [[1, 3]] }, controller.signal),
  );
  assert.deepEqual(walk, copy);
});
