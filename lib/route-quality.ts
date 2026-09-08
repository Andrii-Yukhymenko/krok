import { distance, type Walk } from './route.ts';
// Conservative geometry estimate: count exactly repeated decoded segments,
// ignoring orientation. Nearby parallel paths are never merged.
export function repeatedRatio(walk: Walk): number {
  const seen = new Set<string>();
  let total = 0,
    repeated = 0;
  for (let i = 1; i < walk.points.length; i++) {
    const a = walk.points[i - 1],
      b = walk.points[i];
    const length = distance(a, b);
    if (!length) continue;
    const key = [a.join(','), b.join(',')].sort().join('|');
    total += length;
    if (seen.has(key)) repeated += length;
    seen.add(key);
  }
  return total ? repeated / total : 0;
}
export function routeScore(walk: Walk, target: number): number {
  const deviation = Math.abs(walk.meters - target) / target;
  // Length stays dominant outside a 15% tolerance; no long detours merely
  // to avoid repeating the only bridge or the entrance to the user's street.
  return (
    deviation + Math.max(0, deviation - 0.15) * 3 + repeatedRatio(walk) * 0.3
  );
}
