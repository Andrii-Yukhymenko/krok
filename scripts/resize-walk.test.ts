import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleShape, trimWalk, resizeWalk } from '../lib/resize-walk.ts';
import { sketchLength, withReturn, type Point } from '../lib/route.ts';
const a: Point = [50, 30],
  b: Point = [50.002, 30],
  c: Point = [50.002, 30.003];
const base = { points: [a, b, c], meters: 500, seconds: 400 };
const options = {
  base,
  start: a,
  required: [b, c],
  mode: 'multi',
  style: 'random',
  target: 800,
};
const signal = () => new AbortController().signal;
void test('trimming follows existing bends, scales distance and time and leaves the original intact', () => {
  const cut = trimWalk(base, 400);
  assert.deepEqual(cut.points.slice(0, 2), [a, b]);
  assert.equal(cut.points.at(-1)![0], c[0]);
  assert.equal(cut.meters, 400);
  assert.equal(cut.seconds, 320);
  assert.ok(
    Math.abs(sketchLength(cut.points) / sketchLength(base.points) - 0.8) <
      0.001,
  );
  assert.deepEqual(base.points, [a, b, c]);
  const back = withReturn(cut);
  assert.equal(back.meters, 800);
  assert.deepEqual(back.points.at(-1), a);
});
void test('shorter free sketch moves finish without a service call', async () => {
  let routed: Point[] = [];
  const result = await resizeWalk(
    { ...options, mode: 'draw', target: 300 },
    signal(),
    {
      route: async (points) => {
        routed = points;
        return { points, meters: 300, seconds: 240 };
      },
      scenic: async () => {
        throw Error('unused');
      },
      required: async () => {
        throw Error('unused');
      },
    },
  );
  assert.equal(result.walk.meters, 300);
  assert.equal(routed[0], a);
  assert.ok(distanceFrom(a, routed.at(-1)!) < distanceFrom(a, c));
});
void test('shape scaling keeps the start fixed and changes every bend proportionally', () => {
  const scaled = scaleShape([a, b, c], 2);
  assert.equal(scaled[0], a);
  assert.ok(Math.abs(distanceFrom(a, scaled[1]) / distanceFrom(a, b) - 2) < 0.01);
  assert.ok(Math.abs(distanceFrom(a, scaled[2]) / distanceFrom(a, c) - 2) < 0.01);
});
void test('shortening a random idea stays closed', async () => {
  const result = await resizeWalk(
    { ...options, mode: 'auto', required: [], target: 300 },
    signal(),
  );
  assert.equal(result.walk.meters, 300);
  assert.deepEqual(result.walk.points[0], result.walk.points.at(-1));
});
void test('extensions preserve original stops, endpoints and measured totals', async () => {
  const result = await resizeWalk(options, signal(), {
    route: async (points) => ({ points, meters: 300, seconds: 200 }),
    scenic: async () => {
      throw Error('unused');
    },
    required: async () => {
      throw Error('unused');
    },
  });
  assert.equal(result.walk.meters, 800);
  assert.equal(result.walk.seconds, 600);
  assert.deepEqual(result.walk.points[0], a);
  assert.notDeepEqual(result.walk.points.at(-1), c);
  assert.ok(result.walk.points.includes(b));
  assert.deepEqual(result.waypoints?.slice(0, 2), [b, c]);
});
void test('a shorter target never silently drops required stops or replaces the route with a longer one', async () => {
  const deps = {
    route: async () => ({ ...base, meters: 700 }),
    scenic: async () => {
      throw Error('unused');
    },
    required: async () => {
      throw Error('unused');
    },
  };
  const result = await resizeWalk({ ...options, target: 200 }, signal(), deps);
  assert.equal(result.walk.meters, 200);
  assert.notDeepEqual(result.walk.points.at(-1), c);
  assert.deepEqual(result.waypoints?.at(-1), result.walk.points.at(-1));
});
void test('idea resizing forwards required stops and new target to the appropriate generator', async () => {
  let forwarded = false;
  const result = await resizeWalk(
    { ...options, mode: 'auto', style: 'scenic' },
    signal(),
    {
      route: async () => {
        throw Error('unused');
      },
      scenic: async () => {
        throw Error('unused');
      },
      required: async (start, stops, target) => {
        forwarded = true;
        assert.deepEqual(start, a);
        assert.deepEqual(stops, [b, c]);
        assert.equal(target, 800);
        return { walk: base, places: [], notice: 'minimum' };
      },
    },
  );
  assert.ok(forwarded);
  assert.equal(result.notice, 'minimum');
});

function distanceFrom(x: Point, y: Point) {
  return sketchLength([x, y]);
}
void test('failed extensions preserve the base; cancellation and invalid targets reject', async () => {
  const deps = {
    route: async () => {
      throw Error('offline');
    },
    scenic: async () => {
      throw Error('unused');
    },
    required: async () => {
      throw Error('unused');
    },
  };
  assert.equal((await resizeWalk(options, signal(), deps)).walk, base);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resizeWalk(options, controller.signal, deps));
  await assert.rejects(resizeWalk({ ...options, target: NaN }, signal(), deps));
});
