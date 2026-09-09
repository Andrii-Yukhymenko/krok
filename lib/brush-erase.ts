import {
  distance,
  sketchLength,
  walkingRoute,
  type Point,
  type Walk,
} from './route.ts';
export type EraseRange = [number, number];
export type BrushEdit = { walk: Walk; ranges: EraseRange[] };
export type Pixel = { x: number; y: number };
export function segmentDistance(p: Pixel, a: Pixel, b: Pixel) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
// Densify long road segments so the brush works between vertices too.
export function brushSamples(
  points: Point[],
  project: (p: Point) => Pixel,
): Point[] {
  const result: Point[] = [points[0]];
  const projected = points.map(project);
  let totalPixels = 0;
  for (let i = 1; i < projected.length; i++)
    totalPixels += Math.hypot(
      projected[i].x - projected[i - 1].x,
      projected[i].y - projected[i - 1].y,
    );
  const spacing = Math.max(5, totalPixels / 40000);
  for (let i = 1; i < points.length; i++) {
    const a = projected[i - 1],
      b = projected[i];
    const count = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing),
    );
    for (let j = 1; j <= count; j++)
      result.push([
        points[i - 1][0] + ((points[i][0] - points[i - 1][0]) * j) / count,
        points[i - 1][1] + ((points[i][1] - points[i - 1][1]) * j) / count,
      ]);
  }
  return result;
}
export function brushRanges(hits: Set<number>, count: number): EraseRange[] {
  const result: EraseRange[] = [];
  for (const i of [...hits].sort((a, b) => a - b)) {
    const a = Math.max(0, i - 1),
      b = Math.min(count - 1, i + 1);
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}
export function remainingLines(
  points: Point[],
  ranges: EraseRange[],
): Point[][] {
  const lines: Point[][] = [];
  let start = 0;
  for (const [a, b] of ranges) {
    lines.push(points.slice(start, a + 1));
    start = b;
  }
  lines.push(points.slice(start));
  return lines.filter((line) => line.length > 1);
}
// Expand a touched out-and-back spur to its shoulders. This removes the whole
// unwanted excursion instead of asking the router to recreate its tip.
export function expandSpur(points: Point[], range: EraseRange): EraseRange {
  const [a, b] = range;
  let left = a,
    right = b,
    travel = 0;
  while (left > 0 && travel < 500) {
    travel += distance(points[left], points[left - 1]);
    left--;
  }
  travel = 0;
  while (right < points.length - 1 && travel < 500) {
    travel += distance(points[right], points[right + 1]);
    right++;
  }
  let best: EraseRange = range,
    span = Infinity;
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
  for (let i = a; i >= left; i--)
    for (let j = b; j <= right; j++) {
      if (j - i >= span) break;
      if (distance(points[i], points[j]) < 8 && lengths[j] - lengths[i] > 30) {
        best = [i, j];
        span = j - i;
      }
    }
  if (span < Infinity) return best;
  return range;
}
export async function eraseBrush(
  edit: BrushEdit,
  signal: AbortSignal,
  route = walkingRoute,
): Promise<{ walk: Walk; ranges: EraseRange[] }> {
  const source = edit.walk;
  const expanded = edit.ranges.map((r) => expandSpur(source.points, r));
  const ranges: EraseRange[] = [];
  for (const range of expanded) {
    const last = ranges.at(-1);
    if (last && range[0] <= last[1]) {
      last[0] = Math.min(last[0], range[0]);
      last[1] = Math.max(last[1], range[1]);
    } else ranges.push([...range]);
  }
  if (!ranges.length) return { walk: source, ranges };
  let result = source;
  for (const [a, b] of [...ranges].reverse()) {
    signal.throwIfAborted();
    const from = source.points[a],
      to = source.points[b];
    if (a === 0 && b === source.points.length - 1)
      throw new Error(
        'Стерто весь маршрут. Зменште розмір стирачки або скасуйте рух.',
      );
    let bridge: Walk;
    if (distance(from, to) < 8)
      bridge = {
        points: [from, to],
        meters: distance(from, to),
        seconds: distance(from, to) / 1.4,
      };
    else {
      // Exclude the erased road, not just its waypoints. Otherwise the shortest
      // path query happily returns the exact same detour.
      const middle = source.points[Math.floor((a + b) / 2)];
      bridge = await route([from, to], signal, [middle]);
      const project = (p: Point) => ({
        x: (p[1] - middle[1]) * 111320 * Math.cos((middle[0] * Math.PI) / 180),
        y: (p[0] - middle[0]) * 111320,
      });
      if (
        bridge.points.some(
          (p, i) =>
            i > 0 &&
            segmentDistance(
              { x: 0, y: 0 },
              project(bridge.points[i - 1]),
              project(p),
            ) < 5,
        )
      )
        throw new Error(
          'Обхід стертої дороги не знайдено. Спробуйте стерти більшу частину відгалуження.',
        );
    }
    const total = sketchLength(result.points),
      removed = sketchLength(source.points.slice(a, b + 1));
    const retained = total ? Math.max(0, 1 - removed / total) : 0;
    const joins =
      distance(from, bridge.points[0]) + distance(to, bridge.points.at(-1)!);
    if (joins > 60)
      throw new Error('Не вдалося з’єднати маршрут поблизу стертої ділянки.');
    result = {
      points: [
        ...result.points.slice(0, a + 1),
        ...bridge.points,
        ...result.points.slice(b),
      ],
      meters: result.meters * retained + bridge.meters + joins,
      seconds: result.seconds * retained + bridge.seconds + joins / 1.4,
    };
  }
  return { walk: result, ranges };
}
