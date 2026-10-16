// =========================================================================
// Кисть озеленителя WorldEdit с режимом аккуратной посадки (JS Macros 1.19.4)
// Привязка: Вкладка "Events" -> строго ОДНО событие "InteractBlock" -> включить
// =========================================================================

(function() {
    const TOOL_ITEM = "minecraft:golden_axe";

    // --- РЕЖИМЫ КИСТИ ---
    const MODES = ["SINGLE", "CAREFUL", "SCATTER", "LINE", "CIRCLE"];

    // Базовый пул схем на сервере (worldedit/schematics БЕЗ .schem)
    const WE_POOL = [
        "TDM1",
        "TDM2",
        "TDM3",
        "TDM4",
        "TDM5"
    ];

    // --- КОНСТАНТЫ АККУРАТНОГО РЕЖИМА (ВОКРУГ ЗДАНИЙ И ОБЪЕКТОВ) ---
    const CAREFUL_RADIUS        = 12; // Радиус сканирования вокруг точки клика
    const CAREFUL_CLEARANCE     = 3;  // Отступ кроны от стен/декора (в блоках)
const CAREFUL_CHECK_HEIGHT  = 7;  // Высота проверки кроны
const CAREFUL_MIN_DISTANCE  = 4;  // Дистанция между стволами в городской зоне

// Отдельный пул более компактных деревьев для аккуратного режима
const WE_POOL_CAREFUL = [
    "TDM1",
    "TDM2",
    "TDM4"
];

// Список материалов зданий/декора, от которых скрипт отступает
const BUILDING_KEYWORDS = [
    "concrete", "brick", "glass", "wall", "terracotta", "stone_brick",
    "deepslate", "lantern", "fence", "iron_bars", "asphalt", "shingles"
];

// --- ПАРАМЕТРЫ ПЛОЩАДНЫХ КИСТЕЙ ---
const BRUSH_RADIUS   = 15;   // Радиус для Scatter/Circle или длина Line
const BRUSH_DENSITY  = 0.4;  // Плотность заполнения
const MIN_DISTANCE   = 5;    // Мин. дистанция между стволами
const SILENT_MODE    = true; // Скрывать сообщения команд в чате

const ALLOWED_GROUND = [
    "minecraft:grass_block", "minecraft:dirt", "minecraft:podzol",
    "minecraft:coarse_dirt", "minecraft:dirt_path", "minecraft:moss_block"
];

const PASSABLE_BLOCKS = [
    "minecraft:air", "minecraft:cave_air", "minecraft:grass", "minecraft:tall_grass",
    "minecraft:fern", "minecraft:large_fern", "minecraft:dandelion", "minecraft:poppy",
    "minecraft:snow"
];

const ROTATIONS = [0, 90, 180, 270];

// -------------------------------------------------------------------------
// 1. БАЗОВАЯ ФИЛЬТРАЦИЯ
const player = Player.getPlayer();
if (!player) return;

if (typeof event !== "undefined" && event) {
    if (event.offHand === true || String(event.offHand) === "true") return;
    if (event.hand && String(event.hand).toUpperCase().includes("OFF")) return;
}

if (player.getMainHand().getItem().getId() !== TOOL_ITEM) return;

let now = Date.now();

// 2. БЛОКИРОВКА ЗАНЯТОСТИ
let busyUntil = Number(GlobalVars.getString("WE_BRUSH_BUSY_UNTIL")) || 0;
if (now < busyUntil) return;

// 3. АРБИТРАЖ ТОКЕНОВ (Уничтожение параллельных потоков-дублей)
let myToken = Math.random() + "_" + now;
GlobalVars.putString("WE_BRUSH_TOKEN", myToken);
Client.waitTick(1);
if (GlobalVars.getString("WE_BRUSH_TOKEN") !== myToken) return;

// 4. ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ (Shift + ПКМ куда угодно)
if (player.isSneaking()) {
    GlobalVars.putString("WE_BRUSH_BUSY_UNTIL", String(Date.now() + 350));

    let currentMode = GlobalVars.getString("WE_BRUSH_MODE") || "SINGLE";
    let nextIdx = (MODES.indexOf(currentMode) + 1) % MODES.length;
    currentMode = MODES[nextIdx];
    GlobalVars.putString("WE_BRUSH_MODE", currentMode);

    const MODE_TITLES = {
        "SINGLE":  "§b§l[1/5] ТОЧЕЧНЫЙ (SINGLE) §f— ровно 1 дерево по клику",
 "CAREFUL": "§6§l[2/5] АККУРАТНЫЙ (CAREFUL) §f— безопасная посадка у зданий",
 "SCATTER": "§a§l[3/5] РОССЫПЬ (SCATTER) §f— естественный лесной массив",
 "LINE":    "§e§l[4/5] АЛЛЕЯ (LINE) §f— посадка в ряд по взгляду",
 "CIRCLE":  "§d§l[5/5] КОЛЬЦО (CIRCLE) §f— круговой сквер"
    };

    Chat.actionbar(MODE_TITLES[currentMode]);
    return;
}

// 5. РЕЙКАСТ ПОВЕРХНОСТИ
let hit = player.rayTraceBlock(60, false);
if (!hit) return;

let hitX = hit.getX();
let hitY = hit.getY();
let hitZ = hit.getZ();

function findGroundDownwards(x, startY, z, isSingle) {
    let scanY = isSingle ? startY + 2 : startY + 5;
    let minY  = startY - 8;

    for (let y = scanY; y >= minY; y--) {
        let bId = World.getBlock(x, y, z).getId();
        let upId = World.getBlock(x, y + 1, z).getId();

        let isSolid = !PASSABLE_BLOCKS.includes(bId) && !bId.includes("leaves");
        let isTopEmpty = PASSABLE_BLOCKS.includes(upId);

        if (isSolid && isTopEmpty) {
            if (isSingle || ALLOWED_GROUND.includes(bId)) {
                return y + 1;
            }
        }
    }
    return null;
}

// Проверка наличия фасадов зданий и декора вокруг кроны
function hasBuildingConflict(x, y, z) {
    let rad = CAREFUL_CLEARANCE;
    for (let ox = -rad; ox <= rad; ox++) {
        for (let oz = -rad; oz <= rad; oz++) {
            for (let oy = 1; oy <= CAREFUL_CHECK_HEIGHT; oy++) {
                let blockId = World.getBlock(x + ox, y + oy, z + oz).getId().toLowerCase();
                if (PASSABLE_BLOCKS.includes(blockId) || blockId.includes("leaves") || blockId.includes("air")) {
                    continue;
                }
                for (let k = 0; k < BUILDING_KEYWORDS.length; k++) {
                    if (blockId.includes(BUILDING_KEYWORDS[k])) {
                        return true; // Найден фасад здания или фонарь
                    }
                }
            }
        }
    }
    return false;
}

let currentMode = GlobalVars.getString("WE_BRUSH_MODE") || "SINGLE";
let targets = [];

// --- РЕЖИМ 1: ТОЧЕЧНЫЙ ---
if (currentMode === "SINGLE") {
    let gy = findGroundDownwards(hitX, hitY, hitZ, true);
    if (gy !== null) targets.push({ x: hitX, y: gy, z: hitZ });
    else {
        Chat.actionbar("§c[WE Кисть] Не найдена опора для дерева!");
        return;
    }

    // --- РЕЖИМ 2: АККУРАТНЫЙ У ЗДАНИЙ ---
} else if (currentMode === "CAREFUL") {
    let attempts = Math.floor(Math.PI * CAREFUL_RADIUS * CAREFUL_RADIUS * 0.15);
    let raw = [];

    for (let i = 0; i < attempts; i++) {
        let angle = Math.random() * Math.PI * 2;
        let r = Math.sqrt(Math.random()) * CAREFUL_RADIUS;
        let cx = Math.floor(hitX + r * Math.cos(angle));
        let cz = Math.floor(hitZ + r * Math.sin(angle));
        let cy = findGroundDownwards(cx, hitY, cz, false);

        if (cy !== null) {
            // Проверяем, чтобы крона не задевала здание
            if (!hasBuildingConflict(cx, cy, cz)) {
                raw.push({ x: cx, y: cy, z: cz });
            }
        }
    }

    for (let i = 0; i < raw.length; i++) {
        let p = raw[i];
        if (!targets.some(t => Math.hypot(p.x - t.x, p.z - t.z) < CAREFUL_MIN_DISTANCE)) {
            targets.push(p);
        }
    }

    // --- РЕЖИМ 3: РОССЫПЬ ---
} else if (currentMode === "SCATTER") {
    let attempts = Math.floor(Math.PI * BRUSH_RADIUS * BRUSH_RADIUS * BRUSH_DENSITY * 0.12);
    let raw = [];
    for (let i = 0; i < attempts; i++) {
        let angle = Math.random() * Math.PI * 2;
        let r = Math.sqrt(Math.random()) * BRUSH_RADIUS;
        let cx = Math.floor(hitX + r * Math.cos(angle));
        let cz = Math.floor(hitZ + r * Math.sin(angle));
        let cy = findGroundDownwards(cx, hitY, cz, false);
        if (cy !== null) raw.push({ x: cx, y: cy, z: cz });
    }
    for (let i = 0; i < raw.length; i++) {
        let p = raw[i];
        if (!targets.some(t => Math.hypot(p.x - t.x, p.z - t.z) < MIN_DISTANCE)) {
            targets.push(p);
        }
    }

    // --- РЕЖИМ 4: ЛИНИЯ ---
} else if (currentMode === "LINE") {
    let yawRad = (player.getYaw() % 360) * Math.PI / 180;
    let dirX = -Math.sin(yawRad);
    let dirZ = Math.cos(yawRad);
    let step = Math.max(4, MIN_DISTANCE);

    for (let d = 0; d <= BRUSH_RADIUS; d += step) {
        let cx = Math.floor(hitX + dirX * d);
        let cz = Math.floor(hitZ + dirZ * d);
        let cy = findGroundDownwards(cx, hitY, cz, false);
        if (cy !== null) targets.push({ x: cx, y: cy, z: cz });
    }

    // --- РЕЖИМ 5: КОЛЬЦО ---
} else if (currentMode === "CIRCLE") {
    let stepAngle = (2 * Math.asin(MIN_DISTANCE / (2 * BRUSH_RADIUS))) || 0.45;
    for (let a = 0; a < Math.PI * 2; a += stepAngle) {
        let cx = Math.floor(hitX + BRUSH_RADIUS * Math.cos(a));
        let cz = Math.floor(hitZ + BRUSH_RADIUS * Math.sin(a));
        let cy = findGroundDownwards(cx, hitY, cz, false);
        if (cy !== null) targets.push({ x: cx, y: cy, z: cz });
    }
}

if (targets.length === 0) {
    Chat.actionbar("§c[WE Кисть] Нет подходящих мест (слишком близко к зданиям)!");
    return;
}

// Блокируем новые клики на время вставки
GlobalVars.putString("WE_BRUSH_BUSY_UNTIL", String(Date.now() + (targets.length * 300 + 800)));

// 6. ИСПОЛНЕНИЕ: ТЕЛЕПОРТ И ВСТАВКА
let origX = player.getX().toFixed(2);
let origY = player.getY().toFixed(2);
let origZ = player.getZ().toFixed(2);
let origYaw = player.getYaw().toFixed(2);
let origPitch = player.getPitch().toFixed(2);

if (SILENT_MODE) {
    Chat.say("/gamerule sendCommandFeedback false");
    Client.waitTick(1);
}

// Выбор пула: для CAREFUL берется компактный пул, для остальных — общий
let activePool = (currentMode === "CAREFUL") ? WE_POOL_CAREFUL : WE_POOL;

for (let i = 0; i < targets.length; i++) {
    let pt = targets[i];
    let selectedSchem = activePool[Math.floor(Math.random() * activePool.length)];
    let rot = ROTATIONS[Math.floor(Math.random() * ROTATIONS.length)];

    Chat.say("//schem load " + selectedSchem);
    Client.waitTick(1);

    if (rot > 0) {
        Chat.say("//rotate " + rot);
        Client.waitTick(1);
    }

    Chat.say("/tp @s " + pt.x + " " + pt.y + " " + pt.z);
    Client.waitTick(2);

    Chat.say("//paste -a");
    Client.waitTick(1);

    if (currentMode === "SINGLE") {
        Chat.actionbar("§a[Посажено] §f" + selectedSchem + " §7(" + rot + "°)");
    }
}

// Возврат игрока на исходное место
Chat.say("/tp @s " + origX + " " + origY + " " + origZ + " " + origYaw + " " + origPitch);

if (SILENT_MODE) {
    Client.waitTick(1);
    Chat.say("/gamerule sendCommandFeedback true");
}
})();
