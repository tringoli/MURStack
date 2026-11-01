# MURScheme — Техническая документация для разработчиков

> *Актуально на 1 ноября 2026 года*
> 
> Версия кода: **beta 5**. Документ описывает архитектуру, модель данных, алгоритмы рендеринга и пучкования, точки расширения и подводные камни.

---

## Дорожная карта релиза (v.1.0)

| #   | Требование                                                       | Приоритет | Статус | Реальная сложность | Что конкретно делать                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------- | --------- | ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Туториал: собрать сложную схему вместе с пользователем**       | `P0`      | ⏳ 0%  | 🟡 Средняя         | Сценарий: 3 линии → пучок → пересадка → терминал → легенда. Оверлей-движок пошаговых подсказок. Завершается готовой схемой, экспортируемой в SVG/PDF.                                                                                                                                                                                                                                                                                    |
| 2   | **Базовый функционал** (рисовать → сортировать → корректировать) | `P0`      | 🔄 90% | 🟢 Низкая          | Только багфикс и UX-шлифовка happy path. Новое не добавляем.                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | **Продвинутый функционал** (тонкая настройка)                    | `P1`      | 🔄 85% | 🟢 Низкая          | Режим **«Просто / Про»** в панели свойств — скрыть ~40 контролов за тумблером. Паттерн `syncLineArrowsAndBadgesModernUI` расширить на всю панель.                                                                                                                                                                                                                                                                                        |
| 4   | **Базовый набор графики** (местность, объекты)                   | `P1`      | 🔄 70% | 🟡 Средняя         | Курируемая библиотека пресетов вместо «пустого слоя»: парк, вода, район, вокзал, аэропорт, больница. 15–20 готовых SVG-объектов.                                                                                                                                                                                                                                                                                                         |
| 5   | **Свои SVG-иконки вместо эмодзи**                                | `P0`      | ⏳ 0%   | 🟢 Низкая          | Заменить 8 эмодзи в тулбаре (🚇 ⚪ ⇄ 🛤️ 🖌️ 📝 📍) + эмодзи-пресеты POI на inline-SVG в стиле Feather/Manrope. Единый набор 20–25 иконок.                                                                                                                                                                                                                                                                                                |
| 6   | **Импорт координат линий и маршрутов из OpenStreetMap**          | `P0`      | ⏳ 0%   | 🔴 Высокая         | Два сценария: (а) Overpass API — загрузка готовой сети города по `route=subway/tram`; (б) вставка OSM-ссылки → геометрия одной линии. Парсинг relations + проецирование в локальные координаты.                                                                                                                                                                                                                                          |
| 7   | **Экспорт в PDF**                                                | `P0`      | ⏳ 0%   | 🟡 Средняя         | **Векторный** PDF (не «скриншот»), текст остаётся текстом. Пресеты A4 / A3 / постер. Реализация: jsPDF + svg2pdf либо рендер через Canvas. Также выступает **транспортом для ArtCraft**.                                                                                                                                                                                                                                                 |
| 8   | **Совместимость с ArtCraft**                                     | `P0`      | ⏳ 0%   | 🟡 Средняя         | **Уровень 1 (обязательно для v1.0):** чистый семантический SVG-экспорт — слои `<g id="lines/stations/...">`, живой текст (не `<path>`), корректный `viewBox`. **Уровень 2 (v1.1+):** JSON Control Channel → кнопка «Открыть в VectorCraft» с передачей команд. **Уровень 3 (перспектива):** совместный запуск в браузере через WebAssembly-версию VectorCraft.                                                                           |
| 9   | **Чистота кода, минимум мусора**                                 | `P0`      | 🔄     | 🟡 Средняя         | Устранить **конкретные дубликаты**: `sortLinesForBundle`, `alignSharedCorridorNodes`, `computeSmartCorridorBundles`, `syncBundleCommonNodes`, `syncBundleCorridorPoints`, `createBadgeShapeSVG`, `handleBadgeNodePick`, `showPropsPanel` — каждая определена дважды. Плюс `renderLineBadgesNodesUI` vs `renderLineBadgeNodesUI` (разная логика, похожие имена). Опционально: разбить на ES-модули `/src/core`, `/src/render`, `/src/ui`. |
| 10  | **Мобильная работа**                                             | `P2`      | 🔄 60% | 🟢 Низкая          | **Мобильный просмотр — v1.0, быстрая правка 1–2 объектов — v1.1, полный редактор — не планируется**. В v1.0: полиш `read-only-mode` (tap-таргеты, скрытие тулбара) + жестовая навигация `SMOOTH_NAV` (уже есть).                                                                                                                                                                                            |

## Оглавление

1. [Архитектура и философия](#1-архитектура-и-философия)
2. [Карта модулей и порядок загрузки](#2-карта-модулей-и-порядок-загрузки)
3. [Модель состояния `STATE`](#3-модель-состояния-state)
4. [История изменений `HISTORY`](#4-история-изменений-history)
5. [Конвейер рендеринга SVG](#5-конвейер-рендеринга-svg)
6. [Координаты, трансформации и LOD](#6-координаты-трансформации-и-lod)
7. [Математические утилиты](#7-математические-утилиты)
8. [Пучки линий: полный алгоритм](#8-пучки-линий-полный-алгоритм)
9. [Геометрия станций](#9-геометрия-станций)
10. [Терминалы: генерация и раскладка](#10-терминалы-генерация-и-раскладка)
11. [Система ввода](#11-система-ввода)
12. [Инструменты (`tools`) и конечные автоматы](#12-инструменты-tools-и-конечные-автоматы)
13. [Выделение и панели свойств](#13-выделение-и-панели-свойств)
14. [Контекстное меню](#14-контекстное-меню)
15. [Экспорт](#15-экспорт)
16. [Share / Read-Only](#16-share--read-only)
17. [I18N — локализация](#17-i18n--локализация)
18. [DBG — консоль отладки](#18-dbg--консоль-отладки)
19. [Публичный API `MURSchemeAPI`](#19-публичный-api-murschemeapi)
20. [Рецепты расширения](#20-рецепты-расширения)
21. [Производительность и LOD](#21-производительность-и-lod)
22. [Известные особенности и подводные камни](#22-известные-особенности-и-подводные-камни)
23. [Справочник DOM-идентификаторов](#23-справочник-dom-идентификаторов)
24. [Справочник клавиш и жестов](#24-справочник-клавиш-и-жестов)

---

## 1. Архитектура и философия

MURScheme построен как **моно-файл** без сборщика: единственный HTML с inline-CSS и inline-JS. Такой выбор даёт:

- **Ноль зависимостей** — достаточно открыть файл двойным кликом.
- **Простой шаринг** — файл можно переслать по почте, положить на USB, отдать через `#data=`-ссылку.
- **Прозрачный код** — нет source-maps, транспиляции, `node_modules`. Всё читается прямо в браузере.

Ключевые архитектурные принципы:

| Принцип | Реализация |
|---|---|
| **Единое состояние** | Все данные схемы лежат в одном объекте `STATE`. Никаких параллельных подсистем. |
| **Императивный рендер** | Функции `render*()` пересобирают свои SVG-слои с нуля каждый раз (`innerHTML = ''`). Это дорого, но надёжно и просто отлаживается. |
| **Ручный DOM** | Никакого Virtual DOM. Прямая работа с `document.createElementNS` для SVG. |
| **Изоляция модулей через объекты** | `I18N`, `DBG`, `STATE`, `HISTORY`, `SMOOTH_NAV`, `MURSchemeAPI` — всё в глобальной области видимости (file-scope), но связность через общий `STATE`. |
| **Прогрессивное сохранение** | `HISTORY` — снимки `STATE` в JSON (см. §4), `STATE` сериализуется в `.json` через `exportJSON`. |
| **Read-only режим** | Один CSS-класс `body.read-only-mode` полностью выключает инструментарий и панель. |
| **Слои по z-порядку SVG** | Каждый тип объектов живёт в своём `<g>` под `#world-layer` — гарантирует корректный порядок наложения. |

`STATE` — это **единственный источник правды**. Все панели редактирования пишут прямо в `STATE`, а потом вызывают нужный `render*()` и/или `refreshCanvas()`.

---

## 2. Карта модулей и порядок загрузки

Скрипты выполняются строго в порядке объявления. Порядок важен: многие функции используют `const`/`let`, объявленные выше.

```
<body>
  ├── <header> (верхняя панель)
  ├── <div class="workspace">
  │    ├── .toolbar-left (левая панель)
  │    ├── .viewport
  │    │    ├── <svg id="canvas-svg">
  │    │    │    ├── <defs> (markers, filters, паттерны)
  │    │    │    └── <g id="world-layer"> (слои карты)
  │    │    └── .status-bar, #btn-floating-debug, #map-info-overlay
  │    └── .sidebar-right (правая панель — аккордеоны)
  ├── #debug-console-drawer (нижняя консоль)
  └── <script> (единственный большой inline-скрипт)
```

### Модули (в порядке объявления)

| Модуль | Строки (ориентировочно) | Ответственность |
|---|---|---|
| **I18N** | начало | Словари RU/EN, `t()`, `applyToDOM()`, кастомные локали |
| **DBG** | сразу после I18N | Логи с подсветкой, счётчик ошибок, `window.onerror`, перехват Promise |
| **STATE** | модуль 2 | Единый объект данных + `globalStyles`, `terminalsSettings`, `legend` |
| **HISTORY** | там же | `undoStack`, `redoStack`, `createStateSnapshot`, `applyUndo/Redo` |
| **Math utils** | модуль 3 | `screenToWorld`, `snapToGrid`, `snapAngle`, `distToSegmentSquared`, `projectPointOnSegment`, `getOffsetPoints`, `buildSmoothPath`, `buildSmoothClosedPath` |
| **Rendering** | модуль 4 | `renderGrid`, `renderTerrain`, `renderTerrainLabels`, `renderDecorations`, `renderLines`, `renderStations`, `renderTransfers`, `renderTerminals`, `renderLegend`, `renderHandles`, `renderMapInfo`, `renderCanvasFrame`, `refreshCanvas` |
| **Selection/UI** | модуль 5 | `select*`, `renderSidebarLines`, `render*List`, `sync*FormUI`, `toggleAccordion`, `hideAllPropsPanels` |
| **Editing actions** | модуль 6 | `autoPlaceStationsOnActiveLine`, `handleTransferStationClick`, `finishCurrentLine`, `computeSmartCorridorBundles`, `alignSharedCorridorNodes`, `syncCommonBundleNodes`, `syncBundleCorridorPoints`, `sortLinesForBundle`, `applyTerrainBrush`, `floodFillTerrain`, `autoTranslateAllMap` |
| **Export** | модуль 7 | `getExportFraming`, `prepareExportClone`, `exportSvg`, `exportCleanRaster`, `getEmbeddedFontCss` |
| **Event/Init** | модуль 8 | `setTool`, `setupEventListeners`, `init`, контекстное меню, share, smooth-nav, public API |
| **Multi-selection** | после init | `toggleMultiSelectionItem`, `startMultiSelectionDrag`, `updateGroupDrag`, `finishGroupDrag`, `startWholeLineDrag` |
| **Quick UI 2.0** | в конце | `syncLineArrowsAndBadgesModernUI`, `drawInteractiveBadgeNode`, `renderLineManualBadgesListUI`, ghost-preview |

### Глобальные точки входа

- `init()` вызывается в самом конце (синхронно, из `<script>`).
- `window.addEventListener('DOMContentLoaded', ...)` — для привязки кнопок включения стрелок/номеров (перехватывает уже существующие узлы после `init`).
- `checkReadOnlyUrl()` и `window.__MURSCHEME_PRELOADED__` — режимы шаринга.

---

## 3. Модель состояния `STATE`

Центральный объект. Полная схема с типами и ролями полей:

```js
STATE = {
  // --- Настройки отображения ---
  gridStep: 24,          // шаг сетки в px; используется в snapToGrid и ptKey
  angleSnap: 45,         // 0 | 15 | 30 | 45 | 60 | 75 | 90 — фиксация угла при трассировке
  smoothCurve: true,     // вкл/выкл сглаживание (buildSmoothPath)
  syncFontSize: true,    // синхр. размер шрифта подписей с толщиной линии
  currentTool: 'select', // см. §12
  pinnedSections: ['acc-sec-selected'], // закреплённые аккордеоны

  // --- Панорамирование и зум ---
  zoom: 1, panX: 400, panY: 250,   // affine на #world-layer
  lodLevel: 3,                     // 1..5, вычисляется в refreshCanvas()

  // --- Заголовок и рамка холста ---
  mapInfo: { title, attribution, showTitle, showAttribution, titleSize, attributionSize },
  canvasFrame: { enabled, x, y, width, height }, // мировые координаты

  // --- Активные (выбранные) элементы ---
  activeLineId, activeDecorId, selectedStationId, selectedTransferId,
  selectedTerrainLabelId, selectedTariffZoneId, selectedTerminalId,
  arrowFirstNode, badgeFirstNode,   // {lineId, pathIdx, pIdx} — для pick-2-node
  multiSelection: [],               // массив {type: 'station'|'line'|'decor'|'terminal'|'tlabel'|'tariffZone'|'vertex', id, branchIndex?, pointIndex?}

  // --- Глобальные стили ---
  globalStyles: {
    fontFamily: 'Manrope, sans-serif',
    labelAngle: 315, labelColor: '#0f172a', sublabelColor: '#94a3b8',
    fontSize: 12, lineWidth: 6.5,
    shadowMode: 'none',        // none | all | lines | decor
    canvasBg: '#ffffff', canvasOpacity: 100,
    substrateImageUrl: '', substrateOpacity: 0.85,
    substrateX: -1000, substrateY: -1000, substrateWidth: 4000, substrateHeight: 3000,
    labelPos: 'top-right', curveRadius: 18,
    excludeManualStations: true
  },

  // --- Настройки терминалов (глобальные) ---
  terminalsSettings: {
    autoGenerate: true,
    titleText, subtitleText, subtitleColor,
    attach: 'track-exact', offsetDist: 0, offsetSide: 'auto',
    align: 'vertical', badgeStyle: 'square', badgeSize: 9.5,
    borderMode: 'none', borderColor: '#0f172a', borderWidth: 1.8,
    bgMode: 'contrast', bgColor: '#e2e8f0',
    overlapMode: 'replace-station'
  },

  // --- Легенда ---
  legend: {
    show, x, y, title, subtitle, subtitleColor, template,
    columns, logoType, logoSymbol, logoImageUrl,
    angle, titleFontSize, fontSize, width, autoHeight,
    opacity, bgColor, borderWidth, borderColor, radius,
    notes: [{id, icon, text}]
  },

  // --- Коллекции объектов ---
  lines: [], stations: [], terminals: [], transfers: [], decorations: [],

  // --- Местность и зоны ---
  terrainLayers: [
    { id: 'tlayer-water', name: 'Вода (Акватории)', color: '#a3c9e2', visible: true, cells: { 'gx,gy': '#hex' } },
    { id: 'tlayer-green', ... }, { id: 'tlayer-ground', ... }
  ],
  tariffZones: [{ id, name, points, color, opacity, borderColor, borderWidth, borderStyle, visible }],
  activeLayerId, paintMode: 'brush', brushRadius: 2, terrainStyle: 'smooth',
  terrainLabels: [],   // тексты и POI
  usedPalette: [],

  // --- Транзиентные поля (не сохраняются в .json) ---
  isPanning, startPanX, startPanY,
  draggingVertex, draggingStation, draggingTerminal, draggingLegend,
  draggingTerrainLabel, draggingSubstrate, legendDragOffset,
  tempPoints: [], transferSelection: [], forceNewBranch: false,

  // --- Блокировка автотерминалов ---
  deletedAutoKeys: new Set(),  // 'x,y' ключи для удалённых авто-конечных

  // --- Публичный API ---
  apiListeners: [],            // подписчики MURSchemeAPI.onChange
  isReadOnly: false,

  // --- Drag-group (мультивыделение / вся линия) ---
  dragGroup: null,             // см. §13
  _pendingUnselectIdx: null
}
```

### Полные схемы типов объектов

#### `Line`
```js
{
  id, name, subname, i18n: {ru, en}, color, width, opacity, shadow,
  offset,               // глобальное смещение в пучке (в единицах strokeW+gap)
  dashStyle,            // solid | hollow | rail-dashed | rail-ties | double | express | dashed | dotted | cased
  badgeText,            // строка в бейдже-номере маршрута
  points: [{x, y}],     // ствол
  branches: [[{x, y}]], // подветки

  // Стрелки
  arrows: 'none' | 'forward' | 'backward' | 'both' | 'manual',
  arrowSegments: { 'pathIdx:segIdx': 'forward'|'backward'|'both'|'none' },
  arrowStyle: 'triangle' | 'chevron' | 'stealth' | 'white-inner',
  arrowInterval, arrowWidth, arrowHeight, arrowSide, arrowSideOffset,
  manualArrows: [{pathIndex, segIndex, t, dir}],

  // Номера вдоль линии
  showBadgesAlong: Boolean,
  badgesStyle, badgesSide, badgesInterval, badgesOffset, badgesFontSize,
  badgesColorMode: 'line' | 'black' | 'custom', badgesCustomColor,
  badgeSegments: { 'pathIdx:segIdx': Boolean },
  badgesAutoRepeat: Boolean,
  manualBadges: [{pathIndex, segIndex, t, side}],

  // Локальный пучок
  segmentOffsets: { 'pathIdx:segIdx': number },   // в единицах (strokeW+gap)
  segmentBundleSpan: { 'pathIdx:segIdx': number } // половина ширины пучка
}
```

#### `Station`
```js
{
  id, name, subname, i18n: {ru, en}, subcolor,
  x, y,
  style,           // 'metro-tick' | 'metro-tick-rounded' | 'smooth-ladder' | 'cross-tick' |
                   // 'inner-dot' | 'interchange' | 'interchange-borderless' |
                   // 'capsule' | 'capsule-vertical' | 'capsule-neutral' | 'capsule-vertical-neutral' |
                   // 'capsule-vertical-transparent'
  colorMode,       // 'line' | 'stripes' | 'white' | 'black' | 'custom'
  customColor, tickShift,    // 'auto' | 'stagger' | 'opposite'
  labelPos, labelAngle,
  showBadges, badgeShape, badgePos, badgeSize,
  lineIds: [],     // id линий, к которым привязана
  autoLineId,      // если создана авто-расстановкой
  isTerminal, termPrefix, termAlign,
  manualCustomized // true = пользователь менял вручную (не трогать глобальными)
}
```

#### `Terminal`
```js
{
  id, x, y, name, subname, subcolor, lineIds: [],
  isAuto,          // true = сгенерирован, false = ручной
  attach,          // 'track-exact' | 'track-butt' | 'line-end' | 'on-line' | 'offset'
  offsetDist, offsetSide,
  align: 'horizontal' | 'vertical',
  badgeStyle,      // 'default' = наследовать из STATE.terminalsSettings
  badgeSize, borderMode, borderColor, borderWidth,
  bgMode, bgColor, overlapMode,
  tanX, tanY       // направление касательной у конца линии (для ручных)
}
```

#### `Transfer`
```js
{
  id, stationIds: [id1, id2, ...],
  style: 'radial-arc' | 'radial-arc-borderless' | 'radial-arc-walls' | 'radial-arc-neutral' |
         'circle-hub' | 'circle-gradient-borderless' | 'dumbbell' | 'dotted' | 'stadium-capsule',
  curvature: 25,
  // только для dotted:
  dashLength: 5, dashGap: 4, dashWidth: 3.5, dashColor: '#0f172a'
}
```

#### `Decoration`
```js
{
  id, name, subname, i18n,
  type: 'highway' | 'rail' | 'boundary' | 'thin-line',
  color, width, opacity, shadow,
  showLabel, repeatLabel, labelInterval,
  crossingMode: 'bridge' | 'junction',
  labelText, sublabelText, labelColor, labelSize, sublabelColor,
  labelSide: 'center' | 'above' | 'below',
  sublabelPos: 'above' | 'below' | 'right' | 'left',
  points: [{x, y}]
}
```

#### `TerrainLabel` (текст)
```js
{
  id, isPoi: false,
  text, subtext, subcolor,
  x, y, angle, color, size, lineHeight, spacing,
  anchor: 'start' | 'middle' | 'end',
  baseline: 'auto' | 'middle' | 'hanging' | 'alphabetic',
  fontFamily, bold, italic, outlineWidth, outlineColor
}
```

#### `PoiObject` (POI / иконка)
```js
{
  id, isPoi: true,
  poiType: 'image' | 'emoji' | 'pin',
  text,           // символ эмодзи
  imageUrl,       // data:URI картинки
  label, sublabel, labelPos, labelSize, labelColor, sublabelColor,
  x, y, angle, color, size, opacity
}
```

### Сериализация

- `createStateSnapshot()` сохраняет в историю **только** подмножество полей: `lines`, `stations`, `terminals`, `terminalsSettings`, `transfers`, `decorations`, `terrainLayers`, `tariffZones`, `terrainLabels`, `legend`, `globalStyles`, `palette`.
- `exportJSON()` сериализует **весь** `STATE` (включая `multiSelection` и пр.), кроме `deletedAutoKeys`, которое приводится к массиву.
- `downloadStandaloneShare()` вычищает транзиентные поля из сохранения (см. список в коде).
- При загрузке `.json` (в `file-input-project` или `MURSchemeAPI.loadJSON`) применяется **слияние** с дефолтами: `terminalsSettings = { ...STATE.terminalsSettings, ...parsed.terminalsSettings }`. Это защищает от старых версий.

---

## 4. История изменений `HISTORY`

```js
HISTORY = { undoStack: [], redoStack: [] };
```

- **Снимок** — строка JSON (`createStateSnapshot()`).
- **Лимит** — 40 последних (старые вытесняются `shift()`).
- **Redo** — очищается при любом `pushHistory()`.
- Восстановление: `Object.assign(STATE, parsed)`, затем `syncLegendFormUI()`, `syncTerminalsFormUI()`, `refreshCanvas()`.

### Когда нужен `pushHistory()`

**Перед любым изменением `STATE`**, которое пользователь может захотеть откатить. Правило простое:

- **Изменения из UI-полей** — `input`/`change` **не** пишут `pushHistory()` на каждом keystroke (иначе стек переполнится). Вместо этого:
  - Текст/цвет/размер — без `pushHistory()` на каждое изменение (или только на `change`, не `input`).
  - Изменения структуры (создание/удаление/перетаскивание) — всегда `pushHistory()` **один раз** в начале операции (в `mousedown`).
- `mousedown` по объекту — `pushHistory()` перед первым изменением, `mousemove` — уже без.
- После отпускания (в `mouseup`) — история не пишется, изменения уже в буфере.

Пример неверного подхода:
```js
bind('prop-line-color', 'input', e => {
  pushHistory();          // ❌ переполнит стек на каждом движении мыши
  line.color = e.target.value;
});
```

Правильно:
```js
bind('prop-line-color', 'input', e => { line.color = e.target.value; renderLines(); });
bind('prop-line-color', 'change', () => pushHistory()); // только при отпускании
```
или `pushHistory()` в `mousedown` перед началом интерактивной правки.

---

## 5. Конвейер рендеринга SVG

### Структура SVG-слоёв

```
#canvas-svg
├── <defs id="svg-defs">
│    ├── markers (arrow-head, arrow-head-color)
│    ├── <style id="svg-font-style">  (обновляется из globalStyles.fontFamily)
│    ├── filter#smooth-metaball        (для местности)
│    ├── filter#line-dropshadow        (для теней)
│    └── динамические: <pattern>, <mask>, <linearGradient> — создаются по требованию
└── <g id="world-layer" transform="translate(panX panY) scale(zoom)">
     ├── <rect id="canvas-substrate-rect">   (фон)
     ├── <image id="canvas-substrate-image"> (подложка, если задана)
     ├── <g id="grid-layer">                 (бесконечная сетка через pattern)
     ├── <g id="terrain-container-layer">    (клетки и тарифные зоны)
     ├── <g id="terrain-labels-layer">       (тексты и POI местности)
     ├── <g id="decorations-layer">          (ЖД/дороги)
     ├── <g id="lines-layer">                (линии ОТ)
     ├── <g id="transfers-layer">            (пересадочные дуги)
     ├── <g id="stations-layer">             (засечки)
     ├── <g id="terminals-layer">            (конечные)
     ├── <g id="labels-layer">               (подписи станций)
     ├── <g id="line-handles-layer">         (ноды/ручки)
     ├── <g id="legend-layer">               (карточка легенды)
     └── <g id="temp-layer">                 (превью трассировки, ghost)
```

**Порядок в DOM = порядок отрисовки** (SVG рисует слои снизу вверх). Поэтому:
- местность — под линиями (можно накрыть тонкие линии, если так задумано);
- пересадки — **под** линиями и станциями (чтобы стыки были аккуратными);
- станции — поверх линий;
- подписи — поверх всего, кроме ручек;
- ручки — сверху, чтобы их можно было тащить;
- легенда и temp — в самом верху.

### `refreshCanvas()` — полный перерендер

```js
function refreshCanvas() {
  const lod = STATE.zoom < 0.35 ? 1
            : STATE.zoom < 0.6  ? 2
            : STATE.zoom < 1.2  ? 3
            : STATE.zoom < 2.5  ? 4
            : 5;
  STATE.lodLevel = lod;

  updateSubstrate();          // фон и подложка
  renderGrid();
  renderTerrain();            // клетки + тарифные зоны
  renderTerrainLabels();      // тексты + POI
  renderDecorations();
  renderTransfers();
  renderLines();
  if (STATE.terminalsSettings.autoGenerate) generateAutoTerminals();
  renderStations();
  renderTerminals();
  renderTerminalsList();
  renderHandles();
  renderLegend();
  renderMapInfo();
  renderCanvasFrame();
  // … обновление всех списков UI в правой панели
  I18N.applyToDOM();
}
```

**Дёргайте `refreshCanvas()` только при необходимости полного перерендера.** В интерактивных сценариях (перетаскивание вершины, изменение цвета) вызывайте точечные `renderLines()` / `renderStations()` / `renderTerminals()` — это сильно быстрее.

### Как устроены hitbox'ы

Каждая линия и декоративный путь имеет **невидимый хитбокс** — копию геометрии со `stroke-width` 20–24px и `stroke: transparent`, но `pointer-events: stroke`. Это позволяет кликать по тонкой линии мышью.

```js
hitbox.setAttribute('class', 'map-line-hitbox');
hitbox.setAttribute('stroke', 'transparent');
hitbox.setAttribute('stroke-width', '20');
hitbox.style.pointerEvents = 'stroke';
```

В режиме `select` hitbox ловит `mousedown`, `mousemove`; для станций — отдельный `circle` c `fill: transparent` и `pointer-events: all`.

### `.selected-halo`

CSS-класс, добавляемый к группам выделенных элементов:

```css
.selected-halo {
  filter: drop-shadow(0 0 6px #0088ff) drop-shadow(0 0 2px #38bdf8);
}
```
Работает через SVG `filter`, не ломает геометрию. Добавляется в `renderLines/renderStations/renderTransfers/...` при совпадении `STATE.selected*Id`.

### Где что перерисовывается

| Действие | Нужно вызвать |
|---|---|
| Поменяли цвет линии | `renderLines(); renderSidebarLines(); renderLegend(); renderTerminals(); renderStations();` |
| Перетащили вершину линии | `renderLines(); renderHandles(); renderStations(); renderTransfers(); renderTerminals();` |
| Поменяли шаг сетки | `renderGrid(); renderTerrain();` (клетки привязаны к `STATE.gridStep`) |
| Поменяли шрифт схемы | `applyGlobalsLive()` (обновляет `<style id="svg-font-style">`, затем `refreshCanvas()`) |
| Включили/выключили тени | `refreshCanvas()` |
| Сменили LOD (зум) | Само в `refreshCanvas()` — пересчитывает `STATE.lodLevel` |

---

## 6. Координаты, трансформации и LOD

### Мировые vs экранные координаты

Мир — это виртуальный холст с неограниченными координатами. Экран — то, что видит пользователь.

```js
function screenToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - STATE.panX) / STATE.zoom,
    y: (clientY - rect.top  - STATE.panY) / STATE.zoom
  };
}
```
Обратное преобразование — `applyTransform()`:
```js
worldLayer.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoom})`);
```

**Важно**: `worldLayer` живёт в экранных координатах `#canvas-svg`. Но все объекты внутри — в мировых. Никакой объект не должен содержать `state.panX/panY/zoom` — они накладываются сверху.

### Привязка к сетке

```js
function snapToGrid(val) {
  return Math.round(val / STATE.gridStep) * STATE.gridStep;
}
```

Все основные операции (создание станции, вершин линии, перетаскивание) применяют `snapToGrid`.

### `snapAngle` — фиксация угла

При трассировке, если `STATE.angleSnap > 0`, следующая точка выравнивается по ближайшему углу, кратному `angleSnap`. Для 45°/90° используется **шаг по целым клеткам сетки** (чтобы не появлялись «дробные» координаты):

```js
if (angleStep % 45 === 0) {
  const steps = Math.max(1, Math.round(Math.max(|dx|,|dy|) / STATE.gridStep));
  return {
    x: x1 + Math.round(cos(rad)) * steps * STATE.gridStep,
    y: y1 + Math.round(sin(rad)) * steps * STATE.gridStep
  };
}
```
Для 15°/30°/75° — через `l = round(dist / gridStep) * gridStep`.

### LOD (Level of Detail)

Определяется в `refreshCanvas()` по `STATE.zoom`. Ниже — что отключается на каждом уровне:

| LOD | zoom | Отключено / упрощено |
|---|---|---|
| 1 | < 0.35 | Терминалы, станции → точки, пересадки, легенда (если не `alwaysVisible`), подписи местности |
| 2 | < 0.6 | Подписи местности, частично декор. Слои упрощены |
| 3 | < 1.2 | Стандартный режим |
| 4 | < 2.5 | Полный |
| 5 | ≥ 2.5 | Полный + возможные hover-эффекты |

Проверки в коде: `if (STATE.lodLevel <= 2) return;`, `if (STATE.lodLevel <= 1) { /* только точка */ }`.

---

## 7. Математические утилиты

### `distToSegmentSquared(p, v, w)`
Квадрат расстояния от `p` до отрезка `v-w` (проекция + clamp).

### `projectPointOnSegment(p, v, w)`
Возвращает `{x, y, t}`, где `t ∈ [0, 1]` — параметр проекции.

### `getSegmentsIntersection(A, B, C, D)`
Пересечение двух отрезков. Возвращает `{x, y}` или `null`. Используется для создания бесшовных перекрёстков.

### `isPointInsidePolygon(pt, poly)`
Ray-casting. Нужен для `isLineTrueTerminalPoint` — определение «крупного оборота».

### `computeBestCircle(points)`
Аппроксимация окружности по множеству точек методом наименьших квадратов (Kasa). Если `det ≈ 0` (точки коллинеарны) — возвращает окружность по центру масс с `R = maxDist`.

Используется в `circle-hub` пересадках.

### `sanitizePathPoints(points)`
- Удаляет подряд идущие дубликаты (< 1 px).
- Ищет «замыкание» (последняя точка близка к первой) и переворачивает ветку, чтобы конец был «свободным». Это устраняет артефакт при отрисовке петель в `getOffsetPoints`.

### `escapeHtml(str)`
Мини-эскейп для подстановки в `innerHTML` в `#map-info-overlay`.

---

## 8. Пучки линий: полный алгоритм

Это самая сложная часть. Пучок — когда несколько линий идут параллельно по общему коридору и должны быть разнесены на равные смещения.

### 8.1. `getOffsetPoints(points, offsetPixels, line, pathIdx, stepPx)`

Строит **сдвинутую** полилинию для конкретной линии.

**Шаги:**

1. **Очистка дубликатов**: убираются подряд идущие точки с `dist < 0.5 px`. Это критично — иначе нормали после поворотов ломаются.

2. **Для каждого сегмента** считается:
   - `len`, `ux/uy` (единичное направление), `nx/ny` (нормаль, `-uy/ux`).
   - `offPx` — из `line.segmentOffsets[pathIdx:origSegIdx]` если задано, иначе `line.offset * unit`.
   - `spanPx` — из `line.segmentBundleSpan` (половина ширины пучка), нужно для концентрических радиусов.

3. **Первая и последняя точки** — просто `p + normal * offPx` (без скруглений).

4. **Внутренние узлы**:
   - Если два сегмента коллинеарны (`|cross| < 0.04 && dot > 0`):
     - Если смещения совпадают — одна точка.
     - Если смещения разные — «джог» (ступенька) длиной `jog = min(len1, len2) * 0.35`, чтобы переход между полосами был плавным, а сами прямые прогоны оставались идеально параллельными.
   - Если разворот на 180° (`dot <= 0`) — точка простая (смещение по первой нормали).
   - Иначе — **аналитическое пересечение двух смещённых лучей**:
     ```
     t1 = (dpx * s2.uy - dpy * s2.ux) / cross
     где dpx = s2.offPx*s2.nx - s1.offPx*s1.nx, dpy аналогично.
     ```
     Ограничение `|t1| <= min(len1, len2) * 0.85` — для экстремально острых «шпилек» (иначе точка улетает).

5. Каждая точка получает метаданные:
   - `_effOffsetPx` — итоговое смещение для этой вершины;
   - `_bundleSpanPx` — ширина пучка в этой точке;
   - `_origL1`, `_origL2` — длины прилегающих исходных сегментов (нужны `buildSmoothPath`).

**Зачем нужны `_origL*`**: `buildSmoothPath` ограничивает касательные поворота, чтобы дуги не «съедали» слишком много длины сегмента при больших пучках.

### 8.2. `buildSmoothPath(points, radius, lineOffset)`

Строит SVG-path со скруглениями. **Ключевая инновация** — концентрические дуги для пучков:

```js
// Для каждой внутренней точки:
const turnSign = Math.sign(cross); // +1: по часовой, -1: против
const effOffset = pCurr._effOffsetPx || lineOffset;
const bundleSpan = pCurr._bundleSpanPx || Math.abs(effOffset);

// Базовый радиус центра пучка расширяется под толщину пучка:
let baseR = Math.max(radius, bundleSpan + 4);
baseR = Math.min(baseR, maxCenterTangent / tanHalf);

// Концентрический радиус конкретной линии:
let rLine = Math.max(2.5, baseR - turnSign * effOffset);
let tDist = rLine * tanHalf;   // длина касательной
```

Далее в path добавляется команда `A` (эллиптическая дуга) с `rLine`:
```js
d += ` L ${sX} ${sY} A ${rLine} ${rLine} 0 0 ${sweepFlag} ${eX} ${eY}`;
```

**Почему `A`, а не `Q`?** Кубическая/квадратичная кривая не даёт идеально равного зазора между дугами при пучке. Окружность — даёт: радиусы линий отличаются ровно на `effOffset`, значит зазор между дугами постоянный по всей длине поворота.

**Ограничения:**
- Если `|cross| < 1e-3` или `dot ≤ -0.999` — просто `L` (без скругления).
- Касательные ограничиваются `0.46 * min(len1, len2)` — чтобы не «съесть» весь сегмент и не спровоцировать самопересечение.
- Если `tDist > maxLocalTangent` — уменьшается `rLine` (не `tDist`), чтобы дуга осталась круговой.

### 8.3. `computeSmartCorridorBundles(targetLines, alignNodesFirst)`

**Цель**: для каждой линии посчитать `segmentOffsets[pathIdx:segIdx]` — на сколько сдвинуть каждый сегмент, чтобы линии встали параллельно с равным зазором, и не «перевернулись» на поворотах.

**Алгоритм:**

1. **Сортировка** всех линий по текущему режиму (`bundle-sort-select`): `number`, `alpha`, `spectrum`, `stations`. Получаем `rankMap: lineId → idx`.

2. (Опционально) `alignSharedCorridorNodes(targetLines)` — притягивает близкие вершины разных линий к общим координатам (см. §8.4).

3. **Группировка сегментов по «ребру»**: ключ `ptKey(p) = round(p.x/4)*4, round(p.y/4)*4`. То есть координаты квантуются до 4px. Если сегменты двух линий лежат на одном ребре — они попадают в одну группу `edgeMap`.

4. **Для каждой группы `usages`** (сегменты, лежащие на одном ребре):
   - Дедуп по `line.id` (некоторые линии могут дважды пересечь то же ребро).
   - Если `K ≤ 1` — offset = 0, span = 0.
   - Иначе — определяем **эталонное направление** по первой линии (`ref = uniqueUsages[0]` после сортировки по `rankMap`). Нормаль `refN` — от неё.
   - Для каждой линии считаем `sideBias`:
     - Если у сегмента есть вход (`segIdx > 0`) — проекция предыдущего направления на `refN`. Если линия пришла слева — ей «выгоднее» левый слот.
     - Если есть выход — аналогично.
     - `sideBias` умножается на `dirSign` (`+1/-1`, если линия нарисована в обратном направлении).
   - `sortScore = rank * 0.15 + sideBias`. Сортируем по `sortScore` — так на развилках линии получают «правильные» слоты.
   - **Назначаем смещения**:
     ```js
     const halfSpan = (K - 1) / 2;
     uniqueUsages.forEach((u, idx) => {
       const canonicalSlot = idx - halfSpan;
       const localOffset = canonicalSlot * u._dirSign; // инверсия при встречном направлении
       u.line.segmentOffsets[`${u.pathIdx}:${u.segIdx}`] = localOffset;
       u.line.segmentBundleSpan[`${u.pathIdx}:${u.segIdx}`] = halfSpan;
     });
     ```

**Ключевая деталь**: `_dirSign` — если линия нарисована «против» эталонного направления ребра, её слот зеркалится. Это предотвращает «перехлёст» линий на развилках.

### 8.4. `alignSharedCorridorNodes(targetLines)`

**Цель**: сделать так, чтобы близкие вершины разных линий стали **одной** точкой (иначе они не попадут в один `edgeMap`).

**Шаги:**

1. **Кластеризация вершин**: собираем все вершины всех линий. Для каждой — ищем существующий кластер в пределах `snapTol = max(8, gridStep * 0.65)`. Если нет — создаём. Каждая вершина получает **округлённые** координаты кластера.

2. **Вставка «промежуточных» вершин**: если вершина одной линии лежит **внутри** прямого сегмента другой линии, добавляем её как новую вершину второй линии. Это нужно, чтобы после развилки линии корректно «разошлись» в общий коридор. Точка вставляется, если `0.06 < t < 0.94` (не слишком близко к концам).

### 8.5. `syncCommonBundleNodes()` / `syncBundleCommonNodes()`

Обёртка вокруг `computeSmartCorridorBundles` с проверкой, что выбрано ≥ 2 линии. Работают одинаково (алиасы).

### 8.6. `autoDistributeBundles()`

Кнопка «Сформировать пучки автоматически».

- Если `bundle-shared-nodes-only` включён (по умолчанию) — вызывает `computeSmartCorridorBundles(STATE.lines, true)`.
- Если выключен — **глобальный** режим: просто `line.offset = idx - (N-1)/2` для всех линий (пучок по всей длине).

### 8.7. `syncBundleCorridorPoints()`

Притягивает вершины «ведомых» линий к ближайшему сегменту «главной» (первой в списке или самой длинной). Работает **только** в пределах `corridorMaxDist = gridStep * 1.5` — далёкие вершины не трогаются (защита от «макаронной пасты»).

Есть также альтернативная реализация с плотностью (`bundle-sync-density`, 1–10 точек) — она интерполирует вершины ведомых линий по главной. Используется реже.

### 8.8. `sortLinesForBundle` и `resortLinesByCurrentMode`

`sortLinesForBundle` — **не мутирует**, возвращает копию. Используется в алгоритме пучкования.

`resortLinesByCurrentMode` — **мутирует** `STATE.lines` (сортирует по текущему режиму). Вызывается, когда пользователь меняет `bundle-sort-select` или по завершении редактирования `prop-line-badge` (change).

---

## 9. Геометрия станций

### `getStationVisualGeometry(st)`

Возвращает всё, что нужно для отрисовки засечки и подписи станции:

```js
{
  posX, posY,           // позиция центра засечки (с учётом направления)
  projX, projY,         // проекция на осевую линию
  ux, uy,               // единичный вектор вдоль линии
  dirX, dirY,           // направление «наружу» (к стороне подписи)
  strokeW, maxStrokeW,  // толщина линии / макс. толщина в пучке
  gap,                  // межпутевой зазор
  associatedLines,      // линии, проходящие через станцию
  primaryLine,          // ближайшая / первая
  lineDetails,          // [{line, cX, cY, distDir, sW}] — по каждой линии
  farEdge, nearEdge,    // границы пучка относительно proj
  bundleCenterDist,
  effectiveLabelPos,
  capW, capH            // размеры капсулы, если стиль capsule
}
```

**Алгоритм:**

1. `getLinesAtStation(st)` — линии, проходящие через станцию. Если `st.lineIds` заданы вручную — используются они; иначе — по расстоянию до сегментов (порог `gridStep * 1.5`).

2. Для каждой линии ищется **ближайший сегмент** (`projectPointOnSegment`). Запоминается `ux/uy` и нормаль. Промежуточный `projX/projY` — точка проекции на первую (primary) линию.

3. **Направление тика** (`dirX/dirY`): изначально — нормаль. Если скалярное произведение с направлением на подпись (`lvx/lvy` из `labelPos`) отрицательно, нормаль инвертируется. При `tickShift === 'opposite'` — ещё раз инвертируется.

4. Для каждой линии в пучке вычисляется:
   - `offUnit = getLineSegmentOffsetUnit(al, bestPathIdx, bestSegIdx)` — посегментное смещение из пучка;
   - `alOffPx = offUnit * (sW + gap)`;
   - `cX/cY` — точка на этой линии.

5. `lineDetails` сортируются по `distDir` (проекция на `dir`). Это нужно для:
   - раскраски «полосами» (`colorMode: 'stripes'`);
   - корректной геометрии `metro-tick` в пучке (сегменты засечки распределяются между линиями);
   - центрирования подписи.

6. `farEdge/nearEdge` — границы пучка: `min(d)-sW/2` и `max(d)+sW/2`. От них зависит длина засечки и `bundleSpan`.

### `getLinesAtStation(st)`

Определяет, какие линии проходят через станцию. Приоритеты:

1. Если `st.lineIds` заданы и `!STATE.draggingStation` — используются только они (это ручная привязка пользователя).
2. Иначе — по расстоянию до ближайшего сегмента каждой линии. Порог `gridStep * 1.5`.
3. Если ничего не найдено — возвращается первая линия схемы (fallback).

Побочный эффект: **мутирует** `st.lineIds` (кэширует найденные).

### `isStationAtLineEnd(st)`

Станция считается концевой, если она в пределах `gridStep * 1.3` от начала или конца **любой** линии, и при этом `isLineTrueTerminalPoint(line, endpoint) === true`.

### `renderStations()`

Для каждой станции:
1. `LOD 1` — просто точка.
2. Если совпадает с терминалом в режиме `replace-station` — пропуск (терминал рисует себя сам).
3. `getStationVisualGeometry(st)` — все вычисления.
4. Отрисовка засечки по `style` (см. `metro-tick`, `interchange`, `capsule`, …).
5. `hitGroupListeners(stGroup, st)` — привязка `mousedown`.
6. `renderStationLabel(st, geo, ...)` — подпись.

### `renderStationLabel`

Учитывает:
- `effectiveLabelPos` (top/bottom/left/right + углы);
- угол поворота (`labelAngle`);
- «Убегание» подписи от терминала (если на конце есть терминал);
- `showBadges` — маленькие цветные бейджи маршрутов у подписи;
- `fontSize` с синхронизацией по толщине линии (`syncFontSize`).

Угол подписи используется через `rotate(angle)` на группе — так подпись «наклоняется» целиком.

---

## 10. Терминалы: генерация и раскладка

### 10.1. `generateAutoTerminals()`

Вызывается в `refreshCanvas()` при `STATE.terminalsSettings.autoGenerate === true`.

**Шаги:**

1. Для каждой линии, для каждого пути (ствол + ветки), для каждого **конца**:
   - `isLineTrueTerminalPoint(line, endpoint)` — проверка, что это «настоящий» свободный конец, а не стык с другой веткой или петля.
   - Дедуп по ключу `snapToGrid(x),snapToGrid(y)` — одна конечная на все совпадающие концы.
2. Для каждой точки — создание/обновление `term` в `STATE.terminals`:
   - `isAuto: true`;
   - `lineIds` — все линии, у которых здесь конец;
   - `align`, `badgeStyle` — из `terminalsSettings` по умолчанию.
3. Удаление «осиротевших» авто-терминалов (если линия удалена или её конец больше не концевой).
4. `STATE.deletedAutoKeys` — Set с ключами `"x,y"` удалённых **пользователем** автотерминалов. Они не пересоздаются, пока не будет вызван `btn-sync-terminals` (сброс Set) или пока не включат/выключат `term-auto-generate` (тоже сброс).

### 10.2. `isLineTrueTerminalPoint(line, pt)`

Определяет, «настоящий» ли конец. Возвращает `false`, если:

1. Конец **примыкает** к другому сегменту этой же линии (кроме своих крайних). Это стык веток в ствол, не терминал.
2. Конец **близко к своему телу** (порог `gridStep * 1.6`) — «крупный оборот» / петля.
3. Конец **внутри полигона** собственной линии (`path.length >= 5`) — визуально «в петле».

В этих случаях терминал не создаётся — иначе на схеме появлялись бы «конечные» посередине.

### 10.3. `renderTerminals()`

Каждый терминал рендерится через `renderGroup(termData, isManual, termId)`:

- **Настройки** (attach, offset, align, badgeStyle, badgeSize, border, bg, overlapMode) сливаются из `termData` (локальные) и `STATE.terminalsSettings` (глобальные). Локальные приоритетнее.
- **Привязка** (`attach`):
  - `track-exact` — бейджи прямо на рельсах, выровнены по нормали;
  - `track-butt` — в торце рельсов, с отступом;
  - `line-end` — в торце пучка (по касательной);
  - `on-line` — в точке терминала;
  - `offset` — с отступом в сторону `offsetSide`.
- **Раскладка** бейджей:
  - `horizontal` — в ряд;
  - `vertical` — в столбик;
  - `stacked` — слитно (без зазоров).
- **Стили**: `circle`, `square`, `rect`, `metro-capsule`, `teardrop`, `teardrop-hollow`, `arrow`, `arrow-reverse`, `loop`, `arrow-circle`.
- **Border**: `none` / `black` / `custom`.
- **Background**: `none` / `darker` / `contrast` / `custom`.
- **overlapMode** (если рядом есть станция):
  - `badges-only` — только бейджи, без подписи;
  - `both` — бейджи + засечка станции;
  - `hide-terminal` — терминал не рисуется;
  - `replace-station` — терминал заменяет засечку станции.

Если `isAuto` — имя наследуется от ближайшей станции или от линии (`getTerminalAutoName`).

### 10.4. Ручные терминалы

Создаются через `setTool('terminal-manual')` + клик или кнопку `+ Терминал`. Имеют `isAuto: false`, полностью подконтрольны пользователю. Для ручных `attach: 'track-exact'` **тоже** работает (см. `renderGroup`: `if (!isManual && ...)` — но дальше отдельная ветка для `getLineEndpointInfo` вызывается и для ручных, если `attach === 'track-exact'`).

---

## 11. Система ввода

### 11.1. События мыши на `#viewport`

| Событие | Обработчик | Что делает |
|---|---|---|
| `mousedown` | большой общий обработчик | Разветвляется по `STATE.currentTool` |
| `mousemove` (глобальный) | `window.addEventListener` | Панорамирование, drag-group, draggingVertex, ghost preview |
| `mouseup` (глобальный) | `window.addEventListener` | Сброс всех `dragging*` и `isPanning` |
| `wheel` | внутри `SMOOTH_NAV.init(viewport)` | Плавный зум/скролл |
| `contextmenu` | на `viewport` | Кастомное контекстное меню |
| `touchstart/move/end` | `SMOOTH_NAV.init` | Мобильные жесты |

### 11.2. Панорамирование

Триггеры:
- `ЛКМ` на пустом холсте (`#canvas-svg`, `#canvas-substrate-rect`);
- `СКМ` (`e.button === 1`);
- `Пробел + drag` (в коде: `e.code === 'Space'` — но фактически реализован через `button === 1 || e.code === 'Space'`).

При начале:
```js
STATE.isPanning = true;
STATE.startPanX = e.clientX - STATE.panX;
STATE.startPanY = e.clientY - STATE.panY;
viewport.classList.add('grabbing');
```
В `mousemove`:
```js
STATE.panX = e.clientX - STATE.startPanX;
STATE.panY = e.clientY - STATE.startPanY;
applyTransform();
```

### 11.3. `SMOOTH_NAV` — плавный зум и инерция

Отдельный модуль. Работает по RAF-циклу:

- `targetZoom`, `targetPanX`, `targetPanY` — цели.
- `STATE.zoom/panX/panY` — текущие.
- Каждый кадр: `STATE.X += (target - STATE.X) * 0.34`.
- Останавливается, когда разница < порога.
- Для тач-свайпа: `velX/velY` затухают с `friction = 0.91`.

**Колёсико мыши**:
```js
const delta = e.deltaMode === 1 ? e.deltaY * 28 : e.deltaY;
const speed = e.ctrlKey ? 0.0045 : 0.0022;
const zoomFactor = Math.exp(-delta * speed);
this.zoomAroundScreenPoint(zoomFactor, e.clientX, e.clientY);
```
`zoomAroundScreenPoint` масштабирует `targetPan` так, чтобы точка под курсором оставалась на месте:
```js
this.targetPanX = sx - (sx - this.targetPanX) * actualFactor;
this.targetPanY = sy - (sy - this.targetPanY) * actualFactor;
```

**Тач**:
- 1 палец — панорамирование + инерция;
- 2 пальца — pinch-to-zoom + одновременное смещение;
- `touchAction: none` на `viewport` блокирует нативный скролл браузера.

### 11.4. Drag-group (мультивыделение)

При `Shift + ЛКМ` по объекту вызывается `toggleMultiSelectionItem`. При `mousedown` на объекте, который уже в мультивыделении, или после Shift-клика — `startMultiSelectionDrag`, затем `mousemove` → `updateGroupDrag`, `mouseup` → `finishGroupDrag`.

Внутри `STATE.dragGroup`:
```js
{
  mode: 'multi' | 'whole-line',
  startX, startY,           // снапнутые стартовые координаты
  moved: Boolean,
  stations: [{ st, origX, origY }],
  points: [{ pt, origX, origY }],   // ссылки на объекты {x,y} внутри линий/декораций
  terminals: [{ term, origX, origY }],
  tlabels: [{ tl, origX, origY }]
}
```

`updateGroupDrag` пересчитывает `dx/dy` от `startX/startY` и применяет ко всем `origX/origY`. Это даёт **относительное** смещение без накопления ошибки.

**Особенность**: если `moved === false` и был `_pendingUnselectIdx` (пользователь хотел снять выделение повторным Shift-кликом без перемещения) — элемент удаляется из `multiSelection` в `finishGroupDrag`.

### 11.5. `startWholeLineDrag` — Ctrl+ЛКМ

Позволяет перетащить **всю линию** со станциями и терминалами. Вызывается при `Ctrl+ЛКМ` на линии, её вершине или станции. Инициализирует `dragGroup.mode = 'whole-line'`. В `finishGroupDrag` при включённом `bundle-shared-nodes-only` вызывает `computeSmartCorridorBundles` — чтобы после перетаскивания обновить раскладку пучков.

### 11.6. Клавиатура

Глобальный `keydown` на `window`. Игнорирует ввод в `INPUT/SELECT/TEXTAREA`. Привязки — см. §24.

### 11.7. Проблемы и нюансы ввода

- Глобальные `mousemove`/`mouseup` для `dragGroup` используют `capture: true` (`stopImmediatePropagation`), чтобы перехватить события до других обработчиков. Это **важно** — иначе конкурирующий `mousemove` из `SMOOTH_NAV` или `viewport` может «съесть» обновление.
- Отдельные `addEventListener('mousedown', ..., true)` (capture) — для `line-badge-add` (перехват клика по линии) и `mousemove` на `svg` для ghost preview. Они не конфликтуют, потому что проверяют `STATE.currentTool`.

---

## 12. Инструменты (`tools`) и конечные автоматы

`setTool(name)`:
```js
STATE.currentTool = name;
STATE.transferSelection = [];
document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
document.getElementById(`tool-${name}`)?.classList.add('active');
// сброс tempPoints для не-line/decor инструментов
// открытие нужного аккордеона, установка hint
renderLines(); renderDecorations(); renderHandles(); renderStations(); renderTerminals();
```

| Tool | Поведение |
|---|---|
| `select` | Панорамирование / выбор / перетаскивание |
| `line` | Трассировка ствола/ветки (`STATE.tempPoints`) |
| `station` | Клик = поставить остановку |
| `transfer` | Клик по станции — выбрать первую; по второй — создать связку |
| `decor` | Трассировка декоративного пути |
| `paint` | Кисть/карандаш/заливка/ластик по `#terrain-container-layer` |
| `text` | Клик = создать `TerrainLabel` |
| `poi` | Клик = создать POI |
| `terminal-manual` | Клик = создать ручной терминал |
| `line-arrow-nodes` | Режим выбора 2 нод для построения стрелок между ними |
| `line-arrow-add` | Клик по линии = добавить ручную стрелку |
| `line-badge-nodes` | Режим выбора 2 нод для номеров |
| `line-badge-add` | Клик по линии = добавить ручной номер |

### Завершение трассировки

`finishCurrentLine()`:
1. Если `tempPoints.length >= 2` — создать/дополнить линию или декорацию.
2. `mergePathPoints(existing, newPts, thresh)` — пытается состыковать концы (start↔end, start↔start и т.д.) в пределах `gridStep * 1.2`. Это позволяет рисовать «продолжение» линии кликом в её конец.
3. Если стыковка не удалась — создать новую подветку (для линии) или новый декор-путь.
4. Сбросить `STATE.tempPoints` и `#temp-layer`.

Триггеры завершения:
- `Enter`;
- двойной клик по холсту (в коде — неявно через `dblclick` на некоторых элементах, но основное — Enter);
- конец `mousedown`-серии без движения (нет, не реализовано — только Enter/Esc).

### `Esc` — отмена

Сбрасывает `STATE.tempPoints = []` и `#temp-layer.innerHTML = ''`. Активный инструмент не меняется.

---

## 13. Выделение и панели свойств

### Функции выделения

| Функция | Что делает |
|---|---|
| `selectLine(lineId)` | Открывает `acc-sec-lines`, показывает `#line-props-panel`, заполняет поля, рендерит `renderLineBranchesUI`, `renderLineArrowsUI`, `renderLineBadgesNodesUI` |
| `selectStation(stId)` | `#station-props-panel`, чекбоксы линий, настройки иконок маршрутов |
| `selectTransfer(trId)` | `#transfer-props-panel`, стиль, кривизна, чекбоксы станций |
| `selectDecoration(decId)` | `#decor-props-panel`, тип, подписи, перекрёстки |
| `selectTariffZone(zoneId)` | `#tariff-zone-props-panel` + `renderHandles` для вершин |
| `selectTerrainLabel(id)` / `selectPoiObject(id)` | `#terrain-label-props-panel` / `#poi-props-panel` |
| `selectTerminal(termId)` | `#terminal-props-panel`, локальные настройки |

Все они:
1. Вызывают `updateAccordionLayout(secId)` — раскрывают нужную вкладку и сворачивают остальные незакреплённые.
2. Сбрасывают другие `active*Id` / `selected*Id`.
3. `hideAllPropsPanels()` + показывают нужную.
4. Заполняют поля через `document.getElementById(...).value = ...`.
5. `render*()` для подсветки.

`clearAllSelections()` — сбрасывает всё. Вызывается по клику на пустой холст.

### Принцип «единого окна свойств»

Все панели лежат в `#acc-sec-selected` (первый аккордеон), но с разным `display: none/flex`. Переключение — через `hideAllPropsPanels()` + показать одну. Это позволяет не плодить отдельные аккордеоны на каждый тип.

### `render*List` — списки в сайдбаре

- `renderSidebarLines` — карточки линий.
- `renderStationsList` — с поиском.
- `renderTransfersList` — связки + quick-select.
- `renderDecorList` — декорации.
- `renderTerrainLayersUI` — слои местности (видимость, порядок, удаление).
- `renderTariffZonesUI` — тарифные зоны (видимость, удаление).
- `renderBundleLinesUI` — выбор линий в пучок + кнопки ±.
- `renderLegendLinesReorderUI` — порядок маршрутов в легенде.
- `renderLegendNotesUI` — заметки легенды.
- `renderObjectsListUI` — объекты/POI/тексты.

Все они пересобираются из `STATE` в `refreshCanvas()`.

### `sync*FormUI`

- `syncTerminalsFormUI()` — переносит `STATE.terminalsSettings` в поля формы.
- `syncLegendFormUI()` — то же для `STATE.legend`.
- `syncLineArrowsAndBadgesModernUI(line)` — визуальное состояние кнопок и подвкладок (см. §12).

Вызываются в `init()`, в загрузке проекта, в undo/redo.

---

## 14. Контекстное меню

Реализовано как кастомный `div#ctx-menu`, скрываемый по клику вне.

- `showCtxMenu(x, y, items)` — элементы `{label, action, shortcut?, separator?}`.
- `viewport.addEventListener('contextmenu', ...)` — определяет цель через `closest()`:
  - `.map-station-element` → станция;
  - `.map-line-hitbox` → линия;
  - `.map-transfer-element` → пересадка;
  - `.map-decor-element` → декорация;
  - `.map-terrain-label` → подпись/POI;
  - иначе — «пустой холст» (вставка станции/объекта/текста + сброс вида).

**Действия для линии** включают «🧹 Удалить все ручные стрелки/номера» и «Удалить линию».

---

## 15. Экспорт

### 15.1. `getExportFraming()`

Возвращает:
```js
{ cropX, cropY, cropW, cropH,   // в мировых координатах
  finalW, finalH,               // итоговый размер в px
  aspectChoice, scale }
```

Логика:
- `screen` — размер `#canvas-svg`, crop = (0, 0, viewW, viewH).
- `frame` — если `STATE.canvasFrame.enabled`, возвращает координаты рамки (в мировых).
- `16:9 / 4:3 / 1:1 / 21:9` — подгонка под соотношение, центрирование по экрану.
- `custom` — `prompt` для ввода размера.

### 15.2. `prepareExportClone(framing, embeddedFontCss)`

Клонирует SVG. Удаляет:
- `#line-handles-layer` и `#temp-layer` (пустые);
- `.map-vertex-handle`, `.map-insert-handle`, `.map-line-hitbox` (по селектору);
- все `fill="black"` у `path` (артефакты) — заменяет на `none`.

Добавляет `<style>` с шрифтом и `embeddedFontCss`.

### 15.3. `exportSvg()`

```js
const clone = prepareExportClone(framing);
const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
// скачивание
```

### 15.4. `exportCleanRaster(format)`

```js
await document.fonts.ready;               // ждём шрифты
const embeddedCss = await getEmbeddedFontCss();
const clone = prepareExportClone(framing, embeddedCss);
const svgData = new XMLSerializer().serializeToString(clone);
const img = new Image();
img.onload = () => {
  const canvas = document.createElement('canvas');
  canvas.width = framing.finalW;
  canvas.height = framing.finalH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = STATE.globalStyles.canvasBg;
  ctx.fillRect(0, 0, finalW, finalH);
  ctx.drawImage(img, 0, 0, finalW, finalH);
  canvas.toBlob(blob => { /* скачать */ }, mimeType, 0.95);
};
img.src = URL.createObjectURL(new Blob([svgData]));
```

**Форматы**: PNG (lossless), WEBP, JPG. JXL заявлен в UI, но `canvas.toBlob` для JXL не поддерживается большинством браузеров — фактически сохранится как PNG (или будет ошибка, но в коде **не проверяется**).

### 15.5. `getEmbeddedFontCss()`

Загружает Google Fonts CSS (`family=Manrope:wght@700;800;900&family=Nunito...`), проходит по `url(...)` и **качает каждый woff2**, конвертирует в `data:font/woff2;base64,...`. Результат кэшируется в `cachedFontCssBase64`.

Это позволяет экспортировать схему **без интернета** с корректными шрифтами.

---

## 16. Share / Read-Only

### 16.1. `generateShareLink()`

Спрашивает:
- **ОК** — скачать автономный HTML (`downloadStandaloneShare()`).
- **Отмена** — скопировать онлайн-ссылку (`copyOnlineShareLink()`).

### 16.2. `downloadStandaloneShare()`

1. Берёт `STATE` без транзиентных полей (список в коде), `currentTool = 'select'`, `deletedAutoKeys → Array`.
2. Клонирует `document.documentElement`.
3. **Очищает** динамические слои (`#grid-layer`, `#lines-layer`, ...) — они перерисуются при инициализации.
4. **Удаляет** `linearGradient`, `mask`, `pattern` из `#svg-defs`.
5. Убирает `transform` с `#world-layer`, скрывает подложку.
6. Вставляет `<script>window.__MURSCHEME_PRELOADED__ = {...};</script>` **перед** основным `<script>`.
7. Сохраняет как `MURScheme_view.html`.

### 16.3. `copyOnlineShareLink()`

```js
const jsonStr = JSON.stringify(STATE);
const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
const url = location.origin + location.pathname + '#data=' + encoded;
navigator.clipboard.writeText(url);
```

### 16.4. Загрузка

При старте `init()`:
1. Если `window.__MURSCHEME_PRELOADED__` — берёт его, слияние, `STATE.isReadOnly = true`, `body.classList.add('read-only-mode')`.
2. Иначе — `checkReadOnlyUrl()`: парсит `#data=`, если есть — то же самое.

### 16.5. `body.read-only-mode`

Скрывает `header`, `.toolbar-left`, `.sidebar-right`, `.status-bar`, `#btn-floating-debug`, `#debug-console-drawer`. Растягивает `.workspace` на 100vh. Отключает ручки и хитбоксы станций. Разрешает перетаскивание легенды (`pointer-events: all; cursor: move;`).

---

## 17. I18N — локализация

### 17.1. Структура

```js
I18N = {
  currentLang, fallbackLang: 'en', mapDisplayMode,
  locales: {
    ru: { 'ключ': 'значение', ... },
    en: { 'Линии и маршруты': 'Lines & Routes', ... }
  },
  registerLocale(langCode, dict) { ... },
  t(key, params) { ... },
  applyToDOM() { ... },
  setLanguage(langCode) { ... }
}
```

**Ключи — русские строки** (например, `'Линии и маршруты'`). Для EN — значения — английские переводы. Так достигается:
- Если пользователь не переопределил перевод, `t('Линии и маршруты')` вернёт «Линии и маршруты» при RU и «Lines & Routes» при EN.
- Новый язык подхватывает `en` как fallback, потом `ru` как fallback.

### 17.2. `t(key, params)`

```js
t(key, {n: 3, name: 'X'})
```
- `{}` — плейсхолдеры (`{n}`, `{name}`).
- Сначала ищет в `locales[currentLang]`, потом в `locales[fallbackLang]`, потом в `locales['ru']`, иначе — возвращает сам `key`.

### 17.3. `applyToDOM()`

1. `document.documentElement.lang = currentLang`.
2. `document.title = t('MURScheme — Редактор транспортных схем MURS')`.
3. Все `[data-i18n]` → `textContent = t(...)`.
4. Все `[data-i18n-tooltip]` → `data-tooltip = t(...)`.
5. Все `[placeholder], [title], [data-tooltip]` → переводит через `t()`, сохраняя оригинал в `dataset.origPlaceholder` и т.д.
6. **Автообход текстовых узлов** в `header`, `.sidebar-right`, `.status-bar`, `#btn-floating-debug`, `#debug-console-drawer`:
   - берёт `node.nodeValue.trim()`,
   - переводит через `t()`,
   - заменяет, если перевод отличается.
   Это нужно, чтобы не помечать `data-i18n` каждую мелочь.

### 17.4. Кастомный язык

```html
<input type="file" id="file-input-locale" accept=".json">
```
Загрузка:
```json
{
  "lang": "de",
  "name": "Deutsch",
  "strings": {
    "Линии и маршруты": "Linien und Routen",
    "Остановки и станции": "Haltestellen"
  }
}
```
`I18N.registerLocale(langCode, dict)` + добавление `option` в `<select id="ui-lang-select">` + `setLanguage(langCode)`.

### 17.5. Локализация карты

`getMapElementLabels(obj, mainField, subField)`:
- Если `currentLang === 'ru'` — `{primary: obj[mainField], secondary: obj[subField]}` (плюс `obj.i18n.ru`, если есть).
- Если `currentLang !== 'ru'` — `{primary: obj.i18n[lang] || obj.i18n.en || obj[subField] || t(obj[mainField]), secondary: ...}`.

Применяется в:
- `renderStationLabel` (`getMapElementLabels(st, 'name', 'subname')`);
- `renderTerminals` (`getTerminalAutoName`);
- `renderLegend` (`getMapElementLabels(leg, 'title', 'subtitle')`);
- `renderTerrainLabels` (для POI — `label/subtext/sublabel`);
- `renderDecorations` (`labelText/sublabelText`);
- `renderSidebarLines`, `renderStationsList`, `renderTransfersList`, `renderDecorList`, `renderObjectsListUI`.

### 17.6. Логика `i18n` в объектах

- **Авто-станции** (`autoPlaceStationsOnActiveLine`): `st.i18n = {ru: '1 — Ост. 1', en: '1 — Stop 1'}`.
- **Линии**: `l.i18n[I18N.currentLang] = name` — при смене языка имя линии подхватывается через `getMapElementLabels`.
- **Декорации**: `d.i18n.en = sublabelText` — синхронизируется с `prop-decor-sublabel-text`.
- **Легенда**: `leg.i18n.ru = title`, `leg.i18n.en = subtitle`.

---

## 18. DBG — консоль отладки

### 18.1. Интерфейс

- `#debug-console-drawer` — выезжающая панель снизу.
- Кнопки: тест DOM, дамп STATE, тест рендера, «вызвать ошибку», копировать, очистить, скрыть.
- `#dbg-badge-err` — счётчик ошибок.

### 18.2. Логирование

```js
DBG.log('текст', 'info' | 'warn' | 'err' | 'action' | 'success');
```
- `[время] [тип] текст`;
- для `err` — инкрементит `errorsCount`, открывает консоль;
- сохраняет `row.dataset.origMsg` для перевода при смене языка (`refreshLogsI18N`).

### 18.3. Перехватчики

- `window.onerror` → `DBG.log('...', 'err')`.
- `window.onunhandledrejection` → `DBG.log('Необработанный Promise: ...', 'err')`.
- **Изолированный перехватчик** в `<script>` **до** `init` (в самом начале `<body>`) — на случай синтаксических ошибок парсинга, когда `DBG` ещё не определён. Пишет напрямую в DOM.

### 18.4. `translateLogText` — локализация логов

Множество регэкспов и `t()` для перевода логов на EN:
```js
.replace(/^\[LINE\] Выбрана линия id=(.+)$/, '[LINE] Selected line id=$1')
...
```

---

## 19. Публичный API `MURSchemeAPI`

Доступен как `window.MURSchemeAPI` после `init()`.

```js
MURSchemeAPI = {
  version: '1.0.0',

  loadJSON(jsonString) { /* ... */ return { ok: true } | { ok: false, error } },
  exportJSON() { /* ... */ return JSON string },
  exportSVGString() { /* ... */ return SVG string },
  clear(),
  addLine({ name, color, points, badgeText }) { /* ... */ return lineId },
  addStation({ name, x, y, lineIds }) { /* ... */ return stId },
  onChange(callback),
  _emit(event, payload)    // внутренний
}
```

- `loadJSON` / `exportJSON` — сериализация `STATE` (с совместимостью со старыми файлами).
- `exportSVGString` — клон SVG (как в экспорте).
- `addLine` / `addStation` — программное создание.
- `onChange` — подписка на события; `_emit` вызывается внутри `addLine`, `addStation`, `clear`, `loadJSON`. Не вызывается автоматически на любое изменение — это ответственность кода, который мутирует `STATE`.

**Пример использования из консоли**:
```js
MURSchemeAPI.onChange(e => console.log(e.event, e.payload));
const id = MURSchemeAPI.addLine({ name: 'Экспресс', color: '#ED1B24', points: [{x:0,y:0},{x:100,y:0}] });
MURSchemeAPI.addStation({ name: 'Центр', x: 50, y: 0, lineIds: [id] });
```

---

## 20. Рецепты расширения

### 20.1. Новый инструмент

1. Добавить кнопку в `.toolbar-left`:
   ```html
   <button class="tool-btn" id="tool-my" data-tooltip="Мой инструмент">🎯</button>
   ```
2. В `setupEventListeners`:
   ```js
   bind('tool-my', 'click', () => setTool('my'));
   ```
3. В `setTool` — добавить ветку для `tool === 'my'` (hint, открытие нужной панели).
4. В `viewport.mousedown` — ветку `if (STATE.currentTool === 'my') { ... }`.
5. Если нужна визуальная обратная связь — использовать `#temp-layer` (временные элементы) или добавить свой `<g>` слой.

### 20.2. Новый слой SVG

1. В `#world-layer` добавить:
   ```html
   <g id="my-layer"></g>
   ```
2. Получить ссылку:
   ```js
   const myLayer = document.getElementById('my-layer');
   ```
3. Написать `renderMyLayer()`, добавить вызов в `refreshCanvas()` в нужное место по z-порядку.
4. Слой должен очищаться (`myLayer.innerHTML = ''`) в начале своей функции.

### 20.3. Новый стиль линии

В `renderLines()`, в блоке `if (style === 'hollow') { ... } else if (style === 'rail-dashed') { ... }` — добавить ветку:
```js
} else if (style === 'my-style') {
  g.appendChild(makePath(strokeW + 2, '#000'));         // кайма
  g.appendChild(makePath(strokeW, col, '10,6', 'butt')); // штрих
}
```
Также добавить `<option value="my-style">` в `#prop-line-style`.

### 20.4. Новый тип объекта

1. Добавить в `STATE` поле-массив (например, `STATE.myObjects = []`).
2. Добавить в `createStateSnapshot()` (для истории).
3. Добавить в `exportJSON()` / `loadJSON` (с сохранением и слиянием).
4. Создать `renderMyObjects()` и вызвать в `refreshCanvas()`.
5. Добавить ветку в `mousedown` (`if (STATE.currentTool === 'my-object-create')`).
6. Добавить `selectMyObject(id)` и панель свойств в `#acc-sec-selected`.
7. Если нужны hitbox'ы — как у линий.

### 20.5. Новый формат экспорта

Расширить `exportCleanRaster(fmt)`:
```js
} else if (format === 'avif') {
  mimeType = 'image/avif';
}
```
Либо полностью новый метод (например, PDF через `pdf-lib` — но это нарушит принцип «ноль зависимостей»).

### 20.6. Новая локаль

Создать `.json` и загрузить через `#btn-load-locale`. Или добавить в `I18N.locales`:
```js
I18N.locales.de = {
  'Линии и маршруты': 'Linien und Routen',
  // ...
};
```

### 20.7. Новый стиль засечки станции

В `renderStations()` добавить:
```js
} else if (style === 'my-tick') {
  // рисование
}
```
И `<option value="my-tick">` в `#prop-station-style`.

### 20.8. Новый алгоритм раскладки пучка

Заменить `autoDistributeBundles()` или добавить новый режим:
```js
bind('btn-auto-bundle-v2', 'click', () => { /* ... */ });
```

---

## 21. Производительность и LOD

### 21.1. Где болит

- `refreshCanvas()` пересобирает **все** слои. На больших схемах (сотни станций, десятки линий) — заметно.
- `renderLines()` для каждой линии пересоздаёт все path'ы.
- `renderStations()` вызывает `getStationVisualGeometry()` — тяжёлая функция (проекции на все сегменты).
- `getOffsetPoints()` вызывается многократно (в `renderLines`, `renderStations`, `renderTerminals`, `renderHandles`, `renderTransfers`).
- `buildSmoothPath()` строит длинные строки `d`.

### 21.2. Как смягчено

- **LOD** — отключение тяжёлых слоёв на малых зумах.
- **Кэши нет** — пересчёт каждый раз.
- **`requestAnimationFrame`** в `SMOOTH_NAV` — но не в рендере. Рендер синхронный.
- **Хитбоксы** — отдельные path'ы (дополнительная нагрузка, но нужны для кликов).

### 21.3. Рекомендации по оптимизации (для будущих версий)

1. **Кэш `getStationVisualGeometry`** по `(station, lineOffsets, gap)`. Инвалидировать при изменении `STATE.lines` / `STATE.stations`.
2. **`renderLines` через `<use>`** для повторяющихся бейджей/стрелок.
3. **Виртуализация**: рисовать только объекты в viewport (`STATE.panX/panY/zoom` + `getBoundingClientRect`).
4. **`requestAnimationFrame` на рендер**: сейчас каждый `mousemove` дёргает `renderLines()` — на больших схемах может подтормаживать. Обернуть в throttle.
5. **SVG-паттерн для сетки** уже используется — хорошо.

### 21.4. LOD — что ещё можно добавить

- Скрывать `manualBadges`, `manualArrows` на LOD ≤ 2.
- Скрывать `interchange`-стили станций, рисовать просто кружки.
- Упрощать `transfers` до прямых линий.
- Отключать `filter: url(#smooth-metaball)` для местности (очень дорогой на больших площадях).

---

## 22. Известные особенности и подводные камни

1. **`line.segmentOffsets` — источник истины для пучка**. Если пользователь вручную меняет `line.offset`, это **сбрасывает** пучок (`computeSmartCorridorBundles` перезапишет). Чтобы сохранить ручное смещение — не запускайте пучкование.

2. **`alignSharedCorridorNodes` мутирует координаты вершин** (притягивает к сетке). Это необратимо без undo. Поэтому `pushHistory()` перед `computeSmartCorridorBundles` обязателен.

3. **`ptKey` квантует до 4px**. Если две линии идут «почти параллельно», но с разными координатами (сдвиг < 4px), они могут **не попасть в один edgeMap**. Тогда пучок для них не сформируется. Лечится `alignSharedCorridorNodes` (притягивает к общим координатам с точностью `gridStep * 0.65`).

4. **`getOffsetPoints` возвращает `_effOffsetPx` и `_bundleSpanPx`** — это **виртуальные** свойства. Они добавляются к точкам, но не сохраняются в `line.points` (в `STATE`). Это промежуточные данные для `buildSmoothPath`.

5. **`_origL1` / `_origL2`** — то же, виртуальные.

6. **`buildSmoothPath` для одной линии без пучка** использует `radius = STATE.globalStyles.curveRadius` (по умолчанию 18). Для линии в пучке — `radius` адаптируется под `bundleSpan`.

7. **`STATE.deletedAutoKeys`** — `Set` в памяти, `Array` в JSON. При загрузке — восстанавливается в `Set`. При экспорте standalone — очищается.

8. **`getLinesAtStation` мутирует `st.lineIds`**. Это «самовосстанавливающийся» кэш: если линии перестали проходить через станцию, но `lineIds` заданы — используются `lineIds`. Если нет — пересчитывается.

9. **`renderTerminals` вызывается с `matchingStation`** — если станция в пределах `gridStep * 1.3` от терминала, применяется `overlapMode`. Это позволяет терминалу «сливаться» со станцией.

10. **`getTerminalAutoName`** — для авто-терминалов имя = имя ближайшей станции или линии. Если пользователь переименовал станцию — авто-терминал обновится при следующем `renderTerminals`.

11. **`applyGlobalsLive`** — не пишет `pushHistory` на каждый `input`. `pushHistory` вызывается в `change` (для select) и вручную в `btn-apply-globals-selected`.

12. **`startWholeLineDrag`** включает `computeSmartCorridorBundles` в `finishGroupDrag`. Если выключить `bundle-shared-nodes-only` — не включает.

13. **`window.addEventListener('DOMContentLoaded', ...)`** для кнопок стрелок/номеров **после** `init()` — перехватывает уже привязанные элементы и **перезаписывает** `onclick`. Это специально, чтобы «современный UI» работал, а не дублировался.

14. **`line-badge-add` / `line-arrow-add`** — режимы, в которых клик по линии сразу добавляет элемент. Ghost preview — через `mousemove` на `svg` (capture). Не забывайте `e.stopPropagation()` в `mousedown`, иначе клик уйдёт в `#viewport` и создаст что-то другое.

15. **`share` через `#data=`** — URL может быть **очень длинным** (base64 от JSON). Браузеры поддерживают, но мессенджеры могут обрезать. Для больших схем используйте standalone HTML.

16. **`JXL`** — заявлен в `<select>`, но `canvas.toBlob('image/jxl')` в большинстве браузеров **не поддерживается**. Фактически сохранится PNG или будет ошибка. См. `exportCleanRaster`.

17. **`html2canvas` / `dom-to-image` не используются** — экспорт через SVG → Image → Canvas. Это надёжнее, но не рендерит HTML-элементы (легенда, info-overlay — рендерятся в SVG-слое, не в HTML).

18. **`#map-info-overlay` и `#map-frame-outline` — HTML, не SVG**. Они **не попадают** в экспорт. Легенда — в SVG (`#legend-layer`), поэтому экспортируется. Если нужен заголовок в экспорте — рисуйте его в SVG-слое (можно добавить `renderMapInfoSvg()`).

19. **`applyTransform` использует `translate(panX, panY) scale(zoom)`** — порядок важен. Сначала translate, потом scale. Если поменять — координаты поедут.

20. **`STATE.lodLevel` пересчитывается в `refreshCanvas()`**, но не в точечных `renderLines()`. Если вызвать `renderLines()` без `refreshCanvas()` — LOD останется от предыдущего полного рендера. Обычно это ок, но при резком зуме из кода — учитывайте.

21. **`HISTORY` не сохраняет** `activeLineId`, `selectedStationId` и т.д. — это UI-состояние. После undo выделение может «слететь» (если объект был удалён) или остаться (если нет). `clearAllSelections` для сброса.

22. **`applyUndo`/`applyRedo` вызывает `syncLegendFormUI`/`syncTerminalsFormUI`**, но **не** `syncLineArrowsAndBadgesModernUI`. Если откатили линию — визуальное состояние кнопок стрелок/номеров может не совпадать с `STATE`. Лечится через `selectLine(lineId)`.

23. **`bind(id, event, handler)`** оборачивает в try/catch и логирует. Если обработчик падает — вы увидите ошибку в DBG, но приложение продолжит работу.

24. **`getUsedPalette`** собирает цвета из `lines`, `decorations`, `tariffZones`, `terrainLayers`, `stations` (custom), `canvasBg`. Записывается в `STATE.palette` при сохранении проекта.

---

## 23. Справочник DOM-идентификаторов

### Верхняя панель
| ID | Назначение |
|---|---|
| `btn-undo`, `btn-redo` | Undo/Redo |
| `grid-step-input` | Шаг сетки |
| `angle-snap-select` | Угол трассировки |
| `line-draw-mode-select` | Тип объекта для трассировки |
| `btn-clear-all` | Очистить всё |
| `project-menu-container`, `project-dropdown-panel` | Меню проекта |
| `project-filename-input`, `btn-save-project`, `btn-load-project`, `file-input-project` | Сохранение/загрузка |
| `export-menu-container`, `export-dropdown-panel` | Меню экспорта |
| `export-filename-input`, `export-aspect-select`, `export-scale-select`, `export-format-select`, `btn-do-export` | Параметры экспорта |
| `btn-share-link` | Поделиться |
| `ui-lang-select`, `btn-load-locale`, `file-input-locale` | Язык |
| `btn-project-menu-toggle`, `btn-export-menu-toggle` | Тумблеры меню |

### Левая панель
`tool-select`, `tool-line`, `tool-station`, `tool-transfer`, `tool-decor`, `tool-paint`, `tool-text`, `tool-poi`.

### SVG / viewport
| ID | Назначение |
|---|---|
| `canvas-svg` | Корневой SVG |
| `svg-defs` | `<defs>` |
| `world-layer` | Корневая трансформируемая группа |
| `canvas-substrate-rect`, `canvas-substrate-image` | Фон и подложка |
| `grid-layer` | Сетка |
| `terrain-container-layer` | Местность + тарифные зоны |
| `terrain-labels-layer` | Подписи и POI |
| `decorations-layer` | Декор |
| `lines-layer` | Линии |
| `transfers-layer` | Пересадки |
| `stations-layer` | Засечки станций |
| `terminals-layer` | Терминалы |
| `labels-layer` | Подписи станций |
| `line-handles-layer` | Ручки/ноды |
| `legend-layer` | Легенда |
| `temp-layer` | Временное (превью) |
| `viewport` | Контейнер SVG (для событий) |
| `map-info-overlay` | HTML-заголовок (динамически создаётся) |
| `map-frame-outline`, `frame-drag-handle` | Рамка холста |
| `status-coords`, `status-grid`, `status-mode`, `status-hint` | Статус-бар |
| `btn-floating-debug` | Кнопка «Логи» |

### Правая панель (аккордеоны)
| ID | Заголовок |
|---|---|
| `acc-sec-selected` | Свойства выбранного (всегда закреплён) |
| `acc-sec-lines` | Линии и маршруты |
| `acc-sec-stations` | Остановки и станции |
| `acc-sec-terminals` | Конечные терминалы |
| `acc-sec-transfers` | Пересадочные узлы |
| `acc-sec-bundles` | Пучки маршрутов |
| `acc-sec-decor` | Декоративные пути |
| `acc-sec-paint` | Местность и зоны |
| `acc-sec-objects` | Объекты и тексты |
| `acc-sec-legend` | Легенда |
| `acc-sec-globals` | Глобальные параметры |

Внутри `acc-sec-selected`:
- `line-props-panel`, `station-props-panel`, `terminal-props-panel`, `transfer-props-panel`, `decor-props-panel`, `terrain-label-props-panel`, `poi-props-panel`, `tariff-zone-props-panel`.
- `props-empty-msg`, `acc-selected-title`.

### Поля свойств (примеры)
`prop-line-name`, `prop-line-color`, `prop-line-width`, `prop-line-style`, `prop-line-arrows`, `prop-line-arrow-style`, `prop-line-arrow-interval`, `prop-line-badges-style`, `prop-line-badges-side`, `prop-line-badges-colormode`, `prop-line-offset`, …

`prop-station-name`, `prop-station-style`, `prop-station-colormode`, `prop-station-tick-shift`, `prop-station-labelpos`, `prop-station-show-badges`, `prop-station-badge-*`, …

`prop-decor-name`, `prop-decor-type`, `prop-decor-color`, `prop-decor-width`, `prop-decor-show-label`, `prop-decor-label-text`, `prop-decor-crossing-mode`, …

`prop-transfer-style`, `prop-transfer-curvature`, `prop-transfer-dash-*`, …

`prop-tlabel-x/y/text/size/angle/bold/italic/...`, `prop-poi-x/y/type/symbol/label/...`, …

`prop-tz-name/color/opacity/border-*`, …

### Легенда / глобальные
`leg-show`, `leg-title`, `leg-subtitle`, `leg-columns-select`, `leg-logo-type`, `leg-symbol-input`, `leg-image-file`, `leg-width`, `leg-auto-height`, `leg-angle-input`, `leg-title-fontsize-input`, `leg-fontsize-input`, `leg-subtitle-color`, `legend-lines-reorder-container`, `legend-notes-container`, `btn-add-legend-note`.

`global-font-select`, `global-shadow-select`, `global-line-width`, `global-sync-font-size`, `btn-toggle-smooth`, `global-curve-radius-input`, `global-label-angle-input`, `global-label-pos-select`, `global-apply-to-all-stations`, `btn-toggle-exclude-manual`, `global-sublabel-color`, `btn-global-auto-translate`, `canvas-image-file`, `canvas-image-opacity`, `canvas-img-width`, `canvas-img-height`, `btn-remove-substrate-image`, `canvas-bg-color`, `canvas-bg-opacity`, `btn-apply-globals-selected`, `btn-reset-manual-stations`, `map-title-input`, `map-attribution-input`, `map-title-show`, `map-attribution-show`, `map-title-size`, `map-attribution-size`, `canvas-frame-enabled`, `canvas-frame-width`, `canvas-frame-height`.

### Debug
`debug-console-drawer`, `debug-log-container`, `dbg-badge-err`.

---

## 24. Справочник клавиш и жестов

| Клавиша / жест | Действие |
|---|---|
| `V` | Инструмент «Выбор» |
| `L` | Инструмент «Линия» |
| `S` | Инструмент «Станция» |
| `X` | Инструмент «Пересадка» |
| `D` | Инструмент «Декорация» |
| `B` | Инструмент «Кисть» |
| `T` | Инструмент «Текст» |
| `I` | Инструмент «Объект» |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Enter` | Завершить текущую трассировку |
| `Esc` | Отменить трассировку (сброс `tempPoints`) |
| `ЛКМ` по пустому холсту | Панорамирование |
| `ЛКМ` на объекте | Выбор + перетаскивание |
| `СКМ` / `Пробел + drag` | Панорамирование |
| `Колесо` | Плавный зум к курсору |
| `Shift + колесо` | Горизонтальный скролл (если `deltaX === 0`) |
| `Ctrl + колесо` | Ускоренный зум |
| `ЛКМ` на ноде (вершине) | Перетаскивание вершины |
| `ПКМ` / двойной клик по ноде | Удалить вершину |
| `ЛКМ` на ручной стрелке | Развернуть |
| `ПКМ` на ручной стрелке | Удалить |
| `ЛКМ` на ручном номере | Сменить сторону |
| `ПКМ` на ручном номере | Удалить |
| `Shift + ЛКМ` по объекту | Добавить/убрать из мультивыделения |
| `Shift + drag` по мультивыделению | Перетащить всю группу |
| `Ctrl + ЛКМ` по линии / станции / вершине | Перетащить всю линию со станциями |
| `ПКМ` на пустом холсте | Контекстное меню (вставка) |
| `Один палец` | Панорамирование (с инерцией) |
| `Два пальца` | Pinch-to-zoom + pan |

---

## Заключение

MURScheme — компактный, но плотный код. Ключевые точки, которые нужно понимать перед правкой:

1. **`STATE` — единственный источник правды.** Всё остальное — производные.
2. **Пучкование линий — самая сложная часть.** Разобраться в `getOffsetPoints` + `buildSmoothPath` + `computeSmartCorridorBundles` — половина успеха.
3. **LOD и `refreshCanvas`** — узкое место по производительности. Точечные рендеры (`renderLines` вместо `refreshCanvas`) — ваш друг.
4. **`pushHistory()` — только перед изменениями, которые хотите откатить.** Не на каждый `input`.
5. **Терминалы и станции — две разные сущности**, которые «сливаются» через `overlapMode`. Помните об этом.
6. **Экспорт через SVG → Image → Canvas**, а не `html2canvas`. HTML-элементы (`#map-info-overlay`, `#map-frame-outline`) **не экспортируются**.
7. **`Share` = `#data=` + `__MURSCHEME_PRELOADED__`.** Read-only режим — это `body.read-only-mode`.

Приятного использования.
