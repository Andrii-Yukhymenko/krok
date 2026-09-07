'use client';
import { useState } from 'react';
import {
  DEFAULT_HEIGHT,
  parseStepCount,
  strideFromHeight,
} from '@/lib/profile';

type Profile = { height: number; goal: number; done: number };
export default function ProfileForm({
  height,
  goal,
  done,
  onSave,
}: Profile & { onSave: (p: Profile) => void }) {
  const [heightText, setHeightText] = useState(String(height));
  const number = Number(heightText);
  const validHeight = Number.isFinite(number) && number >= 80 && number <= 250;
  return (
    <form
      id="profile-settings"
      className="profile-fields"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (!validHeight) return;
        const goalInput = data.get('goal'),
          doneInput = data.get('done');
        onSave({
          height: number,
          goal: parseStepCount(
            typeof goalInput === 'string' ? goalInput : '',
            50000,
          ),
          done: parseStepCount(
            typeof doneInput === 'string' ? doneInput : '',
            100000,
          ),
        });
      }}
    >
      <label className="field">
        Денна ціль, кроків
        <input
          name="goal"
          type="number"
          min="0"
          max="50000"
          step="1"
          defaultValue={goal}
        />
        <small>Порожнє поле зберігається як 0.</small>
      </label>
      <label className="field">
        Вже пройдено сьогодні
        <input
          name="done"
          type="number"
          min="0"
          max="100000"
          step="1"
          defaultValue={done}
        />
        <small>Можна також змінювати повзунком на головному екрані.</small>
      </label>
      <label className="field">
        Ваш зріст, см
        <input
          name="height"
          type="number"
          min="80"
          max="250"
          step="0.1"
          required
          placeholder={String(DEFAULT_HEIGHT)}
          value={heightText}
          onChange={(event) => setHeightText(event.target.value)}
        />
        <small>
          {validHeight
            ? `Орієнтовний крок — ${strideFromHeight(number).toLocaleString('uk-UA')} см.`
            : 'Вкажіть зріст від 80 до 250 см.'}{' '}
          Оцінка для звичайної ходьби; фактичний крок залежить від темпу й
          манери ходьби.
        </small>
      </label>
    </form>
  );
}
