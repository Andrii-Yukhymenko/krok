import {
  distance,
  destination,
  sketchLength,
  walkingRoute,
  type Point,
  type Walk,
} from './route.ts';
import { nearbyPlaces, type Place } from './places.ts';
import { routeScore } from './route-quality.ts';

// Insert optional stops between required stops; their user-defined order never changes.
export function insertStops(
  start: Point,
  required: Point[],
  extras: Point[],
): Point[] {
  const route = [start, ...required, start];
  for (const p of extras) {
    let best = 1,
      cost = Infinity;
    for (let i = 1; i < route.length; i++) {
      const delta =
        distance(route[i - 1], p) +
        distance(p, route[i]) -
        distance(route[i - 1], route[i]);
      if (delta < cost) {
        best = i;
        cost = delta;
      }
    }
    route.splice(best, 0, p);
  }
  return route;
}
type Result = { walk: Walk; places: Place[]; notice: string };
export async function requiredWalk(
  start: Point,
  required: Point[],
  target: number,
  style: string,
  signal: AbortSignal,
  variation = 0,
  deps = { route: walkingRoute, places: nearbyPlaces, random: Math.random },
): Promise<Result> {
  if (!required.length || required.length > 6)
    throw new Error('Додайте від 1 до 6 обов’язкових зупинок.');
  signal.throwIfAborted();
  const route = async (points: Point[]) => {
    const walk = await deps.route(points, signal);
    signal.throwIfAborted();
    if (required.some((p) => !walk.points.some((q) => distance(p, q) <= 100)))
      throw new Error(
        'Одна зі зупинок далеко від доступного проходу. Перемістіть її ближче до доріжки.',
      );
    return walk;
  };
  let best: Result = {
    walk: await route([start, ...required, start]),
    places: [],
    notice: '',
  };
  if (best.walk.meters >= target * 0.95) {
    best.notice =
      best.walk.meters > target * 1.1
        ? 'Ваші зупинки вже перевищують ціль. Усі збережено; додаткові місця не додавали.'
        : 'Маршрут через ваші зупинки вже близький до цілі.';
    return best;
  }
  let cachedNotice = '';
  const candidates: { points: Point[]; places: Place[]; score: number }[] = [];
  if (style === 'scenic') {
    try {
      const places = (
        await deps.places(start, target, signal, (n) => {
          cachedNotice = n;
        })
      ).filter((p) => required.every((q) => distance(p.point, q) > 100));
      for (let i = 0; i < places.length; i++) {
        for (let j = i; j < places.length; j++) {
          const selected = i === j ? [places[i]] : [places[i], places[j]];
          const points = insertStops(
            start,
            required,
            selected.map((p) => p.point),
          );
          candidates.push({
            points,
            places: selected,
            score:
              Math.abs(sketchLength(points) * 1.25 - target) / target -
              selected.reduce((s, p) => s + p.priority, 0) * 0.03,
          });
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      const shortlist = candidates.splice(0, 12);
      candidates.length = 0;
      for (let i = 0; i < Math.min(3, shortlist.length); i++)
        candidates.push(shortlist[(variation * 3 + i) % shortlist.length]);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      return {
        ...best,
        notice:
          'Маршрут через ваші зупинки побудовано, але доповнити його місцями не вдалося. ' +
          (error instanceof Error ? error.message : ''),
      };
    }
  } else {
    const bearing = deps.random() * 360;
    const radius = Math.max(100, (target - best.walk.meters) / 4);
    for (let i = 0; i < 3; i++) {
      const p = destination(
        required.at(-1)!,
        radius * (1 + i * 0.2),
        bearing + i * 100,
      );
      candidates.push({
        points: insertStops(start, required, [p]),
        places: [],
        score: 0,
      });
    }
  }
  for (const candidate of candidates) {
    try {
      const walk = await route(candidate.points);
      if (routeScore(walk, target) < routeScore(best.walk, target))
        best = { walk, places: candidate.places, notice: '' };
    } catch {
      if (signal.aborted) throw signal.reason;
    }
  }
  const mismatch = Math.abs(best.walk.meters - target) / target > 0.1;
  return {
    ...best,
    notice: [
      cachedNotice,
      mismatch
        ? 'Усі ваші зупинки враховано. Довжина відрізняється від цілі — кращого доповнення не знайдено.'
        : 'Усі ваші зупинки враховано в порядку додавання.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
