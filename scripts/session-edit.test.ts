import test from 'node:test';
import assert from 'node:assert/strict';
import { readSession } from '../lib/session.ts';
import { eraseSection } from '../lib/erase-section.ts';
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
void test('eraser preserves surrounding geometry, accepts reverse selection and recomputes metrics', async () => {
  const original = structuredClone(walk);
  const bridge: Walk = {
    points: [walk.points[1], walk.points[3]],
    meters: 220,
    seconds: 160,
  };
  const result = await eraseSection(
    walk,
    3,
    1,
    new AbortController().signal,
    async () => bridge,
  );
  assert.deepEqual(result.points.slice(0, 2), walk.points.slice(0, 2));
  assert.deepEqual(result.points.slice(-2), walk.points.slice(-2));
  assert.ok(!result.points.includes(walk.points[2]));
  const fraction =
    1 - sketchLength(walk.points.slice(1, 4)) / sketchLength(walk.points);
  assert.equal(result.meters, walk.meters * fraction + 220);
  assert.equal(result.seconds, walk.seconds * fraction + 160);
  assert.deepEqual(walk, original);
});
void test('failed or invalid edits leave the source intact', async () => {
  const original = structuredClone(walk);
  await assert.rejects(eraseSection(walk, 1, 1, new AbortController().signal));
  await assert.rejects(
    eraseSection(walk, 1, 3, new AbortController().signal, async () => {
      throw new Error('offline');
    }),
  );
  assert.deepEqual(walk, original);
});
void test('closed detour can be removed without requesting a zero-length route', async () => {
  const loop = {
    ...walk,
    points: [
      walk.points[0],
      walk.points[1],
      walk.points[2],
      walk.points[1],
      walk.points[4],
    ],
  };
  const result = await eraseSection(
    loop,
    1,
    3,
    new AbortController().signal,
    async () => {
      throw new Error('should not route');
    },
  );
  assert.ok(result.meters < loop.meters);
});
