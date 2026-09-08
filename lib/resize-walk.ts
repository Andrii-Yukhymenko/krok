import {
  distance,
  destination,
  sampleSketch,
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
type Result = {
  walk: Walk;
  places: Place[];
  notice: string;
  waypoints?: Point[];
};

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

// Keep the start fixed and scale every bend by the same amount. Closed shapes
// stay closed, while rectangles, circles and other sketches retain their form.
export function scaleShape(points: Point[], factor: number): Point[] {
  if (!points.length) return [];
  const origin = points[0];
  return points.map((point, index) =>
    index === 0
      ? origin
      : [
          origin[0] + (point[0] - origin[0]) * factor,
          origin[1] + (point[1] - origin[1]) * factor,
        ],
  );
}

function bearing(a: Point, b: Point) {
  const radians = Math.PI / 180;
  const lat1 = a[0] * radians,
    lat2 = b[0] * radians,
    deltaLongitude = (b[1] - a[1]) * radians;
  return (
    (Math.atan2(
      Math.sin(deltaLongitude) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude),
    ) /
      radians +
      360) %
    360
  );
}

function terminalWaypoints(
  base: Walk,
  trimmed: Walk,
  required: Point[],
  mode: string,
) {
  const finish = trimmed.points.at(-1)!;
  if (mode === 'point') return [finish];
  const progress: number[] = [0];
  for (let i = 1; i < base.points.length; i++)
    progress.push(progress[i - 1] + distance(base.points[i - 1], base.points[i]));
  const limit = sketchLength(trimmed.points);
  const kept = required.filter((stop) => {
    let nearest = 0,
      gap = Infinity;
    base.points.forEach((point, index) => {
      const candidate = distance(stop, point);
      if (candidate < gap) {
        gap = candidate;
        nearest = index;
      }
    });
    return progress[nearest] < limit - 15;
  });
  if (!kept.length || distance(kept.at(-1)!, finish) >= 15) kept.push(finish);
  return kept;
}

async function resizeSketch(
  base: Walk,
  target: number,
  signal: AbortSignal,
  route: typeof walkingRoute,
): Promise<Walk> {
  let factor = target / base.meters,
    best = base;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const shape = scaleShape(base.points, factor);
    const anchors = sampleSketch(
      shape,
      18,
      Math.max(8, sketchLength(shape) / 600),
    );
    try {
      const candidate = await route(anchors, signal);
      signal.throwIfAborted();
      if (Math.abs(candidate.meters - target) < Math.abs(best.meters - target))
        best = candidate;
      if (Math.abs(best.meters - target) / target < 0.05) break;
      factor *= Math.max(0.55, Math.min(1.8, target / candidate.meters));
    } catch (error) {
      if (signal.aborted) throw error;
      factor *= 0.85;
    }
  }
  return best;
}

async function extendFromFinish(
  base: Walk,
  required: Point[],
  mode: string,
  target: number,
  signal: AbortSignal,
  route: typeof walkingRoute,
) {
  const finish = base.points.at(-1)!;
  let previous = base.points[Math.max(0, base.points.length - 2)];
  for (let i = base.points.length - 2; i >= 0; i--) {
    if (distance(base.points[i], finish) >= 15) {
      previous = base.points[i];
      break;
    }
  }
  const direction = bearing(previous, finish),
    missing = target - base.meters;
  let radius = Math.max(40, missing * 0.85),
    best = base;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const offset = attempt === 0 ? 0 : attempt === 1 ? 25 : -25;
    const extra = destination(finish, radius, direction + offset);
    try {
      const extension = await route([finish, extra], signal);
      signal.throwIfAborted();
      if (distance(extension.points[0], finish) > 5) continue;
      const candidate: Walk = {
        points: [...base.points.slice(0, -1), ...extension.points],
        meters: base.meters + extension.meters,
        seconds: base.seconds + extension.seconds,
      };
      if (Math.abs(candidate.meters - target) < Math.abs(best.meters - target))
        best = candidate;
      if (Math.abs(best.meters - target) / target < 0.05) break;
      radius *= Math.max(0.55, Math.min(1.8, missing / extension.meters));
    } catch (error) {
      if (signal.aborted) throw error;
      radius *= 0.8;
    }
  }
  const end = best.points.at(-1)!;
  return {
    walk: best,
    waypoints:
      best === base
        ? required
        : mode === 'point'
          ? [end]
          : [...required, end],
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
  if (mode === 'draw') {
    const resized = await resizeSketch(base, target, signal, deps.route);
    return {
      walk: resized,
      places: [],
      notice:
        resized === base
          ? 'Не вдалося підігнати контур до доріг. Попередній маршрут залишено.'
          : 'Контур рівномірно змінено від старту зі збереженням його форми.',
    };
  }
  if ((mode === 'point' || mode === 'multi') && target < base.meters) {
    const trimmed = trimWalk(base, target);
    return {
      walk: trimmed,
      places: [],
      waypoints: terminalWaypoints(base, trimmed, required, mode),
      notice: 'Фініш зміщено назад уздовж готового маршруту.',
    };
  }
  if ((mode === 'point' || mode === 'multi') && target > base.meters) {
    const extended = await extendFromFinish(
      base,
      required,
      mode,
      target,
      signal,
      deps.route,
    );
    return {
      ...extended,
      places: [],
      notice:
        extended.walk === base
          ? 'Не вдалося знайти доступне продовження. Попередній шлях залишено.'
          : 'Маршрут продовжено вперед від останньої точки.',
    };
  }
  let best = base;
  if (target < base.meters) {
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
