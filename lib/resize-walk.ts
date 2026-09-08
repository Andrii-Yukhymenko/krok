import {
  distance,
  destination,
  sketchLength,
  walkingRoute,
  withReturn,
  type Point,
  type Walk,
} from './route.ts';
import { scenicWalk, type Place } from './places.ts';
import { requiredWalk } from './required-walk.ts';
type Options = {
  base: Walk;
  start: Point;
  required: Point[];
  mode: string;
  style: string;
  target: number;
};
type Result = { walk: Walk; places: Place[]; notice: string };

// Cut along existing route segments only; never draw a shortcut across terrain.
export function trimWalk(walk: Walk, target: number): Walk {
  if (target >= walk.meters) return walk;
  const wanted = (sketchLength(walk.points) * target) / walk.meters;
  const points: Point[] = [walk.points[0]];
  let total = 0;
  for (let i = 1; i < walk.points.length; i++) {
    const a = walk.points[i - 1],
      b = walk.points[i],
      length = distance(a, b);
    if (total + length >= wanted && length > 0) {
      const t = (wanted - total) / length;
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      break;
    }
    points.push(b);
    total += length;
  }
  return {
    points,
    meters: target,
    seconds: (walk.seconds * target) / walk.meters,
  };
}
export async function resizeWalk(
  options: Options,
  signal: AbortSignal,
  deps = { route: walkingRoute, scenic: scenicWalk, required: requiredWalk },
): Promise<Result> {
  const { base, start, required, mode, style, target } = options;
  if (!Number.isFinite(target) || target < 25 || target > 50000)
    throw new Error('Оберіть довжину від 25 м до 50 км.');
  signal.throwIfAborted();
  if (Math.abs(base.meters - target) < 10)
    return { walk: base, places: [], notice: '' };
  if (mode === 'auto') {
    if (required.length)
      return deps.required(start, required, target, style, signal);
    if (style === 'scenic') {
      let notice = '';
      const result = await deps.scenic(start, target, signal, 0, (n) => {
        notice = n;
      });
      return { ...result, notice };
    }
  }
  let best = base;
  if (target < base.meters) {
    if (mode === 'draw')
      return {
        walk: trimWalk(base, target),
        places: [],
        notice: 'Ескіз скорочено вздовж наявного шляху. Фініш зміщено.',
      };
    if (mode === 'auto')
      return {
        walk: withReturn(trimWalk(base, target / 2)),
        places: [],
        notice: 'Коротший варіант повертається тією самою дорогою до старту.',
      };
    best = await deps.route([start, ...required], signal);
    signal.throwIfAborted();
    if (required.some((p) => !best.points.some((q) => distance(p, q) <= 100)))
      throw new Error(
        'Не вдалося зберегти всі ваші зупинки. Попередній маршрут залишено.',
      );
    if (best.meters >= target * 0.95)
      return {
        walk: best.meters < base.meters ? best : base,
        places: [],
        notice:
          'Зупинки й фініш збережено. Коротшого шляху до бажаної довжини не знайдено.',
      };
  }
  // Extend at a real vertex and return to it before continuing the original
  // route. This preserves every stop and both endpoints of manual routes.
  const original = best;
  let radius = Math.max(40, (target - original.meters) / 2.6);
  let succeeded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const index = Math.min(
      original.points.length - 1,
      Math.floor(original.points.length * (0.35 + attempt * 0.2)),
    );
    const pivot = original.points[index];
    const extra = destination(pivot, radius, 40 + attempt * 120);
    try {
      const loop = await deps.route([pivot, extra, pivot], signal);
      signal.throwIfAborted();
      if (
        distance(loop.points[0], pivot) > 5 ||
        distance(loop.points.at(-1)!, pivot) > 5
      )
        continue;
      succeeded = true;
      const candidate = {
        points: [
          ...original.points.slice(0, index),
          ...loop.points,
          ...original.points.slice(index + 1),
        ],
        meters: original.meters + loop.meters,
        seconds: original.seconds + loop.seconds,
      };
      if (Math.abs(candidate.meters - target) < Math.abs(best.meters - target))
        best = candidate;
      if (Math.abs(best.meters - target) / target < 0.05) break;
      radius *= Math.max(
        0.5,
        Math.min(1.6, (target - original.meters) / loop.meters),
      );
    } catch {
      if (signal.aborted) throw signal.reason;
    }
  }
  return {
    walk: best,
    places: [],
    notice:
      !succeeded || best === original
        ? 'Не вдалося знайти доступне подовження. Попередній шлях залишено.'
        : 'Додано прогулянковий відрізок із поверненням на основний шлях; частина дороги може повторюватися.',
  };
}
