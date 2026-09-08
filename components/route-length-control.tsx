'use client';
import { useId } from 'react';
export default function RouteLengthControl({
  value,
  actual,
  max,
  pending,
  onChange,
  onCancel,
}: {
  value: number;
  actual: number;
  max: number;
  pending: boolean;
  onChange: (n: number) => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div className="route-length-control">
      <div className="route-length-heading">
        <label htmlFor={id}>Довжина прогулянки</label>
        <strong>{value.toLocaleString('uk-UA')} кроків</strong>
      </div>
      <input
        id={id}
        type="range"
        min={200}
        max={max}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value} кроків`}
      />
      <div className="route-length-caption">
        <span aria-live="polite">
          {pending
            ? 'Підбираємо шлях…'
            : `На карті: ≈ ${actual.toLocaleString('uk-UA')} кроків`}
        </span>
        {pending && (
          <button className="text-button" onClick={onCancel}>
            Скасувати
          </button>
        )}
      </div>
    </div>
  );
}
