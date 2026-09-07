export const DEFAULT_HEIGHT = 175;
// A deliberately approximate walking estimate within Omron's height × 0.37–0.45 range.
// https://www.faq.healthcare.omron.co.jp/faq/show/4195?site_domain=jp
export function strideFromHeight(heightCm: number): number {
  if (!Number.isFinite(heightCm) || heightCm < 80 || heightCm > 250)
    throw new Error('Вкажіть зріст від 80 до 250 см.');
  return Math.round(heightCm * 0.41 * 10) / 10;
}
export function parseStepCount(value: string, max: number): number {
  const number = Number(value.trim());
  if (!Number.isFinite(number))
    throw new Error('Вкажіть кількість кроків числом.');
  return Math.round(Math.max(0, Math.min(max, number)));
}
export function readProfile(raw: Record<string, unknown>, date: string) {
  const height =
    typeof raw.height === 'number' && raw.height >= 80 && raw.height <= 250
      ? raw.height
      : DEFAULT_HEIGHT;
  const goal =
    typeof raw.goal === 'number' &&
    Number.isFinite(raw.goal) &&
    raw.goal >= 0 &&
    raw.goal <= 50000
      ? raw.goal
      : 10000;
  const done =
    raw.date === date &&
    typeof raw.done === 'number' &&
    Number.isFinite(raw.done) &&
    raw.done >= 0 &&
    raw.done <= 100000
      ? raw.done
      : 0;
  return { height, goal, done };
}
