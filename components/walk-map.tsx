'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { LocateFixed, Plus, Minus, Scan, MapPin } from 'lucide-react';
import { DEFAULT_START, distance, type Point, type Walk } from '@/lib/route';

type Props = {
  start: Point | null;
  points: Point[];
  walk: Walk | null;
  drawing: boolean;
  pickingStart: boolean;
  busy: boolean;
  onConfirmStart: (p: Point) => void;
  onPoint: (p: Point) => void;
  onSketch: (p: Point[]) => void;
  onGps: () => void;
  onError: (s: string) => void;
};
export default function WalkMap(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<Leaflet.Map | null>(null),
    api = useRef<typeof Leaflet | null>(null),
    layers = useRef<Leaflet.LayerGroup | null>(null),
    latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import('leaflet')
      .then((L) => {
        if (cancelled || !container.current) return;
        api.current = L;
        const m = L.map(container.current, {
          zoomControl: false,
          attributionControl: true,
        }).setView(DEFAULT_START, 14);
        map.current = m;
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          updateWhenIdle: true,
        })
          .on('tileerror', () =>
            latest.current.onError(
              'Частина карти не завантажилась. Перевірте інтернет.',
            ),
          )
          .addTo(m);
        layers.current = L.layerGroup().addTo(m);
        m.on('click', (e) => {
          if (
            !latest.current.drawing &&
            !latest.current.pickingStart &&
            latest.current.start &&
            !latest.current.busy
          )
            latest.current.onPoint([e.latlng.lat, e.latlng.lng]);
        });
        setReady(true);
      })
      .catch(() =>
        latest.current.onError(
          'Не вдалося завантажити карту. Оновіть сторінку.',
        ),
      );
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current || !api.current || !layers.current) return;
    const L = api.current,
      group = layers.current;
    group.clearLayers();
    if (props.walk) {
      L.polyline(props.walk.points, {
        color: '#ffffff',
        weight: 10,
        opacity: 0.95,
      }).addTo(group);
      L.polyline(props.walk.points, {
        color: '#19785c',
        weight: 6,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);
    } else if (props.points.length && props.start)
      L.polyline([props.start, ...props.points], {
        color: '#19785c',
        weight: 3,
        dashArray: '7 9',
        opacity: 0.7,
      }).addTo(group);
    if (props.start)
      L.marker(props.start, {
        icon: L.divIcon({
          className: 'start-marker',
          html: '<span></span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        keyboard: false,
      })
        .bindTooltip('Старт')
        .addTo(group);
    props.points.forEach((p, i) =>
      L.marker(p, {
        icon: L.divIcon({
          className: 'waypoint-marker',
          html: String(i + 1),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        keyboard: false,
      })
        .bindTooltip('Точка ' + (i + 1))
        .addTo(group),
    );
  }, [ready, props.start, props.points, props.walk]);
  useEffect(() => {
    if (ready && props.start) map.current?.setView(props.start, 15);
  }, [ready, props.start]);
  useEffect(() => {
    if (
      (props.pickingStart || props.drawing) &&
      window.matchMedia('(max-width:700px)').matches
    )
      container.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [props.pickingStart, props.drawing]);
  useEffect(() => {
    if (ready && props.walk)
      map.current?.fitBounds(props.walk.points, {
        padding: [50, 60],
        maxZoom: 16,
      });
  }, [ready, props.walk]);
  useEffect(() => {
    const m = map.current,
      el = container.current,
      L = api.current;
    if (!ready || !m || !el || !L) return;
    if (!props.drawing) {
      m.dragging.enable();
      m.doubleClickZoom.enable();
      m.touchZoom.enable();
      return;
    }
    m.dragging.disable();
    m.doubleClickZoom.disable();
    m.touchZoom.disable();
    let points: Point[] = [],
      line: Leaflet.Polyline | null = null,
      active: number | null = null;
    const point = (e: PointerEvent): Point => {
      const ll = m.mouseEventToLatLng(e);
      return [ll.lat, ll.lng];
    };
    const down = (e: PointerEvent) => {
      if (active !== null || e.button !== 0) return;
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
      if (active !== e.pointerId) return;
      e.preventDefault();
      const p = point(e);
      if (distance(points.at(-1)!, p) > 8) {
        points.push(p);
        line?.setLatLngs(points);
      }
    };
    const finish = (e: PointerEvent) => {
      if (active !== e.pointerId) return;
      active = null;
      line?.remove();
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
      if (e.type === 'pointercancel') return;
      points.push(point(e));
      if (points.length > 2 && distance(points[0], points[1]) > 0)
        latest.current.onSketch(points);
      else latest.current.onError('Проведіть довшу лінію на карті.');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    return () => {
      line?.remove();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      m.dragging.enable();
      m.doubleClickZoom.enable();
      m.touchZoom.enable();
    };
  }, [ready, props.drawing]);
  return (
    <section
      className={
        'map-panel ' +
        (props.drawing ? 'is-drawing' : '') +
        (props.pickingStart ? ' picking-start' : '')
      }
      aria-label="Карта маршруту"
    >
      <div className="map-canvas" ref={container} />
      <div className="map-label">
        <span className="live-dot" /> Пішохідна карта
      </div>
      {(props.drawing || props.pickingStart) && (
        <div className="map-instruction">
          {props.drawing
            ? 'Проведіть маршрут пальцем або мишкою'
            : 'Пересуньте карту під приціл і підтвердьте старт'}
        </div>
      )}
      <div className="map-controls">
        <button
          title="Наблизити"
          aria-label="Наблизити карту"
          onClick={() => map.current?.zoomIn()}
        >
          <Plus size={20} />
        </button>
        <button
          title="Віддалити"
          aria-label="Віддалити карту"
          onClick={() => map.current?.zoomOut()}
        >
          <Minus size={20} />
        </button>
        <span />
        <button
          title="Моя геолокація"
          aria-label="Моя геолокація"
          onClick={props.onGps}
        >
          <LocateFixed size={20} />
        </button>
        <button
          title="Показати маршрут"
          aria-label="Показати весь маршрут"
          onClick={() => {
            if (props.walk)
              map.current?.fitBounds(props.walk.points, { padding: [50, 60] });
            else if (props.start) map.current?.setView(props.start, 15);
          }}
        >
          <Scan size={20} />
        </button>
      </div>
      {(props.pickingStart || (!props.start && !props.drawing)) && (
        <button
          className="map-center-button confirm-start-button"
          disabled={!ready || props.busy}
          onClick={() => {
            const c = map.current?.getCenter();
            if (c) props.onConfirmStart([c.lat, c.lng]);
          }}
        >
          <MapPin size={16} /> Підтвердити старт тут
        </button>
      )}
      {(props.pickingStart || !props.start) && (
        <span className="center-cross" aria-hidden="true">
          +
        </span>
      )}
      {!ready && <div className="map-loading">Завантаження карти…</div>}
    </section>
  );
}
