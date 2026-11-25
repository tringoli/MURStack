import type {
  Building3D,
  BuildingCategory,
  MapPoi,
  MtrStation,
  PoiIconKind,
  SelectedEntity,
  StreetSegment,
} from '../types/map';
import { getTransportLabelRu } from './routing';
import { POI_ICON_MAP, resolveBuildingIconKind } from './poiIcons';
import { isMuromorskMetroStation } from './mursTransitBrand';

export interface SmartSearchResult {
  id: string;
  title: string;
  subtitle: string;
  entity: SelectedEntity;
  x: number;
  z: number;
  score: number;
  badgeType?: 'muromorsk-metro' | 'metro' | 'icon';
  badgeColor?: string;
  iconKind?: PoiIconKind;
  matchedTag?: string;
}

const CATEGORY_KEYWORDS: Record<BuildingCategory, string[]> = {
  residential: ['жилой', 'жилой дом', 'дом', 'жк', 'квартира', 'мкд', 'корпус', 'общежитие', 'жилье', 'жильё'],
  civic: ['администрация', 'мэрия', 'гос', 'мфц', 'суд', 'увд', 'полиция', 'гибдд', 'пожарная', 'мчс', 'загс', 'правительство', 'почта', 'дума'],
  commercial: ['магазин', 'тц', 'трц', 'торговый центр', 'торговля', 'офис', 'бц', 'бизнес-центр', 'бизнес', 'супермаркет', 'рынок', 'кафе', 'кофейня', 'ресторан', 'банк', 'отель', 'гостиница', 'азс'],
  transport: ['вокзал', 'жд', 'ж/д', 'железнодорожный', 'станция', 'автовокзал', 'депо', 'терминал', 'аэропорт', 'порт', 'транспорт', 'причал'],
  medical: ['больница', 'поликлиника', 'клиника', 'аптека', 'медицина', 'медцентр', 'црб', 'гб', 'госпиталь', 'скорая', 'врач', 'стоматология'],
  culture: ['культура', 'библиотека', 'театр', 'музей', 'дк', 'дом культуры', 'кино', 'кинотеатр', 'стадион', 'спорт', 'фок', 'дворец спорта', 'арена', 'галерея', 'памятник', 'монумент', 'филармония'],
  education: ['школа', 'университет', 'вуз', 'институт', 'колледж', 'лицей', 'гимназия', 'дс', 'детский сад', 'садик', 'академия', 'нии', 'образование', 'библиотека'],
  industrial: ['завод', 'фабрика', 'промышленность', 'промзона', 'комбинат', 'склад', 'цех', 'тэц', 'депо', 'производство'],
};

/**
 * Maps common Russian abbreviations & shorthand queries into expanded semantic terms
 * so queries like "жд", "тц", "дк", "црб", "бц", "вуз", "мфц", "азс" work seamlessly.
 */
const ABBREVIATION_EXPANSIONS: Record<string, string[]> = {
  жд: ['вокзал', 'железнодорожный', 'ж/д', 'станция', 'транспорт'],
  'ж/д': ['вокзал', 'железнодорожный', 'жд', 'станция'],
  жв: ['вокзал', 'железнодорожный'],
  ав: ['автовокзал', 'вокзал'],
  тц: ['торговый центр', 'трц', 'магазин', 'торговля', 'универмаг'],
  трц: ['торговый центр', 'тц', 'магазин', 'кинотеатр', 'торговля'],
  дк: ['дом культуры', 'дворец культуры', 'культура', 'театр', 'клуб'],
  жк: ['жилой комплекс', 'жилой дом', 'жилой'],
  бц: ['бизнес-центр', 'бизнес', 'офис', 'торговля'],
  мфц: ['администрация', 'госуслуги', 'мэрия', 'гос'],
  црб: ['больница', 'поликлиника', 'медицина', 'клиника'],
  гб: ['городская больница', 'больница', 'медицина'],
  гп: ['поликлиника', 'больница', 'медицина'],
  вуз: ['университет', 'институт', 'академия', 'образование'],
  нии: ['институт', 'университет', 'наука', 'образование'],
  дс: ['детский сад', 'садик', 'школа', 'образование'],
  фок: ['спорт', 'стадион', 'бассейн', 'дворец спорта', 'арена'],
  азс: ['заправка', 'бензин', 'автосервис', 'топливо'],
  увд: ['полиция', 'администрация', 'отделение'],
  пвз: ['почта', 'доставка', 'пункт выдачи'],
  ст: ['станция', 'метро', 'остановка'],
  ул: ['улица'],
  пр: ['проспект'],
  пл: ['площадь'],
  пер: ['переулок'],
  наб: ['набережная'],
  б: ['бульвар', 'больница'],
  библ: ['библиотека'],
  вокз: ['вокзал'],
  больн: ['больница', 'поликлиника'],
  универ: ['университет', 'институт'],
  магаз: ['магазин', 'супермаркет', 'торговля'],
  памят: ['памятник', 'монумент', 'скульптура'],
};

function normalizeRu(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandQueryTokens(rawQuery: string): {
  normQuery: string;
  tokens: string[];
  expandedTerms: string[];
} {
  const normQuery = normalizeRu(rawQuery);
  const tokens = normQuery
    .split(/[\s,.;:()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const expandedSet = new Set<string>();
  for (const tok of tokens) {
    expandedSet.add(tok);
    const abbr = ABBREVIATION_EXPANSIONS[tok];
    if (abbr) {
      for (const exp of abbr) expandedSet.add(normalizeRu(exp));
    }
    // Also match prefix of abbreviation keys for short prefixes >= 3 chars (e.g. "библ")
    if (tok.length >= 3) {
      for (const [k, vals] of Object.entries(ABBREVIATION_EXPANSIONS)) {
        if (k.startsWith(tok) || tok.startsWith(k) && k.length >= 3) {
          for (const exp of vals) expandedSet.add(normalizeRu(exp));
        }
      }
    }
  }

  return {
    normQuery,
    tokens,
    expandedTerms: Array.from(expandedSet),
  };
}

function scoreTextMatch(
  haystackNorm: string,
  keywordsNorm: string[],
  normQuery: string,
  tokens: string[],
  expandedTerms: string[]
): { score: number; matchedTag?: string } {
  let score = 0;
  let matchedTag: string | undefined;

  if (haystackNorm === normQuery) {
    return { score: 120 };
  }
  if (haystackNorm.startsWith(normQuery)) {
    score = Math.max(score, 96);
  } else if (haystackNorm.includes(normQuery)) {
    score = Math.max(score, 80);
  }

  // Check if all user tokens match either text or semantic keywords (multi-word queries like "оборонная 32" or "вокзал центр")
  if (tokens.length > 0) {
    let allTokensMatched = true;
    let tokenScoreSum = 0;
    for (const tok of tokens) {
      const abbrExp = ABBREVIATION_EXPANSIONS[tok]?.map(normalizeRu) ?? [];
      if (haystackNorm.includes(tok)) {
        tokenScoreSum += 28;
      } else {
        const kwHit = keywordsNorm.find(
          (kw) => kw === tok || kw.startsWith(tok) || (tok.length >= 3 && kw.includes(tok))
        );
        const abbrHit =
          !kwHit && abbrExp.length > 0
            ? abbrExp.find(
                (exp) =>
                  haystackNorm.includes(exp) ||
                  keywordsNorm.some((kw) => kw.includes(exp) || exp.includes(kw))
              )
            : undefined;
        if (kwHit) {
          tokenScoreSum += 22;
          matchedTag = matchedTag || kwHit;
        } else if (abbrHit) {
          tokenScoreSum += 20;
          matchedTag = matchedTag || abbrHit;
        } else {
          allTokensMatched = false;
          break;
        }
      }
    }
    if (allTokensMatched) {
      score = Math.max(score, 52 + Math.min(40, tokenScoreSum));
    }
  }

  // Single expanded keyword hit (e.g. searching "вокзал", "библиотека", "тц", "жд")
  if (score === 0 && expandedTerms.length > 0) {
    for (const term of expandedTerms) {
      if (term.length < 2) continue;
      if (haystackNorm.includes(term)) {
        score = Math.max(score, 48);
        matchedTag = matchedTag || term;
        break;
      }
      const kwHit = keywordsNorm.find(
        (kw) => kw === term || kw.startsWith(term) || (term.length >= 4 && kw.includes(term))
      );
      if (kwHit) {
        score = Math.max(score, 44);
        matchedTag = matchedTag || kwHit;
        break;
      }
    }
  }

  return { score, matchedTag };
}

export function searchMapEntities(
  query: string,
  data: {
    stations: MtrStation[];
    buildings: Building3D[];
    streets: StreetSegment[];
    pois?: MapPoi[];
  },
  limit = 16
): SmartSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: SmartSearchResult[] = [];

  // 1. Direct coordinates "X, Z" or "X Z"
  const coordMatch = trimmed.match(/^(-?\d+)\s*[,\s]\s*(-?\d+)$/);
  if (coordMatch) {
    const cx = Number(coordMatch[1]);
    const cz = Number(coordMatch[2]);
    results.push({
      id: `coord-${cx}-${cz}`,
      title: `Координаты X: ${cx}, Z: ${cz}`,
      subtitle: 'Перейти к точке на карте MURS',
      entity: { type: 'point', x: cx, z: cz, label: `Точка (${cx}, ${cz})` },
      x: cx,
      z: cz,
      score: 150,
    });
  }

  const { normQuery, tokens, expandedTerms } = expandQueryTokens(trimmed);

  // 2. Standalone Map POIs (businesses, cafes, monuments, etc.)
  for (const poi of data.pois ?? []) {
    const meta = POI_ICON_MAP[poi.icon] ?? POI_ICON_MAP.star;
    const hay = normalizeRu(`${poi.name} ${poi.description || ''} ${meta.label}`);
    const kws = meta.keywords.map(normalizeRu);
    const hit = scoreTextMatch(hay, kws, normQuery, tokens, expandedTerms);
    if (hit.score > 0) {
      results.push({
        id: `poi-${poi.id}`,
        title: poi.name,
        subtitle: poi.description ? `${meta.shortLabel} · ${poi.description}` : `${meta.label} · Метка на карте`,
        entity: { type: 'poi', data: poi },
        x: poi.x,
        z: poi.z,
        score: hit.score + 8, // Slight boost for explicit user POIs
        badgeType: 'icon',
        badgeColor: poi.color || meta.color,
        iconKind: poi.icon,
        matchedTag: hit.matchedTag,
      });
    }
  }

  // 3. Stations & Stops (also match "вокзал", "метро", "жд", "ст")
  for (const s of data.stations) {
    const isMetro = s.kinds.includes('metro');
    const isRail = s.kinds.includes('rail');
    const hay = normalizeRu(`${s.name} ${s.englishName || ''} ${s.district || ''}`);
    const kws: string[] = [
      ...s.kinds.map((k) => normalizeRu(getTransportLabelRu(k))),
      'остановка',
      'станция',
      'ст',
    ];
    if (isMetro) kws.push('метро', 'метрополитен');
    if (isRail) kws.push('вокзал', 'жд', 'ж/д', 'электричка', 'поезд');
    const hit = scoreTextMatch(hay, kws, normQuery, tokens, expandedTerms);
    if (hit.score > 0) {
      results.push({
        id: `st-${s.id}`,
        title: s.name,
        subtitle: `${s.kinds.map(getTransportLabelRu).join(', ')} · ${s.district || 'Муроморск'}`,
        entity: { type: 'station', data: s },
        x: s.x,
        z: s.z,
        score: hit.score + (isMetro ? 6 : 0),
        badgeType: isMetro
          ? isMuromorskMetroStation(s)
            ? 'muromorsk-metro'
            : 'metro'
          : undefined,
        badgeColor: s.color,
        matchedTag: hit.matchedTag,
      });
    }
  }

  // 4. Buildings (by name, street + house number, district, category keywords, icon keywords, and abbreviations!)
  for (const b of data.buildings) {
    const fullAddr = `${b.street}, д. ${b.houseNumber}`;
    const iconKind = resolveBuildingIconKind(b);
    const iconMeta = POI_ICON_MAP[iconKind];
    const hay = normalizeRu(
      `${b.name} ${b.street} ${b.houseNumber} д ${b.houseNumber} ${b.district} ${b.description || ''}`
    );
    const kws = [
      ...(CATEGORY_KEYWORDS[b.category] ?? []),
      ...(iconMeta?.keywords ?? []),
    ].map(normalizeRu);

    const hit = scoreTextMatch(hay, kws, normQuery, tokens, expandedTerms);
    if (hit.score > 0) {
      results.push({
        id: `b-${b.id}`,
        title: b.name,
        subtitle: `${fullAddr} · ${b.district}`,
        entity: { type: 'building', data: b },
        x: b.x,
        z: b.z,
        score: hit.score,
        badgeType: 'icon',
        badgeColor: iconMeta?.color ?? '#64748B',
        iconKind,
        matchedTag: hit.matchedTag,
      });
    }
  }

  // 5. Streets & Railways
  for (const st of data.streets) {
    const hay = normalizeRu(`${st.name} ${st.district}`);
    const kws =
      st.roadClass === 'railway'
        ? ['жд', 'железная дорога', 'рельсы', 'путь']
        : ['улица', 'дорога', 'проспект', 'шоссе'];
    const hit = scoreTextMatch(hay, kws, normQuery, tokens, expandedTerms);
    if (hit.score > 0) {
      const mid = st.points[Math.floor(st.points.length / 2)] || { x: 10550, z: -620 };
      results.push({
        id: `str-${st.id}`,
        title: st.name,
        subtitle: `${st.roadClass === 'railway' ? 'ЖД линия' : 'Улица'} · ${st.district}`,
        entity: { type: 'street', data: st },
        x: mid.x,
        z: mid.z,
        score: hit.score - 4,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru'));
  return results.slice(0, limit);
}
