import {
  cleanSketchSpurs,
  distance,
  destination,
  sampleSketch,
  sketchRoute,
  sketchLength,
  walkingRoute,
  withReturn,
  type Point,
  type SketchPrecision,
  type Walk,
} from './route.ts';
import { nearbyPlaces, scenicWalk, type Place } from './places.ts';
import { requiredWalk } from './required-walk.ts';
import { repeatedRatio, routeScore } from './route-quality.ts';
type Options = {
  base: Walk;
  start: Point;
  required: Point[];
  mode: string;
  style: string;
  target: number;
  shape?: Point[];
  precision?: SketchPrecision;
};
type Result = {
  walk: Walk;
  places: Place[];
  notice: string;
  waypoints?: Point[];
};
type Dependencies = {
  route: typeof walkingRoute;
  scenic: typeof scenicWalk;
  required: typeof requiredWalk;
  sketch?: typeof sketchRoute;
  places?: typeof nearbyPlaces;
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
export function scaleShape(
  points: Point[],
  factor: number,
  origin = points[0],
): Point[] {
  if (!points.length) return [];
  return points.map((point) =>
    point === origin
      ? origin
      : [
          origin[0] + (point[0] - origin[0]) * factor,
          origin[1] + (point[1] - origin[1]) * factor,
        ],
  );
}

function scenicGuide(shape: Point[], places: Place[], maxDetour: number) {
  const ranked = places
    .map((place) => {
      let index = 0,
        detour = Infinity;
      for (let candidate = 0; candidate < shape.length - 1; candidate++) {
        const d =
          distance(shape[candidate], place.point) +
          distance(place.point, shape[candidate + 1]) -
          distance(shape[candidate], shape[candidate + 1]);
        if (d < detour) {
          detour = d;
          index = candidate;
        }
      }
      return { place, index, detour };
    })
    .filter(
      ({ place, detour }) =>
        detour <= maxDetour && distance(shape[0], place.point) > 75,
    )
    .sort(
      (a, b) =>
        a.detour -
        a.place.priority * 60 -
        (b.detour - b.place.priority * 60),
    );
  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    if (
      selected.length >= 2 ||
      selected.some(({ place }) => distance(place.point, candidate.place.point) < 250)
    )
      continue;
    selected.push(candidate);
  }
  const guide = [...shape];
  selected
    .sort((a, b) => b.index - a.index)
    .forEach(({ place, index }) => guide.splice(index + 1, 0, place.point));
  return { guide, places: selected.map(({ place }) => place) };
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
  start: Point,
  source: Point[],
  target: number,
  precision: SketchPrecision,
  signal: AbortSignal,
  deps: {
    route: typeof walkingRoute;
    sketch?: typeof sketchRoute;
    places?: typeof nearbyPlaces;
  },
): Promise<{ walk: Walk; places: Place[] }> {
  const contour = source.length >= 2 ? source : base.points;
  let factor = target / base.meters,
    best = base,
    bestPlaces: Place[] = [];
  let places: Place[] = [];
  if (target > base.meters + 100 && deps.places)
    try {
      places = await deps.places(start, target, signal);
    } catch (error) {
      if (signal.aborted) throw error;
    }
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const scaled = scaleShape(contour, factor, start),
      simplified = sampleSketch(
        scaled,
        8,
        precision === 'loose' ? 100 : 50,
      ),
      enriched = scenicGuide(
        simplified,
        places,
        Math.max(250, Math.min(650, (target - base.meters) * 0.65)),
      );
    try {
      const candidate = cleanSketchSpurs(
        deps.sketch
          ? await deps.sketch(
              start,
              enriched.guide,
              signal,
              precision === 'loose' ? 'loose' : 'balanced',
            )
          : await deps.route(
              sampleSketch(
                enriched.guide,
                8,
                precision === 'loose' ? 100 : 50,
              ),
              signal,
            ),
        enriched.places.map((place) => place.point),
      );
      signal.throwIfAborted();
      const score = (walk: Walk) =>
        routeScore(walk, target) + repeatedRatio(walk) * 1.2;
      if (score(candidate) < score(best)) {
        best = candidate;
        bestPlaces = enriched.places.filter((place) =>
          candidate.points.some((point) => distance(point, place.point) <= 150),
        );
      }
      if (Math.abs(best.meters - target) / target < 0.05) break;
      factor *= Math.max(0.55, Math.min(1.8, target / candidate.meters));
    } catch (error) {
      if (signal.aborted) throw error;
      factor *= 0.85;
    }
  }
  return { walk: best, places: bestPlaces };
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
  deps?: Dependencies,
): Promise<Result> {
  const {
    base,
    start,
    required,
    mode,
    style,
    target,
    shape = base.points,
    precision = 'balanced',
  } = options;
  const runtime = {
    route: deps?.route ?? walkingRoute,
    scenic: deps?.scenic ?? scenicWalk,
    required: deps?.required ?? requiredWalk,
    sketch: deps ? deps.sketch : sketchRoute,
    places: deps ? deps.places : nearbyPlaces,
  };
  if (!Number.isFinite(target) || target < 25 || target > 50000)
    throw new Error('Оберіть довжину від 25 м до 50 км.');
  signal.throwIfAborted();
  if (Math.abs(base.meters - target) < 10)
    return { walk: base, places: [], notice: '' };
  if (mode === 'auto') {
    if (required.length)
      return runtime.required(start, required, target, style, signal);
    if (style === 'scenic') {
      let notice = '';
      const result = await runtime.scenic(start, target, signal, 0, (n) => {
        notice = n;
      });
      return { ...result, notice };
    }
  }
  if (mode === 'draw') {
    const resized = await resizeSketch(
      base,
      start,
      shape,
      target,
      precision,
      signal,
      runtime,
    );
    return {
      walk: resized.walk,
      places: resized.places,
      notice:
        resized.walk === base
          ? 'Не вдалося підігнати контур до доріг. Попередній маршрут залишено.'
          : resized.places.length
            ? 'Контур змінено без тупикових відхилень і проведено біля прогулянкових місць.'
            : 'Контур плавно змінено від старту; короткі тупикові відхилення прибрано.',
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
      runtime.route,
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
    best = await runtime.route([start, ...required], signal);
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
      const loop = await runtime.route([pivot, extra, pivot], signal);
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
