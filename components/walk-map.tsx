'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import {
  LocateFixed,
  Plus,
  Minus,
  Scan,
  MapPin,
  Pencil,
  Hand,
  RotateCcw,
  Trash2,
  Route,
} from 'lucide-react';
import {
  DEFAULT_START,
  distance,
  type Point,
  type Walk,
  type SketchPrecision,
} from '@/lib/route';
import { directionLane, directionArrows } from '@/lib/route-display';

type Props = {
  pointTool: 'add' | 'edit' | 'move';
  selectedPoint: number | null;
  onPointTool: (tool: 'add' | 'edit' | 'move') => void;
  onSelectPoint: (index: number | null) => void;
  onMovePoint: (index: number, p: Point) => void;
  onRemovePoint: (index: number) => void;
  onBuild: () => void;
  onClearPoints: () => void;
  precision: SketchPrecision;
  onPrecision: (value: SketchPrecision) => void;
  start: Point | null;
  points: Point[];
  walk: Walk | null;
  drawing: boolean;
  pickingStart: boolean;
  busy: boolean;
  mode: string;
  sketch: Point[];
  onToggleDrawing: () => void;
  onNewSketch: () => void;
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
    const editing =
      (props.mode === 'point' || props.mode === 'multi') &&
      props.pointTool === 'edit' &&
      !props.pickingStart;
    const wireEditor = (marker: Leaflet.Marker, index: number) => {
      if (!editing) return marker;
      marker.on('click', () => latest.current.onSelectPoint(index));
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        latest.current.onSelectPoint(index);
        latest.current.onMovePoint(index, [p.lat, p.lng]);
      });
      return marker;
    };
    group.clearLayers();
    if (!props.walk && props.points.length && props.start)
      L.polyline(
        props.mode === 'draw' ? props.sketch : [props.start, ...props.points],
        {
          color: '#19785c',
          weight: 3,
          dashArray: '7 9',
          opacity: 0.7,
        },
      ).addTo(group);
    if (props.start)
      wireEditor(
        L.marker(props.start, {
          draggable: editing && !props.busy,
          title: 'Старт',
          icon: L.divIcon({
            className:
              'map-pin-icon' +
              (editing ? ' editable-pin' : '') +
              (editing && props.selectedPoint === -1 ? ' selected-pin' : ''),
            html: '<div class="krok-start"><span></span></div>',
            iconSize: editing ? [44, 44] : [28, 28],
            iconAnchor: editing ? [22, 22] : [14, 14],
          }),
          keyboard: false,
        }),
        -1,
      )
        .bindTooltip('Старт')
        .addTo(group);
    const markers =
      props.mode === 'draw'
        ? props.walk
          ? [props.walk.points.at(-1)!]
          : []
        : props.points;
    markers.forEach((p, i) => {
      if (!editing && props.start && distance(props.start, p) < 15) return;
      wireEditor(
        L.marker(p, {
          draggable: editing && !props.busy,
          title: 'Точка ' + (i + 1),
          icon: L.divIcon({
            className:
              'map-pin-icon' +
              (editing ? ' editable-pin' : '') +
              (editing && props.selectedPoint === i ? ' selected-pin' : ''),
            html:
              '<div class="krok-waypoint"><span>' +
              (props.mode === 'draw' ? 'Ф' : String(i + 1)) +
              '</span></div>',
            iconSize: editing ? [44, 44] : [30, 30],
            iconAnchor: editing ? [22, 22] : [15, 15],
          }),
          keyboard: false,
          zIndexOffset: 100,
        }),
        i,
      )
        .bindTooltip(props.mode === 'draw' ? 'Фініш' : 'Точка ' + (i + 1))
        .addTo(group);
    });
  }, [
    ready,
    props.start,
    props.points,
    props.walk,
    props.mode,
    props.sketch,
    props.pointTool,
    props.selectedPoint,
    props.busy,
    props.pickingStart,
  ]);
  useEffect(() => {
    const L = api.current,
      m = map.current;
    if (!ready || !L || !m || !props.walk) return;
    const route = L.layerGroup().addTo(m);
    const draw = () => {
      route.clearLayers();
      const lane = directionLane(
        props.walk!.points.map((p) => m.latLngToLayerPoint(p)),
      );
      const latLngs = lane.map((p) => m.layerPointToLatLng(L.point(p.x, p.y)));
      const common = {
        interactive: false,
        smoothFactor: 0,
        lineCap: 'round' as const,
      };
      L.polyline(latLngs, { ...common, color: '#fff', weight: 8 }).addTo(route);
      L.polyline(latLngs, { ...common, color: '#16634e', weight: 5 }).addTo(
        route,
      );
      L.polyline(latLngs, {
        ...common,
        color: '#7de3bc',
        weight: 2,
        dashArray: '2 24',
        className: 'route-flow',
      }).addTo(route);
      const viewport = m.getSize();
      const arrows = directionArrows(lane).filter((arrow) => {
        const p = m.layerPointToContainerPoint(L.point(arrow[1].x, arrow[1].y));
        return (
          p.x > -20 &&
          p.y > -20 &&
          p.x < viewport.x + 20 &&
          p.y < viewport.y + 20
        );
      });
      L.polyline(
        arrows.map((arrow) =>
          arrow.map((p) => m.layerPointToLatLng(L.point(p.x, p.y))),
        ),
        {
          ...common,
          color: '#fff',
          weight: 2.2,
        },
      ).addTo(route);
    };
    draw();
    m.on('zoomend moveend resize', draw);
    return () => {
      m.off('zoomend moveend resize', draw);
      route.remove();
    };
  }, [ready, props.walk]);
  useEffect(() => {
    if (!ready || !container.current) return;
    const observer = new ResizeObserver(() =>
      map.current?.invalidateSize({ pan: false }),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    if (ready && props.start && props.pointTool !== 'edit')
      map.current?.setView(props.start, 15);
  }, [ready, props.start, props.pointTool]);
  useEffect(() => {
    if (
      ready &&
      props.walk &&
      props.mode !== 'draw' &&
      props.pointTool !== 'edit'
    )
      map.current?.fitBounds(props.walk.points, {
        padding: [50, 60],
        maxZoom: 16,
      });
  }, [ready, props.walk, props.mode, props.pointTool]);
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
    m.touchZoom.enable();
    let points: Point[] = [],
      line: Leaflet.Polyline | null = null,
      active: number | null = null;
    const fingers = new Set<number>();
    let pinching = false,
      panning = false;
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
      m.dragging.disable();
      el.style.cursor = '';
    };
    const point = (e: PointerEvent): Point => {
      const ll = m.mouseEventToLatLng(e);
      return [ll.lat, ll.lng];
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        fingers.add(e.pointerId);
        if (fingers.size > 1) {
          pinching = true;
          active = null;
          line?.remove();
          points = [];
          return;
        }
      }
      if (panning || pinching || active !== null || e.button !== 0) return;
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
      if (pinching || active !== e.pointerId) return;
      e.preventDefault();
      const p = point(e);
      if (distance(points.at(-1)!, p) > 8) {
        points.push(p);
        line?.setLatLngs(points);
      }
    };
    const finish = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (pinching) {
        if (fingers.size === 0) pinching = false;
        return;
      }
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
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
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
        <span className="live-dot" />{' '}
        {props.walk ? 'Стрілки показують напрямок' : 'Пішохідна карта'}
      </div>
      {(props.drawing || props.pickingStart) && (
        <div className="map-instruction">
          {props.drawing
            ? 'Один палець — малювати, два — масштаб. Відпустіть для побудови.'
            : 'Пересуньте карту під приціл і підтвердьте старт'}
        </div>
      )}
      {props.mode === 'draw' && props.start && !props.pickingStart && (
        <div className="map-draw-tools sketch-tools">
          <button
            disabled={props.busy}
            onClick={props.onToggleDrawing}
            className={props.drawing ? 'active' : ''}
            aria-pressed={props.drawing}
          >
            {props.drawing ? <Hand size={17} /> : <Pencil size={17} />}{' '}
            {props.drawing
              ? 'Рухати карту'
              : props.sketch.length
                ? 'Продовжити лінію'
                : 'Малювати'}
          </button>
          {props.sketch.length > 0 && (
            <button
              disabled={props.busy}
              onClick={props.onNewSketch}
              aria-label="Новий малюнок"
              title="Новий малюнок"
            >
              <RotateCcw size={17} />
            </button>
          )}
          <label className="sketch-precision">
            Свобода маршруту
            <select
              aria-label="Точність ескізу"
              value={props.precision}
              disabled={props.busy || props.drawing}
              onChange={(e) =>
                props.onPrecision(e.target.value as SketchPrecision)
              }
            >
              <option value="loose">Вільно · до ≈200 м</option>
              <option value="balanced">Точніше · до ≈100 м</option>
              <option value="precise">За лінією</option>
            </select>
          </label>
        </div>
      )}
      {(props.mode === 'point' || props.mode === 'multi') &&
        props.start &&
        !props.pickingStart && (
          <div
            className="map-draw-tools point-tools"
            aria-label="Керування точками"
          >
            <div className="point-tool-row">
              <button
                disabled={props.busy}
                className={props.pointTool === 'add' ? 'active' : ''}
                aria-pressed={props.pointTool === 'add'}
                onClick={() => props.onPointTool('add')}
              >
                <Plus size={16} />
                Точки
              </button>
              <button
                disabled={props.busy}
                className={props.pointTool === 'edit' ? 'active' : ''}
                aria-pressed={props.pointTool === 'edit'}
                onClick={() => props.onPointTool('edit')}
              >
                <Pencil size={16} />
                Змінити
              </button>
              <button
                disabled={props.busy}
                className={props.pointTool === 'move' ? 'active' : ''}
                aria-pressed={props.pointTool === 'move'}
                onClick={() => props.onPointTool('move')}
                title="Рухати карту без додавання точок"
                aria-label="Рухати карту"
              >
                <Hand size={16} />
              </button>
            </div>
            {props.pointTool === 'edit' && (
              <>
                <span className="point-tool-hint">
                  Перетягніть точку — шлях оновиться.
                </span>
                <div className="point-tool-row">
                  <select
                    aria-label="Точка для редагування"
                    disabled={props.busy}
                    value={props.selectedPoint ?? ''}
                    onChange={(e) =>
                      props.onSelectPoint(
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                  >
                    <option value="">Оберіть точку</option>
                    <option value="-1">Старт</option>
                    {props.points.map((_, i) => (
                      <option key={i} value={i}>
                        Точка {i + 1}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={props.busy || props.selectedPoint === null}
                    onClick={() => {
                      const p = map.current?.getCenter();
                      if (p && props.selectedPoint !== null)
                        props.onMovePoint(props.selectedPoint, [p.lat, p.lng]);
                    }}
                  >
                    До центру
                  </button>
                  <button
                    aria-label="Видалити обрану точку"
                    title="Видалити обрану точку"
                    disabled={
                      props.busy ||
                      props.selectedPoint === null ||
                      props.selectedPoint < 0
                    }
                    onClick={() => {
                      if (props.selectedPoint !== null)
                        props.onRemovePoint(props.selectedPoint);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </>
            )}
            <div className="point-tool-row">
              <button
                className="active"
                disabled={props.busy || !props.points.length}
                onClick={props.onBuild}
              >
                <Route size={16} />
                {props.busy
                  ? 'Будуємо…'
                  : props.walk
                    ? 'Перебудувати'
                    : 'Побудувати'}
              </button>
              <button
                disabled={props.busy || !props.points.length}
                title="Забрати останню точку"
                aria-label="Забрати останню точку"
                onClick={() => props.onRemovePoint(props.points.length - 1)}
              >
                <RotateCcw size={16} />
              </button>
              <button
                disabled={props.busy || !props.points.length}
                title="Очистити точки"
                aria-label="Очистити точки"
                onClick={props.onClearPoints}
              >
                <Trash2 size={16} />
              </button>
            </div>
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
      {(props.pickingStart ||
        !props.start ||
        ((props.mode === 'point' || props.mode === 'multi') &&
          props.pointTool === 'edit' &&
          props.selectedPoint !== null)) && (
        <span className="center-cross" aria-hidden="true">
          +
        </span>
      )}
      {!ready && <div className="map-loading">Завантаження карти…</div>}
    </section>
  );
}
