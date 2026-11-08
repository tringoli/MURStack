# MURScheme — Техническая документация для разработчиков

> *Актуально на 8 ноября 2026 года*
> 
> Версия кода: **beta 6**. Документ описывает архитектуру, модель данных, алгоритмы рендеринга и пучкования, систему локализации, библиотеку векторных иконок, многослойный экспорт, точки расширения и подводные камни.

---

## Оглавление

1. [Архитектура и философия](#1-архитектура-и-философия)
2. [Карта модулей и порядок загрузки](#2-карта-модулей-и-порядок-загрузки)
3. [Модель состояния `STATE`](#3-модель-состояния-state)
4. [История изменений `HISTORY`](#4-история-изменений-history)
5. [Конвейер рендеринга SVG и авто-контраст](#5-конвейер-рендеринга-svg-и-авто-контраст)
6. [Координаты, трансформации и LOD](#6-координаты-трансформации-и-lod)
7. [Математические утилиты](#7-математические-утилиты)
8. [Пучки линий: полный алгоритм и стягивание к корневой линии](#8-пучки-линий-полный-алгоритм-и-стягивание-к-корневой-линии)
9. [Геометрия станций и пропорциональные подписи](#9-геометрия-станций-и-пропорциональные-подписи)
10. [Терминалы: генерация, раскладка и связь с подписями](#10-терминалы-генерация-раскладка-и-связь-с-подписями)
11. [Система ввода](#11-система-ввода)
12. [Инструменты (`tools`) и конечные автоматы](#12-инструменты-tools-и-конечные-автоматы)
13. [Выделение, панели свойств, свободный текст и POI](#13-выделение-панели-свойств-свободный-текст-и-poi)
14. [Контекстное меню](#14-контекстное-меню)
15. [Экспорт (SVG, Растр, PdfCraft, VectorCraft, FigCraft, PhotoCraft .ora)](#15-экспорт-svg-растр-pdfcraft-vectorcraft-figcraft-photocraft-ora)
16. [Share / Read-Only](#16-share--read-only)
17. [I18N — двунаправленная локализация и авто-наблюдатель](#17-i18n--двунаправленная-локализация-и-авто-наблюдатель)
18. [DBG — консоль отладки](#18-dbg--консоль-отладки)
19. [Публичный API `MURSchemeAPI` и библиотека иконок](#19-публичный-api-murschemeapi-и-библиотека-иконок)
20. [Рецепты расширения](#20-рецепты-расширения)
21. [Производительность и LOD](#21-производительность-и-lod)
22. [Известные особенности и подводные камни](#22-известные-особенности-и-подводные-камни)
23. [Справочник DOM-идентификаторов](#23-справочник-dom-идентификаторов)
24. [Справочник клавиш и жестов](#24-справочник-клавиш-и-жестов)

---

## 1. Архитектура и философия

MURScheme построен как **моно-файл** без сборщика: единственный HTML-документ с inline-CSS (адаптация темы GTK Adwaita Dark) и inline-JS. Такой выбор даёт:

- **Автономность** — достаточно открыть HTML-файл в любом браузере. Опциональные CDN-библиотеки (`JSZip` и `pako`) используются только при экспорте послойных архивов `.ora` (PhotoCraft) и сжатых послойных `.pdf` (PdfCraft).
- **Простой шаринг** — проект можно сохранить в `.json`, упаковать в полностью автономный HTML-файл режима чтения (`MURScheme_view.html`) или передать через `#data=`-ссылку.
- **Прозрачный код** — отсутствие транспиляции, сборщиков и `node_modules`.

Ключевые архитектурные принципы:

| Принцип | Реализация |
|---|---|
| **Единое состояние** | Все данные схемы лежат в одном объекте `STATE`. Никаких параллельных подсистем. |
| **Императивный рендер** | Функции `render*()` пересобирают свои SVG-слои с нуля (`innerHTML = ''`), что исключает рассинхронизацию DOM и данных. |
| **Ручный DOM** | Прямая работа с `document.createElementNS('http://www.w3.org/2000/svg', ...)` для всех графических примитивов. |
| **Изоляция модулей через объекты** | `I18N`, `DBG`, `STATE`, `HISTORY`, `SMOOTH_NAV`, `MURSchemeAPI` живут в области видимости скрипта и взаимодействуют через `STATE`. |
| **Прогрессивное сохранение** | `HISTORY` хранит JSON-снимки `STATE` (до 40 шагов), а сериализация проекта автоматически конвертирует `Set` (`deletedAutoKeys`, `selectedRootNodeIndices`) в массивы и обратно. |
| **Read-only режим** | Один CSS-класс `body.read-only-mode` полностью скрывает панели редактирования и включает режим интерактивного просмотра. |
| **Слои по z-порядку SVG** | Каждый класс объектов рендерится в изолированную группу `<g>` внутри `#world-layer`, которая при экспорте напрямую мапится в слои Inkscape / Figma / OpenRaster / PDF OCG. |

---

## 2. Карта модулей и порядок загрузки

Скрипты выполняются строго сверху вниз. Перед основным скриптом подключены:
1. Изолированный перехватчик критических ошибок парсинга `window.addEventListener('error', ...)`.
2. Скрипты `jszip.min.js` и `pako.min.js` (для формирования `.ora` и FlateDecode-потоков в `.pdf`).

### Модули (в порядке объявления)

|**Модуль**|**Ответственность**|
|---|---|
|**МОДУЛЬ 0: I18N**|Двунаправленные словари RU/EN, шаблоны `patterns`, обратный словарь `_reverseLookup`, `t()`, `applyToDOM()`, `MutationObserver` и загрузка `.json`-локалей из `<select id="ui-lang-select">`|
|**МОДУЛЬ 1: DBG**|Логирование с цветовой индикацией, перевод логов на лету (`translateLogText`), счётчик ошибок, тесты DOM и рендера|
|**МОДУЛЬ 2: STATE & HISTORY**|Единый объект состояния `STATE`, стек `undoStack`/`redoStack`, сбор используемой палитры `getUsedPalette()`|
|**МОДУЛЬ 3: Math & Geometry**|`screenToWorld`, `snapToGrid`, `snapAngle`, `getOffsetPoints`, `buildSmoothPath`, `buildSmoothClosedPath`, `getStationVisualGeometry`, `computeBestCircle`|
|**МОДУЛЬ 4: Renderers**|Авто-контраст и авто-окантовка текста (`applyTextAutoOutline`), `renderGrid`, `renderTerrain`, `renderTerrainLabels`, `renderDecorations`, `renderLines`, `renderHandles`, `computeTerminalBadgeLayout`, `renderTerminals`, `renderStations`, `renderStationLabel`, `renderTransfers`, `renderLegend`, `refreshCanvas`|
|**МОДУЛЬ 5: Selection & Props UI**|`selectLine`, `selectStation`, `selectTerminal`, `selectTransfer`, `selectDecoration`, `selectTariffZone`, `selectTerrainLabel`, `selectPoiObject`, синхронизация форм и списков сайдбара|
|**МОДУЛЬ 6: Editing & Bundles**|Авто-расстановка станций, постройка пересадок, умные пучки (`computeSmartCorridorBundles`, `alignSharedCorridorNodes`), стягивание к нодам корневой линии (`syncByRootLineNodes`), кисть местности, авто-перевод карты|
|**МОДУЛЬ 7: Export**|`getExportFraming`, `prepareExportClone` (с инлайнингом `<use href="#mi-...">`), `exportSvg`, `exportCleanRaster`, `exportOpenRaster` (`.ora`), `exportLayeredPdfCraft` (послойный PDF с альфа-каналом), `exportPdfOrCraft` (`VectorCraft` / `FigCraft`)|
|**МОДУЛЬ 8: Events, Share & Init**|Контекстное меню `#ctx-menu`, `setTool`, `setupEventListeners`, `generateShareLink`, `downloadStandaloneShare`, `init`, мультивыделение и перетаскивание групп|
|**МОДУЛЬ 9: Quick UI & SVG Icons API**|Быстрый UI стрелок и номеров на линии, динамическая библиотека 25 000+ иконок Material/Iconify API с кэшем `localStorage` и русско-английским поиском|

## 3. Модель состояния `STATE`

JavaScript

```
STATE = {
  // --- Параметры сетки и инструментария ---
  gridStep: 24,
  angleSnap: 45,          // 0 | 15 | 30 | 45 | 60 | 75 | 90
  smoothCurve: true,
  syncFontSize: true,
  currentTool: 'select',
  pinnedSections: ['acc-sec-selected'],

  // --- Навигация и детализация ---
  zoom: 1, panX: 400, panY: 250,
  lodLevel: 3,            // 1..5

  // --- Инфо карты и рамка кадра ---
  mapInfo: { title: '', attribution: '', showTitle: true, showAttribution: true, titleSize: 16, attributionSize: 11 },
  canvasFrame: { enabled: false, x: 0, y: 0, width: 1920, height: 1080 },

  // --- Выделение ---
  activeLineId: null,
  activeDecorId: null,
  selectedStationId: null,
  selectedTransferId: null,
  selectedTerrainLabelId: null,
  selectedTariffZoneId: null,
  selectedTerminalId: null,
  arrowFirstNode: null,
  badgeFirstNode: null,
  multiSelection: [],
  selectedRootNodeIndices: new Set(), // индексы нод корневой линии для притяжения пучка

  // --- Глобальные стили и авто-контраст ---
  globalStyles: {
    fontFamily: 'Manrope, sans-serif',
    labelAngle: 315,
    labelColor: '#0f172a',
    sublabelColor: '#94a3b8',
    fontSize: 12,
    lineWidth: 6.5,
    shadowMode: 'none',               // 'none' | 'all' | 'lines' | 'decor'
    canvasBg: '#ffffff',
    canvasOpacity: 100,
    substrateImageUrl: '',
    substrateOpacity: 0.85,
    substrateX: -1000, substrateY: -1000, substrateWidth: 4000, substrateHeight: 3000,
    labelPos: 'top-right',
    excludeManualStations: true,
    curveRadius: 18,
    syncFontSize: true,
    autoTextContrast: true,           // авто-контраст текста от яркости холста
    textContrastCustom: false,
    textContrastColor: '#0f172a',
    autoOutlineLabels: true,          // авто-окантовка подписей
    autoOutlineIntersectionOnly: true,// включать окантовку только при пересечении с путями/станциями
    autoOutlineColor: '#ffffff',
    autoOutlineWidth: 3
  },

  // --- Глобальные настройки конечных терминалов ---
  terminalsSettings: {
    autoGenerate: true,
    titleText: '', subtitleText: '', subtitleColor: '#94a3b8',
    attach: 'track-exact',            // 'track-exact' | 'track-butt' | 'line-end' | 'on-line' | 'offset'
    offsetDist: 0, offsetSide: 'auto',
    align: 'vertical',
    badgeStyle: 'square',
    badgeSize: 9.5,
    borderMode: 'none', borderColor: '#0f172a', borderWidth: 1.8,
    bgMode: 'contrast', bgColor: '#e2e8f0',
    overlapMode: 'replace-station'    // 'badges-only' | 'both' | 'hide-terminal' | 'replace-station'
  },

  // --- Легенда ---
  legend: {
    show: true, x: 100, y: 100,
    title: 'Список маршрутов', subtitle: '', subtitleColor: '#94a3b8',
    template: 'table', columns: 1,
    logoType: 'none', logoSymbol: '🚋', logoImageUrl: '',
    angle: 0, titleFontSize: 15, fontSize: 12,
    width: 320, autoWidth: true, autoHeight: true,
    opacity: 0.94, bgColor: '#ffffff', borderWidth: 1.5, borderColor: '#cbd5e1', radius: 8,
    notes: []
  },

  // --- Коллекции объектов ---
  lines: [], stations: [], terminals: [], transfers: [], decorations: [],
  terrainLayers: [ ... ],
  tariffZones: [],
  terrainLabels: [],                  // свободные текстовые надписи (isPoi: false) и объекты POI (isPoi: true)
  deletedAutoKeys: new Set()
}
```

### Обновлённые схемы объектов в `beta 6`

#### `Station` (Остановка)

Помимо базовых полей (`id, name, subname, i18n, x, y, style, colorMode, customColor, tickShift, labelPos, labelAngle, lineIds`), объект станции поддерживает индивидуальные габариты и типографику:

  

JavaScript

```
{
  // Кастомные габариты и граница иконки/засечки станции:
  customWidth: Number | undefined,
  customHeight: Number | undefined,
  customBorderWidth: Number | undefined,
  customBorderColorOn: Boolean,
  customBorderColor: '#0f172a',

  // Индивидуальные настройки текстового блока подписи:
  labelFontSize: Number | undefined,
  sublabelFontSize: Number | undefined,
  labelLineHeight: Number | undefined,
  labelSpacing: Number,
  labelColor: '#0f172a',
  subcolor: '#94a3b8',
  bold: Boolean,
  italic: Boolean,
  textAnchor: 'auto' | 'start' | 'middle' | 'end',
  labelOffsetX: Number,
  labelOffsetY: Number,

  // Иконки маршрутов возле подписи:
  showBadges: Boolean,
  badgeShape: 'circle' | 'square' | 'rect',
  badgePos: 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  badgeSize: 10
}
```

#### `TerrainLabel` (Свободная текстовая надпись, `isPoi: false`)

Свободный текст полностью унифицирован с подписями станций:

  

JavaScript

```
{
  id: 'tlab-...',
  isPoi: false,
  x: Number, y: Number,
  text: String,                   // многострочный основной текст (\n)
  subtext: String,                // многострочная вторичная подпись (\n)
  i18n: { ru, en },
  labelPos: 'center' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top' | 'bottom' | 'right' | 'left',
  size: Number | undefined,       // кегль основной надписи (undefined = Авто)
  subsize: Number | undefined,    // кегль вторичной надписи (undefined = Авто)
  lineHeight: Number | undefined, // межстрочный интервал (undefined = Авто)
  spacing: Number,                // разрядка букв (px)
  color: '#0f172a',
  subcolor: '#94a3b8',
  customColorMain: Boolean,       // приоритет пользовательского цвета над глобальным авто-контрастом
  customColorSub: Boolean,
  outlineWidth: Number,
  outlineColor: '#ffffff',
  bold: Boolean,
  italic: Boolean,
  anchor: 'auto' | 'start' | 'middle' | 'end',
  baseline: 'auto' | 'middle' | 'hanging' | 'alphabetic',
  fontFamily: String,
  angle: Number,
  // Привязка бейджей маршрутов к свободному тексту:
  showBadges: Boolean,
  badgeShape: 'circle' | 'square' | 'rect',
  badgePos: 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  badgeSize: 10,
  lineIds: []
}
```

#### `PoiObject` (Объект / Иконка на карте, `isPoi: true`)

Хранится в `STATE.terrainLabels` с флагом `isPoi: true`:

  

JavaScript

```
{
  id: 'poi-...',
  isPoi: true,
  x: Number, y: Number,
  poiType: 'material' | 'image' | 'emoji' | 'pin',
  poiShape: 'circle' | 'square' | 'rect' | 'triangle', // форма подложки бейджа
  imageUrl: '#mi-directions_bus' | 'data:image/...',
  iconSvgData: { viewBox: '0 0 24 24', inner: '<path .../>' }, // вшитый вектор для офлайн-рендера и .json
  text: '📍',                     // символ для режима emoji / pin
  color: '#ffffff',               // цвет самой иконки
  showBgPlate: true,              // показывать ли цветную плашку-бейджик под иконкой
  bgColor: '#3584e4',             // цвет фона бейджа
  autoContrast: true,             // авто-контраст обводки бейджа относительно фона холста
  size: 28,
  opacity: 100,
  angle: 0,
  // Надпись внутри иконки:
  showInnerLabel: Boolean,
  innerLabelText: String,
  innerLabelSize: 11,
  innerLabelColor: '#ffffff',
  // Внешняя подпись объекта:
  label: String,
  sublabel: String,
  labelPos: 'bottom' | 'top' | 'right' | 'left' | 'none',
  labelSize: 12,
  sublabelSize: Number | undefined,
  labelLineHeight: Number | undefined,
  labelColor: '#0f172a',
  sublabelColor: '#94a3b8',
  labelBold: true,
  labelItalic: false
}
```

## 4. История изменений `HISTORY`

- Стек `HISTORY.undoStack` хранит до 40 JSON-снимков (`createStateSnapshot()`).
    
      
    
- При вызове `pushHistory()` стек `redoStack` очищается.
    
      
    
- `pushHistory()` вызывается перед началом структурных операций (`mousedown` при перемещении, создание/удаление объекта, применение групповых алгоритмов) и на событии `change` (но не на каждом шаге ползунка `input`).
    
      
    

## 5. Конвейер рендеринга SVG и авто-контраст

### Авто-контраст и авто-окантовка подписей

В `МОДУЛЕ 4` реализованы три функции, отвечающие за читаемость текста на любом фоне и поверх линий:

  

1. **`getContrastColor(hexColor)`** — вычисляет относительную яркость `lum = (0.299*R + 0.587*G + 0.114*B) / 255` и возвращает `'#0f172a'` (для светлого фона, `lum > 0.55`) или `'#ffffff'` (для тёмного).
    
      
    
2. **`getEffectivePrimaryTextColor(customFallback)` / `getEffectiveSecondaryTextColor(customFallback)`** — если включён `STATE.globalStyles.autoTextContrast`, автоматически переключает цвет текста между тёмным и светлым в зависимости от цвета холста `canvasBg`. Для свободного текста (`TerrainLabel`), если пользователь явно выбрал свой цвет через палитру (`customColorMain = true` / `customColorSub = true`), пользовательский цвет имеет приоритет над авто-контрастом.
    
      
    
3. **`applyTextAutoOutline(svgTextEl, worldX, worldY, approxW, approxH, isSub, ignoreStationId)`** — если включён `autoOutlineLabels`, проверяет пересечение габаритного бокса текста с любыми линиями, декорациями или соседними станциями через `doesBoxIntersectAnyTrack(...)`. При обнаружении пересечения добавляет тексту атрибут `paint-order="stroke fill"` с обводкой цвета холста (`autoOutlineColor`), причём для вторичных подписей (`isSub = true`) толщина обводки масштабируется коэффициентом `0.45`, чтобы мелкий шрифт не залипал.
    
      
    

## 6. Координаты, трансформации и LOD

Трансформация камеры накладывается только на `<g id="world-layer">` через `translate(panX, panY) scale(zoom)`. Все координаты объектов внутри слоёв — мировые.

  

Уровни детализации (`STATE.lodLevel`, от 1 до 5) пересчитываются в `refreshCanvas()` в зависимости от `STATE.zoom`:

  

- **LOD 1 (`zoom < 0.35`)**: станции рендерятся как точки `r=3`, скрыты подписи станций, пересадки и подписи местности.
    
      
    
- **LOD 2 (`zoom < 0.6`)**: скрыты `terrainLabels` (`renderTerrainLabels` завершается досрочно) и вторичные подписи станций.
    
      
    
- **LOD 3–5 (`zoom >= 0.6`)**: полная отрисовка всех элементов и навигации вдоль трасс.
    
      
    

## 7. Математические утилиты

Помимо базовых проекций (`distToSegmentSquared`, `projectPointOnSegment`, `getSegmentsIntersection`, `isPointInsidePolygon`, `computeBestCircle`, `sanitizePathPoints`), модуль предоставляет:

  

- **`getLineSegmentOffsetUnit(line, pathIdx, segIdx)`** — возвращает суммарное смещение конкретного сегмента линии в единицах пучка: базовый `line.offset` + локальный `line.segmentOffsets["pathIdx:segIdx"]`.
    
      
    
- **`getBundleGapValue()`** — возвращает `0`, если отмечен чекбокс `#bundle-no-gap` («Без зазоров между линиями пучка»), иначе числовое значение из `#bundle-gap-input` (по умолчанию `2.5px`).
    
      
    

## 8. Пучки линий: полный алгоритм и стягивание к корневой линии

### 8.1–8.7. Параллельное смещение и концентрические дуги

Алгоритм строится на связке:

  

- `getOffsetPoints(points, offsetPixels, line, pathIdx, stepPx)` — вычисляет аналитическое пересечение смещённых прямых в узлах и плавные ступеньки перестроения (`jog`) на коллинеарных участках при изменении ширины пучка.
    
      
    
- `buildSmoothPath(points, radius, lineOffset)` — строит круговые дуги SVG `A rLine rLine ...`, где радиус каждой линии в пучке пропорционально корректируется (`rLine = baseR - turnSign * effOffset`), обеспечивая идеально постоянный зазор в поворотах.
    
      
    
- `computeSmartCorridorBundles(targetLines, alignNodesFirst)` — автоматически находит общие коридоры и распределяет слоты без перехлёстов на развилках.
    
      
    

### 8.8. Стягивание к нодам корневой линии (`syncByRootLineNodes`)

В `beta 6` в секцию «Параллельные пучки маршрутов» добавлен трёхшаговый инструмент притяжения к опорной (корневой) линии:

  

1. Пользователь выбирает **Корневую линию** (`#bundle-root-line`).
    
      
    
2. Отмечает галочками **Примыкающие линии** (`#bundle-lines-selector`).
    
      
    
3. Выбирает конкретные **Ноды корневой линии** (`STATE.selectedRootNodeIndices`, чипы в `#bundle-root-nodes-chips` или интерактивно на холсте) и задаёт радиус захвата (`#bundle-merge-radius`, по умолчанию `60px`).
    
      
    

При вызове `syncByRootLineNodes()`:

  

- Для каждой выбранной ноды корневой линии вычисляется вектор касательной и нормали `(nx, ny)`.
    
      
    
- В радиусе захвата находятся ближайшие узлы примыкающих линий. До перемещения узла анализируется положение его соседней свободной точки относительно нормали корневой линии (`projNormal = vx * nx + vy * ny`), чтобы определить, с какой стороны (сверху/слева `score < 0` или снизу/справа `score >= 0`) маршрут подходит к магистрали.
    
      
    
- Узлы примыкающих линий переносятся точно в координаты узлов корневой линии, а самим линиям автоматически назначаются целочисленные смещения `-(i + 1)` и `+(i + 1)` (глобально в `l.offset` или посегментно в `l.segmentOffsets`, если включён флаг `#bundle-shared-nodes-only`).
    
      
    

## 9. Геометрия станций и пропорциональные подписи

### Кастомные габариты и контур засечки

В `renderStations()` каждая станция поддерживает переопределение размеров через поля `#prop-station-custom-w`, `#prop-station-custom-h` и `#prop-station-border-w`:

  

- Для круговых и капсульных стилей размеры подставляются напрямую в атрибуты `r` / `width` / `height`.
    
      
    
- Для полигональных и path-стилей (`metro-tick`, `metro-tick-rounded`, `smooth-ladder`, `cross-tick`) примитивы оборачиваются во внутреннюю группу `<g>`, вычисляется её `getBBox()`, и применяется масштабирующая трансформация `translate(cx cy) scale(sx sy) translate(-cx -cy)` вокруг центра засечки.
    
      
    

### Пропорциональное позиционирование подписи (`computeLabelPlacementAroundBox`)

Расчёт координат подписи вынесен в универсальную функцию `computeLabelPlacementAroundBox(...)`, которая принимает полуширину и полувысоту объекта (`halfExtX`, `halfExtY`) и отступ `labelGap`:

  

- При горизонтальном тексте (`sinA ≈ 0`) подпись выравнивается строго по границе `halfExtX + labelGap` / `halfExtY + labelGap`.
    
      
    
- При наклонном тексте (например, `315°`) учитывается проекция всех строк основной (`nMain`) и вторичной (`nSub`) надписей на оси `X` и `Y` (`dxTop, dxBot, dyTop, dyBot`), благодаря чему текст никогда не налезает на иконку станции или блок бейджей терминала при любом из 8 положений (`top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`, `bottom-right`).
    
      
    

## 10. Терминалы: генерация, раскладка и связь с подписями

1. **`computeTerminalBadgeLayout(termData, isManual)`** — единая чистая функция расчёта геометрии конечного терминала. Вычисляет центры всех бейджей (`badgeCenters`), точные границы блока (`minBx, maxBx, minBy, maxBy`), центр (`avgX, avgY`), отступы фоновой плашки (`platePad`) и рамок (`borderPad`), а также итоговые полугабариты `termHalfW`, `termHalfH` и пропорциональный зазор `labelGap = Math.max(5, Math.round(bSize * 0.65))`.
    
      
    
2. **`getStationTerminalBadgeBox(st)`** — проверяет, находится ли станция на конце линии с активным терминалом (автоматическим или ручным).
    
      
    - Если выбран режим `replace-station` или `badges-only`, засечка станции скрывается (`hideVisualTick = true`), а `renderStationLabel()` получает от `getStationTerminalBadgeBox(st)` точные `termHalfW` и `termHalfH` блока бейджей.
        
          
        
    - Если выбран режим `both` («Бейджи + засечка остановки»), `renderStationLabel()` строит объединённый bounding-box засечки и терминала.
        
          
        
    - При любом изменении размера бейджей терминала (`#term-badge-size`, `#prop-term-badge-size`), стиля или ориентации синхронно вызывается `renderStations()`, чтобы подписи конечных станций мгновенно сдвигались пропорционально новому размеру бейджей.
        
          
        

## 11. Система ввода

Обработка ввода сочетает событийную модель на `#viewport` и RAF-цикл плавной навигации `SMOOTH_NAV`[cite: 9]:

  

- **Панорамирование**: ЛКМ по пустому холсту, СКМ (`button === 1`) или жест одним пальцем на тач-экране[cite: 9].
    
      
    
- **Масштабирование**: колесо мыши (с центрированием в точке курсора `zoomAroundScreenPoint`) или жест pinch-to-zoom двумя пальцами[cite: 9].
    
      
    
- **Изменение размеров подложки холста**: если загружена фоновая картинка (`substrateImageUrl`), в режиме `select` по её углам рендерятся 4 квадратные ручки (`tl`, `tr`, `bl`, `br`), позволяющие интерактивно растягивать подложку (`STATE.draggingSubstrate`).
    
      
    

## 12. Инструменты (`tools`) и конечные автоматы

Помимо базовых инструментов левой панели (`select`, `line`, `station`, `transfer`, `decor`, `paint`, `text`, `poi`), в `STATE.currentTool` поддерживаются специализированные подрежимы:

  

- `line-arrow-add` — интерактивная расстановка ручных стрелок кликом по выбранной линии (ЛКМ по стрелке разворачивает направление, ПКМ — удаляет).
    
      
    
- `line-arrow-nodes` — выбор двух вершин линии на холсте для автоматического заполнения стрелками всех сегментов между ними.
    
      
    
- `line-badge-add` — интерактивная расстановка ручных номеров маршрута кликом по линии (ЛКМ по номеру циклически меняет сторону, ПКМ — удаляет).
    
      
    
- `line-badge-nodes` — выбор двух вершин линии для размещения номеров маршрута по центрам всех участков между ними.
    
      
    
- `manual-terminal` / `terminal-manual` — размещение ручного конечного терминала кликом по карте.
    
      
    

## 13. Выделение, панели свойств, свободный текст и POI

Все панели свойств внутри `#acc-sec-selected` управляются через `hideAllPropPanels()` и `openSelectedAccordion()`.

  

### Панель свободного текста (`#terrain-label-props-panel`)

При клике на текстовую надпись (`selectTerrainLabel(id)`) открывается расширенное меню, полностью аналогичное панели свойств остановки:

  

- Многострочные поля `<textarea>` для основной (`#prop-tlabel-text`) и вторичной (`#prop-tlabel-subtext`) надписей с кнопкой построчного авто-перевода `🌐 Перевести` (`#btn-translate-tlabel`).
    
      
    
- Выбор положения текста относительно узла (`#prop-tlabel-labelpos`: по центру точки, сверху-справа, сверху-слева и т.д.) и режима выравнивания (`Авто (по позиции)`, `Слева`, `По центру`, `Справа`).
    
      
    
- Блок **«Настройки блока текста подписи»** с кнопкой сброса `Авто` (`#btn-reset-tlabel-typography`), раздельными полями **«Кегль осн.»** (`#prop-tlabel-size`), **«Кегль втор.»** (`#prop-tlabel-subsize`), **«Межстрочн.»** (`#prop-tlabel-lineheight`), разрядкой букв, цветами и собственной обводкой.
    
      
    
- Блок **«Иконки маршрутов у подписи»** (`#prop-tlabel-show-badges`), позволяющий прикрепить цветные бейджи любых линий к произвольной надписи на карте.
    
      
    
- Кнопки дублирования, копирования текста и копирования/вставки визуального стиля (`STATE.copiedTextLabelStyle`).
    
      
    

### Панель объектов и иконок (`#poi-props-panel`)

При выборе объекта (`selectPoiObject(poiId)`) доступны 4 режима `poiType`:

  

1. `material` — векторная SVG-иконка из онлайн-библиотеки (25 000+ значков) с настраиваемой формой бейджа (`circle`, `square`, `rect`, `triangle`), цветом самой иконки, цветом подложки и авто-контрастом обводки.
    
      
    
2. `image` — загрузка собственной картинки с диска (`PNG`, `SVG`, `WEBP`, `JPG`, `ICO` в формате DataURL).
    
      
    
3. `emoji` — произвольный символ или эмодзи.
    
      
    
4. `pin` — векторный круглый пин-значок с текстом внутри.
    
      
    

## 14. Контекстное меню

Вызывается по ПКМ на `#viewport` (кроме режима `isReadOnly`):

  

- Перехватчик в фазе `capture` сначала проверяет клик ПКМ по ручной стрелке (`[data-mur-manual-arrow]`) или ручному номеру (`[data-mur-manual-badge]`) для их мгновенного удаления.
    
      
    
- Для станций, линий, пересадок и декораций открывается `#ctx-menu` с быстрыми действиями (редактирование, авто-остановки на линии, смена цвета, очистка всех ручных стрелок/номеров линии, дублирование, удаление).
    
      
    
- При ПКМ по пустому месту холста предлагается создать остановку в точке клика, добавить объект, текст или сбросить камеру.
    
      
    

## 15. Экспорт (SVG, Растр, PdfCraft, VectorCraft, FigCraft, PhotoCraft .ora)

Перед запуском любого экспорта вызывается `await ensureAllProjectIconsLoaded()`, чтобы гарантировать наличие всех `<symbol id="mi-...">` в `#svg-defs`.

  

### 15.1. Подготовка клона (`prepareExportClone`)

1. Клонирует `#canvas-svg`, выставляет `viewBox` и размеры согласно выбранному кадру (`screen`, `frame` — точно по рамке холста, `16:9`, `4:3`, `1:1`, `21:9`, `custom`) и множителю качества (`1x`..`16x`).
    
      
    
2. Проставляет всем главным группам `#world-layer` атрибуты `data-name`, `inkscape:groupmode="layer"` и `inkscape:label` для распознавания слоёв во внешних редакторах.
    
      
    
3. **Разворачивает все `<use href="#mi-...">` в прямые вложенные `<svg>`** с явно прописанным `fill` на каждом примитиве (`path, circle, rect, polygon`), чтобы значки POI гарантированно рендерились в `Canvas` и открывались в любых векторных пакетах без потери иконок.
    
      
    
4. Применяет `fill="none"` строго к `path.map-line-path`, не затрагивая заливку векторных иконок.
    
      
    

### 15.2. Поддерживаемые форматы экспорта

|**Формат в UI**|**Функция**|**Описание**|
|---|---|---|
|**PNG / WEBP / JPG**|`exportCleanRaster(fmt)`|Встраивает шрифты Google Fonts в Base64 (`getEmbeddedFontCss()`), рендерит SVG через `Image` на `HTMLCanvasElement` с учётом прозрачности холста `canvasOpacity` и сохраняет растр.|
|**SVG**|`exportSvg()`|Сохраняет чистый векторный файл `.svg` с размеченными слоями.|
|**PDF**|`exportPdfOrCraft('pdf')`|Формирует однослойный PDF-документ с изображением схемы.|
|**PdfCraft (`.pdf` + проект)**|`exportLayeredPdfCraft(true)`|Генерирует **PDF 1.5** (`buildLayeredPdfWithAlpha`) с 11 независимыми прозрачными слоями **Optional Content Groups (`/OCGs`)**, раздельными RGB-потоками и масками прозрачности `/SMask` (сжатие `FlateDecode` через `CompressionStream` / `pako`), а также вшивает JSON проекта в объект `/EmbeddedFile` (`90 0 obj`).|
|**VectorCraft (`.svg` слои)**|`exportPdfOrCraft('vectorcraft')`|Убирает растровый фильтр `#smooth-metaball` (`makeExportCloneEditableForVector`), оставляя клетки местности чистыми векторными `<rect>`, и встраивает снимок `STATE` в тег `<metadata>`.|
|**FigCraft (`.svg` слои)**|`exportPdfOrCraft('figcraft')`|Очищает SVG от нестандартных фильтров (`[filter]`) для безошибочного импорта по слоям в Figma.|
|**PhotoCraft (`.ora` со слоями)**|`exportOpenRaster()`|Рендерит каждый из 11 слоёв схемы в отдельный прозрачный PNG (`data/layer00.png`..`layer10.png`), формирует `stack.xml`, `Thumbnails/thumbnail.png` и упаковывает через `JSZip` в стандартный файл **OpenRaster (`.ora`)** для GIMP / Krita / PhotoCraft.|

## 16. Share / Read-Only

Поддерживаются два режима публикации схемы по кнопке `🔗 Поделиться` (`generateShareLink`):

  

1. **Автономный HTML-файл (`downloadStandaloneShare`)** — создаёт клон страницы `MURScheme_view.html`, очищает динамические слои и встраивает сериализованный `STATE` в `window.__MURSCHEME_PRELOADED__`. Файл открывается офлайн в любом браузере сразу в режиме `read-only-mode`.
    
      
    
2. **Онлайн-ссылка (`copyOnlineShareLink`)** — кодирует `STATE` в Base64 и записывает в хэш `#data=...`, который автоматически распознаётся функцией `checkReadOnlyUrl()` при открытии страницы.
    
      
    

## 17. I18N — двунаправленная локализация и авто-наблюдатель

В `beta 6` система интернационализации (`МОДУЛЬ 0: I18N`) переработана для 100%-го покрытия как статического HTML, так и динамически создаваемых элементов:

  

1. **Двунаправленный перевод (`RU ↔ EN`)**:
    
      
    - Метод `_buildReverseLookup()` автоматически строит обратный словарь `EN → RU` из `I18N.locales.en`.
        
          
        
    - Массив регулярных шаблонов `I18N.patterns` переводит составные динамические строки в обе стороны (`Клетка: 0, 0` ↔ `Cell: 0, 0`, `Уч. 1→2` ↔ `Seg. 1→2`, `Стрелка #1 (уч. 2)` ↔ `Arrow #1 (seg. 2)`, `Подветка #1 (4 т.)` ↔ `Branch #1 (4 pts.)`, `5 ост.` ↔ `5 stops` и т.д.).
        
          
        
    - При обходе текстовых узлов в `applyToDOM()` каждый узел сохраняет исходный русский ключ в `node._origRu`, что позволяет многократно переключать язык туда и обратно без потери текста.
        
          
        
2. **Автоматический `MutationObserver` и перехват диалогов (`initAutoObserver`)**:
    
      
    - Наблюдатель отслеживает добавление любых новых DOM-узлов в панели управления и контекстном меню (исключая `#canvas-svg`) и мгновенно переводит их на активный язык.
        
          
        
    - Стандартные вызовы `window.alert`, `window.confirm` и `window.prompt` обёрнуты через `I18N.t()`.
        
          
        
3. **Загрузка пользовательского `.json` перевода внутри выбора языка**:
    
      
    - Отдельная кнопка загрузки локали убрана из шапки: пункт `📂 Загрузить перевод (.json)...` (`value="__load_json__"`) встроен прямо внутрь `<select id="ui-lang-select">`.
        
          
        
    - При выборе этого пункта селектор возвращает визуальное значение на текущий язык и открывает диалог `#file-input-locale`. После чтения файла метод `I18N.registerLocale(code, dict, label)` автоматически добавляет новую опцию в `<select>` перед пунктом загрузки и активирует выбранный язык.
        
          
        

## 18. DBG — консоль отладки

- Выдвижная панель `#debug-console-drawer` логирует все действия пользователя (`[UI] click/input/change`), изменения состояния и ошибки выполнения.
    
      
    
- Метод `DBG.translateLogText(rawMsg)` и `DBG.refreshLogsI18N()` переводят даже уже записанные строки логов при переключении языка интерфейса.
    
      
    
- Встроенные инструменты самодиагностики: `runDiagnosticsTest()` (проверка наличия ключевых DOM ID), `dumpStateToLog()`, `runRenderTest()`, `triggerTestError()`.
    
      
    

## 19. Публичный API `MURSchemeAPI` и библиотека иконок

### 19.1. `window.MURSchemeAPI`

Публичный интерфейс для внешних скриптов и интеграций (`loadJSON`, `exportJSON`, `exportSVGString`, `clear`, `addLine`, `addStation`, `onChange`)[cite: 9].

  

### 19.2. Онлайн-библиотека 25 000+ SVG-иконок (Iconify API)

Модуль иконок POI в конце файла работает по гибридной схеме:

  

- **Стартовый каталог (`COMMON_MATERIAL_ICONS`)**: более 120 профильных транспортных, городских, туристических и инфраструктурных значков.
    
      
    
- **Словарь синонимов (`ICON_SEARCH_SYNONYMS`)**: переводит популярные русские и английские запросы (`авто`, `auto`, `машина`, `вокзал`, `метро`, `трамвай`, `тц`, `больница`, `мост`, `порт` и др.) в точные поисковые термины.
    
      
    
- **Поиск в реальном времени (`searchMaterialIconsApi`)**: обращается к `https://api.iconify.design/search?query=...&prefixes=ic,material-symbols,mdi&limit=60`, возвращая до 60 релевантных векторных значков на любой запрос.
    
      
    
- **Многоуровневая загрузка и кэширование (`ensureIconLoaded`)**:
    
      
    1. Проверяет наличие `<symbol id="mi-...">` в `#svg-defs` или вшитых данных `tlab.iconSvgData` внутри самого объекта POI (из загруженного `.json`).
        
          
        
    2. Проверяет кэш `localStorage` (`murscheme_icon_cache_v2`).
        
          
        
    3. Загружает чистый SVG через каскад `api.iconify.design` (`ic/baseline-*`, `material-symbols/*`, `mdi/*`) → `cdn.jsdelivr.net` → `fonts.gstatic.com`, очищает от пустых рамок `24x24` (`parseAndCleanSvgText`), сохраняет в `iconCache` и записывает в `activePoi.iconSvgData`, чтобы проект оставался полностью автономным при передаче `.json` на другой компьютер.
        
          
        

## 20. Рецепты расширения

- **Добавление нового стиля бейджей терминала или номеров на линии**: добавьте `<option>` в `#prop-line-badges-style` / `#term-style-select` / `#prop-term-style` и соответствующую ветку отрисовки в `renderLines()` и `renderTerminals()`.
    
      
    
- **Добавление нового слоя в экспорт**: при добавлении новой группы `<g>` в `#world-layer` зарегистрируйте её ID и читаемое имя в массиве `layerDefs` внутри `prepareExportClone()`, `exportOpenRaster()` и `exportLayeredPdfCraft()`.
    
      
    
- **Добавление новых строк интерфейса**: достаточно написать текст на русском языке в HTML или передать в `t('Текст')` и добавить английскую пару `'Текст': 'Text'` в `I18N.locales.en`.
    
      
    

## 21. Производительность и LOD

- Для интерактивных операций (перетаскивание станции, вершины или ползунков) вызываются точечные функции (`renderLines()`, `renderStations()`, `renderTerminals()`, `renderTerrainLabels()`), а полный `refreshCanvas()` используется при смене масштаба, загрузке проекта, отмене/повторе действий и глобальных операциях.
    
      
    
- Наблюдатель `I18N._observer` принудительно игнорирует мутации внутри `#canvas-svg` (`!n.closest('#canvas-svg')`), поэтому перерисовка тысяч SVG-узлов на холсте не создаёт накладных расходов в системе локализации.
    
      
    

## 22. Известные особенности и подводные камни

1. **Синхронизация `renderTerminals()` и `renderStations()`**: поскольку в режимах `replace-station` и `badges-only` подпись конечной станции отступает от реальных габаритов бейджей терминала (`getStationTerminalBadgeBox`), в конце `renderTerminals()` стоит защищённый флагом `window._inRenderStationsSync` вызов `renderStations()`.
    
      
    
2. **Инлайнинг `<use>` при экспорте**: браузерный `Canvas.drawImage(svgImg)` и внешние векторные редакторы часто не рендерят `<use href="#mi-...">`, ссылающиеся на `<symbol>` с внешним `fill`. Поэтому `prepareExportClone()` всегда заменяет `<use>` на самодостаточные `<svg>` со скопированным `innerHTML` символа.
    
      
    
3. **Приоритет пользовательского цвета у свободного текста**: флаги `tlab.customColorMain` и `tlab.customColorSub` выставляются в `true` при ручном выборе цвета в `#prop-tlabel-color` / `#prop-tlabel-subcolor` и сбрасываются в `false` по кнопке `Авто` (`#btn-reset-tlabel-typography`), чтобы глобальный авто-контраст не перезаписывал цвета подписей рек, лесов и районов.
    
      
    
4. **Клонирование узлов в `bindTerrainLabelPropsEvents()`**: функция инициализирует слушатели панели текста один раз (`window._tlabelEventsBound = true`) и очищает возможные старые дублирующиеся обработчики через `cloneNode(true)`.
    
      
    

## 23. Справочник DOM-идентификаторов

### Верхняя панель (`<header>`)

- Управление историей и сеткой: `btn-undo`, `btn-redo`, `grid-step-input`, `angle-snap-select`, `line-draw-mode-select`, `btn-clear-all`.
    
      
    
- Проект: `project-menu-container`, `btn-project-menu-toggle`, `project-dropdown-panel`, `project-filename-input`, `btn-save-project`, `btn-load-project`, `file-input-project`.
    
      
    
- Экспорт и шаринг: `export-menu-container`, `btn-export-menu-toggle`, `btn-share-link`, `export-dropdown-panel`, `export-filename-input`, `export-aspect-select`, `export-scale-select`, `export-format-select`, `btn-do-export`.
    
      
    
- Локализация: `ui-lang-select` (включая `<option value="__load_json__">`), `file-input-locale`.
    
      
    

### Свойства свободного текста (`#terrain-label-props-panel`)

- Текст и перевод: `prop-tlabel-text`, `prop-tlabel-subtext`, `btn-translate-tlabel`, `prop-tlabel-labelpos`.
    
      
    
- Типографика и цвета: `btn-reset-tlabel-typography`, `prop-tlabel-size`, `prop-tlabel-subsize`, `prop-tlabel-lineheight`, `prop-tlabel-spacing`, `prop-tlabel-color`, `prop-tlabel-subcolor`, `prop-tlabel-outline`, `prop-tlabel-outline-color`, `prop-tlabel-bold`, `prop-tlabel-italic`, `prop-tlabel-anchor`, `prop-tlabel-baseline`, `prop-tlabel-font`, `prop-tlabel-angle-num`, `prop-tlabel-angle-input`, `prop-tlabel-angle-val`.
    
      
    
- Иконки маршрутов у текста: `prop-tlabel-show-badges`, `box-tlabel-badges-opts`, `prop-tlabel-badge-shape`, `prop-tlabel-badge-pos`, `prop-tlabel-badge-size`, `tlabel-lines-checkboxes`.
    
      
    
- Координаты и действия: `prop-tlabel-x`, `prop-tlabel-y`, `btn-tlabel-duplicate`, `btn-tlabel-copy`, `btn-delete-tlabel`, `btn-tlabel-copy-style`, `btn-tlabel-paste-style`.
    
      
    

### Свойства объектов POI (`#poi-props-panel`)

- Координаты и тип: `prop-poi-x`, `prop-poi-y`, `prop-poi-type`, `box-poi-image`, `prop-poi-preview`, `btn-poi-upload-trigger`, `prop-poi-image-file`.
    
      
    
- Поиск и библиотека SVG: `box-poi-emoji`, `poi-api-search`, `btn-fetch-material-icon`, `material-icons-picker-grid`, `prop-poi-symbol`.
    
      
    
- Форма и цвета бейджа: `prop-poi-shape`, `prop-poi-auto-contrast`, `prop-poi-color`, `prop-poi-bg-plate`, `prop-poi-bg-color`[cite: 7].
    
      
    
- Внутренняя и внешняя подписи: `prop-poi-show-inner`, `row-poi-inner`, `prop-poi-inner-text`, `prop-poi-inner-size`, `prop-poi-inner-color`, `prop-poi-size`, `prop-poi-opacity`, `prop-poi-angle-input`, `prop-poi-label`, `prop-poi-sublabel`, `btn-translate-poi`, `prop-poi-label-pos`, `prop-poi-label-size`, `prop-poi-sublabel-size`, `prop-poi-label-color`, `prop-poi-sublabel-color`, `prop-poi-label-bold`, `prop-poi-label-italic`, `prop-poi-label-lineheight`, `btn-duplicate-poi`, `btn-delete-poi`[cite: 7].
    
      
    

### Пучки и стягивание к корневой линии (`#acc-sec-bundles`)

- `bundle-sort-select`, `bundle-gap-input`, `bundle-no-gap`, `bundle-shared-nodes-only`, `btn-auto-bundle`, `btn-bundle-selected-manual`, `btn-sync-common-nodes`, `btn-sync-corridor-points`, `btn-reset-bundles`, `bundle-sync-density`, `bundle-root-line`, `bundle-lines-selector`, `btn-root-nodes-pick-canvas`, `btn-root-nodes-select-all`, `bundle-root-nodes-chips`, `bundle-merge-radius`, `btn-sync-by-root-line`[cite: 7].
    
      
    

## 24. Справочник клавиш и жестов

| **Клавиша / жест**                 | **Действие**                                                              |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `V`                                | Инструмент «Выбор и перемещение»                                          |
| `L`                                | Инструмент «Трассировка линии»                                            |
| `S`                                | Инструмент «Поставить остановку»                                          |
| `X`                                | Инструмент «Создать пересадку»                                            |
| `D`                                | Инструмент «Декоративный путь»                                            |
| `B`                                | Инструмент «Окрасить местность»                                           |
| `T`                                | Инструмент «Написать текст»[cite: 7, 9]                                   |
| `I`                                | Инструмент «Добавить объект (POI)»[cite: 7, 9]                            |
| `Ctrl+Z` / `Cmd+Z`                 | Отменить действие (Undo)[cite: 7, 9]                                      |
| `Ctrl+Y` / `Ctrl+Shift+Z`          | Повторить действие (Redo)[cite: 7, 9]                                     |
| `Enter`                            | Завершить текущую трассировку линии / декоративного пути[cite: 7, 9]      |
| `Esc`                              | Сбросить незавершённую трассировку (`tempPoints`)[cite: 9]                |
| `Shift + ЛКМ` по объекту           | Добавить/убрать объект из мультивыделения и перетащить группу[cite: 7, 9] |
| `Ctrl + ЛКМ` по линии / узлу       | Перетащить всю линию целиком вместе с её станциями[cite: 7, 9]            |
| `ЛКМ` по стрелке / номеру на линии | Развернуть стрелку / сменить сторону номера маршрута[cite: 7, 9]          |
| `ПКМ` по стрелке / номеру / узлу   | Удалить ручную стрелку, ручной номер или узел линии/зоны[cite: 7, 9]      |
| `ПКМ` по объекту или холсту        | Открыть контекстное меню быстрых действий[cite: 7, 9]                     |
Приятного использования.