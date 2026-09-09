'use client';
import Link from 'next/link';
import { SESSION_KEY, readSession } from '@/lib/session';
import { eraseSection } from '@/lib/erase-section';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  const [erasing, setErasing] = useState(false);
  const [eraseAnchor, setEraseAnchor] = useState<number | null>(null);
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
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() =>
          setMessage('Автономний режим недоступний у цьому браузері.'),
        );
    return () => {
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', installed);
      controller.current?.abort();
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
  async function eraseAt(index: number) {
    if (!walk || busy || resizing) return;
    if (eraseAnchor === null) {
      setEraseAnchor(index);
      return;
    }
    const snapshot = { walk, sketch, points, mustVisit, places: routePlaces };
    cancelResize();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage('');
    try {
      const result = await eraseSection(walk, eraseAnchor, index, abort.signal);
      if (abort.signal.aborted) return;
      setEraseUndo({ ...snapshot, edited: result });
      setWalk(result);
      // Remove waypoints on the erased interval so later builds cannot restore the detour.
      const a = Math.min(eraseAnchor, index),
        b = Math.max(eraseAnchor, index);
      const keep = (p: Point) => {
        let nearest = 0,
          best = Infinity;
        walk.points.forEach((q, i) => {
          const d = distance(p, q);
          if (d < best) {
            best = d;
            nearest = i;
          }
        });
        return nearest <= a || nearest >= b;
      };
      setPoints(points.filter(keep));
      setMustVisit(mustVisit.filter(keep));
      setRoutePlaces(routePlaces.filter((p) => keep(p.point)));
      if (mode === 'draw') {
        setSketch(result.points);
        setPoints(sampleSketch(result.points));
      }
      setMessage(
        'Ділянку замінено пішохідним шляхом. За потреби скасуйте зміну.',
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
        setEraseAnchor(null);
      }
    }
  }
  function cancelSearch() {
    if (erasing && walk) {
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
      setEraseAnchor(null);
      setMessage('Стирання скасовано. Маршрут залишено.');
    } else invalidate();
  }
  function invalidate() {
    setErasing(false);
    setEraseAnchor(null);
    setEraseUndo(null);
    cancelResize();
    setPlacesNotice('');
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setWalk(null);
    setMessage('');
    setRoutePlaces([]);
  }
  function chooseStart(p: Point, label = 'Обрана точка') {
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
    setMustVisit([]);
    setPointTool('add');
    setSelectedPoint(null);
    invalidate();
    setMode(value as Mode);
    setSketch([]);
    setPoints([]);
    setDrawing(false);
    setPickingStart(false);
  }
  async function build(
    input = points,
    origin = start,
    trace = sketch,
    accuracy = precision,
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
    setWalk(null);
    setMessage('');
    setDrawing(false);
    setPanelOpen(false);
    try {
      const result =
        mode === 'draw'
          ? await sketchRoute(origin, trace, abort.signal, accuracy)
          : await walkingRoute([origin, ...input], abort.signal);
      if (!abort.signal.aborted) setWalk(result);
    } catch (e) {
      if (!abort.signal.aborted)
        setMessage(
          e instanceof Error && e.name !== 'TimeoutError'
            ? e.message
            : 'Сервіс не відповів. Спробуйте ще раз.',
        );
    } finally {
      if (controller.current === abort) setBusy(false);
    }
  }
  function onPoint(p: Point) {
    if (busy) return;
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
    invalidate();
    const next = mode === 'point' ? [p] : [...points, p];
    if (next.length > 18) {
      setMessage('До 18 точок на один маршрут.');
      return;
    }
    setPoints(next);
    if (mode === 'point') void build(next);
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
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setWalk(null);
    setMessage('');
    setPoints([]);
    const target = (remaining * stride) / 100,
      bearing = Math.random() * 360;
    let radius = target / 6,
      best: Walk | null = null,
      bestPoints: Point[] = [];
    setPanelOpen(false);
    setRoutePlaces([]);
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
      if (controller.current === abort) setBusy(false);
    }
  }
  const guidance = pickingStart
    ? 'Наведіть приціл на місце старту'
    : !start
      ? 'Де почнемо прогулянку?'
      : mode === 'draw'
        ? 'Намалюйте свій шлях'
        : mode === 'auto'
          ? 'Прогулянка під вашу ціль'
          : mode === 'multi'
            ? 'Додайте зупинки по дорозі'
            : 'Куди хочеться пройтися?';
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Крок — головна">
          <span className="brand-icon">
            <Footprints size={25} />
          </span>
          <span>
            крок<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="header-note">Маленькі кроки. Ваші маршрути.</div>
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
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ВАША ЩОДЕННА ПРОГУЛЯНКА</p>
              <h1>
                Вийдемо на <span>прогулянку?</span>
              </h1>
            </div>
            <span className="heading-icon">
              <ArrowUpRight size={25} />
            </span>
          </div>
          <div className="goal-card">
            <div className="row">
              <span>
                <Flag size={15} /> Ціль на сьогодні
              </span>
              <button
                onClick={() => setSettings(true)}
                aria-label="Змінити денну ціль"
              >
                <Settings2 size={16} />
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
          <div className="section-label">
            <span className="step-index">01</span>
            <h2>Звідки вирушаємо</h2>
          </div>
          <div className="start-card">
            <span className="start-symbol" />
            <div>
              <strong>{startLabel}</strong>
              <small>{start ? coords(start) : 'GPS або точка на карті'}</small>
            </div>
            {start && <Check size={18} className="green" />}
          </div>
          <div className="start-actions">
            <button
              className="secondary-button"
              disabled={gpsBusy || busy}
              onClick={gps}
            >
              <LocateFixed size={16} />
              {gpsBusy ? 'Шукаємо…' : 'Моє місце'}
            </button>
            <button
              className={'secondary-button ' + (pickingStart ? 'selected' : '')}
              disabled={busy}
              onClick={() => {
                gpsVersion.current++;
                setGpsBusy(false);
                setPickingStart(!pickingStart);
                setDrawing(false);
                setPanelOpen(false);
              }}
            >
              <MapPin size={16} />
              {pickingStart ? 'Скасувати вибір' : 'На карті'}
            </button>
          </div>
          {!start && (
            <button
              className="text-button demo-start"
              onClick={() =>
                chooseStart(DEFAULT_START, 'Майдан Незалежності, Київ')
              }
            >
              Спробувати зі стартом у Києві <ArrowRight size={14} />
            </button>
          )}
          <div className="section-label">
            <span className="step-index">02</span>
            <h2>Як прокладемо маршрут</h2>
          </div>
          <Tabs value={mode} onValueChange={changeMode}>
            <TabsList className="mode-tabs">
              <TabsTrigger value="point">
                <MapPin />
                <span>До точки</span>
              </TabsTrigger>
              <TabsTrigger value="multi">
                <Route />
                <span>Точки</span>
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
            <div className="mode-description">
              <TabsContent value="point">
                Оберіть місце на карті — знайдемо пішохідний шлях до нього.
              </TabsContent>
              <TabsContent value="multi">
                Поставте кілька точок. Пройдемо їх у тому порядку, як ви обрали.
              </TabsContent>
              <TabsContent value="draw">
                Проведіть лінію — маршрут побудується автоматично. Це напрямок
                прогулянки, а не обов’язкові зупинки.
              </TabsContent>
              <TabsContent value="auto">
                Знайдемо парки, сквери й пішохідні місця поруч та з’єднаємо їх у
                прогулянку з поверненням.
              </TabsContent>
            </div>
          </Tabs>
          {mode === 'auto' && (
            <p className="notice">
              Додайте на карті до 6 зупинок, які хочете відвідати. Порядок — як
              додавали; повернення до старту включено. Обрано:{' '}
              {mustVisit.length}.
            </p>
          )}
          {mode === 'auto' && (
            <Tabs
              value={ideaStyle}
              onValueChange={(v) => {
                setIdeaStyle(String(v));
                invalidate();
                ideaVariation.current = 0;
              }}
            >
              <TabsList className="idea-tabs">
                <TabsTrigger value="scenic">Парки й цікаві місця</TabsTrigger>
                <TabsTrigger value="random">Випадкова</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {mode !== 'auto' && (
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
          {mode === 'draw' && (
            <button
              className={
                'secondary-button draw-button ' + (drawing ? 'selected' : '')
              }
              disabled={!start || busy}
              onClick={() => {
                setDrawing(!drawing);
                setPickingStart(false);
                setPanelOpen(false);
              }}
            >
              <Pencil size={16} />
              {drawing ? 'Готово, переміщувати карту' : 'Малювати на карті'}
            </button>
          )}
          {points.length > 0 && mode !== 'auto' && (
            <div className="route-edit">
              <span>
                {mode === 'draw' ? 'Ескіз готовий' : `Точок: ${points.length}`}
              </span>
              <button
                aria-label="Скасувати останню точку"
                disabled={busy}
                onClick={() => {
                  invalidate();
                  setPoints(mode === 'draw' ? [] : points.slice(0, -1));
                  if (mode === 'draw') setSketch([]);
                }}
              >
                <Undo2 size={17} />
              </button>
              <button
                aria-label="Очистити маршрут"
                onClick={() => {
                  invalidate();
                  setPoints([]);
                  setSketch([]);
                  setDrawing(false);
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {(mode !== 'draw' || (points.length > 0 && !walk && !busy)) && (
            <button
              className="primary-button"
              disabled={
                busy || !online || !start || (mode !== 'auto' && !points.length)
              }
              onClick={() => (mode === 'auto' ? void suggest() : void build())}
            >
              {busy ? (
                <>
                  <span className="spinner" /> Шукаємо пішохідний шлях…
                </>
              ) : (
                <>
                  {mode === 'auto'
                    ? walk
                      ? 'Інша прогулянка'
                      : 'Запропонувати прогулянку'
                    : mode === 'draw'
                      ? 'Повторити побудову'
                      : 'Побудувати маршрут'}
                  <ArrowRight size={19} />
                </>
              )}
            </button>
          )}
          {busy && (
            <button className="text-button" onClick={cancelSearch}>
              Скасувати пошук
            </button>
          )}
          <output aria-live="polite">
            {storageError && (
              <p className="notice" role="alert">
                Браузер не дозволяє зберегти дані. Після закриття маршрут може
                зникнути.
              </p>
            )}
            {placesNotice && <p className="notice">{placesNotice}</p>}
            {(!online || message) && (
              <p className="notice">
                {!online
                  ? 'Ви офлайн. Для карти й нових маршрутів потрібен інтернет.'
                  : message}
              </p>
            )}
          </output>
          {(message || placesNotice || !online) && (
            <button
              className="text-button"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([diagnosticReport()], { type: 'application/json' }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = 'krok-diagnostics.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Зберегти звіт без координат
            </button>
          )}
          <div className="result-card" aria-live="polite">
            {shownWalk ? (
              <>
                <div className="result-top">
                  <span>
                    <span className="live-dot" /> Ваш маршрут
                  </span>
                  <span>
                    {back || mode === 'auto' ? 'Туди й назад' : 'В один бік'}
                  </span>
                </div>
                <div className="result-steps">
                  ≈ {fmt(steps)}
                  <span>кроків</span>
                </div>
                <div className="result-metrics">
                  <span>
                    <Ruler size={17} />
                    {(shownWalk.meters / 1000).toLocaleString('uk-UA', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    км
                  </span>
                  <span>
                    <Clock3 size={17} />
                    {Math.round(shownWalk.seconds / 60)} хв
                  </span>
                </div>
                {lengthControl}
                <p className="length-help">
                  {mode === 'draw'
                    ? 'Контур змінюється цілісно; короткі тупики відсіюються, а подовження шукає парки й прогулянкові місця поруч.'
                    : 'Зупинки зберігаються. Бажана довжина може бути недосяжною.'}
                </p>
                {routePlaces.length > 0 && (
                  <div className="route-places">
                    <p>
                      Повторне проходження: ≈{' '}
                      {Math.round(repeatedRatio(walk!) * 100)}% шляху. Оцінка за
                      збігами лінії.
                    </p>
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
                  </div>
                )}
                <p className="goal-comparison">
                  {Math.abs(remaining - steps) < 100
                    ? 'Майже точно під вашу ціль'
                    : steps < remaining
                      ? `Ще ${fmt(remaining - steps)} кроків до цілі`
                      : `На ${fmt(steps - remaining)} кроків понад ціль`}
                </p>
              </>
            ) : (
              <div className="empty-result">
                <Footprints size={25} />
                <div>
                  <strong>Ваші кроки починаються тут</strong>
                  <p>
                    Побудуйте маршрут, щоб побачити дистанцію, час і кількість
                    кроків.
                  </p>
                </div>
              </div>
            )}
          </div>
          <p className="panel-footnote">
            <Info size={14} />
            Оцінка за довжиною кроку {stride} см. Це планувальник, а не
            лічильник руху.
          </p>
        </PlannerPanel>
        <div className="map-area">
          {loaded && (
            <WalkMap
              erasing={erasing}
              eraseAnchor={
                eraseAnchor === null
                  ? null
                  : (walk?.points[eraseAnchor] ?? null)
              }
              editableWalk={walk}
              onEraseAt={(index) => void eraseAt(index)}
              onToggleEraser={() => {
                setErasing(!erasing);
                setEraseAnchor(null);
                setDrawing(false);
                setPickingStart(false);
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
                setEraseAnchor(null);
                setMessage('Редагування скасовано.');
              }}
              lockViewport={resizeTarget !== null || erasing}
              suggestedPoints={routePlaces.map((p) => p.point)}
              pointTool={pointTool}
              selectedPoint={selectedPoint}
              onPointTool={setPointTool}
              onSelectPoint={setSelectedPoint}
              onMovePoint={movePoint}
              onRemovePoint={removePoint}
              onBuild={() => (mode === 'auto' ? void suggest() : void build())}
              onClearPoints={() => {
                if (mode === 'auto') setMustVisit([]);
                invalidate();
                setPoints([]);
                setSelectedPoint(null);
              }}
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
              busy={busy || resizing}
              mode={mode}
              sketch={sketch}
              onToggleDrawing={() => {
                setErasing(false);
                setEraseAnchor(null);
                setDrawing(!drawing);
                setPickingStart(false);
              }}
              onNewSketch={() => {
                invalidate();
                setSketch([]);
                setPoints([]);
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
          <div className="mobile-map-dock">
            {shownWalk && (
              <div className="mobile-length-control">{lengthControl}</div>
            )}
            <div className="mobile-route-summary" aria-live="polite">
              <strong>
                {busy
                  ? 'Будуємо маршрут…'
                  : shownWalk
                    ? `≈ ${fmt(steps)} кроків`
                    : `До цілі: ${fmt(remaining)} кроків`}
              </strong>
              <span>
                {shownWalk
                  ? `${(shownWalk.meters / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} км · ${Math.round(shownWalk.seconds / 60)} хв`
                  : 'Оберіть старт і спосіб прогулянки'}
              </span>
            </div>
            <button
              className="primary-button"
              onClick={() => setPanelOpen(true)}
            >
              <Settings2 size={18} />
              Маршрут
            </button>
            {(!online || message || placesNotice || storageError) && (
              <output className="mobile-notice" aria-live="polite">
                {!online
                  ? 'Ви офлайн. Потрібен інтернет.'
                  : [
                      storageError
                        ? 'Браузер не дозволяє зберегти маршрут.'
                        : '',
                      message,
                      placesNotice,
                    ]
                      .filter(Boolean)
                      .join(' ')}
              </output>
            )}
            {busy && (
              <button className="text-button" onClick={cancelSearch}>
                Скасувати пошук
              </button>
            )}
          </div>
          <div className="map-bottom-tip">
            <span className="tip-icon">
              {mode === 'draw' ? <Pencil size={20} /> : <MapPin size={20} />}
            </span>
            <div>
              <strong>{guidance}</strong>
              <span>
                {pickingStart || !start
                  ? 'Пересуньте карту й натисніть «Підтвердити старт тут»'
                  : mode === 'auto'
                    ? 'Натисніть кнопку — знайдемо варіант для вас'
                    : mode === 'draw'
                      ? 'Малюйте приблизно — дороги підберемо ми'
                      : 'Торкніться карти, щоб обрати місце'}
              </span>
            </div>
          </div>
        </div>
      </div>
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
            Крок на вашому телефоні
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
