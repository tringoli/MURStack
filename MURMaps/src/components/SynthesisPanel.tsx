import React, { useRef } from 'react';
import {
  Building2,
  CheckCircle2,
  Cpu,
  Crop,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  Save,
  TrainFront,
  Upload,
  X,
} from 'lucide-react';
import { computePolygonArea, type SynthesisOptions } from '../utils/urbanSynthesizer';
import type {
  MagicApiStatus,
  RoadClass,
  RoofType,
  SynthesisStats,
  SynthesisTargetMode,
  WorldPoint,
} from '../types/map';

interface SynthesisPanelProps {
  isRunning: boolean;
  stats: SynthesisStats | null;
  error: string | null;
  options: Required<SynthesisOptions>;
  synthesisPolygon: WorldPoint[];
  isSynthesisPolygonClosed: boolean;
  isSelectingSynthesisArea: boolean;
  blueMapUnderlay: boolean;
  unsavedBuildingsCount: number;
  unsavedStreetsCount: number;
  savedTotalBuildings: number;
  savedTotalStreets: number;
  autoSaveSynthesis: boolean;
  saveNotice: string | null;
  magicStatus: MagicApiStatus;
  magicRefreshing: boolean;
  onChangeOptions: (next: Required<SynthesisOptions>) => void;
  onToggleSelectArea: () => void;
  onFinishSynthesisPolygon: () => void;
  onPopSynthesisVertex: () => void;
  onClearSynthesisArea: () => void;
  onToggleBlueMapUnderlay: () => void;
  onToggleAutoSave: () => void;
  onSaveSynthesisToMap: () => void;
  onRefreshMagicApi: () => void;
  onImportMagicJson: (jsonText: string) => { ok: boolean; message: string };
  onRunSynthesis: () => void;
  onRunMagicTrajectorySynthesis: (opts: {
    includeRoads: boolean;
    includeRailways: boolean;
    onlyInZone: boolean;
  }) => { roadsCount: number; railwaysCount: number; sourceMode: 'magic-rails' | 'mtr-trajectories' };
  onClearSynthesis: () => void;
}

const ROOF_OPTIONS: Array<{ id: RoofType; label: string }> = [
  { id: 'flat', label: 'Плоская' },
  { id: 'pitched', label: 'Скатная' },
  { id: 'curved', label: 'Кривая' },
  { id: 'complex', label: 'Сложная' },
];

const ROAD_TYPE_OPTIONS: Array<{ id: RoadClass; label: string; widthHint: string }> = [
  { id: 'highway', label: 'Магистраль', widthHint: '26+ м' },
  { id: 'avenue', label: 'Проспект', widthHint: '19–25 м' },
  { id: 'street', label: 'Улица', widthHint: '12–18 м' },
  { id: 'lane', label: 'Переулок', widthHint: '7–11 м' },
  { id: 'service', label: 'Подъездная', widthHint: '5–8 м' },
  { id: 'dirt', label: 'Грунтовая', widthHint: '4–7 м' },
  { id: 'pedestrian', label: 'Проход', widthHint: 'до 7 м' },
];

function formatPolygonSummary(polygon: WorldPoint[]): { short: string; full: string } {
  const sqM = Math.max(1, Math.round(computePolygonArea(polygon)));
  const areaText =
    sqM >= 1_000_000
      ? `${(sqM / 1_000_000).toFixed(2)} км²`
      : `${sqM.toLocaleString('ru-RU')} м²`;
  return {
    short: areaText,
    full: `${areaText} · ${polygon.length} верш.`,
  };
}

export const SynthesisPanel: React.FC<SynthesisPanelProps> = ({
  isRunning,
  stats,
  error,
  options,
  synthesisPolygon,
  isSynthesisPolygonClosed,
  isSelectingSynthesisArea,
  blueMapUnderlay,
  unsavedBuildingsCount,
  unsavedStreetsCount,
  savedTotalBuildings,
  savedTotalStreets,
  autoSaveSynthesis,
  saveNotice,
  magicStatus,
  magicRefreshing,
  onChangeOptions,
  onToggleSelectArea,
  onFinishSynthesisPolygon,
  onPopSynthesisVertex,
  onClearSynthesisArea,
  onToggleBlueMapUnderlay,
  onToggleAutoSave,
  onSaveSynthesisToMap,
  onRefreshMagicApi,
  onImportMagicJson,
  onRunSynthesis,
  onRunMagicTrajectorySynthesis,
  onClearSynthesis,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [magicNotice, setMagicNotice] = React.useState<string | null>(null);
  const [trajIncludeRoads, setTrajIncludeRoads] = React.useState(true);
  const [trajIncludeRails, setTrajIncludeRails] = React.useState(true);
  const [trajOnlyInZone, setTrajOnlyInZone] = React.useState(false);
  const [trajResultMsg, setTrajResultMsg] = React.useState<string | null>(null);

  const toggleRoof = (roof: RoofType) => {
    const exists = options.allowedRoofTypes.includes(roof);
    if (exists && options.allowedRoofTypes.length === 1) return;
    const next = exists
      ? options.allowedRoofTypes.filter((r) => r !== roof)
      : [...options.allowedRoofTypes, roof];
    onChangeOptions({ ...options, allowedRoofTypes: next });
  };

  const toggleRoadClass = (cls: RoadClass) => {
    const exists = options.allowedRoadClasses.includes(cls);
    if (exists && options.allowedRoadClasses.length === 1) return;
    const next = exists
      ? options.allowedRoadClasses.filter((c) => c !== cls)
      : [...options.allowedRoadClasses, cls];
    onChangeOptions({ ...options, allowedRoadClasses: next });
  };

  const hasUnsaved = unsavedBuildingsCount > 0 || unsavedStreetsCount > 0;
  const isMagicTrajectoryMode = options.targetMode === 'magic-trajectories';
  const hasReadyPolygon = synthesisPolygon.length >= 3 && isSynthesisPolygonClosed;
  const areaDims = synthesisPolygon.length >= 3 ? formatPolygonSummary(synthesisPolygon) : null;

  const handlePrimaryRun = () => {
    if (isMagicTrajectoryMode) {
      if (!trajIncludeRoads && !trajIncludeRails) return;
      if (trajOnlyInZone && !hasReadyPolygon) {
        if (synthesisPolygon.length >= 3 && !isSynthesisPolygonClosed) {
          onFinishSynthesisPolygon();
        } else {
          onToggleSelectArea();
        }
        return;
      }
      const res = onRunMagicTrajectorySynthesis({
        includeRoads: trajIncludeRoads,
        includeRailways: trajIncludeRails,
        onlyInZone: trajOnlyInZone,
      });
      setTrajResultMsg(
        `Создано: ${res.roadsCount} дор. и ${res.railwaysCount} ЖД путей (общие участки объединены, кривые сглажены)`
      );
      return;
    }
    if (!hasReadyPolygon) {
      if (synthesisPolygon.length >= 3 && !isSynthesisPolygonClosed) {
        onFinishSynthesisPolygon();
        return;
      }
      onToggleSelectArea();
      return;
    }
    setTrajResultMsg(null);
    onRunSynthesis();
  };

  return (
    <div className="flex flex-col h-full murs-anim-tab">
      {/* Pinned Header + Unified Mode Switcher + Run & Save CTA */}
      <div className="px-4 pt-3 pb-3 border-b border-neutral-200/80 dark:border-neutral-700/80 space-y-2.5">
        <div>
          <h2 className="text-sm font-bold text-neutral-950 dark:text-white">
            Автогенерация объектов карты
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">
            Выделите произвольную область на карте — синтез проанализирует крыши, дороги и ЖД
            точно в её границах.
          </p>
        </div>

        {/* Unified Target Mode Selector: All / Buildings / Roads / MAGIC Roads & Rails */}
        <div
          role="group"
          aria-label="Что генерировать"
          className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-[#282B33]"
        >
          {(
            [
              { id: 'both', label: 'Всё' },
              { id: 'buildings', label: 'Только здания' },
              { id: 'streets', label: 'Только дороги' },
              { id: 'magic-trajectories', label: 'Дороги и ЖД (трассы)' },
            ] as Array<{ id: SynthesisTargetMode; label: string }>
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => onChangeOptions({ ...options, targetMode: mode.id })}
              className={`min-h-[36px] py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                options.targetMode === mode.id
                  ? 'bg-white dark:bg-[#1B1E24] text-neutral-950 dark:text-white shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isRunning || (isMagicTrajectoryMode && !trajIncludeRoads && !trajIncludeRails)}
            onClick={handlePrimaryRun}
            className="flex-1 min-h-[42px] px-3 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] disabled:opacity-60 text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Анализ области...</span>
              </>
            ) : isMagicTrajectoryMode ? (
              <>
                <TrainFront className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {trajOnlyInZone && !hasReadyPolygon
                    ? 'Выделить контур на карте'
                    : 'Синтезировать дороги и ЖД'}
                </span>
              </>
            ) : !hasReadyPolygon ? (
              <>
                <Crop className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {synthesisPolygon.length >= 3 && !isSynthesisPolygonClosed
                    ? `Замкнуть контур (${synthesisPolygon.length} т.)`
                    : isSelectingSynthesisArea
                    ? `Ставьте точки (${synthesisPolygon.length})...`
                    : 'Выделить область на карте'}
                </span>
              </>
            ) : (
              <>
                <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Синтезировать ({areaDims?.short})</span>
              </>
            )}
          </button>

          {(stats || hasUnsaved) && (
            <button
              type="button"
              onClick={onClearSynthesis}
              aria-label="Очистить несохранённый слой"
              title="Очистить несохранённый слой"
              className="min-h-[42px] px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 transition-colors shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Save Synthesized Layer Controls */}
        <div className="space-y-1.5">
          <button
            type="button"
            disabled={!hasUnsaved}
            onClick={onSaveSynthesisToMap}
            className={`w-full h-9 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
              hasUnsaved
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-neutral-100 dark:bg-[#252830] text-neutral-400 dark:text-neutral-500 cursor-default'
            }`}
          >
            <Save className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {hasUnsaved
                ? `Сохранить на карту (${unsavedBuildingsCount} зд. · ${unsavedStreetsCount} ул.)`
                : `Сохранено на карте (${savedTotalBuildings} зд. · ${savedTotalStreets} ул.)`}
            </span>
          </button>

          <label className="flex items-center justify-between gap-2 text-[11px] text-neutral-600 dark:text-neutral-300 cursor-pointer px-0.5">
            <span>Автоматически сохранять на карту</span>
            <input
              type="checkbox"
              checked={autoSaveSynthesis}
              onChange={onToggleAutoSave}
              className="h-3.5 w-3.5 accent-emerald-600 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* Scrollable Configuration & Results */}
      <div className="flex-1 overflow-y-auto murs-scroll px-4 py-3 space-y-4">
        {saveNotice && (
          <div
            role="status"
            className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2 murs-anim-pop"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>{saveNotice}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 murs-anim-pop"
          >
            {error}
          </div>
        )}

        {/* Transit Line Tracing Status & Loader */}
        <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-neutral-900 dark:text-white">
              <TrainFront className="w-3.5 h-3.5 text-[#FC3F1D]" aria-hidden="true" />
              <span>Трассировка линий транспорта</span>
            </span>
            <span className="text-[11px] font-mono tabular-nums font-semibold text-neutral-600 dark:text-neutral-300">
              {magicStatus.railsLoaded > 0
                ? `${magicStatus.railsLoaded} кривых`
                : 'По станциям'}
            </span>
          </div>

          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
            {magicStatus.railsLoaded > 0
              ? `Проложено ${magicStatus.routesTracedFromRails} из ${magicStatus.totalRoutes} маршрутов блок-в-блок по кривым MAGIC API со сглаживанием и учётом высот.`
              : magicStatus.diagnostic
              ? magicStatus.diagnostic
              : 'Источник MAGIC API: map.murs-mc.ru:8088/api/rails?dimension=0. Обновите пути для трассировки блок-в-блок или загрузите JSON кривых.'}
          </p>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={magicRefreshing}
              onClick={() => {
                setMagicNotice(null);
                onRefreshMagicApi();
              }}
              className="flex-1 h-8 px-2.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${magicRefreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Обновить пути</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Загрузить файл</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const res = onImportMagicJson(String(reader.result || ''));
                  setMagicNotice(res.message);
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </div>

          {magicNotice && (
            <div className="text-[11px] text-neutral-700 dark:text-neutral-200 font-medium">
              {magicNotice}
            </div>
          )}
        </div>

        {/* MAGIC API Trajectory Synthesis Settings (shown when selected in unified mode switcher) */}
        {isMagicTrajectoryMode && (
          <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/90 dark:border-amber-800/60 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-950 dark:text-white">
              <RouteIcon className="w-3.5 h-3.5 text-[#FC3F1D]" aria-hidden="true" />
              <span>Параметры синтеза по траекториям (MAGIC API)</span>
            </div>

            <p className="text-[11px] text-neutral-600 dark:text-neutral-300 leading-snug">
              Строит непрерывные автодороги по маршрутам автобусов и троллейбусов и отдельные ЖД
              пути по траекториям MTR / MAGIC API с постоянным радиусом скругления.
            </p>

            <div className="grid grid-cols-2 gap-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer py-2 px-2.5 rounded-lg bg-white/90 dark:bg-[#1E2027]/90 border border-neutral-200/80 dark:border-neutral-700/70">
                <input
                  type="checkbox"
                  checked={trajIncludeRoads}
                  onChange={(e) => setTrajIncludeRoads(e.target.checked)}
                  className="h-4 w-4 accent-[#FC3F1D]"
                />
                <span>Автодороги</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer py-2 px-2.5 rounded-lg bg-white/90 dark:bg-[#1E2027]/90 border border-neutral-200/80 dark:border-neutral-700/70">
                <input
                  type="checkbox"
                  checked={trajIncludeRails}
                  onChange={(e) => setTrajIncludeRails(e.target.checked)}
                  className="h-4 w-4 accent-[#FC3F1D]"
                />
                <span>ЖД рельсы</span>
              </label>
            </div>

            <label className="flex items-center justify-between gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
              <span>Ограничить выделенной областью</span>
              <input
                type="checkbox"
                checked={trajOnlyInZone}
                onChange={(e) => setTrajOnlyInZone(e.target.checked)}
                className="h-4 w-4 accent-[#FC3F1D]"
              />
            </label>

            {trajResultMsg && (
              <div
                role="status"
                className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50/90 dark:bg-emerald-950/40 px-2.5 py-1.5 rounded-lg border border-emerald-200/80 dark:border-emerald-800/60"
              >
                {trajResultMsg}
              </div>
            )}
          </div>
        )}

        {/* User-Drawn Arbitrary Polygon Scan Zone (like Park/Water contour) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Область синтеза (контур)
            </span>
            <span className="text-[11px] font-mono tabular-nums text-neutral-900 dark:text-white font-semibold">
              {hasReadyPolygon && areaDims
                ? areaDims.full
                : synthesisPolygon.length > 0
                ? `${synthesisPolygon.length} верш. (не замкнут)`
                : 'Не выбрана'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleSelectArea}
              className={`flex-1 min-h-[38px] px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border ${
                isSelectingSynthesisArea
                  ? 'bg-[#FC3F1D] text-white border-[#FC3F1D] shadow-sm'
                  : 'bg-neutral-100 dark:bg-[#282B33] hover:bg-neutral-200 dark:hover:bg-[#323642] text-neutral-900 dark:text-white border-neutral-200/80 dark:border-neutral-700/70'
              }`}
            >
              <Crop className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {isSelectingSynthesisArea
                  ? 'Отменить рисование'
                  : hasReadyPolygon
                  ? 'Выделить заново'
                  : 'Выделить область на карте'}
              </span>
            </button>

            {synthesisPolygon.length > 0 && (
              <button
                type="button"
                onClick={onClearSynthesisArea}
                aria-label="Сбросить выделенную область"
                title="Сбросить выделенную область"
                className="min-h-[38px] px-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {!isSynthesisPolygonClosed && synthesisPolygon.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={synthesisPolygon.length < 3}
                onClick={onFinishSynthesisPolygon}
                className="flex-1 h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-xs font-bold transition-colors"
              >
                Замкнуть контур (Enter)
              </button>
              <button
                type="button"
                onClick={onPopSynthesisVertex}
                className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-200 transition-colors"
              >
                Шаг назад
              </button>
            </div>
          )}

          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
            {isSelectingSynthesisArea || (!isSynthesisPolygonClosed && synthesisPolygon.length > 0)
              ? 'Ставьте вершины многоугольника ЛКМ (или Shift + ЛКМ). Двойной клик, Enter или клик по первой точке замкнут область.'
              : hasReadyPolygon
              ? 'Синтез выполнится строго внутри заданного контура. Любую вершину можно перетаскивать на карте.'
              : 'Нажмите «Выделить область на карте» или используйте Shift + ЛКМ, чтобы обвести произвольную область (как парк или водоём).'}
          </p>

          {/* Detail Level */}
          <div className="pt-1">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">
                Детализация снимка
              </span>
              <span className="font-mono tabular-nums text-[11px] text-neutral-500 dark:text-neutral-400">
                {options.tileLod === 1
                  ? '1 м/пикс · макс.'
                  : options.tileLod === 2
                  ? '5 м/пикс · баланс'
                  : '25 м/пикс · быстро'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-[#282B33]">
              {(
                [
                  { lod: 1, label: 'Точно' },
                  { lod: 2, label: 'Средне (1+ км)' },
                  { lod: 3, label: 'Обзорно' },
                ] as const
              ).map((item) => (
                <button
                  key={item.lod}
                  type="button"
                  onClick={() => onChangeOptions({ ...options, tileLod: item.lod })}
                  className={`py-1.5 px-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    options.tileLod === item.lod
                      ? 'bg-white dark:bg-[#1B1E24] text-neutral-950 dark:text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Road Type Selection & Width Filters */}
        {(options.targetMode === 'both' || options.targetMode === 'streets') && (
          <div className="space-y-2.5 pt-2 border-t border-neutral-200/80 dark:border-neutral-700/80">
            <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              Типы генерируемых дорог
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Типы дорог для синтеза">
              {ROAD_TYPE_OPTIONS.map((rt) => {
                const active = options.allowedRoadClasses.includes(rt.id);
                return (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => toggleRoadClass(rt.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                        : 'bg-neutral-50 dark:bg-[#252830] text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {rt.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 pt-1">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label htmlFor="syn-min-w" className="font-medium text-neutral-700 dark:text-neutral-300">
                    Мин. ширина дороги
                  </label>
                  <span className="font-mono tabular-nums text-neutral-900 dark:text-white font-semibold">
                    {options.minStreetWidthBlocks} м
                  </span>
                </div>
                <input
                  id="syn-min-w"
                  type="range"
                  min={2}
                  max={18}
                  value={options.minStreetWidthBlocks}
                  onChange={(e) =>
                    onChangeOptions({ ...options, minStreetWidthBlocks: Number(e.target.value) })
                  }
                  className="w-full accent-[#FC3F1D]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label htmlFor="syn-max-w" className="font-medium text-neutral-700 dark:text-neutral-300">
                    Макс. ширина (шире — двор/площадь)
                  </label>
                  <span className="font-mono tabular-nums text-neutral-900 dark:text-white font-semibold">
                    {options.maxStreetWidthBlocks} м
                  </span>
                </div>
                <input
                  id="syn-max-w"
                  type="range"
                  min={12}
                  max={64}
                  step={2}
                  value={options.maxStreetWidthBlocks}
                  onChange={(e) =>
                    onChangeOptions({ ...options, maxStreetWidthBlocks: Number(e.target.value) })
                  }
                  className="w-full accent-[#FC3F1D]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Roof-Boundary Segmentation & Building Filters (no block-snapping or max size caps) */}
        {!isMagicTrajectoryMode && (
          <div className="space-y-3 pt-2 border-t border-neutral-200/80 dark:border-neutral-700/80">
            <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              Сегментация по крышам и геометрия
            </div>

            {options.targetMode !== 'streets' && (
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Типы крыш зданий
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {ROOF_OPTIONS.map((rf) => {
                    const checked = options.allowedRoofTypes.includes(rf.id);
                    return (
                      <label
                        key={rf.id}
                        className="flex items-center gap-1.5 text-[11px] text-neutral-700 dark:text-neutral-300 cursor-pointer py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRoof(rf.id)}
                          className="h-3.5 w-3.5 accent-[#FC3F1D]"
                        />
                        <span>{rf.label}</span>
                      </label>
                    );
                  })}
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <label htmlFor="syn-min-h" className="font-medium text-neutral-700 dark:text-neutral-300">
                      Мин. высота крыши (верх без ограничений)
                    </label>
                    <span className="font-mono tabular-nums text-neutral-900 dark:text-white font-semibold">
                      {options.minBuildingHeight} м
                    </span>
                  </div>
                  <input
                    id="syn-min-h"
                    type="range"
                    min={1}
                    max={20}
                    value={options.minBuildingHeight}
                    onChange={(e) =>
                      onChangeOptions({ ...options, minBuildingHeight: Number(e.target.value) })
                    }
                    className="w-full accent-[#FC3F1D]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <label htmlFor="syn-min-area" className="font-medium text-neutral-700 dark:text-neutral-300">
                      Мин. площадь здания (от 1 м²)
                    </label>
                    <span className="font-mono tabular-nums text-neutral-900 dark:text-white font-semibold">
                      {options.minBuildingAreaBlocks} м²
                    </span>
                  </div>
                  <input
                    id="syn-min-area"
                    type="range"
                    min={1}
                    max={200}
                    step={1}
                    value={Math.min(200, options.minBuildingAreaBlocks)}
                    onChange={(e) =>
                      onChangeOptions({ ...options, minBuildingAreaBlocks: Number(e.target.value) })
                    }
                    className="w-full accent-[#FC3F1D]"
                  />
                </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label htmlFor="syn-simplify" className="font-medium text-neutral-700 dark:text-neutral-300">
                    Упрощение формы здания
                  </label>
                  <span className="font-mono tabular-nums text-neutral-900 dark:text-white font-semibold">
                    {Math.round((options.shapeSimplification ?? 0.55) * 100)}%
                  </span>
                </div>
                <input
                  id="syn-simplify"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={options.shapeSimplification ?? 0.55}
                  onChange={(e) =>
                    onChangeOptions({ ...options, shapeSimplification: Number(e.target.value) })
                  }
                  className="w-full accent-[#FC3F1D]"
                />
                <div className="grid grid-cols-3 gap-1 mt-1.5">
                  {(
                    [
                      { value: 0.2, label: 'Детально' },
                      { value: 0.55, label: 'Оптимально' },
                      { value: 0.85, label: 'Сильно' },
                    ] as const
                  ).map((preset) => {
                    const active = Math.abs((options.shapeSimplification ?? 0.55) - preset.value) < 0.08;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onChangeOptions({ ...options, shapeSimplification: preset.value })}
                        className={`py-1 px-1.5 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                            : 'bg-neutral-50 dark:bg-[#252830] text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1.5 leading-snug">
                  Поглощает балконы, подъезды, карнизы и ступеньки диагональных фасадов в единый
                  аккуратный силуэт здания.
                </p>
              </div>
            </div>
          )}

          <label className="flex items-center justify-between gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer pt-1">
            <span>Привязывать наземный транспорт к улицам</span>
            <input
              type="checkbox"
              checked={options.snapSurfaceTransit}
              onChange={(e) =>
                onChangeOptions({ ...options, snapSurfaceTransit: e.target.checked })
              }
              className="h-4 w-4 accent-[#FC3F1D] cursor-pointer"
            />
          </label>
        </div>
        )}

        {/* Results */}
        {stats && (
          <div className="space-y-2 pt-2 border-t border-neutral-200/80 dark:border-neutral-700/80">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-neutral-500 dark:text-neutral-400">
                Результат анализа
              </span>
              <span className="font-mono tabular-nums text-[11px] text-neutral-500 dark:text-neutral-400">
                {stats.elapsedMs} мс
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-neutral-900 dark:text-neutral-100">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#FC3F1D]" aria-hidden="true" />
                  <span>Здания с крышей</span>
                </span>
                <span className="font-mono tabular-nums">+{stats.buildingsExtracted}</span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
                Плоск: {stats.roofBreakdown.flat} · Скат: {stats.roofBreakdown.pitched} · Крив:{' '}
                {stats.roofBreakdown.curved} · Сложн: {stats.roofBreakdown.complex}
              </div>
              {stats.buildingsRejectedBridges ? (
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Отсеяно мостов и эстакад: {stats.buildingsRejectedBridges}
                </div>
              ) : null}
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-neutral-900 dark:text-neutral-100">
                <span className="flex items-center gap-1.5">
                  <RouteIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span>Улицы и магистрали</span>
                </span>
                <span className="font-mono tabular-nums">+{stats.streetsExtracted}</span>
              </div>
              {stats.streetsExtracted > 0 && (
                <div className="text-[11px] font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
                  Ширина: {stats.minStreetWidth}–{stats.maxStreetWidth} м (ср. {stats.avgStreetWidth} м)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Satellite Underlay Comparison Toggle */}
        <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-700/80 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-neutral-500 shrink-0" aria-hidden="true" />
            <div>
              <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                Подложка спутника
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Или переключите карту в режим «Гибрид» справа сверху
              </div>
            </div>
          </div>
          <input
            type="checkbox"
            checked={blueMapUnderlay}
            onChange={onToggleBlueMapUnderlay}
            className="h-4 w-4 accent-[#FC3F1D] cursor-pointer shrink-0"
          />
        </label>
      </div>
    </div>
  );
};
