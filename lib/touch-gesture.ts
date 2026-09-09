export type TouchPoint = { x: number; y: number };
export class TouchGesture {
  readonly points = new Map<number, TouchPoint>();
  navigating = false;
  down(id: number, point: TouchPoint) {
    this.points.set(id, point);
    if (this.points.size >= 2) this.navigating = true;
  }
  move(id: number, point: TouchPoint) {
    if (this.points.has(id)) this.points.set(id, point);
  }
  up(id: number) {
    this.points.delete(id);
    // Never turn the remaining finger into an eraser after a pinch.
    if (!this.points.size) this.navigating = false;
  }
  pair() {
    const [a, b] = [...this.points.values()];
    return a && b
      ? {
          midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          span: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        }
      : null;
  }
  reset() {
    this.points.clear();
    this.navigating = false;
  }
}
