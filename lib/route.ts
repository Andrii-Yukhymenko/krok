export type Point = [number, number];
export type Walk = { points: Point[]; meters: number; seconds: number };
export const DEFAULT_START: Point = [50.4501, 30.5234];
export function stepsFor(meters: number, strideCm: number) {
  if (
    !Number.isFinite(meters) ||
    meters < 0 ||
    !Number.isFinite(strideCm) ||
    strideCm <= 0
  )
    throw new Error('Invalid distance or stride');
  return Math.round((meters * 100) / strideCm);
}
export function distance(a: Point, b: Point) {
  const rad = Math.PI / 180,
    dlat = (b[0] - a[0]) * rad,
    dlon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function destination(p: Point, meters: number, bearing: number): Point {
  const r = Math.PI / 180,
    d = meters / 6371000,
    b = bearing * r,
    lat = p[0] * r,
    lon = p[1] * r;
  const y = Math.asin(
    Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b),
  );
  return [
    y / r,
    (((lon +
      Math.atan2(
        Math.sin(b) * Math.sin(d) * Math.cos(lat),
        Math.cos(d) - Math.sin(lat) * Math.sin(y),
      )) /
      r +
      540) %
      360) -
      180,
  ];
}
export function decodePolyline(encoded: string): Point[] {
  let index = 0,
    lat = 0,
    lng = 0;
  const out: Point[] = [];
  function next() {
    let result = 0,
      shift = 0,
      b = 0;
    do {
      if (index >= encoded.length || shift > 30)
        throw new Error('Invalid geometry');
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
  while (index < encoded.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}
// Sample by travelled distance, retaining deliberate backtracking.
export function sampleSketch(points: Point[], maxPoints = 18): Point[] {
  if (points.length <= maxPoints) return points;
  const accumulated = [0];
  for (let i = 1; i < points.length; i++)
    accumulated.push(accumulated[i - 1] + distance(points[i - 1], points[i]));
  const total = accumulated.at(-1)!;
  if (total === 0) return [points[0]];
  const result: Point[] = [points[0]];
  let cursor = 1;
  for (let j = 1; j < maxPoints - 1; j++) {
    const target = (total * j) / (maxPoints - 1);
    while (cursor < points.length - 1 && accumulated[cursor] < target) cursor++;
    result.push(points[cursor]);
  }
  result.push(points.at(-1)!);
  return result;
}
export function withReturn(walk: Walk): Walk {
  return {
    meters: walk.meters * 2,
    seconds: walk.seconds * 2,
    points: [...walk.points, ...walk.points.slice(0, -1).reverse()],
  };
}
let lastRequest = 0;
export async function walkingRoute(
  points: Point[],
  signal: AbortSignal,
): Promise<Walk> {
  if (points.length < 2 || points.length > 20)
    throw new Error('Додайте від 2 до 20 точок.');
  if (
    points.some(
      (p) =>
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 85 ||
        Math.abs(p[1]) > 180,
    )
  )
    throw new Error('Перевірте координати.');
  const delay = Math.max(0, 1100 - (Date.now() - lastRequest));
  if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
  signal.throwIfAborted();
  lastRequest = Date.now();
  const endpoint =
    process.env.NEXT_PUBLIC_ROUTING_URL ||
    'https://valhalla1.openstreetmap.de/route';
  const request = {
    locations: points.map(([lat, lon]) => ({
      lat,
      lon,
      type: 'break',
      search_cutoff: 500,
    })),
    costing: 'pedestrian',
    units: 'kilometers',
    directions_options: { units: 'kilometers' },
    costing_options: { pedestrian: { walking_speed: 4.8 } },
  };
  const response = await fetch(
    endpoint + '?json=' + encodeURIComponent(JSON.stringify(request)),
    { signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Сервіс зайнятий. Зачекайте трохи й спробуйте ще раз.'
        : 'Не вдалося прокласти шлях. Перемістіть точку ближче до дороги.',
    );
  const data = (await response.json()) as {
    trip?: {
      status: number;
      legs: { shape: string }[];
      summary: { length: number; time: number };
    };
  };
  if (data.trip?.status !== 0 || !data.trip.legs?.length)
    throw new Error('Пішохідний маршрут не знайдено. Спробуйте інші точки.');
  const geometry: Point[] = data.trip.legs.flatMap((leg: { shape: string }) =>
    decodePolyline(leg.shape),
  );
  const meters = Number(data.trip.summary.length) * 1000,
    seconds = Number(data.trip.summary.time);
  if (
    !Number.isFinite(meters) ||
    meters <= 0 ||
    !Number.isFinite(seconds) ||
    geometry.length < 2
  )
    throw new Error('Сервіс повернув некоректний маршрут.');
  return { points: geometry, meters, seconds };
}
