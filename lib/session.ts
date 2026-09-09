import { type Point, type Walk } from './route.ts';

import type { Place } from './places.ts';

export const SESSION_KEY = 'krok-session-v1';
export type Session = {
  version: 1;
  routePlaces?: Place[];
  start: Point | null;
  startLabel: string;
  points: Point[];
  sketch: Point[];
  mustVisit: Point[];
  walk: Walk | null;
  mode: 'point' | 'multi' | 'draw' | 'auto';
  back: boolean;
  precision: 'loose' | 'balanced' | 'precise';
  ideaStyle: string;
};
export function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(value[0]) <= 90 &&
    Math.abs(value[1]) <= 180
  );
}
function isPoints(value: unknown): value is Point[] {
  return Array.isArray(value) && value.length <= 200000 && value.every(isPoint);
}
export function readSession(text: string | null): Session | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text);
    if (
      !s ||
      s.version !== 1 ||
      !(s.start === null || isPoint(s.start)) ||
      typeof s.startLabel !== 'string' ||
      !isPoints(s.points) ||
      !isPoints(s.sketch) ||
      !isPoints(s.mustVisit) ||
      !['point', 'multi', 'draw', 'auto'].includes(s.mode) ||
      typeof s.back !== 'boolean' ||
      !['loose', 'balanced', 'precise'].includes(s.precision) ||
      !['scenic', 'random'].includes(s.ideaStyle)
    )
      return null;
    if (
      s.walk !== null &&
      (!s.walk ||
        !isPoints(s.walk.points) ||
        s.walk.points.length < 2 ||
        !Number.isFinite(s.walk.meters) ||
        s.walk.meters < 0 ||
        !Number.isFinite(s.walk.seconds) ||
        s.walk.seconds < 0)
    )
      return null;
    if (
      s.routePlaces !== undefined &&
      (!Array.isArray(s.routePlaces) ||
        s.routePlaces.length > 100 ||
        !s.routePlaces.every(
          (p: Place) =>
            p &&
            typeof p.id === 'string' &&
            typeof p.name === 'string' &&
            typeof p.kind === 'string' &&
            isPoint(p.point) &&
            Number.isFinite(p.priority),
        ))
    )
      return null;
    return s;
  } catch {
    return null;
  }
}
