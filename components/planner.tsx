'use client';
import Link from 'next/link';
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
import { scenicWalk, type Place } from '@/lib/places';
import {
  DEFAULT_START,
  destination,
  sampleSketch,
  sketchRoute,
  stepsFor,
  walkingRoute,
  withReturn,
  type Point,
  type Walk,
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [sketch, setSketch] = useState<Point[]>([]);
  const [ideaStyle, setIdeaStyle] = useState('scenic');
  const [routePlaces, setRoutePlaces] = useState<Place[]>([]);
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
  function invalidate() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setWalk(null);
    setMessage('');
    setRoutePlaces([]);
  }
  function chooseStart(p: Point, label = 'Обрана точка') {
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
    invalidate();
    setMode(value as Mode);
    setSketch([]);
    setPoints([]);
    setDrawing(false);
    setPickingStart(false);
  }
  async function build(input = points, origin = start, trace = sketch) {
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
          ? await sketchRoute(origin, trace, abort.signal)
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
      setMessage('Натисніть «Запропонувати прогулянку».');
      return;
    }
    if (mode === 'draw') return;
    invalidate();
    const next = mode === 'point' ? [p] : [...points, p];
    if (next.length > 18) {
      setMessage('До 18 точок на один маршрут.');
      return;
    }
    setPoints(next);
    if (mode === 'point') void build(next);
  }
  async function suggest() {
    if (!start) {
      setMessage('Спочатку оберіть старт.');
      return;
    }
    if (remaining < 300) {
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
      if (ideaStyle === 'scenic') {
        const result = await scenicWalk(
          start,
          target,
          abort.signal,
          ideaVariation.current++,
        );
        if (!abort.signal.aborted) {
          setWalk(result.walk);
          setRoutePlaces(result.places);
          setPoints([...result.places.map((p) => p.point), start]);
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
          destination(start, radius, bearing + attempt * 20),
          destination(start, radius, bearing + 110 + attempt * 20),
          start,
        ];
        try {
          const route = await walkingRoute(
            [start, ...candidates],
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
                onCheckedChange={setBack}
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
          {points.length > 0 && (
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
            <button className="text-button" onClick={invalidate}>
              Скасувати пошук
            </button>
          )}
          <output aria-live="polite">
            {(!online || message) && (
              <p className="notice">
                {!online
                  ? 'Ви офлайн. Для карти й нових маршрутів потрібен інтернет.'
                  : message}
              </p>
            )}
          </output>
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
                {routePlaces.length > 0 && (
                  <div className="route-places">
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
          <WalkMap
            start={start}
            points={points}
            walk={shownWalk}
            drawing={drawing}
            pickingStart={pickingStart}
            busy={busy}
            mode={mode}
            sketch={sketch}
            onToggleDrawing={() => {
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
          <div className="mobile-map-dock">
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
            {(!online || message) && (
              <output className="mobile-notice" aria-live="polite">
                {!online ? 'Ви офлайн. Потрібен інтернет.' : message}
              </output>
            )}
            {busy && (
              <button className="text-button" onClick={invalidate}>
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
            завантажується з OpenStreetMap. Координати не зберігаються в
            налаштуваннях.
          </p>
        </DialogContent>
      </Dialog>
    </main>
  );
}
