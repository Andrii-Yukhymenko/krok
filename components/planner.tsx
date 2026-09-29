'use client';
import { SESSION_KEY, readSession, type Session } from '@/lib/session';
import { eraseBrush, type BrushEdit } from '@/lib/brush-erase';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Check,
  Footprints,
  LocateFixed,
  MapPin,
  Pencil,
  Route,
  Settings2,
  Shuffle,
  Undo2,
  X,
  Download,
  Clock3,
  Ruler,
  Flag,
  RotateCcw,
  Info,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import ProfileForm from './profile-form';
import { DEFAULT_HEIGHT, readProfile, strideFromHeight } from '@/lib/profile';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import WalkMap from './walk-map';
import PlannerPanel from './planner-panel';
import { scenicWalk, clearPlacesCache, type Place } from '@/lib/places';
import { diagnosticReport } from '@/lib/service';
import { repeatedRatio } from '@/lib/route-quality';
import { requiredWalk } from '@/lib/required-walk';
import { resizeWalk } from '@/lib/resize-walk';
import RouteLengthControl from './route-length-control';
import {
  DEFAULT_START,
  distance,
  destination,
  sampleSketch,
  sketchRoute,
  stepsFor,
  walkingRoute,
  withReturn,
  type Point,
  type Walk,
  type SketchPrecision,
} from '@/lib/route';

type Mode = 'point' | 'multi' | 'draw' | 'auto';
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const fmt = (n: number) => new Intl.NumberFormat('uk-UA').format(n);
const coords = (p: Point) => p.map((n) => n.toFixed(4)).join(', ');
const today = () => new Date().toLocaleDateString('en-CA');

export default function Planner() {
  const pointBuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [erasing, setErasing] = useState(false);
  const [eraseUndo, setEraseUndo] = useState<{
    edited: Walk;
    walk: Walk;
    sketch: Point[];
    points: Point[];
    mustVisit: Point[];
    places: Place[];
  } | null>(null);
  const [resizeTarget, setResizeTarget] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeAbort = useRef<AbortController | null>(null);
  const resizeBase = useRef<{
    walk: Walk;
    places: Place[];
    required: Point[];
    shape: Point[];
    steps: number;
  } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [lengthOpen, setLengthOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState(false);
  const [routeUndo, setRouteUndo] = useState<Session | null>(null);
  const [sketch, setSketch] = useState<Point[]>([]);
  const [mustVisit, setMustVisit] = useState<Point[]>([]);
  const [precision, setPrecision] = useState<SketchPrecision>('loose');
  const [pointTool, setPointTool] = useState<'add' | 'edit' | 'move'>('add');
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [ideaStyle, setIdeaStyle] = useState('scenic');
  const [routePlaces, setRoutePlaces] = useState<Place[]>([]);
  const [placesNotice, setPlacesNotice] = useState('');
  const ideaVariation = useRef(0);
  const [mode, setMode] = useState<Mode>('point'),
    [start, setStart] = useState<Point | null>(null),
    [startLabel, setStartLabel] = useState('Старт ще не обрано'),
    [points, setPoints] = useState<Point[]>([]),
    [walk, setWalk] = useState<Walk | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT),
    [goal, setGoal] = useState(10000),
    [done, setDone] = useState(0),
    [sliderMax, setSliderMax] = useState(10000),
    [back, setBack] = useState(false),
    [pickingStart, setPickingStart] = useState(false),
    [drawing, setDrawing] = useState(false),
    [busy, setBusy] = useState(false),
    [gpsBusy, setGpsBusy] = useState(false);
  const [message, setMessage] = useState(''),
    [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false),
    [online, setOnline] = useState(true),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [loaded, setLoaded] = useState(false),
    [manual, setManual] = useState(''),
    [coordinateError, setCoordinateError] = useState(''),
    [storageError, setStorageError] = useState(false);
  const controller = useRef<AbortController | null>(null),
    gpsVersion = useRef(0);
  const stride = strideFromHeight(height);
  const remaining = Math.max(0, goal - done),
    shownWalk = useMemo(
      () => walk && (back && mode !== 'auto' ? withReturn(walk) : walk),
      [walk, back, mode],
    ),
    steps = shownWalk ? stepsFor(shownWalk.meters, stride) : 0;
  function cancelResize() {
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeTimer.current = null;
    resizeAbort.current?.abort();
    resizeAbort.current = null;
    resizeBase.current = null;
    setResizing(false);
    setResizeTarget(null);
  }
  useEffect(
    () => () => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeAbort.current?.abort();
    },
    [],
  );
  function changeLength(value: number) {
    if (!walk || !start || busy) return;
    if (!resizeBase.current)
      resizeBase.current = {
        walk,
        places: routePlaces,
        required: mode === 'auto' ? mustVisit : points,
        shape: sketch,
        steps: Math.max(200, Math.round(steps / 100) * 100),
      };
    const snapshot = resizeBase.current;
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeAbort.current?.abort();
    const abort = new AbortController();
    resizeAbort.current = abort;
    setResizeTarget(value);
    setResizing(true);
    setMessage('');
    if (value === snapshot.steps) {
      setWalk(snapshot.walk);
      setRoutePlaces(snapshot.places);
      if (mode !== 'auto' && mode !== 'draw') setPoints(snapshot.required);
      setResizing(false);
      setMessage('Повернуто початковий маршрут.');
      return;
    }
    resizeTimer.current = setTimeout(async () => {
      const multiplier = back && mode !== 'auto' ? 2 : 1;
      try {
        const result = await resizeWalk(
          {
            base: snapshot.walk,
            start,
            required: snapshot.required,
            mode,
            style: ideaStyle,
            target: (value * stride) / 100 / multiplier,
            shape: snapshot.shape,
            precision,
          },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setWalk(result.walk);
        if (result.waypoints && mode !== 'auto' && mode !== 'draw')
          setPoints(result.waypoints);
        setRoutePlaces(
          result.walk === snapshot.walk ? snapshot.places : result.places,
        );
        const actual = stepsFor(result.walk.meters * multiplier, stride);
        setMessage(
          [
            result.notice,
            Math.abs(actual - value) / value > 0.1
              ? `Бажано ${fmt(value)}, знайдено ≈ ${fmt(actual)} кроків.`
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      } catch (error) {
        if (!abort.signal.aborted)
          setMessage(
            (error instanceof Error
              ? error.message
              : 'Не вдалося змінити довжину.') + ' Поточний маршрут залишено.',
          );
      } finally {
        if (resizeAbort.current === abort) setResizing(false);
      }
    }, 900);
  }
  const lengthControl = shownWalk && (
    <RouteLengthControl
      value={resizeTarget ?? Math.max(200, Math.round(steps / 100) * 100)}
      actual={steps}
      max={Math.max(
        20000,
        Math.ceil(
          (stepsFor(
            (resizeBase.current?.walk.meters ?? walk!.meters) *
              (back && mode !== 'auto' ? 2 : 1),
            stride,
          ) *
            1.75) /
            1000,
        ) * 1000,
      )}
      pending={resizing}
      onChange={changeLength}
      onCancel={cancelResize}
    />
  );
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('krok-settings') || '{}');
        const profile = readProfile(raw ?? {}, today());
        setHeight(profile.height);
        setGoal(profile.goal);
        setDone(profile.done);
        setSliderMax(
          Math.max(
            profile.goal || 10000,
            Math.ceil(profile.done / 1000) * 1000,
          ),
        );
      } catch {
        setStorageError(true);
      }
      try {
        const saved = readSession(localStorage.getItem(SESSION_KEY));
        if (saved) {
          setStart(saved.start);
          setPointTool(saved.walk ? 'move' : 'add');
          setEditingRoute(!saved.walk);
          setStartLabel(saved.startLabel);
          setPoints(saved.points);
          setSketch(saved.sketch);
          setMustVisit(saved.mustVisit);
          setWalk(saved.walk);
          setRoutePlaces(saved.routePlaces ?? []);
          setMode(saved.mode);
          setBack(saved.back);
          setPrecision(saved.precision);
          setIdeaStyle(saved.ideaStyle);
        }
      } catch {
        setStorageError(true);
      }
      setLoaded(true);
    });
    const net = () => setOnline(navigator.onLine);
    net();
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    const before = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    const installed = () => setInstall(null);
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', installed);
    if ('serviceWorker' in navigator && import.meta.env.PROD)
      navigator.serviceWorker
        .register(import.meta.env.BASE_URL + 'sw.js')
        .catch(() =>
          setMessage('Автономний режим недоступний у цьому браузері.'),
        );
    return () => {
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', installed);
      controller.current?.abort();
      if (pointBuildTimer.current) clearTimeout(pointBuildTimer.current);
    };
  }, []);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(
          'krok-settings',
          JSON.stringify({ height, goal, done, date: today(), version: 2 }),
        );
      } catch {
        queueMicrotask(() => setStorageError(true));
      }
  }, [height, goal, done, loaded]);
  useEffect(() => {
    if (!loaded || busy || resizing) return;
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          version: 1,
          start,
          startLabel,
          points,
          sketch,
          mustVisit,
          walk,
          routePlaces,
          mode,
          back,
          precision,
          ideaStyle,
        }),
      );
    } catch {
      queueMicrotask(() => setStorageError(true));
    }
  }, [
    loaded,
    busy,
    resizing,
    routePlaces,
    start,
    startLabel,
    points,
    sketch,
    mustVisit,
    walk,
    mode,
    back,
    precision,
    ideaStyle,
  ]);
  async function eraseStroke(edit: BrushEdit) {
    if (!walk || busy || resizing) return;
    const snapshot = { walk, sketch, points, mustVisit, places: routePlaces };
    cancelResize();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage('');
    try {
      const { walk: result, ranges } = await eraseBrush(
        { ...edit, trimEnd: mode === 'draw' },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setEraseUndo({ ...snapshot, edited: result });
      setWalk(result);
      // Remove waypoints on the erased interval so later builds cannot restore the detour.
      const keep = (p: Point) => {
        let nearest = 0,
          best = Infinity;
        edit.walk.points.forEach((q, i) => {
          const d = distance(p, q);
          if (d < best) {
            best = d;
            nearest = i;
          }
        });
        return !ranges.some(([a, b]) => nearest > a && nearest < b);
      };
      setPoints(points.filter(keep));
      setMustVisit(mustVisit.filter(keep));
      setRoutePlaces(routePlaces.filter((p) => keep(p.point)));
      if (mode === 'draw') {
        setSketch(result.points);
        setPoints(sampleSketch(result.points));
      }
      setMessage(
        mode === 'draw' &&
          ranges.some(([, b]) => b === edit.walk.points.length - 1)
          ? 'Кінець маршруту стерто. Фініш перенесено до решти лінії.'
          : 'Ділянку замінено пішохідним шляхом. За потреби скасуйте зміну.',
      );
    } catch (error) {
      if (!abort.signal.aborted)
        setMessage(
          (error instanceof Error
            ? error.message
            : 'Не вдалося змінити ділянку.') + ' Маршрут залишено.',
        );
    } finally {
      if (controller.current === abort) {
        setBusy(false);
      }
    }
  }
  function cancelSearch() {
    if (pointBuildTimer.current) clearTimeout(pointBuildTimer.current);
    pointBuildTimer.current = null;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setMessage('Пошук скасовано. Можна повторити або почати новий маршрут.');
  }
  function invalidate(keepWalk = false) {
    if (pointBuildTimer.current) clearTimeout(pointBuildTimer.current);
    pointBuildTimer.current = null;
    setErasing(false);

    setEraseUndo(null);
    cancelResize();
    setPlacesNotice('');
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    if (!keepWalk) setWalk(null);
    setMessage('');
    setRoutePlaces([]);
  }
  function chooseStart(p: Point, label = 'Обрана точка') {
    rememberRoute();
    setLengthOpen(false);
    setMustVisit([]);
    setSelectedPoint(null);
    setPointTool('add');
    gpsVersion.current++;
    setGpsBusy(false);
    invalidate();
    setStart(p);
    setStartLabel(label);
    setPickingStart(false);
    setDrawing(false);
    setPoints([]);
    setSketch([]);
    setPanelOpen(false);
    setEditingRoute(true);
  }
  function rememberRoute() {
    if (!walk && !points.length && !sketch.length && !mustVisit.length) return;
    setRouteUndo({
      version: 1,
      start,
      startLabel,
      points,
      sketch,
      mustVisit,
      walk,
      mode,
      back,
      precision,
      ideaStyle,
      routePlaces,
    });
  }
  function newRoute() {
    rememberRoute();
    setLengthOpen(false);
    gpsVersion.current++;
    setGpsBusy(false);
    invalidate();
    setPoints([]);
    setSketch([]);
    setMustVisit([]);
    setSelectedPoint(null);
    setPointTool('add');
    setDrawing(false);
    setPickingStart(false);
    setEditingRoute(true);
    setPanelOpen(false);
  }
  function restoreRoute() {
    if (!routeUndo) return;
    gpsVersion.current++;
    setGpsBusy(false);
    invalidate();
    setLengthOpen(false);
    setStart(routeUndo.start);
    setStartLabel(routeUndo.startLabel);
    setPoints(routeUndo.points);
    setSketch(routeUndo.sketch);
    setMustVisit(routeUndo.mustVisit);
    setWalk(routeUndo.walk);
    setMode(routeUndo.mode);
    setBack(routeUndo.back);
    setPrecision(routeUndo.precision);
    setIdeaStyle(routeUndo.ideaStyle);
    setRoutePlaces(routeUndo.routePlaces ?? []);
    setPointTool(routeUndo.walk ? 'move' : 'add');
    setSelectedPoint(null);
    setDrawing(false);
    setPickingStart(false);
    setEditingRoute(!routeUndo.walk);
    setRouteUndo(null);
    setPanelOpen(false);
  }
  function pickStart() {
    gpsVersion.current++;
    setGpsBusy(false);
    setPickingStart(true);
    setDrawing(false);
    setErasing(false);
    setPanelOpen(false);
  }
  function finishEditing() {
    setEditingRoute(false);
    setDrawing(false);
    setErasing(false);
    setPointTool('move');
    setSelectedPoint(null);
  }
  function gps() {
    if (!navigator.geolocation) {
      setMessage('Геолокація недоступна. Оберіть старт на карті.');
      return;
    }
    const version = ++gpsVersion.current;
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (gpsVersion.current !== version) return;
        chooseStart([p.coords.latitude, p.coords.longitude], 'Моя геолокація');
      },
      (e) => {
        if (gpsVersion.current !== version) return;
        setGpsBusy(false);
        setMessage(
          e.code === 1
            ? 'Доступ до геолокації вимкнено. Дозвольте його в браузері або оберіть старт на карті.'
            : 'Не вдалося визначити місце. Оберіть старт на карті.',
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }
  function changeMode(value: unknown) {
    if (value === mode) return;
    rememberRoute();
    setLengthOpen(false);
    setMustVisit([]);
    setPointTool('add');
    setSelectedPoint(null);
    invalidate();
    setMode(value as Mode);
    setSketch([]);
    setPoints([]);
    setDrawing(false);
    setPickingStart(false);
    setEditingRoute(true);
  }
  async function build(
    input = points,
    origin = start,
    trace = sketch,
    accuracy = precision,
    keepWalk = false,
  ) {
    cancelResize();
    if (!origin) {
      setMessage('Спочатку оберіть старт.');
      return;
    }
    if (!input.length) {
      setMessage('Додайте точку або намалюйте маршрут.');
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    if (!keepWalk) setWalk(null);
    setMessage('');
    setDrawing(false);
    setPanelOpen(false);
    try {
      const result =
        mode === 'draw'
          ? await sketchRoute(origin, trace, abort.signal, accuracy)
          : await walkingRoute([origin, ...input], abort.signal);
      if (!abort.signal.aborted) {
        setWalk(result);
        if (mode !== 'multi' && !walk) finishEditing();
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setMessage(
          (e instanceof Error && e.name !== 'TimeoutError'
            ? e.message
            : 'Сервіс не відповів. Спробуйте ще раз.') +
            (keepWalk && walk ? ' Показано попередній маршрут.' : ''),
        );
    } finally {
      if (controller.current === abort) setBusy(false);
    }
  }
  function onPoint(p: Point) {
    if (resizing || (busy && mode !== 'point' && mode !== 'multi')) return;
    if (pickingStart || !start) return;
    if (mode === 'auto') {
      if (pointTool !== 'add') return;
      if (mustVisit.length >= 6) {
        setMessage('Можна додати до 6 обов’язкових зупинок.');
        return;
      }
      invalidate();
      setMustVisit([...mustVisit, p]);
      return;
    }
    if (mode === 'draw') return;
    if (pointTool !== 'add') return;
    const next = mode === 'point' ? [p] : [...points, p];
    if (next.length > 18) {
      setMessage('До 18 точок на один маршрут.');
      return;
    }
    invalidate(true);
    setPoints(next);
    setBusy(true);
    // Coalesce rapid taps and abort superseded requests; all selected points
    // stay visible immediately while only the newest route may be applied.
    pointBuildTimer.current = setTimeout(() => {
      pointBuildTimer.current = null;
      void build(next, start, sketch, precision, true);
    }, 350);
  }
  function movePoint(index: number, p: Point) {
    if (mode === 'auto') {
      if (busy || index < -1 || index >= mustVisit.length) return;
      const next =
        index < 0 ? mustVisit : mustVisit.map((q, i) => (i === index ? p : q));
      invalidate();
      setMustVisit(next);
      if (index < 0) {
        gpsVersion.current++;
        setGpsBusy(false);
        setStart(p);
        setStartLabel('Старт переміщено вручну');
      }
      void suggest(next, index < 0 ? p : start);
      return;
    }
    if (index < -1 || index >= points.length) return;
    if (busy || (mode !== 'point' && mode !== 'multi')) return;
    const next =
      index < 0 ? points : points.map((value, i) => (i === index ? p : value));
    invalidate();
    if (index < 0) {
      gpsVersion.current++;
      setGpsBusy(false);
      setStart(p);
      setStartLabel('Старт переміщено вручну');
    } else setPoints(next);
    if (next.length) void build(next, index < 0 ? p : start);
  }
  function removePoint(index: number) {
    if (mode === 'auto') {
      if (busy || index < 0 || index >= mustVisit.length) return;
      const next = mustVisit.filter((_, i) => i !== index);
      invalidate();
      setMustVisit(next);
      setSelectedPoint(null);
      return;
    }
    if (busy || index < 0 || index >= points.length) return;
    const next = points.filter((_, i) => i !== index);
    invalidate();
    setPoints(next);
    setSelectedPoint(null);
    if (next.length) void build(next);
  }
  async function suggest(required = mustVisit, origin = start) {
    cancelResize();
    setPlacesNotice('');
    if (!origin) {
      setMessage('Спочатку оберіть старт.');
      return;
    }
    if (remaining < 300 && !required.length) {
      setMessage('Ціль уже близько! Збільште ціль для нової прогулянки.');
      return;
    }
    rememberRoute();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage('');
    const target = (remaining * stride) / 100,
      bearing = Math.random() * 360;
    let radius = target / 6,
      best: Walk | null = null,
      bestPoints: Point[] = [];
    setPanelOpen(false);
    try {
      if (required.length) {
        const result = await requiredWalk(
          origin,
          required,
          target,
          ideaStyle,
          abort.signal,
          ideaVariation.current++,
        );
        if (!abort.signal.aborted) {
          setWalk(result.walk);
          setRoutePlaces(result.places);
          setMessage(result.notice);
          finishEditing();
        }
        return;
      }
      if (ideaStyle === 'scenic') {
        const result = await scenicWalk(
          origin,
          target,
          abort.signal,
          ideaVariation.current++,
          (notice) => {
            if (!abort.signal.aborted) setPlacesNotice(notice);
          },
        );
        if (!abort.signal.aborted) {
          setWalk(result.walk);
          setRoutePlaces(result.places);
          setPoints([...result.places.map((p) => p.point), origin]);
          finishEditing();
          if (Math.abs(result.walk.meters - target) / target > 0.1)
            setMessage(
              'Знайдено прогулянку через цікаві місця. Перевірте різницю з ціллю — точна довжина залежить від доріг.',
            );
        }
        return;
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        abort.signal.throwIfAborted();
        const candidates = [
          destination(origin, radius, bearing + attempt * 20),
          destination(origin, radius, bearing + 110 + attempt * 20),
          origin,
        ];
        try {
          const route = await walkingRoute(
            [origin, ...candidates],
            abort.signal,
          );
          if (
            !best ||
            Math.abs(route.meters - target) < Math.abs(best.meters - target)
          ) {
            best = route;
            bestPoints = candidates;
          }
          if (Math.abs(route.meters - target) / target < 0.1) break;
          radius *= Math.max(0.5, Math.min(1.7, target / route.meters));
        } catch (e) {
          if (abort.signal.aborted) throw e;
          if (attempt === 2 && !best) throw e;
          radius *= 0.8;
        }
      }
      if (best && !abort.signal.aborted) {
        setWalk(best);
        setPoints(bestPoints);
        setRoutePlaces([]);
        finishEditing();
        if (Math.abs(best.meters - target) / target > 0.1)
          setMessage(
            'Знайдено найближчий варіант. Він відрізняється від цілі — перевірте кількість кроків або спробуйте інший.',
          );
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setMessage(
          e instanceof Error ? e.message : 'Не вдалося знайти прогулянку.',
        );
    } finally {
      if (controller.current === abort) {
        setBusy(false);
      }
    }
  }
  const hasDraft =
    !!walk || points.length > 0 || sketch.length > 0 || mustVisit.length > 0;
  const choosingStart = pickingStart || !start;
  const planning = !shownWalk || editingRoute;
  const modeNames: Record<Mode, string> = {
    point: 'До місця',
    multi: 'Через зупинки',
    draw: 'Малювати',
    auto: 'Ідея',
  };
  const instruction = choosingStart
    ? 'Пересуньте карту: приціл позначає майбутній старт.'
    : erasing
      ? 'Проведіть по зайвій ділянці. Два пальці рухають карту.'
      : drawing
        ? 'Малюйте одним пальцем. Відпустіть — знайдемо доріжки.'
        : pointTool === 'edit' && editingRoute
          ? 'Перетягніть старт або зупинку — шлях оновиться.'
          : mode === 'multi' && editingRoute
            ? 'Торкайтеся карти, щоб додати зупинки. Потім натисніть «Готово».'
            : mode === 'auto' && planning
              ? 'Знайдемо прогулянку під вашу ціль. Зупинки на карті — за бажанням.'
              : mode === 'draw' && planning
                ? 'Увімкніть малювання й проведіть лінію на карті.'
                : mode === 'point' && planning
                  ? 'Торкніться місця на карті — маршрут побудується сам.'
                  : 'Маршрут готовий. Карту можна вільно пересувати.';
  const modePicker = (
    <Tabs value={mode} onValueChange={changeMode}>
      <TabsList
        className="mode-tabs journey-modes"
        aria-label="Спосіб побудови"
      >
        <TabsTrigger value="point">
          <MapPin />
          <span>До місця</span>
        </TabsTrigger>
        <TabsTrigger value="multi">
          <Route />
          <span>Зупинки</span>
        </TabsTrigger>
        <TabsTrigger value="draw">
          <Pencil />
          <span>Малювати</span>
        </TabsTrigger>
        <TabsTrigger value="auto">
          <Shuffle />
          <span>Ідея</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
  const routeActions = start && (
    <div className={'journey-actions' + (!hasDraft ? ' single-action' : '')}>
      {hasDraft && (
        <button className="secondary-button" onClick={newRoute}>
          <RotateCcw size={17} />
          Новий маршрут
        </button>
      )}
      <button
        className="secondary-button"
        onClick={pickStart}
        disabled={busy || resizing}
      >
        <MapPin size={17} />
        Змінити старт
      </button>
    </div>
  );
  const undoNotice = routeUndo && (
    <output className="route-undo">
      <span>Попередній маршрут</span>
      <button onClick={restoreRoute}>
        <Undo2 size={17} />
        Повернути
      </button>
    </output>
  );
  const notices = (!online || message || placesNotice || storageError) && (
    <details className="journey-notice">
      <summary>
        <Info size={17} />
        <span>
          {!online
            ? 'Ви офлайн. Для побудови потрібен інтернет.'
            : storageError
              ? 'Не вдалося зберегти маршрут.'
              : message || placesNotice}
        </span>
      </summary>
      <p>
        {[
          message,
          placesNotice,
          storageError
            ? 'Браузер не дозволяє зберегти дані. Після закриття маршрут може зникнути.'
            : '',
          !online
            ? 'Збережений маршрут доступний. Для карти й нового шляху підключіться до інтернету.'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      </p>
      <button
        className="text-button"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([diagnosticReport()], { type: 'application/json' }),
          );
          const a = document.createElement('a');
          a.href = url;
          a.download = 'kruh-diagnostics.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        Зберегти звіт без координат
      </button>
    </details>
  );
  const summary = shownWalk && (
    <div className="journey-summary" aria-live="polite">
      <div className="journey-summary-top">
        <strong>
          ≈ {fmt(steps)} <span>кроків</span>
        </strong>
        <span className="journey-badge">
          {editingRoute ? 'Редагування' : 'Готовий маршрут'}
        </span>
      </div>
      <div className="journey-metrics">
        <span>
          <Ruler size={16} />
          {(shownWalk.meters / 1000).toLocaleString('uk-UA', {
            maximumFractionDigits: 2,
          })}{' '}
          км
        </span>
        <span>
          <Clock3 size={16} />
          {Math.round(shownWalk.seconds / 60)} хв
        </span>
        <span>{back || mode === 'auto' ? 'З поверненням' : 'В один бік'}</span>
      </div>
    </div>
  );
  const editorActions = shownWalk && !choosingStart && (
    <div className="journey-actions">
      <button
        className={editingRoute ? 'primary-button' : 'secondary-button'}
        disabled={busy || resizing}
        onClick={() => {
          if (editingRoute) finishEditing();
          else {
            setLengthOpen(false);
            setEditingRoute(true);
            setPointTool(mode === 'draw' ? 'move' : 'edit');
            setPanelOpen(false);
          }
        }}
      >
        {editingRoute ? <Check size={18} /> : <Pencil size={18} />}
        {editingRoute ? 'Готово' : 'Редагувати'}
      </button>
      <button
        className={
          'secondary-button length-toggle ' + (lengthOpen ? 'selected' : '')
        }
        disabled={busy || resizing}
        aria-expanded={lengthOpen}
        onClick={() => setLengthOpen(!lengthOpen)}
      >
        <Ruler size={18} />
        Довжина
      </button>
    </div>
  );
  const mainAction =
    busy || resizing ? (
      <button
        className="secondary-button pending-action"
        onClick={resizing ? cancelResize : cancelSearch}
      >
        <span className="spinner" />
        {resizing ? 'Підбираємо довжину…' : 'Будуємо маршрут…'}
        <X size={18} />
        <span className="sr-only">Скасувати пошук</span>
      </button>
    ) : !choosingStart && (!shownWalk || (mode === 'auto' && !editingRoute)) ? (
      mode === 'auto' ? (
        <button
          className="primary-button"
          disabled={!online}
          onClick={() => void suggest()}
        >
          <Shuffle size={18} />
          {shownWalk ? 'Інший варіант' : 'Знайти прогулянку'}
        </button>
      ) : mode === 'draw' && sketch.length > 0 && !drawing ? (
        <button
          className="primary-button"
          disabled={!online}
          onClick={() => void build()}
        >
          <Route size={18} /> Повторити побудову
        </button>
      ) : mode === 'draw' ? (
        <button
          className="primary-button"
          disabled={!online}
          onClick={() => {
            setDrawing(!drawing);
            setErasing(false);
            setEditingRoute(true);
            setPanelOpen(false);
          }}
        >
          <Pencil size={18} />
          {drawing
            ? 'Завершити малювання'
            : sketch.length
              ? 'Продовжити малювання'
              : 'Малювати маршрут'}
        </button>
      ) : points.length > 0 ? (
        <button
          className="primary-button"
          disabled={!online}
          onClick={() => void build()}
        >
          <Route size={18} />
          Повторити побудову
        </button>
      ) : null
    ) : null;
  const startTools = (
    <div className="journey-start-tools">
      <button
        className="secondary-button"
        disabled={gpsBusy || busy || resizing}
        onClick={gps}
      >
        <LocateFixed size={18} />
        {gpsBusy ? 'Шукаємо місце…' : 'Моє місце'}
      </button>
      {start && pickingStart ? (
        <button
          className="secondary-button"
          onClick={() => {
            gpsVersion.current++;
            setGpsBusy(false);
            setPickingStart(false);
          }}
        >
          <X size={18} />
          Скасувати вибір
        </button>
      ) : (
        <button
          className="secondary-button"
          disabled={busy || resizing}
          onClick={pickStart}
        >
          <MapPin size={18} />
          Обрати на карті
        </button>
      )}
    </div>
  );
  const goalCard = (
    <div className="goal-card">
      <div className="row">
        <span>
          <Flag size={16} />
          Ціль на сьогодні
        </span>
        <button
          onClick={() => {
            setDailyOpen(false);
            setSettings(true);
          }}
          aria-label="Змінити денну ціль"
        >
          <Settings2 size={18} />
        </button>
      </div>
      <div className="goal-number">
        {fmt(remaining)} <span>кроків залишилось</span>
      </div>
      <span id="daily-steps-label" className="sr-only">
        Пройдено сьогодні, кроків
      </span>
      <Slider
        className="daily-steps-slider"
        value={[done]}
        min={0}
        max={sliderMax}
        step={1}
        largeStep={100}
        aria-labelledby="daily-steps-label"
        onValueChange={(value) =>
          setDone(Array.isArray(value) ? value[0] : value)
        }
      />
      <div className="goal-meta">
        <span aria-live="polite">Пройдено {fmt(done)}</span>
        <span>Ціль {fmt(goal)}</span>
      </div>
    </div>
  );
  return (
    <main className="app-shell journey-shell">
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="Круг — головна"
        >
          <span className="brand-icon">
            <Footprints size={25} />
          </span>
          <span>
            круг<span className="brand-dot">.</span>
          </span>
        </a>
        <button
          className="daily-progress-button"
          onClick={() => setDailyOpen(true)}
          aria-label="Кроки й денна ціль"
        >
          <Footprints size={18} />
          <span>
            <strong>{fmt(done)}</strong> / {fmt(goal)}
          </span>
          <span className="daily-progress-track" aria-hidden="true">
            <span
              style={{
                width: Math.min(100, goal ? (done / goal) * 100 : 0) + '%',
              }}
            />
          </span>
        </button>
        <div className="header-actions">
          <button
            className="quiet-button install-button"
            onClick={async () => {
              if (install) {
                await install.prompt();
                await install.userChoice;
                setInstall(null);
              } else setHelp(true);
            }}
          >
            <Download size={17} />
            <span>Встановити</span>
          </button>
          <button
            className="icon-button"
            aria-label="Налаштування"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={20} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <PlannerPanel open={panelOpen} onOpenChange={setPanelOpen}>
          <div className="journey-panel-heading">
            <h1>{shownWalk ? 'Ваша прогулянка' : 'Новий маршрут'}</h1>
            <span>{modeNames[mode]}</span>
          </div>
          {summary}
          {notices}
          {undoNotice}
          <div className="desktop-journey-actions">
            {editorActions}
            {mainAction}
            {routeActions}
          </div>
          {shownWalk && (
            <>
              {lengthControl}
              <p className="length-help">
                {mode === 'draw'
                  ? 'Скорочення перемістить фініш уздовж вашої лінії.'
                  : 'Зупинки збережуться. Точна довжина залежить від доріг.'}
              </p>
            </>
          )}
          <section className="journey-section">
            <h2>Старт прогулянки</h2>
            <div className="start-card">
              <span className="start-symbol" />
              <div>
                <strong>{startLabel}</strong>
                <small>
                  {start
                    ? coords(start)
                    : 'Оберіть своє місце або точку на карті'}
                </small>
              </div>
              {start && <Check size={18} className="green" />}
            </div>
            {startTools}
            {!start && (
              <button
                className="text-button demo-start"
                onClick={() =>
                  chooseStart(DEFAULT_START, 'Майдан Незалежності, Київ')
                }
              >
                Спробувати в Києві <ArrowRight size={16} />
              </button>
            )}
          </section>
          <section className="journey-section">
            <h2>Спосіб побудови</h2>
            {modePicker}
            <p className="journey-help">{instruction}</p>
            {mode === 'auto' ? (
              <>
                <Tabs
                  value={ideaStyle}
                  onValueChange={(value) => {
                    rememberRoute();
                    setIdeaStyle(String(value));
                    invalidate();
                    setEditingRoute(true);
                    setPointTool('add');
                    ideaVariation.current = 0;
                  }}
                >
                  <TabsList className="idea-tabs">
                    <TabsTrigger value="scenic">
                      Парки й цікаві місця
                    </TabsTrigger>
                    <TabsTrigger value="random">Випадкова</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="journey-help">
                  З поверненням до старту. Обов’язкових зупинок:{' '}
                  {mustVisit.length} із 6.
                </p>
              </>
            ) : (
              <label className="return-option" htmlFor="return-switch">
                <span>
                  <RotateCcw size={17} />
                  Повернутися тим самим шляхом
                </span>
                <Switch
                  id="return-switch"
                  checked={back}
                  onCheckedChange={(value) => {
                    cancelResize();
                    setBack(value);
                  }}
                  aria-label="Повернутися тим самим шляхом"
                />
              </label>
            )}
          </section>
          {routePlaces.length > 0 && (
            <section className="journey-section route-places">
              <h2>Місця на шляху</h2>
              {routePlaces.map((place) => (
                <a
                  key={place.id}
                  href={'https://www.openstreetmap.org/' + place.id}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{place.kind}</span>
                  <strong>{place.name}</strong>
                </a>
              ))}
              <p className="journey-help">
                Повторне проходження: ≈ {Math.round(repeatedRatio(walk!) * 100)}
                % шляху.
              </p>
            </section>
          )}
          <p className="panel-footnote">
            <Info size={15} />
            Оцінка за довжиною кроку {stride} см. Кроки не рахуються
            автоматично.
          </p>
          <button
            className="primary-button mobile-panel-done"
            onClick={() => setPanelOpen(false)}
          >
            <Check size={18} />
            До карти
          </button>
        </PlannerPanel>
        <div
          className={'map-area' + (drawing || erasing ? ' editing-map' : '')}
        >
          {loaded && (
            <WalkMap
              editing={editingRoute}
              erasing={erasing}
              editableWalk={walk}
              onEraseStroke={eraseStroke}
              onToggleEraser={() => {
                setMessage('');
                setErasing(!erasing);
                setDrawing(false);
                setPickingStart(false);
                setEditingRoute(true);
                setPanelOpen(false);
              }}
              canUndoErase={!!eraseUndo && eraseUndo.edited === walk}
              onUndoErase={() => {
                if (!eraseUndo || eraseUndo.edited !== walk) return;
                cancelResize();
                setWalk(eraseUndo.walk);
                setSketch(eraseUndo.sketch);
                setPoints(eraseUndo.points);
                setMustVisit(eraseUndo.mustVisit);
                setRoutePlaces(eraseUndo.places);
                setEraseUndo(null);
                setMessage('Редагування скасовано.');
              }}
              lockViewport={resizeTarget !== null || erasing}
              suggestedPoints={routePlaces.map((p) => p.point)}
              pointTool={pointTool}
              selectedPoint={selectedPoint}
              onPointTool={(tool) => {
                setPointTool(tool);
                setErasing(false);
                setDrawing(false);
              }}
              onSelectPoint={setSelectedPoint}
              onMovePoint={movePoint}
              onRemovePoint={removePoint}
              onBuild={() => (mode === 'auto' ? void suggest() : void build())}
              onClearPoints={newRoute}
              precision={precision}
              onPrecision={(value) => {
                setPrecision(value);
                if (sketch.length) void build(points, start, sketch, value);
              }}
              start={start}
              points={mode === 'auto' ? mustVisit : points}
              walk={shownWalk}
              drawing={drawing}
              pickingStart={pickingStart}
              allowPointWhileBusy={
                !resizing &&
                (mode === 'point' || mode === 'multi') &&
                pointTool === 'add'
              }
              busy={busy || resizing}
              mode={mode}
              sketch={sketch}
              onToggleDrawing={() => {
                setMessage('');
                setErasing(false);
                setDrawing(!drawing);
                setPickingStart(false);
                setEditingRoute(true);
              }}
              onNewSketch={() => {
                newRoute();
                setDrawing(true);
              }}
              onConfirmStart={(p) => chooseStart(p)}
              onPoint={onPoint}
              onSketch={(stroke) => {
                const complete = [...sketch, ...stroke];
                const simplified = sampleSketch(complete);
                invalidate();
                setSketch(complete);
                setPoints(simplified);
                setDrawing(false);
                void build(simplified, start, complete);
              }}
              onGps={gps}
              onError={setMessage}
            />
          )}
          <section className="mobile-map-dock" aria-label="Керування маршрутом">
            {undoNotice}
            {choosingStart ? (
              <>
                <div className="dock-heading">
                  <h2>{start ? 'Новий старт' : 'Де почнемо?'}</h2>
                  <span>
                    {start
                      ? 'Маршрут зміниться після підтвердження'
                      : 'Оберіть місце на карті або GPS'}
                  </span>
                </div>
                {startTools}
                {!start && (
                  <button
                    className="text-button demo-start"
                    onClick={() =>
                      chooseStart(DEFAULT_START, 'Майдан Незалежності, Київ')
                    }
                  >
                    Спробувати в Києві <ArrowRight size={15} />
                  </button>
                )}
              </>
            ) : (
              <>
                {summary || (
                  <div className="dock-heading">
                    <h2>Куди підемо?</h2>
                    <span>До денної цілі: {fmt(remaining)} кроків</span>
                  </div>
                )}
                {!shownWalk && modePicker}
                {lengthOpen && shownWalk && (
                  <div className="dock-length-control">{lengthControl}</div>
                )}
                {(planning || busy || resizing) && (
                  <p className="dock-instruction" aria-live="polite">
                    {busy ? 'Шукаємо пішохідні доріжки…' : instruction}
                  </p>
                )}
                {mainAction}
                {editorActions}
                {routeActions}
                <button
                  className="dock-details"
                  onClick={() => setPanelOpen(true)}
                >
                  <span>
                    {shownWalk ? 'Деталі та параметри' : 'Параметри прогулянки'}
                  </span>
                  <ChevronRight size={17} />
                </button>
              </>
            )}
            {notices}
          </section>
          <div className="map-bottom-tip">
            <span className="tip-icon">
              {mode === 'draw' ? <Pencil size={20} /> : <MapPin size={20} />}
            </span>
            <div>
              <strong>
                {choosingStart
                  ? 'Оберіть старт'
                  : shownWalk
                    ? 'Ваша прогулянка'
                    : modeNames[mode]}
              </strong>
              <span>{instruction}</span>
            </div>
          </div>
        </div>
      </div>
      <Dialog open={dailyOpen} onOpenChange={setDailyOpen}>
        <DialogContent className="settings-dialog daily-dialog">
          <DialogTitle className="dialog-title">
            Ваші кроки сьогодні
          </DialogTitle>
          <DialogDescription>
            Вкажіть, скільки вже пройшли. Ці кроки врахуємо в ідеї прогулянки.
          </DialogDescription>
          {goalCard}
          <button
            className="primary-button"
            onClick={() => setDailyOpen(false)}
          >
            <Check size={18} />
            Готово
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="settings-dialog">
          <DialogTitle className="dialog-title">Ваш ритм</DialogTitle>
          <DialogDescription>
            Підлаштуйте розрахунок під себе. Налаштування зберігаються в цьому
            браузері.
          </DialogDescription>
          <ProfileForm
            height={height}
            goal={goal}
            done={done}
            onSave={(profile) => {
              cancelResize();
              setHeight(profile.height);
              setGoal(profile.goal);
              setDone(profile.done);
              setSliderMax(
                Math.max(
                  profile.goal || 10000,
                  Math.ceil(profile.done / 1000) * 1000,
                ),
              );
              setSettings(false);
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const values = manual
                .split(/[,;\s]+/)
                .filter(Boolean)
                .map(Number);
              if (
                values.length !== 2 ||
                !values.every(Number.isFinite) ||
                Math.abs(values[0]) > 85 ||
                Math.abs(values[1]) > 180
              ) {
                setCoordinateError(
                  'Введіть широту й довготу, наприклад 50.4501, 30.5234',
                );
                return;
              }
              chooseStart(values as Point, 'Старт за координатами');
              setSettings(false);
            }}
          >
            <label className="field">
              Старт за координатами
              <input
                placeholder="50.4501, 30.5234"
                value={manual}
                onChange={(e) => {
                  setManual(e.target.value);
                  setCoordinateError('');
                }}
              />
            </label>
            <button
              className="secondary-button coordinate-button"
              type="submit"
            >
              Застосувати координати
            </button>
            {coordinateError && (
              <p className="notice" role="alert">
                {coordinateError}
              </p>
            )}
          </form>
          {storageError && (
            <p className="notice">Браузер не дозволяє зберегти налаштування.</p>
          )}
          <button
            className="primary-button"
            type="submit"
            form="profile-settings"
          >
            Готово <Check size={18} />
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="settings-dialog">
          <DialogTitle className="dialog-title">
            Круг на вашому телефоні
          </DialogTitle>
          <DialogDescription>
            Відкривайте планувальник просто з домашнього екрана.
          </DialogDescription>
          <p>
            <strong>iPhone:</strong> у Safari натисніть «Поділитися» → «На
            початковий екран».
          </p>
          <p>
            <strong>Android:</strong> у меню Chrome оберіть «Встановити
            застосунок» або «Додати на головний екран».
          </p>
          <p className="muted">
            Встановлення потребує HTTPS або localhost. Карта та нові маршрути
            потребують інтернету.
          </p>
          <p className="muted">
            Точки та ескіз маршруту надсилаються сервісу Valhalla. Для пошуку
            парків координати старту надсилаються Overpass API; карта
            завантажується з OpenStreetMap. Місця й область пошуку зберігаються
            лише на цьому пристрої та використовуються до 7 днів. Налаштування,
            старт і маршрут також зберігаються в цьому браузері до очищення
            даних сайту. Діагностичний звіт не містить координат, назв місць або
            ліній маршруту й завантажується лише за вашим натисканням.
          </p>
          <button
            className="text-button"
            onClick={() => {
              clearPlacesCache();
              setPlacesNotice('Збережені місця очищено.');
            }}
          >
            Очистити збережені місця
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
