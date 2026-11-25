import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_SOLAR_POSITION,
  computeShadowOffset,
  computeWallShadowPolygons,
  computeWingShadowGeometry,
  ensureScreenPolygonCW,
} from './solarInsolation';
import {
  buildIconLabelCandidates,
  clipScreenSegmentToBox,
  ScreenLabelGrid,
} from './spatialIndex';
import {
  isUtilityOrTestRoute,
  parseMtrStationsAndRoutes,
} from './mtrParser';
import {
  ElementAppearanceAnimator,
  getPlaceHierarchyPriority,
  getStationHierarchyPriority,
  normalizeStationNameForDedup,
  TerritoryLabelFadeController,
} from './mapZoomLod';
import {
  getTransitStopSymbolHalfExtents,
  resolveStationStopSymbol,
} from './transitStopIcons';
import type { MapPlaceLabel, MtrStation } from '../types/map';

test('AMBIENT_SOLAR_POSITION casts consistent physical world-space ground, roof, and wall shadows', () => {
  assert.equal(AMBIENT_SOLAR_POSITION.shadowOpacity, 1);
  assert.ok(AMBIENT_SOLAR_POSITION.shadowLengthPerBlock > 0.4 && AMBIENT_SOLAR_POSITION.shadowLengthPerBlock < 1.2);

  const off = computeShadowOffset(20, AMBIENT_SOLAR_POSITION);
  assert.ok(Math.hypot(off.dx, off.dz) > 10, '20-block tall building should cast noticeable shadow');

  const footprint = [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 20 },
    { x: 0, z: 20 },
  ];
  const geom = computeWingShadowGeometry(footprint, 20, AMBIENT_SOLAR_POSITION);
  assert.ok(geom !== null);
  assert.equal(geom.shiftedRoof.length, 4);

  // Winding normalization guarantees all CW screen polygons have signedArea >= 0 (no cancellation holes)
  const ccw = [
    { sx: 0, sy: 0 },
    { sx: 0, sy: 10 },
    { sx: 10, sy: 10 },
    { sx: 10, sy: 0 },
  ];
  const cw = ensureScreenPolygonCW(ccw);
  let area2 = 0;
  for (let i = 0; i < cw.length; i++) {
    const j = (i + 1) % cw.length;
    area2 += cw[i].sx * cw[j].sy - cw[j].sx * cw[i].sy;
  }
  assert.ok(area2 >= 0, 'ensureScreenPolygonCW must output CW winding');

  // Upwind tall caster must cast wall shadow polygons onto downwind sun-facing wall
  const casterFp = [
    { x: -18, z: -12 },
    { x: -6, z: -12 },
    { x: -6, z: 4 },
    { x: -18, z: 4 },
  ];
  const wallPolys = computeWallShadowPolygons(
    { x: 0, z: -20 },
    { x: 0, z: 20 },
    -1,
    0,
    64,
    80,
    casterFp,
    64,
    104,
    AMBIENT_SOLAR_POSITION
  );
  assert.ok(wallPolys.length > 0, 'upwind tall building should cast shadow onto facing lower wall');
});

test('Cartographic hierarchy priorities enforce City > Town > Village > District > Metro > Rail > Tram > Bus', () => {
  const mkPlace = (tier: MapPlaceLabel['tier'], priority = 50): MapPlaceLabel => ({
    id: `p-${tier}`,
    name: tier,
    x: 0,
    z: 0,
    tier,
    priority,
  });
  const mkStation = (kinds: MtrStation['kinds'], routeCount = 2): MtrStation => ({
    id: `s-${kinds.join('-')}`,
    name: 'Test',
    x: 0,
    y: 64,
    z: 0,
    color: '#007FDE',
    kinds,
    routeIds: Array.from({ length: routeCount }, (_, i) => `r${i}`),
  });

  const cityPri = getPlaceHierarchyPriority(mkPlace('city'));
  const townPri = getPlaceHierarchyPriority(mkPlace('town'));
  const villagePri = getPlaceHierarchyPriority(mkPlace('village'));
  const districtPri = getPlaceHierarchyPriority(mkPlace('district'));
  const metroPri = getStationHierarchyPriority(mkStation(['metro']));
  const railPri = getStationHierarchyPriority(mkStation(['rail']));
  const tramPri = getStationHierarchyPriority(mkStation(['tram']));
  const busPri = getStationHierarchyPriority(mkStation(['bus']));

  assert.ok(cityPri > townPri);
  assert.ok(townPri > villagePri);
  assert.ok(villagePri > districtPri);
  assert.ok(districtPri > metroPri, 'District labels must always outrank Metro stations');
  assert.ok(metroPri > railPri);
  assert.ok(railPri > tramPri);
  assert.ok(tramPri > busPri);

  assert.equal(normalizeStationNameForDedup('  Платформа «Серп и Молот»  '), 'платформа серп и молот');
});

test('ScreenLabelGrid icon hitbox reservation blocks colliding lower-tier icons and finds fallback label anchors', () => {
  const grid = new ScreenLabelGrid(96, 30);

  const metroStation: MtrStation = {
    id: 'm1',
    name: 'Вокзальная',
    x: 10500,
    y: 50,
    z: -600,
    color: '#007FDE',
    kinds: ['metro'],
    routeIds: ['r1', 'r2'],
  };
  const metroSym = resolveStationStopSymbol(metroStation, []);
  const metroExt = getTransitStopSymbolHalfExtents(metroSym, { zoom: 0.4 });
  assert.ok(metroExt.halfW >= 10 && metroExt.halfH >= 10);

  // Reserve Metro icon + label at (400, 300)
  grid.reserve(400 - metroExt.halfW, 300 - metroExt.halfH, 400 + metroExt.halfW, 300 + metroExt.halfH);
  grid.reserve(414, 292, 495, 308);

  // A small rail icon right on top of the metro badge (404, 301) must be rejected
  assert.equal(grid.canPlace(395, 293, 413, 309), false);
  // A small rail icon right on top of the "Вокзальная" text (435, 300) must also be rejected
  assert.equal(grid.canPlace(426, 292, 444, 308), false);

  // A non-overlapping station slightly below at (400, 332) passes icon check and uses fallback anchor if right is occupied
  assert.equal(grid.canPlace(391, 323, 409, 341), true);
  grid.reserve(412, 324, 500, 340); // block right candidate
  const chosen = grid.tryPlaceWithCandidates([
    { x1: 412, y1: 324, x2: 495, y2: 340 }, // Right (blocked)
    { x1: 300, y1: 324, x2: 388, y2: 340 }, // Left (free)
  ]);
  assert.equal(chosen, 1, 'tryPlaceWithCandidates should pick first non-colliding fallback anchor');
});

test('clipScreenSegmentToBox accurately clips long off-screen transit segments to viewport bounds', () => {
  const clipped = clipScreenSegmentToBox(-5000, 300, 8000, 300, -64, -64, 1504, 964);
  assert.ok(clipped !== null);
  assert.equal(clipped.ax, -64);
  assert.equal(clipped.bx, 1504);
  assert.equal(clipped.ay, 300);
  assert.equal(clipped.by, 300);

  // Completely outside segment returns null
  assert.equal(clipScreenSegmentToBox(-2000, -500, -100, -500, -64, -64, 1504, 964), null);
});

test('ElementAppearanceAnimator animates newly appearing elements smoothly and settles cleanly to idle', () => {
  const anim = new ElementAppearanceAnimator(300, 100);

  // Initial seed frame: elements already visible start settled at 1
  anim.beginFrame();
  assert.equal(anim.getProgress('city:murs', 1000), 1);
  assert.equal(anim.hasActiveAnimations, false);
  anim.endFrame(1000);

  // New element appearing after zoom change starts easing from < 0.2 and activates rAF flag
  anim.beginFrame();
  const p0 = anim.getProgress('station:vokzalnaya', 1050);
  assert.ok(p0 > 0 && p0 < 0.2, `Expected initial entrance progress in (0, 0.2), got ${p0}`);
  assert.equal(anim.hasActiveAnimations, true);
  anim.endFrame(1050);

  // Mid-animation progress increases monotonically
  anim.beginFrame();
  const pMid = anim.getProgress('station:vokzalnaya', 1200);
  assert.ok(pMid > p0 && pMid < 1, `Expected mid progress (${pMid}) between ${p0} and 1`);
  assert.equal(anim.hasActiveAnimations, true);
  anim.endFrame(1200);

  // After durationMs, settles cleanly to 1 with hasActiveAnimations === false (0% idle CPU)
  anim.beginFrame();
  const pDone = anim.getProgress('station:vokzalnaya', 1400);
  assert.equal(pDone, 1);
  assert.equal(anim.hasActiveAnimations, false);
  anim.endFrame(1400);

  // Even after a 1500ms idle tick, an element rendered on consecutive frames stays settled at 1 (zero flicker!)
  anim.beginFrame();
  assert.equal(anim.getProgress('station:vokzalnaya', 2900), 1);
  assert.equal(anim.hasActiveAnimations, false);
  anim.endFrame(2900);

  // Frame where element is NOT visible (hidden by zoom LOD / culled)
  anim.beginFrame();
  anim.endFrame(2950);

  // Next frame where element reappears -> smoothly re-animates from < 0.2
  anim.beginFrame();
  const pReappear = anim.getProgress('station:vokzalnaya', 3000);
  assert.ok(pReappear < 0.2, `Expected re-appearance reset < 0.2, got ${pReappear}`);
  assert.equal(anim.hasActiveAnimations, true);
  anim.endFrame(3000);
});

test('buildIconLabelCandidates never self-collides with its own reserved station icon hitbox', () => {
  const grid = new ScreenLabelGrid(96, 30);
  const cx = 420;
  const cy = 280;
  const halfW = 12.6;
  const halfH = 11.6;
  const iconPad = 3.5;

  // Reserve Metro icon box exactly as Pass 9 tryPlaceStation does
  grid.reserve(cx - halfW - iconPad, cy - halfH - iconPad, cx + halfW + iconPad, cy + halfH + iconPad);

  const candidates = buildIconLabelCandidates(cx, cy, halfW, halfH, iconPad, 84, 8.5);
  assert.equal(candidates.length, 8);
  // Every single one of the 8 candidates must be strictly outside the icon's own reserved box!
  for (let i = 0; i < candidates.length; i++) {
    const b = candidates[i].box;
    assert.equal(
      grid.canPlace(b.x1, b.y1, b.x2, b.y2),
      true,
      `Candidate ${i} must never self-collide with its own icon reservation`
    );
  }
  const winIdx = grid.tryPlaceWithCandidates(candidates.map((c) => c.box));
  assert.equal(winIdx, 0, 'Primary Right candidate must win immediately on an uncluttered grid');
});

test('isUtilityOrTestRoute filters out obkatka/test routes so tram stops never misclassify as rail and rail color is preserved', () => {
  assert.equal(isUtilityOrTestRoute({ name: '(О2) Обкатка Витте', stations: [{ id: 'a', x: 0, y: 64, z: 0, name: 'A' }, { id: 'b', x: 10, y: 64, z: 0, name: 'B' }] }), true);
  assert.equal(isUtilityOrTestRoute({ name: 'Открытие трамвая', stations: [{ id: 'a', x: 0, y: 64, z: 0, name: 'A' }, { id: 'b', x: 10, y: 64, z: 0, name: 'B' }] }), true);
  assert.equal(isUtilityOrTestRoute({ name: 'тест', stations: [{ id: 'a', x: 0, y: 64, z: 0, name: 'A' }, { id: 'b', x: 10, y: 64, z: 0, name: 'B' }] }), true);
  assert.equal(isUtilityOrTestRoute({ name: 'ММЦ(4) - МАР', stations: [{ id: 'a', x: 0, y: 64, z: 0, name: 'A' }, { id: 'b', x: 10, y: 64, z: 0, name: 'B' }] }), false);

  const parsed = parseMtrStationsAndRoutes({
    data: {
      stations: [
        { id: 's-dep', name: 'Деповской проезд', color: 0xc8102e },
        { id: 's-sim', name: 'Платформа "Серп и Молот"', color: 0x2ca05a },
        { id: 's-cv', name: 'Центральный вокзал', color: 0x2ca05a },
      ],
      routes: [
        {
          id: 'r-obkatka',
          name: '(О2) Обкатка Витте',
          type: 'train_normal',
          color: 0x00bfda,
          stations: [
            { id: 's-sim', x: 13544, y: 64, z: 204, name: '1' },
            { id: 's-dep', x: 13900, y: 64, z: 500, name: '1' },
          ],
        },
        {
          id: 'r-tram13',
          name: '(Т13) ЦВ->7мкр',
          type: 'train_tram',
          jmeType: 'train_tram',
          color: 0xc8102e,
          stations: [
            { id: 's-sim', x: 13544, y: 64, z: 204, name: '1' },
            { id: 's-dep', x: 13900, y: 64, z: 500, name: '1' },
          ],
        },
        {
          id: 'r-rail',
          name: 'ММЦ(4) - МАР',
          type: 'train_normal',
          color: 0x2ca05a,
          stations: [
            { id: 's-cv', x: 12220, y: 64, z: 320, name: '1' },
            { id: 's-sim', x: 13544, y: 64, z: 204, name: '1' },
          ],
        },
      ],
    },
  });

  // Break-in route must be filtered out completely
  assert.equal(parsed.routes.some((r) => r.id === 'r-obkatka'), false);

  // Regular tram stop "Деповской проезд" must ONLY be tram, NEVER rail!
  const dep = parsed.stations.find((s) => s.id === 's-dep');
  assert.ok(dep);
  assert.deepEqual(dep.kinds, ['tram']);

  // Real rail + tram transfer "Платформа Серп и Молот" keeps rail color (#2CA05A), not overwritten by tram red!
  const sim = parsed.stations.find((s) => s.id === 's-sim');
  assert.ok(sim);
  assert.equal(sim.kinds.includes('rail'), true);
  assert.equal(sim.color, '#2CA05A');
});

test('District labels (e.g. Вокзальная) never hide near Metro stations and steer station text labels around them', () => {
  const placeGrid = new ScreenLabelGrid(96, 30);
  const labelGrid = new ScreenLabelGrid(96, 30);

  // District "ВОКЗАЛЬНАЯ" placed at (350, 311) — 50px left of Metro (M) Вокзальная at (400, 300)
  const distBox = { x1: 307, y1: 302, x2: 393, y2: 320 };
  assert.equal(placeGrid.tryPlace(distBox.x1, distBox.y1, distBox.x2, distBox.y2), true);

  // Metro (M) icon at (400, 300) still places in labelGrid (not killed by adjacent district!)
  const iconBox = { x1: 382.5, y1: 282.5, x2: 417.5, y2: 317.5 };
  assert.equal(labelGrid.tryPlace(iconBox.x1, iconBox.y1, iconBox.x2, iconBox.y2), true);

  // Metro station text label tests candidates against BOTH labelGrid and placeGrid
  const candidates = buildIconLabelCandidates(400, 300, 14, 14, 3.5, 68, 8.5);
  let chosen = -1;
  for (let i = 0; i < candidates.length; i++) {
    const b = candidates[i].box;
    if (labelGrid.canPlace(b.x1, b.y1, b.x2, b.y2) && placeGrid.canPlace(b.x1, b.y1, b.x2, b.y2)) {
      labelGrid.reserve(b.x1, b.y1, b.x2, b.y2);
      chosen = i;
      break;
    }
  }
  assert.equal(chosen, 0, 'Metro label should cleanly pick Right candidate clear of district on left');

  // If a district sits to the RIGHT of a Metro icon, the Metro label automatically moves to Left/Top/Bottom
  const placeGrid2 = new ScreenLabelGrid(96, 30);
  const labelGrid2 = new ScreenLabelGrid(96, 30);
  placeGrid2.reserve(415, 290, 505, 310); // District directly on the right side
  labelGrid2.reserve(iconBox.x1, iconBox.y1, iconBox.x2, iconBox.y2);
  let chosen2 = -1;
  for (let i = 0; i < candidates.length; i++) {
    const b = candidates[i].box;
    if (labelGrid2.canPlace(b.x1, b.y1, b.x2, b.y2) && placeGrid2.canPlace(b.x1, b.y1, b.x2, b.y2)) {
      chosen2 = i;
      break;
    }
  }
  assert.equal(chosen2, 1, 'Metro label must yield Right side to district label and pick Left candidate');
});

test('TerritoryLabelFadeController smoothly fades out on camera motion, hides while moving, and fades back in after stopping', () => {
  const ctrl = new TerritoryLabelFadeController(150, 220, 300);
  const cam0 = { x: 10550, z: -620, zoom: 0.4, pitch: 40, bearing: 0 };

  // 1. Initial frame computes settled territory labels and renders at opacity 1
  const s0 = ctrl.update(cam0, false, 1000);
  assert.equal(s0.phase, 'visible');
  assert.equal(s0.opacity, 1);
  assert.equal(s0.shouldRecompute, true);
  assert.equal(s0.needsAnimationFrame, false);
  ctrl.setCachedLabels([
    {
      key: 'land-lbl:mur',
      name: 'Река Мур',
      kind: 'water',
      worldX: 10550,
      worldZ: -620,
      angle: -0.4,
      baseAlpha: 1,
      isRegional: false,
    },
  ]);

  // 2. Camera begins panning -> immediately enters fading-out WITHOUT recomputing placement
  const cam1 = { ...cam0, x: 10580 };
  const sMove1 = ctrl.update(cam1, true, 1050);
  assert.equal(sMove1.phase, 'fading-out');
  assert.equal(sMove1.shouldRecompute, false);
  assert.equal(sMove1.needsAnimationFrame, true);

  // Mid fade-out: opacity drops smoothly between 0 and 1
  const cam2 = { ...cam0, x: 10620 };
  const sMove2 = ctrl.update(cam2, true, 1125);
  assert.equal(sMove2.phase, 'fading-out');
  assert.ok(sMove2.opacity > 0.05 && sMove2.opacity < 0.7, `Expected mid fade-out opacity, got ${sMove2.opacity}`);
  assert.equal(sMove2.shouldRecompute, false);

  // After fadeOutMs -> completely hidden while camera keeps moving
  const cam3 = { ...cam0, x: 10700 };
  const sHidden = ctrl.update(cam3, true, 1220);
  assert.equal(sHidden.phase, 'hidden');
  assert.equal(sHidden.opacity, 0);
  assert.equal(sHidden.shouldRecompute, false);
  assert.equal(sHidden.needsAnimationFrame, false);

  // 3. Camera stops moving -> waits settleDelayMs before reappearing (schedules wake timer)
  const sWait = ctrl.update(cam3, false, 1300);
  assert.equal(sWait.phase, 'hidden');
  assert.equal(sWait.opacity, 0);
  assert.equal(sWait.shouldRecompute, false);
  assert.ok(sWait.wakeAfterMs !== null && sWait.wakeAfterMs > 0);

  // 4. After settleDelayMs (1220 + 220 = 1440) -> recomputes ONCE and fades in smoothly
  const sFadeIn0 = ctrl.update(cam3, false, 1460);
  assert.equal(sFadeIn0.phase, 'fading-in');
  assert.equal(sFadeIn0.shouldRecompute, true);
  assert.ok(sFadeIn0.opacity > 0 && sFadeIn0.opacity < 0.25);
  assert.equal(sFadeIn0.needsAnimationFrame, true);

  // Subsequent fade-in frame does NOT recompute placement again (rock-solid!)
  const sFadeInMid = ctrl.update(cam3, false, 1600);
  assert.equal(sFadeInMid.phase, 'fading-in');
  assert.equal(sFadeInMid.shouldRecompute, false);
  assert.ok(sFadeInMid.opacity > sFadeIn0.opacity && sFadeInMid.opacity < 1);

  // After fadeInMs -> settles at visible, opacity === 1, 0% idle CPU
  const sDone = ctrl.update(cam3, false, 1800);
  assert.equal(sDone.phase, 'visible');
  assert.equal(sDone.opacity, 1);
  assert.equal(sDone.scale, 1);
  assert.equal(sDone.needsAnimationFrame, false);
});



