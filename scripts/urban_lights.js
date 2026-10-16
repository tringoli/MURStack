// =========================================================================
// Умное автоматическое освещение окон (JS Macros 1.19.4)
// =========================================================================

const radius = 20;        // Радиус сканирования вокруг игрока
const lightRatio = 0.3;   // Шанс горящего окна (30% свет, 70% тьма)
const blocksPerTick = 4;  // Скорость застройки (4 блока за 1 тик = 80 блоков/сек)
const silentMode = true;  // 🤫 ТИХИЙ РЕЖИМ: глушит системный спам команд в чат

// Идентификаторы блоков света и тьмы
const blockLight = "chisel:large_tile/glowstone";
const blockDark = "minecraft:black_concrete";

const player = Player.getPlayer();

// Главный вектор взгляда игрока по сетке
function getPlayerInwardVector() {
    let yaw = player.getYaw() % 360;
    if (yaw < 0) yaw += 360;

    if (yaw >= 315 || yaw < 45) return { dx: 0, dz: 1 };   // Взгляд на Юг -> комната на Юге (+Z)
    if (yaw >= 45 && yaw < 135) return { dx: -1, dz: 0 };  // Взгляд на Запад -> комната на Западе (-X)
    if (yaw >= 135 && yaw < 225) return { dx: 0, dz: -1 }; // Взгляд на Север -> комната на Севере (-Z)
    if (yaw >= 225 && yaw < 315) return { dx: 1, dz: 0 };  // Взгляд на Восток -> комната на Востоке (+X)
    return { dx: 0, dz: -1 };
}

const mainInward = getPlayerInwardVector();

let yawRad = (player.getYaw() % 360) * Math.PI / 180;
let lookX = -Math.sin(yawRad);
let lookZ = Math.cos(yawRad);

// 🛡 Проверка сектора перед глазами игрока
function isInFront(x, z, px, pz) {
    let dirX = x - px;
    let dirZ = z - pz;
    if (dirX === 0 && dirZ === 0) return true;
    let dot = dirX * lookX + dirZ * lookZ;
    return dot > -2.0;
}

// 🔍 ПРОВЕРКА ОКНА (Vanilla, Blockus, Macaw's, Chisel, Yuushya, Chipped)
function isWindow(id) {
    if (!id) return false;
    let s = String(id).toLowerCase();

    // 🚫 1. Исключаем дорожные моды (alt_fabroads)
    if (s.startsWith("alt_fabroads:") ||
        s.startsWith("fabroads:") ||
        s.includes("asphalt") ||
        s.includes("marking") ||
        s.includes("curb") ||
        s.includes("traffic") ||
        s.includes("road_sign") ||
        s.includes("road")) {
        return false;
        }

        // 🚫 2. Исключаем конструктивные элементы фасадов, шторы и ограждения
        if (s.includes("sideway_frame") ||
            s.includes("parapet") ||
            s.includes("railing") ||
            s.includes("balcony_railing") ||
            s.includes("curtain") ||
            s.includes("roof") ||
            s.includes("fence") ||
            s.includes("shutter")) {
            return false;
            }

            // 🌟 3. Поддержка всех типов стекла
            return s.includes("window") ||
            s.includes("glass") ||
            s.includes("pane") ||
            s.includes("beveled") ||
            s.includes("diagonal") ||
            s.includes("frosted") ||
            s.includes("stained_glass") ||
            (s.startsWith("yuushya:") && (s.includes("white_") || s.includes("black_") || s.includes("brown_") || s.includes("classical_")) && s.includes("diagonal"));
}

// Проверка на воздух или заменяемый блок
function isAirOrReplaceable(id) {
    if (!id) return true;
    let s = String(id).toLowerCase();
    return s.includes("air") || s === "minecraft:light" || s.includes("structure_void");
}

// Проверка на твердый блок стены здания
function isSolidWallBlock(x, y, z) {
    let id = World.getBlock(x, y, z).getId();
    if (isAirOrReplaceable(id)) return false;
    if (id === blockLight || id === blockDark) return false;
    if (isWindow(id)) return false;
    return true;
}

// 📐 ЛОКАЛЬНЫЙ РАСЧЁТ ПРИЛЕГАЮЩЕЙ ТОЧКИ ДЛЯ СЛОЖНЫХ УГЛОВ (22.5°, 45°, 60°, дуги)
function getBestCurvedInteriorTarget(x, y, z, px, pz) {
    let candidates = [
        { dx: 0, dz: 1 },
        { dx: 0, dz: -1 },
        { dx: 1, dz: 0 },
        { dx: -1, dz: 0 }
    ];

    let winDistSq = (x - px) * (x - px) + (z - pz) * (z - pz);
    let vecX = x - px;
    let vecZ = z - pz;

    // Соседи-стекла для определения локальной касательной к стене
    let glassEast  = isWindow(World.getBlock(x + 1, y, z).getId());
    let glassWest  = isWindow(World.getBlock(x - 1, y, z).getId());
    let glassSouth = isWindow(World.getBlock(x, y, z + 1).getId());
    let glassNorth = isWindow(World.getBlock(x, y, z - 1).getId());

    let wallX = glassEast || glassWest || isSolidWallBlock(x + 1, y, z) || isSolidWallBlock(x - 1, y, z);
    let wallZ = glassSouth || glassNorth || isSolidWallBlock(x, y, z + 1) || isSolidWallBlock(x, y, z - 1);

    let bestTarget = null;
    let bestScore = -999999;

    for (let i = 0; i < candidates.length; i++) {
        let c = candidates[i];
        let tx = x + c.dx;
        let ty = y;
        let tz = z + c.dz;

        let bId = World.getBlock(tx, ty, tz).getId();

        // 🛑 Нельзя ставить в другое стекло или в толщу стены
        if (isWindow(bId) || isSolidWallBlock(tx, ty, tz)) continue;

        // Точка должна быть воздухом или существующим блоком света
        if (!isAirOrReplaceable(bId) && bId !== blockLight && bId !== blockDark) continue;

        // 🛡 Точка обязана быть глубже в здании, чем стекло (не на улице!)
        let targetDistSq = (tx - px) * (tx - px) + (tz - pz) * (tz - pz);
        if (targetDistSq < winDistSq - 0.05) continue;

        let score = 0;

        // 1. Проекция на вектор вглубь здания от игрока
        let dotRay = c.dx * vecX + c.dz * vecZ;
        score += dotRay * 20;

        // 2. Перпендикулярность локальной линии стены
        if (wallX && !wallZ && c.dz !== 0) score += 60; // Локальная стена по X -> нормаль Z
        if (wallZ && !wallX && c.dx !== 0) score += 60; // Локальная стена по Z -> нормаль X

        // 3. Анализ замкнутости помещения (наличие пола/потолка/внутренних перегородок)
        let surrounding = [
            {ox: 0, oy: 1, oz: 0}, {ox: 0, oy: -1, oz: 0},
            {ox: 1, oy: 0, oz: 0}, {ox: -1, oy: 0, oz: 0},
            {ox: 0, oy: 0, oz: 1}, {ox: 0, oy: 0, oz: -1}
        ];
        let enclosed = 0;
        for (let s = 0; s < surrounding.length; s++) {
            let sid = World.getBlock(tx + surrounding[s].ox, ty + surrounding[s].oy, tz + surrounding[s].oz).getId();
            if (!isAirOrReplaceable(sid)) enclosed++;
        }
        score += enclosed * 5;

        if (score > bestScore) {
            bestScore = score;
            bestTarget = { x: tx, y: ty, z: tz };
        }
    }

    if (bestTarget) return bestTarget;

    // Резервный расчет по направлению взгляда
    if (Math.abs(vecZ) >= Math.abs(vecX)) {
        let dz = (vecZ >= 0) ? 1 : -1;
        return { x: x, y: y, z: z + dz };
    } else {
        let dx = (vecX >= 0) ? 1 : -1;
        return { x: x + dx, y: y, z: z };
    }
}

// 🛡 Проверка наличия уже установленного цвета в соседней точке
function getLocalExistingBlock(targetX, targetY, targetZ) {
    let offsets = [
        {x: 0, y: 1, z: 0}, {x: 0, y: -1, z: 0},
        {x: 1, y: 0, z: 0}, {x: -1, y: 0, z: 0},
        {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}
    ];
    for (let i = 0; i < offsets.length; i++) {
        let o = offsets[i];
        let bId = World.getBlock(targetX + o.x, targetY + o.y, targetZ + o.z).getId();
        if (bId === blockLight || bId === blockDark) {
            return bId;
        }
    }
    return null;
}

let px = Math.floor(player.getX());
let py = Math.floor(player.getY());
let pz = Math.floor(player.getZ());

let visited = new Set();
let targetedCoords = new Set();
let tasksToBuild = [];

function getPosKey(x, y, z) {
    return `${x},${y},${z}`;
}

Chat.log(`§e[Урбанист] §fСканирую фасад (Фикс кривых углов 22.5°/45°/60°: §aАКТИВЕН§f)...`);

// 1. Поиск и группировка окон (8-направленный Flood Fill для сбора ломаных стен)
for (let x = px - radius; x <= px + radius; x++) {
    for (let z = pz - radius; z <= pz + radius; z++) {

        if (!isInFront(x, z, px, pz)) continue;

        for (let y = py - radius; y <= py + radius; y++) {

            let key = getPosKey(x, y, z);
            if (visited.has(key)) continue;

            let blockId = World.getBlock(x, y, z).getId();

            if (isWindow(blockId)) {
                let stack = [{x: x, y: y, z: z}];
                visited.add(key);

                let rawWindowBlocks = [];

                while (stack.length > 0) {
                    let curr = stack.pop();
                    rawWindowBlocks.push(curr);

                    let neighbors = [
                        {x: curr.x + 1, y: curr.y, z: curr.z},
                        {x: curr.x - 1, y: curr.y, z: curr.z},
                        {x: curr.x, y: curr.y + 1, z: curr.z},
                        {x: curr.x, y: curr.y - 1, z: curr.z},
                        {x: curr.x, y: curr.y, z: curr.z + 1},
                        {x: curr.x, y: curr.y, z: curr.z - 1},
                        // Диагональные связки для ступенчатых углов 22.5°/45°/60°
                        {x: curr.x + 1, y: curr.y, z: curr.z + 1},
                        {x: curr.x + 1, y: curr.y, z: curr.z - 1},
                        {x: curr.x - 1, y: curr.y, z: curr.z + 1},
                        {x: curr.x - 1, y: curr.y, z: curr.z - 1}
                    ];

                    for (let i = 0; i < neighbors.length; i++) {
                        let n = neighbors[i];
                        let nKey = getPosKey(n.x, n.y, n.z);

                        if (!visited.has(nKey)) {
                            if (Math.abs(n.x - px) <= radius && Math.abs(n.y - py) <= radius && Math.abs(n.z - pz) <= radius) {
                                let nId = World.getBlock(n.x, n.y, n.z).getId();

                                if (isWindow(nId)) {
                                    visited.add(nKey);
                                    stack.push(n);
                                }
                            }
                        }
                    }
                }

                if (rawWindowBlocks.length > 0) {
                    let groupTargets = [];
                    let existingBlockInGroup = null;

                    for (let b = 0; b < rawWindowBlocks.length; b++) {
                        let wBlock = rawWindowBlocks[b];

                        // Локальный расчёт для каждой ступени криволинейного окна
                        let target = getBestCurvedInteriorTarget(wBlock.x, wBlock.y, wBlock.z, px, pz);
                        let behindId = World.getBlock(target.x, target.y, target.z).getId();

                        if (behindId === blockLight || behindId === blockDark) {
                            existingBlockInGroup = behindId;
                        } else if (isAirOrReplaceable(behindId)) {
                            let tKey = getPosKey(target.x, target.y, target.z);
                            if (!targetedCoords.has(tKey)) {
                                targetedCoords.add(tKey);
                                groupTargets.push({ targetX: target.x, targetY: target.y, targetZ: target.z });
                            }
                        }
                    }

                    if (groupTargets.length > 0) {
                        let chosenBlock = existingBlockInGroup;

                        if (!chosenBlock) {
                            for (let k = 0; k < groupTargets.length; k++) {
                                let local = getLocalExistingBlock(groupTargets[k].targetX, groupTargets[k].targetY, groupTargets[k].targetZ);
                                if (local) {
                                    chosenBlock = local;
                                    break;
                                }
                            }
                        }

                        if (!chosenBlock) {
                            chosenBlock = (Math.random() <= lightRatio) ? blockLight : blockDark;
                        }

                        for (let k = 0; k < groupTargets.length; k++) {
                            let t = groupTargets[k];
                            tasksToBuild.push({
                                targetX: t.targetX,
                                targetY: t.targetY,
                                targetZ: t.targetZ,
                                blockToPlace: chosenBlock
                            });
                        }
                    }
                }
            }
        }
    }
}

let lightCount = 0;
let darkCount = 0;

for (let i = 0; i < tasksToBuild.length; i++) {
    if (tasksToBuild[i].blockToPlace === blockLight) lightCount++;
    else darkCount++;
}

Chat.log(`§e[Урбанист] §fНайдено ячеек: §a${tasksToBuild.length}§f (💡 Свет: §e${lightCount}§f, ⬛ Тьма: §7${darkCount}§f). Застройка...`);

// 🤫 2. Включаем тихий режим
if (silentMode && tasksToBuild.length > 0) {
    Chat.say(`/gamerule sendCommandFeedback false`);
    Client.waitTick(1);
}

let changed = 0;

// 3. Застройка
for (let i = 0; i < tasksToBuild.length; i++) {
    let task = tasksToBuild[i];

    Chat.say(`/setblock ${task.targetX} ${task.targetY} ${task.targetZ} ${task.blockToPlace}`);
    changed++;

    if (changed % blocksPerTick === 0) {
        Client.waitTick(1);
    }
}

// 🔊 4. Возвращаем вывод команд обратно
if (silentMode && tasksToBuild.length > 0) {
    Client.waitTick(1);
    Chat.say(`/gamerule sendCommandFeedback true`);
}

Chat.log(`§a[Урбанист] §fЗастройка успешно завершена! Обработано блоков: §e${changed}`);