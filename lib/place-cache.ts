import { distance, type Point } from './route.ts';
import type { Place } from './places.ts';
type Entry = {
  source: string;
  center: Point;
  radius: number;
  time: number;
  places: Place[];
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'krok-places-v1';
export const FRESH_MS = 24 * 60 * 60 * 1000;
export const MAX_AGE_MS = 7 * FRESH_MS;
const point = (p: unknown): p is Point =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every(Number.isFinite) &&
  Math.abs(p[0]) <= 85 &&
  Math.abs(p[1]) <= 180;
function valid(e: Entry, now: number) {
  return (
    e &&
    typeof e.source === 'string' &&
    point(e.center) &&
    Number.isFinite(e.radius) &&
    e.radius >= 700 &&
    e.radius <= 4000 &&
    Number.isFinite(e.time) &&
    e.time <= now &&
    now - e.time < MAX_AGE_MS &&
    Array.isArray(e.places) &&
    e.places.length <= 520 &&
    e.places.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        /^(node|way|relation)\/\d+$/.test(p.id) &&
        typeof p.name === 'string' &&
        typeof p.kind === 'string' &&
        point(p.point) &&
        Number.isFinite(p.priority),
    )
  );
}
export class PlaceCache {
  clear() {
    this.loaded = true;
    this.entries = [];
    try {
      this.storage()?.setItem(KEY, '[]');
    } catch {
      /* Storage unavailable. */
    }
  }
  private entries: Entry[] = [];
  private loaded = false;
  private storage: () => StorageLike | undefined;
  constructor(
    storage: () => StorageLike | undefined = () =>
      typeof localStorage === 'undefined' ? undefined : localStorage,
  ) { this.storage = storage; }
  private read(now: number) {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const data = JSON.parse(this.storage()?.getItem(KEY) || '[]');
        if (Array.isArray(data))
          this.entries = data.filter((e) => valid(e, now)).slice(-8);
      } catch {
        /* Storage may be blocked or corrupted; memory remains usable. */
      }
    }
    this.entries = this.entries.filter((e) => valid(e, now));
  }
  find(source: string, center: Point, radius: number, now = Date.now()) {
    this.read(now);
    return this.entries
      .filter(
        (e) =>
          e.source === source &&
          distance(e.center, center) + radius <= e.radius + 0.01,
      )
      .sort((a, b) => b.time - a.time)[0];
  }
  put(entry: Entry) {
    this.read(entry.time);
    if (!valid(entry, entry.time)) return;
    this.entries = this.entries.filter(
      (e) =>
        !(
          e.source === entry.source &&
          distance(e.center, entry.center) < 1 &&
          e.radius === entry.radius
        ),
    );
    this.entries.push(entry);
    this.entries = this.entries.slice(-8);
    try {
      this.storage()?.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      /* Quota/full/private mode: keep in memory. */
    }
  }
}
