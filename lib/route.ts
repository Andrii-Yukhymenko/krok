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
// Ramer–Douglas–Peucker in metres: keep meaningful bends, discard hand jitter.
export function sampleSketch(points: Point[], maxPoints = 200): Point[] {
  const clean: Point[] = [];
  points.forEach((p, i) => {
    if (
      !clean.length ||
      distance(clean.at(-1)!, p) > 2 ||
      (i === points.length - 1 && distance(clean.at(-1)!, p) > 0)
    )
      clean.push(p);
  });
  if (clean.length < 3) return clean;
  const simplify = (input: Point[], tolerance: number): Point[] => {
    if (input.length < 3) return input;
    const a = input[0],
      b = input.at(-1)!,
      scale = Math.cos((a[0] * Math.PI) / 180);
    const xy = (p: Point) => [
      (p[1] - a[1]) * 111195 * scale,
      (p[0] - a[0]) * 111195,
    ];
    const [bx, by] = xy(b),
      length = bx * bx + by * by;
    let furthest = 0,
      index = 0;
    for (let i = 1; i < input.length - 1; i++) {
      const [x, y] = xy(input[i]);
      const t = length
        ? Math.max(0, Math.min(1, (x * bx + y * by) / length))
        : 0;
      const d = Math.hypot(x - t * bx, y - t * by);
      if (d > furthest) {
        furthest = d;
        index = i;
      }
    }
    if (furthest <= tolerance) return [a, b];
    return [
      ...simplify(input.slice(0, index + 1), tolerance).slice(0, -1),
      ...simplify(input.slice(index), tolerance),
    ];
  };
  let tolerance = 25,
    result = simplify(clean, tolerance);
  while (result.length > maxPoints) {
    tolerance *= 1.5;
    result = simplify(clean, tolerance);
  }
  return result;
}
export function sketchLength(points: Point[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
}
export function traceSamples(points: Point[]): Point[] {
  const simplified = sampleSketch(points),
    length = sketchLength(simplified);
  const spacing = Math.max(60, length / 350),
    out: Point[] = [];
  simplified.forEach((p, i) => {
    if (i) {
      const a = simplified[i - 1],
        count = Math.ceil(distance(a, p) / spacing);
      for (let j = 1; j < count; j++)
        out.push([
          a[0] + ((p[0] - a[0]) * j) / count,
          a[1] + ((p[1] - a[1]) * j) / count,
        ]);
    }
    out.push(p);
  });
  return out;
}
export const WALK_PREFERENCES = {
  walking_speed: 4.8,
  service_penalty: 90,
  service_factor: 2.5,
  driveway_factor: 8,
  use_living_streets: 0.15,
  use_ferry: 0,
};
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
  // The public pedestrian service accepts at most ten locations per request.
  // Keep every waypoint, sharing the boundary point between successive chunks.
  const cleaned = points.filter(
    (p, i) => i === 0 || distance(points[i - 1], p) >= 1,
  );
  if (cleaned.length < 2)
    throw new Error('Маршрут надто короткий. Оберіть різні точки.');
  const combined: Walk = { points: [], meters: 0, seconds: 0 };
  for (let offset = 0; offset < cleaned.length - 1; offset += 9) {
    signal.throwIfAborted();
    const part = await requestWalkingRoute(
      cleaned.slice(offset, offset + 10),
      signal,
    );
    if (
      combined.points.length &&
      distance(combined.points.at(-1)!, part.points[0]) > 5
    )
      throw new Error(
        'Частини маршруту не з’єдналися. Перемістіть точку ближче до стежки.',
      );
    combined.points.push(...part.points);
    combined.meters += part.meters;
    combined.seconds += part.seconds;
  }
  return combined;
}
async function requestWalkingRoute(
  points: Point[],
  signal: AbortSignal,
): Promise<Walk> {
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
    costing_options: { pedestrian: WALK_PREFERENCES },
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

// Treat the sketch as noisy guidance, never as compulsory intermediate stops.
export async function sketchRoute(
  start: Point,
  sketch: Point[],
  signal: AbortSignal,
): Promise<Walk> {
  const shape = traceSamples(sketch);
  if (shape.length < 2 || sketchLength(shape) < 25)
    throw new Error('Намалюйте маршрут довжиною хоча б 25 метрів.');
  if (sketchLength(shape) > 50000)
    throw new Error('Розділіть малюнок на прогулянки до 50 км.');
  const delay = Math.max(0, 1100 - (Date.now() - lastRequest));
  if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
  signal.throwIfAborted();
  lastRequest = Date.now();
  const endpoint = (
    process.env.NEXT_PUBLIC_ROUTING_URL ||
    'https://valhalla1.openstreetmap.de/route'
  ).replace(/\/route\/?$/, '/trace_route');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shape: shape.map(([lat, lon]) => ({ lat, lon })),
      shape_match: 'map_snap',
      costing: 'pedestrian',
      units: 'kilometers',
      trace_options: { gps_accuracy: 50, search_radius: 100 },
      costing_options: { pedestrian: WALK_PREFERENCES },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Сервіс зайнятий. Зачекайте й повторіть побудову.'
        : 'Не вдалося зіставити малюнок із доріжками. Спробуйте провести лінію ближче до них.',
    );
  const data = (await response.json()) as {
    alternates?: unknown[];
    trip?: {
      status: number;
      legs: { shape: string }[];
      summary: { length: number; time: number };
    };
  };
  if (
    data.trip?.status !== 0 ||
    !data.trip.legs?.length ||
    data.alternates?.length
  )
    throw new Error(
      'Лінія перетинає непрохідну ділянку. Скоригуйте малюнок — неповний маршрут не показуємо.',
    );
  const points = data.trip.legs.flatMap((leg) => decodePolyline(leg.shape)),
    meters = data.trip.summary.length * 1000,
    seconds = data.trip.summary.time;
  if (
    points.length < 2 ||
    !Number.isFinite(meters) ||
    meters <= 0 ||
    !Number.isFinite(seconds)
  )
    throw new Error('Сервіс повернув некоректний маршрут.');
  if (
    distance(points[0], shape[0]) > 150 ||
    distance(points.at(-1)!, shape.at(-1)!) > 150
  )
    throw new Error(
      'Не вдалося знайти початок або кінець лінії на доріжках. Перемістіть їх ближче до проходу.',
    );
  if (meters > sketchLength(shape) * 2 + 400)
    throw new Error(
      'За цим малюнком виходить великий обхід. Спробуйте обвести перешкоду або змінити лінію.',
    );
  if (distance(start, points[0]) > 15) {
    const connector = await walkingRoute([start, points[0]], signal);
    if (distance(connector.points.at(-1)!, points[0]) > 5)
      throw new Error(
        'Не вдалося з’єднати старт із малюнком. Почніть лінію ближче до старту.',
      );
    return {
      points: [...connector.points, ...points],
      meters: connector.meters + meters,
      seconds: connector.seconds + seconds,
    };
  }
  return { points, meters, seconds };
}
