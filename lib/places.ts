import { distance, walkingRoute, type Point, type Walk } from './route.ts';

export type Place = {
  id: string;
  name: string;
  kind: string;
  point: Point;
  priority: number;
};
type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { role?: string; geometry?: { lat: number; lon: number }[] }[];
};
const cache = new Map<string, { time: number; places: Place[] }>();
export function placeKind(
  tags: Record<string, string>,
): { kind: string; priority: number } | null {
  if (['private', 'no'].includes(tags.access) || tags.foot === 'no')
    return null;
  if (tags.leisure === 'park') return { kind: 'Парк / сквер', priority: 3 };
  if (tags.leisure === 'garden') return { kind: 'Сад', priority: 2.5 };
  if (tags.natural === 'beach') return { kind: 'Пляж', priority: 2.5 };
  if (tags.highway === 'pedestrian' || tags.place === 'square')
    return { kind: 'Пішохідний простір', priority: 2 };
  if (
    ['footway', 'path'].includes(tags.highway) &&
    /бульвар|набереж|promenade|boulevard|embankment/i.test(tags.name || '')
  )
    return { kind: 'Бульвар / набережна', priority: 3 };
  return null;
}
function geometry(e: Element): Point[] {
  return (
    e.geometry ||
    e.members
      ?.filter((m) => m.role !== 'inner')
      .flatMap((m) => m.geometry || []) ||
    []
  ).map((p) => [p.lat, p.lon]);
}
export function inside(point: Point, ring: Point[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[0] > point[0] !== b[0] > point[0] &&
      point[1] < ((b[1] - a[1]) * (point[0] - a[0])) / (b[0] - a[0]) + a[1]
    )
      result = !result;
  }
  return result;
}
export function extractPlaces(elements: Element[], start: Point): Place[] {
  const paths = elements
    .filter(
      (e) =>
        ['footway', 'path', 'pedestrian'].includes(e.tags?.highway || '') &&
        !['no', 'private'].includes(e.tags?.access || '') &&
        e.tags?.foot !== 'no',
    )
    .flatMap((e) => {
      const vertices = geometry(e);
      const step = Math.max(1, Math.ceil(vertices.length / 40));
      return vertices.filter((_, i) => i % step === 0);
    });
  const places: Place[] = [];
  for (const element of elements) {
    const tags = element.tags || {},
      category = placeKind(tags);
    if (!category) continue;
    const center =
      element.center ||
      (element.lat !== undefined
        ? { lat: element.lat, lon: element.lon! }
        : null);
    const outline = geometry(element),
      reference: Point | undefined = center
        ? [center.lat, center.lon]
        : outline[0];
    if (!reference) continue;
    const closed =
      outline.length > 3 && distance(outline[0], outline.at(-1)!) < 5;
    // Prefer a real walking-path vertex inside the park, never a lawn centroid.
    const bounds = outline.length
      ? [
          Math.min(...outline.map((p) => p[0])),
          Math.min(...outline.map((p) => p[1])),
          Math.max(...outline.map((p) => p[0])),
          Math.max(...outline.map((p) => p[1])),
        ]
      : [0, 0, 0, 0];
    const options = paths.filter((p) =>
      closed
        ? p[0] >= bounds[0] &&
          p[0] <= bounds[2] &&
          p[1] >= bounds[1] &&
          p[1] <= bounds[3] &&
          inside(p, outline)
        : distance(p, reference) < 150,
    );
    const point = options.length
      ? options.sort(
          (a, b) => distance(a, reference) - distance(b, reference),
        )[0]
      : outline.length
        ? outline.sort((a, b) => distance(a, start) - distance(b, start))[0]
        : reference;
    const name = tags['name:uk'] || tags.name || category.kind;
    if (places.some((p) => p.name === name && distance(p.point, point) < 300))
      continue;
    places.push({
      id: element.type + '/' + element.id,
      name,
      point,
      ...category,
    });
  }
  return places;
}
export async function nearbyPlaces(
  start: Point,
  targetMeters: number,
  signal: AbortSignal,
): Promise<Place[]> {
  const radius = Math.round(Math.max(700, Math.min(4000, targetMeters / 2)));
  const key = start.map((n) => n.toFixed(3)).join(',') + ':' + radius;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < 600000) return cached.places;
  const around = `(around:${radius},${start[0]},${start[1]})`;
  const query = `[out:json][timeout:20];(nwr${around}[leisure~"^(park|garden)$"][access!~"^(private|no)$"];nwr${around}[natural=beach][access!~"^(private|no)$"];way${around}[highway=pedestrian];nwr${around}[place=square];way${around}[highway~"^(footway|path)$"][name~"бульвар|набереж|promenade|boulevard|embankment",i];);out tags center geom 120;way${around}[highway~"^(footway|path|pedestrian)$"][access!~"^(private|no)$"][foot!=no];out tags geom 400;`;
  const response = await fetch(
    process.env.NEXT_PUBLIC_PLACES_URL ||
      'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    },
  );
  if (!response.ok)
    throw new Error(
      'Дані про парки зараз недоступні. Спробуйте пізніше або оберіть «Випадкова».',
    );
  const data = (await response.json()) as {
    elements?: Element[];
    remark?: string;
  };
  if (!data.elements || data.remark)
    throw new Error(
      'Не вдалося повністю завантажити місця. Спробуйте ще раз пізніше.',
    );
  const places = extractPlaces(data.elements, start).filter(
    (p) => distance(start, p.point) < radius,
  );
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, { time: Date.now(), places });
  return places;
}
export function placeCandidates(
  start: Point,
  target: number,
  places: Place[],
  variation: number,
): Place[][] {
  const reachable = places.filter(
    (p) =>
      distance(start, p.point) * 2 < target * 1.2 &&
      distance(start, p.point) > 75,
  );
  const candidates: { places: Place[]; score: number }[] = [];
  for (const p of reachable) {
    const predicted = distance(start, p.point) * 2 * 1.3;
    candidates.push({
      places: [p],
      score: Math.abs(predicted - target) / target - 0.07 * p.priority,
    });
    for (const q of reachable) {
      if (p.id >= q.id || distance(p.point, q.point) < 200) continue;
      const perimeter =
        (distance(start, p.point) +
          distance(p.point, q.point) +
          distance(q.point, start)) *
        1.25;
      candidates.push({
        places: [p, q],
        score:
          Math.abs(perimeter - target) / target -
          0.05 * (p.priority + q.priority),
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const shortlist = candidates.slice(0, 12);
  if (!shortlist.length) return [];
  const offset = (variation * 3) % shortlist.length;
  return Array.from(
    { length: Math.min(3, shortlist.length) },
    (_, i) => shortlist[(offset + i) % shortlist.length].places,
  );
}
export async function scenicWalk(
  start: Point,
  target: number,
  signal: AbortSignal,
  variation = 0,
): Promise<{ walk: Walk; places: Place[] }> {
  const places = await nearbyPlaces(start, target, signal),
    candidates = placeCandidates(start, target, places, variation);
  if (!candidates.length)
    throw new Error(
      'Поруч не знайдено прогулянкових місць під цю ціль. Збільште ціль або оберіть «Випадкова».',
    );
  let best: { walk: Walk; places: Place[] } | null = null;
  let lastError: unknown;
  for (const stops of candidates) {
    signal.throwIfAborted();
    try {
      const walk = await walkingRoute(
        [start, ...stops.map((p) => p.point), start],
        signal,
      );
      if (
        !best ||
        Math.abs(walk.meters - target) < Math.abs(best.walk.meters - target)
      )
        best = { walk, places: stops };
      if (Math.abs(walk.meters - target) / target < 0.1) break;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  if (!best)
    throw (
      lastError || new Error('Не вдалося з’єднати місця пішохідним маршрутом.')
    );
  return best;
}
