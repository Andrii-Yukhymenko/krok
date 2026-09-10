import test from 'node:test';
import assert from 'node:assert/strict';
import type * as Leaflet from 'leaflet';
import { bindDrawingGesture } from '../lib/drawing-gesture.ts';
import type { Point } from '../lib/route.ts';
void test('a sustained one-finger stroke survives and builds once on release; two fingers cancel only the unfinished stroke', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    value: new EventTarget(),
    configurable: true,
  });
  const el = new EventTarget() as EventTarget & {
    style: Record<string, string>;
    setPointerCapture: (id: number) => void;
    hasPointerCapture: (id: number) => boolean;
    releasePointerCapture: (id: number) => void;
  };
  const captures = new Set<number>();
  el.style = {};
  el.setPointerCapture = (id) => {
    captures.add(id);
  };
  el.hasPointerCapture = (id) => captures.has(id);
  el.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  let removed = false,
    updates = 0;
  const strokes: Point[][] = [];
  const errors: string[] = [];
  const handler = { enable() {}, disable() {} };
  const map = {
    options: { zoomSnap: 1 },
    dragging: handler,
    doubleClickZoom: handler,
    touchZoom: handler,
    mouseEventToLatLng: (e: { clientX: number; clientY: number }) => ({
      lat: 50 + e.clientY / 10000,
      lng: 30 + e.clientX / 10000,
    }),
    mouseEventToContainerPoint: (e: { clientX: number; clientY: number }) => ({
      x: e.clientX,
      y: e.clientY,
    }),
    containerPointToLatLng: () => ({ lat: 50, lng: 30 }),
    getZoom: () => 15,
  };
  const api = {
    polyline: () => {
      removed = false;
      return {
        addTo() {
          return this;
        },
        remove() {
          removed = true;
        },
        setLatLngs() {
          updates++;
        },
      };
    },
  };
  const cleanup = bindDrawingGesture(
    map as unknown as Leaflet.Map,
    el as unknown as HTMLElement,
    api as unknown as typeof Leaflet,
    (p) => strokes.push(p),
    (m) => errors.push(m),
  );
  const fire = (type: string, id: number, x: number) =>
    el.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        pointerType: 'touch',
        pointerId: id,
        button: 0,
        clientX: x,
        clientY: 0,
      }),
    );
  try {
    fire('pointerdown', 1, 0);
    for (let x = 1; x <= 5; x++) {
      fire('pointermove', 1, x * 5);
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(removed, false);
    assert.ok(updates > 0);
    assert.equal(strokes.length, 0);
    fire('pointerup', 1, 30);
    assert.equal(strokes.length, 1);
    assert.ok(strokes[0].length > 2);
    fire('pointerdown', 2, 0);
    fire('pointermove', 2, 10);
    fire('pointerdown', 3, 40);
    assert.equal(removed, true);
    fire('pointerup', 3, 40);
    fire('pointermove', 2, 50);
    fire('pointerup', 2, 50);
    assert.equal(strokes.length, 1);
    fire('pointerdown', 4, 0);
    fire('pointermove', 4, 20);
    fire('pointerup', 4, 25);
    assert.equal(strokes.length, 2);
    assert.deepEqual(errors, []);
  } finally {
    cleanup();
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
