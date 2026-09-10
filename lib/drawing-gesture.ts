import type * as Leaflet from 'leaflet';
import { distance, type Point } from './route.ts';
import { TouchGesture } from './touch-gesture.ts';

export function bindDrawingGesture(
  m: Leaflet.Map,
  el: HTMLElement,
  L: typeof Leaflet,
  onSketch: (points: Point[]) => void,
  onError: (message: string) => void,
) {
  m.dragging.disable();
  m.doubleClickZoom.disable();
  m.touchZoom.disable();
  let points: Point[] = [],
    line: Leaflet.Polyline | null = null,
    active: number | null = null;
  const touches = new TouchGesture();
  const originalZoomSnap = m.options.zoomSnap;
  m.options.zoomSnap = 0;
  let pinch: { anchor: Leaflet.LatLng; zoom: number; span: number } | null =
    null;
  let panning = false;
  const beginPinch = () => {
    const pair = touches.pair();
    pinch = pair
      ? {
          anchor: m.containerPointToLatLng([pair.midpoint.x, pair.midpoint.y]),
          zoom: m.getZoom(),
          span: pair.span,
        }
      : null;
  };
  const cancelLine = () => {
    if (active !== null && el.hasPointerCapture(active))
      el.releasePointerCapture(active);
    active = null;
    line?.remove();
    line = null;
    points = [];
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      event.code !== 'Space' ||
      active !== null ||
      (event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,button,[contenteditable]'))
    )
      return;
    event.preventDefault();
    panning = true;
    m.dragging.enable();
    el.style.cursor = 'grab';
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || !panning) return;
    panning = false;
    m.dragging.disable();
    el.style.cursor = '';
  };
  const blur = () => {
    panning = false;
    cancelLine();
    for (const id of touches.points.keys())
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    touches.reset();
    pinch = null;
    m.dragging.disable();
    el.style.cursor = '';
  };
  const point = (e: PointerEvent): Point => {
    const ll = m.mouseEventToLatLng(e);
    return [ll.lat, ll.lng];
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.down(e.pointerId, m.mouseEventToContainerPoint(e));
      el.setPointerCapture(e.pointerId);
      if (touches.navigating) {
        e.preventDefault();
        cancelLine();
        for (const id of touches.points.keys()) el.setPointerCapture(id);
        beginPinch();
        return;
      }
    }
    if (panning || touches.navigating || active !== null || e.button !== 0)
      return;
    line?.remove();
    e.preventDefault();
    active = e.pointerId;
    el.setPointerCapture(e.pointerId);
    points = [point(e)];
    line = L.polyline(points, {
      color: '#19785c',
      weight: 4,
      dashArray: '5 7',
    }).addTo(m);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.move(e.pointerId, m.mouseEventToContainerPoint(e));
      if (touches.navigating) {
        e.preventDefault();
        const pair = touches.pair();
        if (pair && pinch) {
          const zoom = Math.max(
            m.getMinZoom(),
            Math.min(
              m.getMaxZoom(),
              m.getScaleZoom(pair.span / pinch.span, pinch.zoom),
            ),
          );
          const center = m
            .project(pinch.anchor, zoom)
            .subtract([pair.midpoint.x, pair.midpoint.y])
            .add(m.getSize().divideBy(2));
          m.setView(m.unproject(center, zoom), zoom, { animate: false });
        }
        return;
      }
    }
    if (active !== e.pointerId) return;
    e.preventDefault();
    const p = point(e);
    if (distance(points.at(-1)!, p) > 8) {
      points.push(p);
      line?.setLatLngs(points);
    }
  };
  const finish = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      const navigating = touches.navigating;
      touches.up(e.pointerId);
      if (navigating) {
        if (el.hasPointerCapture(e.pointerId))
          el.releasePointerCapture(e.pointerId);
        beginPinch();
        return;
      }
    }
    if (active !== e.pointerId) return;
    active = null;
    line?.remove();
    if (el.hasPointerCapture(e.pointerId))
      el.releasePointerCapture(e.pointerId);
    if (e.type === 'pointercancel') {
      onError(
        'Малювання перервано пристроєм. Спробуйте провести лінію ще раз.',
      );
      return;
    }
    points.push(point(e));
    if (points.length >= 2 && points.some((p) => distance(points[0], p) >= 8))
      onSketch(points);
    else onError('Проведіть довшу лінію на карті.');
  };
  const preventContextMenu = (event: Event) => event.preventDefault();
  el.addEventListener('contextmenu', preventContextMenu);
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  return () => {
    cancelLine();
    for (const id of touches.points.keys())
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    touches.reset();
    m.options.zoomSnap = originalZoomSnap;
    el.removeEventListener('contextmenu', preventContextMenu);
    line?.remove();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', finish);
    el.removeEventListener('pointercancel', finish);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
    el.style.cursor = '';
    m.dragging.enable();
    m.doubleClickZoom.enable();
    m.touchZoom.enable();
  };
}
