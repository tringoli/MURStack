import type {
  Building3D,
  LandFeature,
  MtrRoute,
  MtrStation,
  StreetSegment,
} from '../types/map';
import { MUROMORSK_WIKI_COLORS } from '../utils/mursTransitBrand';

/**
 * Default camera centered on central Муроморск (Адмиралтейский / Приморский районы)
 */
export const MURS_DEFAULT_CENTER = {
  x: 10550,
  z: -620,
};

export const MURS_QUICK_DISTRICTS = [
  { id: 'center', name: 'Центр · Театральная', x: 10910, z: -1480, zoom: 0.42 },
  { id: 'primorsky', name: 'Морской бульвар', x: 9680, z: -40, zoom: 0.44 },
  { id: 'narodnaya', name: 'Узел «Народная»', x: 10040, z: -780, zoom: 0.42 },
  { id: 'vokzal', name: 'Вокзальная', x: 12215, z: 300, zoom: 0.42 },
  { id: 'ivanko', name: 'Иваноостровская', x: 10295, z: -2840, zoom: 0.4 },
  { id: 'dvorets', name: 'Дворец Спорта', x: 13520, z: 1400, zoom: 0.4 },
];

/**
 * Initial schematic map starts clean with transit lines & stops only.
 * Buildings, streets, parks, and water bodies are added via Synthesis or the Map Editor.
 */
export const DEFAULT_LAND_FEATURES: LandFeature[] = [];

export const DEFAULT_STREETS: StreetSegment[] = [];

export const DEFAULT_BUILDINGS: Building3D[] = [];

/**
 * Fallback transit network snapshot (real station coordinates & lines of Муроморск)
 * Used immediately before live server transit data arrives.
 */
export function buildFallbackMtrData(): { stations: MtrStation[]; routes: MtrRoute[] } {
  const mkStop = (stationId: string, name: string, x: number, z: number, y = 52) => ({
    stationId,
    name,
    x,
    y,
    z,
    dwellMs: 12000,
  });

  const line1Stops = [
    mkStop('m1-vlad', 'Владимирский проспект', 12455, -3069),
    mkStop('m1-metrostr', 'Пл. Метростроителей', 11534, -2118),
    mkStop('m1-teatr', 'Театральная', 10904, -1492),
    mkStop('m1-narod', 'Народная', 10084, -758),
    mkStop('m1-morskoy', 'Морской бульвар', 9598, 135),
    mkStop('m1-auktuva', 'Ауктува', 9965, 1245),
    mkStop('m1-mash', 'Машиностроителей', 9593, 2723),
  ];

  const line2BrestStops = [
    mkStop('m2-lesnaya', 'Лесная', 12088, -5140),
    mkStop('m2-balt', 'Балтийская', 11560, -3600),
    mkStop('m2-ivan', 'Иваноостровская', 10296, -2835),
    mkStop('m2-zastava', 'Морская Застава', 9545, -1892),
    mkStop('m2-narod', 'Народная', 9976, -822),
    mkStop('m2-univ', 'Университет', 10688, -18),
    mkStop('m2-vokzal', 'Вокзальная', 12215, 302),
    mkStop('m2-sport', 'Дворец Спорта', 13520, 1401),
    mkStop('m2-novye', 'Новые Дома', 14095, 2479),
    mkStop('m2-brest', 'Брестская', 15082, 3264),
  ];

  const line2TeploStops = [
    ...line2BrestStops.slice(0, 7),
    mkStop('m2-pavlov', 'Павловская', 12248, 1688),
    mkStop('m2-teplo', 'Теплосила', 12128, 2839),
  ];

  const line3Stops = [
    mkStop('m3-vdnit', 'ВДНиТ', 9976, -3837),
    mkStop('m3-ivan', 'Иваноостровская', 10295, -2845),
    mkStop('m3-metrostr', 'Пл. Метростроителей', 11533, -2120),
    mkStop('m3-rybatsk', 'Рыбацкая', 12072, -984),
    mkStop('m3-zamur', 'Замуррецкая', 13031, -744),
  ];

  const tram5Stops = [
    mkStop('t5-prim', 'Приморская улица', 9320, -14, 68),
    mkStop('t5-morsk', 'Морской бульвар', 9610, -27, 68),
    mkStop('t5-nizh', 'Нижнемуровский проспект', 10022, -27, 68),
    mkStop('t5-afin', 'Афинская улица', 10331, -27, 68),
    mkStop('t5-univ', 'Университет', 10695, -24, 68),
    mkStop('t5-vokz', 'Вокзальная', 12215, 292, 68),
  ];

  const bus64Stops = [
    mkStop('b64-petr', 'Площадь Петра', 9270, -241, 68),
    mkStop('b64-vlad', 'Владимирский проспект', 9270, -497, 68),
    mkStop('b64-publ', 'Публичный переулок', 9297, -698, 68),
    mkStop('b64-hosp', 'Скандинавская ул. — Больница', 9270, 239, 68),
    mkStop('b64-pob', 'Улица Победы', 9610, 402, 68),
    mkStop('b64-yam', 'Ямской рынок', 10046, 613, 68),
    mkStop('b64-sk12', 'Скандинавская улица, д. 12', 9796, 220, 68),
  ];

  const makePair = (
    baseId: string,
    name: string,
    shortName: string,
    number: string,
    color: string,
    kind: MtrRoute['kind'],
    stops: MtrRoute['stops'],
    speed: number,
    headwaySec: number
  ): MtrRoute[] => {
    const calcDurs = (arr: MtrRoute['stops']) =>
      arr.slice(0, -1).map((s, idx) => {
        const next = arr[idx + 1];
        const dist = Math.hypot(next.x - s.x, next.z - s.z);
        return Math.round(Math.max(10, dist / speed + 6) * 1000);
      });
    const rev = [...stops].reverse();
    return [
      {
        id: `${baseId}-fwd`,
        name,
        shortName,
        number,
        color,
        kind,
        circular: false,
        stops,
        segmentDurationsMs: calcDurs(stops),
        headwaySec,
      },
      {
        id: `${baseId}-rev`,
        name,
        shortName,
        number,
        color,
        kind,
        circular: false,
        stops: rev,
        segmentDurationsMs: calcDurs(rev),
        headwaySec,
      },
    ];
  };

  const routes: MtrRoute[] = [
    ...makePair('fb-m1', 'Линия 1 (Невско-Заводская)', 'Линия 1', 'M1', MUROMORSK_WIKI_COLORS.m1, 'metro', line1Stops, 25, 110),
    ...makePair('fb-m2a', 'Линия 2 (Марининско-Павловская · Брестская)', 'Линия 2', 'M2', MUROMORSK_WIKI_COLORS.m2, 'metro', line2BrestStops, 25, 130),
    ...makePair('fb-m2b', 'Линия 2 (Марининско-Павловская · Теплосила)', 'Линия 2', 'M2', MUROMORSK_WIKI_COLORS.m2, 'metro', line2TeploStops, 25, 150),
    ...makePair('fb-m3', 'Линия 3 (Замуррецкая)', 'Линия 3', 'M3', MUROMORSK_WIKI_COLORS.m3, 'metro', line3Stops, 25, 125),
    ...makePair('fb-t5', 'Трамвай №5 · Приморская — Вокзал', '5', '5', MUROMORSK_WIKI_COLORS.tram, 'tram', tram5Stops, 13, 180),
    ...makePair('fb-b64', 'Автобус №64 · Площадь Петра — Ямской рынок', '64', '64', MUROMORSK_WIKI_COLORS.bus, 'bus', bus64Stops, 11, 210),
  ];

  const stationMap = new Map<string, MtrStation>();
  for (const r of routes) {
    for (const s of r.stops) {
      const ex = stationMap.get(s.stationId);
      if (ex) {
        if (!ex.kinds.includes(r.kind)) ex.kinds.push(r.kind);
        if (!ex.routeIds.includes(r.id)) ex.routeIds.push(r.id);
      } else {
        stationMap.set(s.stationId, {
          id: s.stationId,
          name: s.name,
          x: s.x,
          y: s.y,
          z: s.z,
          color: r.color,
          kinds: [r.kind],
          routeIds: [r.id],
          district: 'Муроморск',
        });
      }
    }
  }

  return {
    stations: Array.from(stationMap.values()),
    routes,
  };
}
