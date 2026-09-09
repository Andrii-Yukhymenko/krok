import { distance, sketchLength, walkingRoute, type Walk } from './route.ts';

// Only replace the selected interval; preserve the rest of the geometry exactly.
export async function eraseSection(
  walk: Walk,
  first: number,
  last: number,
  signal: AbortSignal,
  route = walkingRoute,
): Promise<Walk> {
  const a = Math.min(first, last),
    b = Math.max(first, last);
  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < 0 ||
    b >= walk.points.length ||
    b - a < 2
  )
    throw new Error('Оберіть дві різні точки по обидва боки зайвої ділянки.');
  const from = walk.points[a],
    to = walk.points[b];
  const bridge =
    distance(from, to) < 2
      ? {
          points: [from, to],
          meters: distance(from, to),
          seconds: distance(from, to) / 1.4,
        }
      : await route([from, to], signal);
  if (
    distance(from, bridge.points[0]) > 30 ||
    distance(to, bridge.points.at(-1)!) > 30
  )
    throw new Error(
      'Не вдалося точно з’єднати ділянку. Оберіть точки ближче до дороги.',
    );
  const total = sketchLength(walk.points);
  const removed = sketchLength(walk.points.slice(a, b + 1));
  const retained = total > 0 ? Math.max(0, 1 - removed / total) : 0;
  const joins =
    distance(from, bridge.points[0]) + distance(to, bridge.points.at(-1)!);
  return {
    points: [
      ...walk.points.slice(0, a + 1),
      ...bridge.points,
      ...walk.points.slice(b),
    ],
    meters: walk.meters * retained + bridge.meters + joins,
    seconds: walk.seconds * retained + bridge.seconds + joins / 1.4,
  };
}
