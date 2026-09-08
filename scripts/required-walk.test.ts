import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredWalk, insertStops } from '../lib/required-walk.ts';
import type { Point } from '../lib/route.ts';
const start: Point = [50, 30],
  a: Point = [50.002, 30],
  b: Point = [50.003, 30.003],
  extra: Point = [50.004, 30.001];
void test('optional insertion preserves required stops and their order in a closed walk', () => {
  const points = insertStops(start, [a, b], [extra, [50.001, 30.004]]);
  assert.equal(points[0], start);
  assert.equal(points.at(-1), start);
  assert.ok(points.indexOf(a) < points.indexOf(b));
  assert.equal(points.filter((p) => p === a).length, 1);
});
void test('scenic suggestions keep required visits while adding a place to approach the target', async () => {
  const requests: Point[][] = [];
  const result = await requiredWalk(
    start,
    [a, b],
    2000,
    'scenic',
    new AbortController().signal,
    0,
    {
      route: async (points) => {
        requests.push(points);
        return {
          points,
          meters: points.length === 4 ? 800 : 2000,
          seconds: 1000,
        };
      },
      places: async () => [
        { id: 'way/1', name: 'Park', kind: 'Парк', priority: 3, point: extra },
      ],
      random: () => 0,
    },
  );
  assert.equal(result.walk.meters, 2000);
  assert.equal(result.places.length, 1);
  for (const points of requests) {
    assert.ok(points.includes(a) && points.includes(b));
    assert.ok(points.indexOf(a) < points.indexOf(b));
  }
});
void test('over-target required route is retained and does not fetch extra places', async () => {
  const result = await requiredWalk(
    start,
    [a],
    300,
    'scenic',
    new AbortController().signal,
    0,
    {
      route: async (points) => ({ points, meters: 1000, seconds: 800 }),
      places: async () => {
        throw Error('must not query places');
      },
      random: () => 0,
    },
  );
  assert.equal(result.walk.meters, 1000);
  assert.match(result.notice, /перевищують/);
});
void test('place outages retain the base route; unreachable required stops fail explicitly', async () => {
  const deps = {
    route: async (points: Point[]) => ({ points, meters: 600, seconds: 500 }),
    places: async () => {
      throw Error('Unavailable');
    },
    random: () => 0,
  };
  const result = await requiredWalk(
    start,
    [a],
    2000,
    'scenic',
    new AbortController().signal,
    0,
    deps,
  );
  assert.equal(result.walk.meters, 600);
  assert.match(result.notice, /не вдалося/);
  await assert.rejects(
    requiredWalk(start, [b], 2000, 'random', new AbortController().signal, 0, {
      ...deps,
      route: async () => ({ points: [start, a], meters: 600, seconds: 500 }),
    }),
    /проходу/,
  );
});
void test('random extensions also preserve all visits and cancellation is not swallowed', async () => {
  const controller = new AbortController();
  let calls = 0;
  await requiredWalk(start, [a, b], 2000, 'random', controller.signal, 0, {
    route: async (points) => {
      calls++;
      assert.ok(points.includes(a) && points.includes(b));
      return { points, meters: points.length === 4 ? 600 : 1950, seconds: 500 };
    },
    places: async () => {
      throw Error('not needed');
    },
    random: () => 0.25,
  });
  assert.equal(calls, 4);
  controller.abort();
  await assert.rejects(
    requiredWalk(start, [a], 2000, 'scenic', controller.signal),
  );
});
