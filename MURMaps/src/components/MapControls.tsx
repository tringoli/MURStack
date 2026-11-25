import React, { useState } from 'react';
import {
  Camera,
  Compass,
  Crosshair,
  Globe,
  Layers,
  Layers2,
  Minus,
  Moon,
  Pencil,
  Plus,
  Sun,
} from 'lucide-react';
import type {
  CameraState,
  MapLayerVisibility,
  MapStyleMode,
  WorldPoint,
} from '../types/map';

interface MapControlsProps {
  camera: CameraState;
  darkMode: boolean;
  mapStyle: MapStyleMode;
  layers: MapLayerVisibility;
  insolationEnabled?: boolean;
  cursorCoords?: WorldPoint;
  cursorSpanRef?: React.RefObject<HTMLSpanElement | null>;
  isEditorMode: boolean;
  onEnterEditorMode: () => void;
  onEnterPhotoMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggle3D: () => void;
  onResetNorth: () => void;
  onRecenter: () => void;
  onToggleDarkMode: () => void;
  onToggleInsolation?: () => void;
  onChangeMapStyle: (style: MapStyleMode) => void;
  onToggleLayer: (key: keyof MapLayerVisibility) => void;
}

function computeScaleBar(zoom: number): { blocks: number; px: number; label: string } {
  const candidates = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const targetPx = 88;
  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const px = c * zoom;
    const diff = Math.abs(px - targetPx);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  const px = Math.max(36, Math.min(130, Math.round(best * zoom)));
  const label = best >= 1000 ? `${best / 1000} км` : `${best} м`;
  return { blocks: best, px, label };
}

export const MapControls: React.FC<MapControlsProps> = ({
  camera,
  darkMode,
  mapStyle,
  layers,
  insolationEnabled = false,
  cursorCoords,
  cursorSpanRef,
  isEditorMode,
  onEnterEditorMode,
  onEnterPhotoMode,
  onZoomIn,
  onZoomOut,
  onToggle3D,
  onResetNorth,
  onRecenter,
  onToggleDarkMode,
  onChangeMapStyle,
  onToggleLayer,
}) => {
  const [layersOpen, setLayersOpen] = useState(false);
  const is3D = camera.pitch > 10;
  const scale = computeScaleBar(camera.zoom);
  const showInteractiveControls = true;

  return (
    <>
      {/* Top-Right Controls: Map Style, Layers, Theme, and dedicated Map Editor entry button */}
      {!isEditorMode && (
        <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-30 flex items-center gap-1 sm:gap-2 murs-anim-slide-down">
          <div
            role="group"
            aria-label="Режим отображения карты"
            className="flex items-center p-0.5 sm:p-1 rounded-xl bg-white dark:bg-[#22252C] border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
          >
            <button
              type="button"
              onClick={() => onChangeMapStyle('vector')}
              className={`px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                mapStyle === 'vector'
                  ? 'bg-[#FFCC00] text-neutral-950'
                  : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <span className="sm:hidden">Схема</span>
              <span className="hidden sm:inline">Схема 3D</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeMapStyle('hybrid')}
              title="Гибрид: схема поверх спутникового снимка"
              className={`px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                mapStyle === 'hybrid'
                  ? 'bg-[#FFCC00] text-neutral-950'
                  : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Layers2 className="w-3.5 h-3.5 hidden sm:inline" aria-hidden="true" />
              <span>Гибрид</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeMapStyle('bluemap')}
              className={`px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                mapStyle === 'bluemap'
                  ? 'bg-[#FFCC00] text-neutral-950'
                  : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Globe className="w-3.5 h-3.5 hidden sm:inline" aria-hidden="true" />
              <span>Спутник</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onEnterEditorMode}
            aria-label="Редактор"
            title="Открыть графический редактор карты"
            className="hidden sm:flex sm:h-10 sm:px-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 shadow-[0_2px_12px_rgba(0,0,0,0.14)] items-center justify-center gap-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Редактор</span>
          </button>

          <button
            type="button"
            onClick={onEnterPhotoMode}
            aria-label="Фоторежим"
            title="Фоторежим — скрыть весь интерфейс (выход на Esc)"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white dark:bg-[#22252C] border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center justify-center text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700/70 transition-colors shrink-0"
          >
            <Camera className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Включить светлую тему' : 'Включить тёмную тему'}
            title={darkMode ? 'Светлая тема' : 'Тёмная тема'}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white dark:bg-[#22252C] border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center justify-center text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700/70 transition-colors shrink-0"
          >
            {darkMode ? (
              <Sun className="w-4 h-4 murs-anim-pop" />
            ) : (
              <Moon className="w-4 h-4 murs-anim-pop" />
            )}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setLayersOpen((o) => !o)}
              aria-label="Слои карты"
              aria-expanded={layersOpen}
              className={`h-9 w-9 sm:w-auto sm:h-10 sm:px-3 rounded-xl border shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                layersOpen
                  ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
                  : 'bg-white dark:bg-[#22252C] text-neutral-800 dark:text-neutral-100 border-neutral-200/90 dark:border-neutral-700/80 hover:bg-neutral-50 dark:hover:bg-neutral-700/70'
              }`}
            >
              <Layers className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Слои</span>
            </button>

            {layersOpen && (
              <div className="absolute right-0 mt-2 z-40 w-68 rounded-2xl bg-white dark:bg-[#22252C] border border-neutral-200 dark:border-neutral-700 shadow-2xl p-3 text-sm max-h-[80vh] overflow-y-auto murs-scroll origin-top-right murs-anim-pop">
                <div className="text-xs font-bold text-neutral-900 dark:text-white mb-2">
                  Слои и режимы
                </div>
                <div className="space-y-3">
                  {(
                    [
                      {
                        title: '3D-среда и освещение',
                        items: [
                          ['buildings3D', 'Объёмные 3D-здания'],
                          ['insolation', 'Инсоляция (тени от Солнца)'],
                          ['elevation3D', 'Учёт высоты в 3D'],
                          ['terrainRelief', 'Рельеф местности (3D)'],
                          ['blueMapUnderlay', 'Подложка спутника'],
                        ],
                      },
                      {
                        title: 'Транспорт',
                        items: [
                          ['mtrLines', 'Линии транспорта'],
                          ['metroOnly', 'Только метрополитен'],
                          ['liveVehicles', 'Движение транспорта'],
                        ],
                      },
                      {
                        title: 'Подписи на карте',
                        items: [
                          ['streetLabels', 'Названия улиц и магистралей'],
                          ['addressNumbers', 'Номера домов'],
                        ],
                      },
                    ] as Array<{
                      title: string;
                      items: Array<[keyof MapLayerVisibility, string]>;
                    }>
                  ).map((group) => (
                    <div key={group.title} className="space-y-0.5">
                      <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                        {group.title}
                      </div>
                      {group.items.map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center justify-between gap-3 py-1.5 px-1.5 rounded-lg hover:bg-neutral-100/80 dark:hover:bg-neutral-700/40 cursor-pointer"
                        >
                          <span className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                            {label}
                          </span>
                          <input
                            type="checkbox"
                            checked={key === 'insolation' ? insolationEnabled || layers[key] : layers[key]}
                            onChange={() => onToggleLayer(key)}
                            className="h-4 w-4 rounded accent-[#FC3F1D] cursor-pointer"
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Right-Side Zoom / 3D / Compass Stack */}
      {showInteractiveControls && (
        <div className="fixed right-3 sm:right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2">
          <div className="flex flex-col gap-2 murs-anim-slide-left">
          <div className="flex flex-col rounded-xl bg-white/95 dark:bg-[#22252C]/95 backdrop-blur-sm border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)] overflow-hidden">
            <button
              type="button"
              onClick={onZoomIn}
              aria-label="Приблизить карту"
              title="Приблизить (+)"
              className="w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 transition-colors border-b border-neutral-200/80 dark:border-neutral-700/80"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onZoomOut}
              aria-label="Отдалить карту"
              title="Отдалить (−)"
              className="w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onToggle3D}
            aria-label={is3D ? 'Переключить в 2D вид' : 'Переключить в 3D вид'}
            title="Переключить 2D / 3D наклон"
            className={`w-11 h-11 sm:w-10 sm:h-10 rounded-xl border shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center justify-center text-xs font-bold transition-colors ${
              is3D
                ? 'bg-[#FFCC00] text-neutral-950 border-[#E5B800]'
                : 'bg-white/95 dark:bg-[#22252C]/95 text-neutral-800 dark:text-neutral-100 border-neutral-200/90 dark:border-neutral-700/80 hover:bg-neutral-100 dark:hover:bg-neutral-700/60'
            }`}
          >
            {is3D ? '3D' : '2D'}
          </button>

          <button
            type="button"
            onClick={onResetNorth}
            aria-label="Ориентировать на север"
            title="Сбросить поворот на север (ПКМ + перетаскивание вращает карту)"
            className="w-11 h-11 sm:w-10 sm:h-10 rounded-xl bg-white/95 dark:bg-[#22252C]/95 backdrop-blur-sm border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center justify-center text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 transition-colors"
          >
            <Compass
              className="w-4 h-4 transition-transform duration-150"
              style={{ transform: `rotate(${-camera.bearing}deg)` }}
            />
          </button>

          <button
            type="button"
            onClick={onRecenter}
            aria-label="Центрировать на Муроморске"
            title="Центр Муроморска"
            className="w-11 h-11 sm:w-10 sm:h-10 rounded-xl bg-white/95 dark:bg-[#22252C]/95 backdrop-blur-sm border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center justify-center text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 transition-colors"
          >
            <Crosshair className="w-4 h-4" />
          </button>
          </div>
        </div>
      )}

      {/* Bottom-Right Compact Scale Bar */}
      {showInteractiveControls && (
        <div className="fixed bottom-4 right-4 z-20 hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-white/90 dark:bg-[#22252C]/90 backdrop-blur-sm border border-neutral-200/80 dark:border-neutral-700/80 shadow-sm text-xs text-neutral-600 dark:text-neutral-300 murs-anim-slide-up">
          {insolationEnabled && (
            <>
              <span className="font-semibold text-amber-600 dark:text-amber-400">Инсоляция</span>
              <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">
                |
              </span>
            </>
          )}
          {layers.terrainRelief && (
            <>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">Рельеф</span>
              <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">
                |
              </span>
            </>
          )}
          {mapStyle === 'hybrid' && (
            <>
              <span className="font-semibold text-amber-700 dark:text-amber-400">Гибрид 3D</span>
              <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">
                |
              </span>
            </>
          )}
          {mapStyle === 'bluemap' && (
            <>
              <span className="font-semibold text-sky-700 dark:text-sky-400">Спутник</span>
              <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">
                |
              </span>
            </>
          )}
          <div className="flex items-center gap-2">
            <div
              className="h-2 border-b-2 border-l-2 border-r-2 border-neutral-700 dark:border-neutral-300 transition-[width] duration-200 ease-out"
              style={{ width: `${scale.px}px` }}
            />
            <span className="font-mono tabular-nums font-medium">{scale.label}</span>
          </div>
          <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">
            |
          </span>
          <span ref={cursorSpanRef} className="font-mono tabular-nums">
            {cursorCoords ? `${Math.round(cursorCoords.x)}, ${Math.round(cursorCoords.z)}` : '10550, -620'}
          </span>
        </div>
      )}
    </>
  );
};
