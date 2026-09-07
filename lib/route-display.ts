export type XY = { x: number; y: number };

// Offset in the direction of travel, so a reversed path occupies the other lane.
// This changes display pixels only, never the route or its measured distance.
export function directionLane(input: XY[], offset = 4): XY[] {
  const points = input.filter(
    (p, i) =>
      !i || Math.hypot(p.x - input[i - 1].x, p.y - input[i - 1].y) > 0.01,
  );
  const normal = (a: XY, b: XY) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  };
  return points.map((p, i) => {
    if (points.length < 2) return p;
    const before = normal(points[Math.max(0, i - 1)], points[Math.max(1, i)]);
    const after = normal(
      points[Math.min(i, points.length - 2)],
      points[Math.min(i + 1, points.length - 1)],
    );
    const x = before.x + after.x,
      y = before.y + after.y;
    const length = Math.hypot(x, y);
    // At an exact turnaround the two lanes join at the actual turning point.
    if (length < 0.01) return p;
    return { x: p.x + (x / length) * offset, y: p.y + (y / length) * offset };
  });
}

export function directionArrows(points: XY[], spacing = 75): XY[][] {
  const arrows: XY[][] = [];
  let remaining = 24;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const dx = (b.x - a.x) / length,
      dy = (b.y - a.y) / length;
    while (remaining <= length) {
      const x = a.x + dx * remaining,
        y = a.y + dy * remaining;
      arrows.push([
        { x: x - dx * 5 - dy * 3, y: y - dy * 5 + dx * 3 },
        { x, y },
        { x: x - dx * 5 + dy * 3, y: y - dy * 5 - dx * 3 },
      ]);
      remaining += spacing;
    }
    remaining -= length;
  }
  return arrows;
}
