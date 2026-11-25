import React, { useMemo } from 'react';
import { Calendar, Clock, Pause, Play, RotateCcw, Sun, X } from 'lucide-react';
import type { SolarInsolationState } from '../types/map';
import {
  computeSolarPosition,
  formatAzimuthCompassRu,
  formatMinutesHHMM,
  getCurrentKaliningradDateTime,
  INSOLATION_DATE_PRESETS,
  KALININGRAD_GEO,
} from '../utils/solarInsolation';

interface InsolationControlProps {
  insolation: SolarInsolationState;
  cameraBearing: number;
  onChange: (next: SolarInsolationState) => void;
  onClose: () => void;
}

export const InsolationControl: React.FC<InsolationControlProps> = ({
  insolation,
  cameraBearing,
  onChange,
  onClose,
}) => {
  const solar = useMemo(
    () => computeSolarPosition(insolation.dateIso, insolation.minutesOfDay),
    [insolation.dateIso, insolation.minutesOfDay]
  );

  // Screen-aligned azimuth (rotates with map bearing so the compass arrow matches shadows on canvas)
  const screenSunAzRad = (((solar.azimuthDeg - cameraBearing) % 360) * Math.PI) / 180;
  const sunDotX = 24 + Math.sin(screenSunAzRad) * 16;
  const sunDotY = 24 - Math.cos(screenSunAzRad) * 16;
  const shadowTipX = 24 - Math.sin(screenSunAzRad) * 13;
  const shadowTipY = 24 + Math.cos(screenSunAzRad) * 13;

  const sunrisePct =
    solar.sunriseMinutes !== null
      ? Math.max(0, Math.min(100, (solar.sunriseMinutes / 1440) * 100))
      : 25;
  const sunsetPct =
    solar.sunsetMinutes !== null
      ? Math.max(0, Math.min(100, (solar.sunsetMinutes / 1440) * 100))
      : 75;
  const noonPct = Math.max(0, Math.min(100, (solar.solarNoonMinutes / 1440) * 100));

  const dayHours = Math.floor(solar.dayLengthMinutes / 60);
  const dayMins = Math.round(solar.dayLengthMinutes % 60);

  const handleSetNow = () => {
    const now = getCurrentKaliningradDateTime();
    onChange({
      ...insolation,
      dateIso: now.dateIso,
      minutesOfDay: now.minutesOfDay,
      useLiveTime: true,
      isPlaying: false,
    });
  };

  const trackGradient = `linear-gradient(90deg,
    #1E293B 0%,
    #1E293B ${Math.max(0, sunrisePct - 4).toFixed(1)}%,
    #F59E0B ${sunrisePct.toFixed(1)}%,
    #FDE68A ${Math.min(100, sunrisePct + 5).toFixed(1)}%,
    #FEF3C7 ${noonPct.toFixed(1)}%,
    #FDE68A ${Math.max(0, sunsetPct - 5).toFixed(1)}%,
    #EA580C ${sunsetPct.toFixed(1)}%,
    #1E293B ${Math.min(100, sunsetPct + 4).toFixed(1)}%,
    #1E293B 100%)`;

  return (
    <section
      aria-label="Панель инсоляции и солнечных теней"
      className="fixed bottom-16 right-3 sm:right-4 z-30 w-[calc(100vw-24px)] max-w-[356px] rounded-2xl bg-white/95 dark:bg-[#1E222A]/95 backdrop-blur-md border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_8px_28px_rgba(0,0,0,0.14)] p-4 text-neutral-900 dark:text-neutral-100 select-none origin-bottom-right murs-anim-slide-up"
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-neutral-200/80 dark:border-neutral-700/70">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Sun className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
            <h2 className="text-sm font-bold tracking-tight truncate">Инсоляция</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400 font-mono tabular-nums truncate">
            {KALININGRAD_GEO.name} · {KALININGRAD_GEO.latDeg.toFixed(2)}°N, {KALININGRAD_GEO.lonDeg.toFixed(2)}°E · UTC+2
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Выключить инсоляцию"
          title="Выключить режим инсоляции"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Time Readout + Solar Compass + Playback Controls */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Live Solar Azimuth & Shadow Direction Compass */}
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            aria-label={`Азимут Солнца ${Math.round(solar.azimuthDeg)} градусов`}
            className="shrink-0"
          >
            <circle
              cx="24"
              cy="24"
              r="21"
              className="fill-neutral-100 dark:fill-neutral-800/80 stroke-neutral-300 dark:stroke-neutral-600"
              strokeWidth="1"
            />
            <text
              x="24"
              y="9.5"
              textAnchor="middle"
              className="fill-neutral-400 dark:fill-neutral-500 text-[7px] font-mono font-bold"
            >
              С
            </text>
            {/* Cast shadow vector */}
            {solar.shadowOpacity > 0.05 && (
              <line
                x1="24"
                y1="24"
                x2={shadowTipX}
                y2={shadowTipY}
                stroke="#475569"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity={0.75}
              />
            )}
            {/* Solar ray vector */}
            <line
              x1="24"
              y1="24"
              x2={sunDotX}
              y2={sunDotY}
              stroke={solar.altitudeDeg >= 0 ? '#F59E0B' : '#64748B'}
              strokeWidth="1.5"
              strokeDasharray={solar.altitudeDeg >= 0 ? undefined : '2 2'}
              strokeLinecap="round"
            />
            {/* Center building point */}
            <circle cx="24" cy="24" r="2.5" className="fill-neutral-800 dark:fill-neutral-200" />
            {/* Sun disk */}
            <circle
              cx={sunDotX}
              cy={sunDotY}
              r={solar.altitudeDeg >= 0 ? 4 : 3}
              fill={
                solar.altitudeDeg >= 12
                  ? '#F59E0B'
                  : solar.altitudeDeg >= 0
                  ? '#EA580C'
                  : '#64748B'
              }
              stroke="#FFFFFF"
              strokeWidth="1"
            />
          </svg>

          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono tabular-nums leading-none tracking-tight">
                {formatMinutesHHMM(insolation.minutesOfDay)}
              </span>
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 truncate">
                {solar.phaseLabel}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
              Восход {formatMinutesHHMM(solar.sunriseMinutes)} · Закат {formatMinutesHHMM(solar.sunsetMinutes)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() =>
              onChange({
                ...insolation,
                isPlaying: !insolation.isPlaying,
                useLiveTime: false,
              })
            }
            aria-label={insolation.isPlaying ? 'Пауза анимации солнца' : 'Запустить движение солнца'}
            title={insolation.isPlaying ? 'Пауза' : 'Анимация хода солнца'}
            className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
              insolation.isPlaying
                ? 'bg-amber-500 text-neutral-950 hover:bg-amber-400'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            }`}
          >
            {insolation.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleSetNow}
            title="Синхронизировать с реальным временем в Калининграде"
            className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
              insolation.useLiveTime
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            }`}
          >
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>Сейчас</span>
          </button>
        </div>
      </div>

      {/* Time-of-Day Scrubber with Daylight Envelope */}
      <div className="mt-3">
        <div className="relative h-6 flex items-center">
          <div
            className="absolute inset-x-0 h-2 rounded-full border border-neutral-300/60 dark:border-neutral-600/60 pointer-events-none"
            style={{ background: trackGradient }}
          />
          <input
            type="range"
            min={0}
            max={1439}
            step={1}
            value={Math.round(insolation.minutesOfDay)}
            aria-label="Время суток в Калининграде"
            onChange={(e) =>
              onChange({
                ...insolation,
                minutesOfDay: Number(e.target.value),
                useLiveTime: false,
                isPlaying: false,
              })
            }
            className="relative z-10 w-full h-6 appearance-none bg-transparent cursor-pointer accent-amber-500"
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500 px-0.5">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:59</span>
        </div>
      </div>

      {/* Date Picker & Solstice/Equinox Presets */}
      <div className="mt-3 pt-3 border-t border-neutral-200/80 dark:border-neutral-700/70 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 shrink-0">
            <Calendar className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
            <span>Дата</span>
          </label>
          <input
            type="date"
            value={insolation.dateIso}
            aria-label="Дата для расчёта положения Солнца"
            onChange={(e) => {
              if (!e.target.value) return;
              onChange({
                ...insolation,
                dateIso: e.target.value,
                useLiveTime: false,
              });
            }}
            className="h-7 px-2 rounded-lg text-xs font-mono tabular-nums bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div className="grid grid-cols-4 gap-1">
          {INSOLATION_DATE_PRESETS.map((preset) => {
            const active = insolation.dateIso.slice(5) === preset.dateIso.slice(5);
            return (
              <button
                key={preset.dateIso}
                type="button"
                title={preset.label}
                onClick={() =>
                  onChange({
                    ...insolation,
                    dateIso: preset.dateIso,
                    useLiveTime: false,
                  })
                }
                className={`py-1 px-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#FFCC00] text-neutral-950'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                {preset.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabular Solar Metrics & Shadow Opacity Control */}
      <div className="mt-3 pt-3 border-t border-neutral-200/80 dark:border-neutral-700/70">
        <div className="grid grid-cols-3 gap-2 text-left">
          <div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400">Высота</div>
            <div className="text-xs font-bold font-mono tabular-nums">
              {solar.altitudeDeg >= 0 ? '+' : ''}
              {solar.altitudeDeg.toFixed(1)}°
            </div>
          </div>
          <div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400">Азимут</div>
            <div className="text-xs font-bold font-mono tabular-nums">
              {Math.round(solar.azimuthDeg)}° {formatAzimuthCompassRu(solar.azimuthDeg)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400">Длина тени</div>
            <div className="text-xs font-bold font-mono tabular-nums">
              {solar.shadowOpacity > 0.02 ? `${solar.shadowLengthPerBlock.toFixed(2)}×H` : '—'}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="whitespace-nowrap">Плотность теней</span>
          <input
            type="range"
            min={25}
            max={95}
            step={5}
            value={Math.round(insolation.shadowStrength * 100)}
            aria-label="Плотность солнечных теней"
            onChange={(e) =>
              onChange({
                ...insolation,
                shadowStrength: Number(e.target.value) / 100,
              })
            }
            className="w-28 h-1.5 accent-amber-500 cursor-pointer"
          />
          <span className="font-mono tabular-nums w-8 text-right">
            {Math.round(insolation.shadowStrength * 100)}%
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-400 dark:text-neutral-500 font-mono tabular-nums">
          <span>Световой день: {dayHours}ч {String(dayMins).padStart(2, '0')}м</span>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...insolation,
                minutesOfDay: Math.round(solar.solarNoonMinutes),
                useLiveTime: false,
                isPlaying: false,
              })
            }
            className="inline-flex items-center gap-1 text-neutral-600 dark:text-neutral-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            title="Перейти к солнечному полдню"
          >
            <RotateCcw className="w-2.5 h-2.5" aria-hidden="true" />
            <span>Полдень {formatMinutesHHMM(solar.solarNoonMinutes)}</span>
          </button>
        </div>
      </div>
    </section>
  );
};
