import type { Building3D, BuildingCategory, PoiIconKind } from '../types/map';

export interface PoiIconMeta {
  id: PoiIconKind;
  label: string;
  shortLabel: string;
  color: string;
  keywords: string[];
}

export const POI_ICON_CATALOG: PoiIconMeta[] = [
  {
    id: 'station',
    label: 'Вокзал / Транспорт',
    shortLabel: 'Вокзал',
    color: '#0284C7',
    keywords: ['вокзал', 'жд', 'ж/д', 'станция', 'автовокзал', 'терминал', 'аэропорт', 'порт', 'депо', 'транспорт'],
  },
  {
    id: 'library',
    label: 'Библиотека',
    shortLabel: 'Библиотека',
    color: '#7C3AED',
    keywords: ['библиотека', 'книги', 'читальня', 'архив', 'книжный'],
  },
  {
    id: 'hospital',
    label: 'Больница / Клиника',
    shortLabel: 'Больница',
    color: '#DC2626',
    keywords: ['больница', 'поликлиника', 'клиника', 'госпиталь', 'црб', 'гб', 'медцентр', 'медицина', 'скорая', 'врач'],
  },
  {
    id: 'pharmacy',
    label: 'Аптека',
    shortLabel: 'Аптека',
    color: '#059669',
    keywords: ['аптека', 'лекарства', 'фармация'],
  },
  {
    id: 'school',
    label: 'Школа / Лицей',
    shortLabel: 'Школа',
    color: '#16A34A',
    keywords: ['школа', 'лицей', 'гимназия', 'дс', 'детский сад', 'садик', 'колледж', 'училище', 'образование'],
  },
  {
    id: 'university',
    label: 'Университет / ВУЗ',
    shortLabel: 'ВУЗ',
    color: '#0D9488',
    keywords: ['университет', 'вуз', 'институт', 'академия', 'нии', 'кампус', 'факультет'],
  },
  {
    id: 'museum',
    label: 'Музей / Галерея',
    shortLabel: 'Музей',
    color: '#B45309',
    keywords: ['музей', 'галерея', 'выставка', 'экспозиция', 'дворец'],
  },
  {
    id: 'theater',
    label: 'Театр / ДК / Кино',
    shortLabel: 'Театр',
    color: '#9333EA',
    keywords: ['театр', 'дк', 'дом культуры', 'кино', 'кинотеатр', 'филармония', 'концерт', 'культура', 'клуб'],
  },
  {
    id: 'shop',
    label: 'Магазин / ТЦ / Рынок',
    shortLabel: 'Магазин',
    color: '#EA580C',
    keywords: ['магазин', 'тц', 'трц', 'торговый центр', 'супермаркет', 'рынок', 'универмаг', 'продукты', 'бутик', 'торговля'],
  },
  {
    id: 'cafe',
    label: 'Кафе / Кофейня',
    shortLabel: 'Кафе',
    color: '#D97706',
    keywords: ['кафе', 'кофейня', 'кофе', 'пекарня', 'кондитерская', 'бистро', 'чайная'],
  },
  {
    id: 'restaurant',
    label: 'Ресторан / Бар',
    shortLabel: 'Ресторан',
    color: '#E11D48',
    keywords: ['ресторан', 'столовая', 'бар', 'паб', 'пиццерия', 'общепит', 'еда'],
  },
  {
    id: 'bank',
    label: 'Банк / Финансы',
    shortLabel: 'Банк',
    color: '#1D4ED8',
    keywords: ['банк', 'банкомат', 'сбер', 'касса', 'финансы'],
  },
  {
    id: 'post',
    label: 'Почта / Доставка',
    shortLabel: 'Почта',
    color: '#2563EB',
    keywords: ['почта', 'почтамт', 'отделение', 'пвз', 'доставка', 'посылки'],
  },
  {
    id: 'hotel',
    label: 'Отель / Гостиница',
    shortLabel: 'Отель',
    color: '#4F46E5',
    keywords: ['отель', 'гостиница', 'хостел', 'общежитие', 'апартаменты'],
  },
  {
    id: 'sport',
    label: 'Спорт / Стадион',
    shortLabel: 'Спорт',
    color: '#0891B2',
    keywords: ['стадион', 'спорт', 'фок', 'бассейн', 'арена', 'дворец спорта', 'фитнес', 'спортзал', 'каток'],
  },
  {
    id: 'monument',
    label: 'Памятник / Монумент',
    shortLabel: 'Памятник',
    color: '#A16207',
    keywords: ['памятник', 'монумент', 'скульптура', 'стела', 'мемориал', 'фонтан', 'достопримечательность', 'арка', 'обелиск'],
  },
  {
    id: 'park',
    label: 'Парк / Сквер',
    shortLabel: 'Парк',
    color: '#15803D',
    keywords: ['парк', 'сквер', 'сад', 'аллея', 'набережная', 'бульвар', 'пляж'],
  },
  {
    id: 'fuel',
    label: 'АЗС / Автосервис',
    shortLabel: 'АЗС',
    color: '#475569',
    keywords: ['азс', 'заправка', 'бензин', 'автосервис', 'сто', 'мойка', 'парковка', 'гараж'],
  },
  {
    id: 'factory',
    label: 'Завод / Производство',
    shortLabel: 'Завод',
    color: '#52525B',
    keywords: ['завод', 'фабрика', 'комбинат', 'тэц', 'промзона', 'склад', 'цех', 'промышленность'],
  },
  {
    id: 'civic',
    label: 'Администрация / МФЦ',
    shortLabel: 'Гос.',
    color: '#991B1B',
    keywords: ['мэрия', 'администрация', 'мфц', 'суд', 'увд', 'полиция', 'гибдд', 'пожарная', 'мчс', 'загс', 'дума', 'правительство', 'госучреждение'],
  },
  {
    id: 'office',
    label: 'Офис / Бизнес-центр',
    shortLabel: 'Офис',
    color: '#334155',
    keywords: ['офис', 'бц', 'бизнес-центр', 'бизнес', 'компания', 'фирма', 'штаб', 'деловой'],
  },
  {
    id: 'residential',
    label: 'Жилой дом / ЖК',
    shortLabel: 'Жилой',
    color: '#64748B',
    keywords: ['жк', 'жилой', 'дом', 'корпус', 'квартира', 'подъезд', 'общежитие'],
  },
  {
    id: 'star',
    label: 'Особая точка / Метка',
    shortLabel: 'Метка',
    color: '#EAB308',
    keywords: ['метка', 'точка', 'интересное', 'место', 'ориентир', 'звезда'],
  },
];

export const POI_ICON_MAP: Record<PoiIconKind, PoiIconMeta> = POI_ICON_CATALOG.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<PoiIconKind, PoiIconMeta>
);

export const BUILDING_CATEGORY_DEFAULT_ICON: Record<BuildingCategory, PoiIconKind> = {
  residential: 'residential',
  civic: 'civic',
  commercial: 'shop',
  transport: 'station',
  medical: 'hospital',
  culture: 'theater',
  education: 'school',
  industrial: 'factory',
};

/**
 * Infers the most accurate stylish vector symbol for a building from its explicit `icon`,
 * Russian name/description keywords, or fallback `category`.
 */
export function resolveBuildingIconKind(building: Pick<Building3D, 'icon' | 'category' | 'name' | 'description'>): PoiIconKind {
  if (building.icon && POI_ICON_MAP[building.icon]) {
    return building.icon;
  }
  const text = `${building.name || ''} ${building.description || ''}`.toLowerCase();
  if (text.trim().length > 0) {
    if (/библиотек|читальн|книжн/.test(text)) return 'library';
    if (/вокзал|автовокзал|терминал|аэропорт|депо/.test(text)) return 'station';
    if (/аптек/.test(text)) return 'pharmacy';
    if (/больниц|поликлиник|клиник|госпитал|црб|мед/.test(text)) return 'hospital';
    if (/университет|институт|академ|вуз|нии/.test(text)) return 'university';
    if (/школ|лицей|гимназ|колледж|детск\w*\s+сад/.test(text)) return 'school';
    if (/музей|галере|выставк/.test(text)) return 'museum';
    if (/театр|кино|филармон|дворец\s+культур|\bдк\b/.test(text)) return 'theater';
    if (/стадион|дворец\s+спорт|спорт|арен|бассейн|фок/.test(text)) return 'sport';
    if (/памятник|монумент|скульптур|мемориал|фонтан/.test(text)) return 'monument';
    if (/кафе|кофейн|пекарн|кондитер/.test(text)) return 'cafe';
    if (/ресторан|столов|пиццер|\bбар\b/.test(text)) return 'restaurant';
    if (/банк|сбер/.test(text)) return 'bank';
    if (/почт/.test(text)) return 'post';
    if (/отель|гостиниц|хостел/.test(text)) return 'hotel';
    if (/азс|заправк|автосервис/.test(text)) return 'fuel';
    if (/магазин|рынок|супермаркет|\bтц\b|\bтрц\b|торгов|универмаг/.test(text)) return 'shop';
    if (/бизнес|\bбц\b|офис/.test(text)) return 'office';
    if (/мэри|администрац|мфц|суд|увд|полиц|пожарн/.test(text)) return 'civic';
    if (/завод|фабрик|комбинат|тэц|цех|склад/.test(text)) return 'factory';
    if (/парк|сквер/.test(text)) return 'park';
  }
  return BUILDING_CATEGORY_DEFAULT_ICON[building.category] ?? 'residential';
}

/**
 * Draws a crisp, stylish vector glyph for any `PoiIconKind` centered at (0, 0) in a ~14x14px local box.
 */
function drawIconGlyph(ctx: CanvasRenderingContext2D, icon: PoiIconKind, r: number) {
  const s = r * 0.56;
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(1.3, r * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (icon) {
    case 'hospital': {
      // Medical cross
      const t = s * 0.36;
      ctx.beginPath();
      ctx.roundRect(-t, -s, t * 2, s * 2, 1);
      ctx.roundRect(-s, -t, s * 2, t * 2, 1);
      ctx.fill();
      break;
    }
    case 'pharmacy': {
      // Cross inside subtle diamond/ring
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.9);
      ctx.lineTo(0, s * 0.9);
      ctx.moveTo(-s * 0.9, 0);
      ctx.lineTo(s * 0.9, 0);
      ctx.stroke();
      break;
    }
    case 'library': {
      // Open book
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.65);
      ctx.quadraticCurveTo(-s * 0.5, -s * 0.9, -s, -s * 0.6);
      ctx.lineTo(-s, s * 0.65);
      ctx.quadraticCurveTo(-s * 0.5, s * 0.4, 0, s * 0.72);
      ctx.quadraticCurveTo(s * 0.5, s * 0.4, s, s * 0.65);
      ctx.lineTo(s, -s * 0.6);
      ctx.quadraticCurveTo(s * 0.5, -s * 0.9, 0, -s * 0.65);
      ctx.moveTo(0, -s * 0.65);
      ctx.lineTo(0, s * 0.72);
      ctx.stroke();
      break;
    }
    case 'station': {
      // Front-view train locomotive
      ctx.beginPath();
      ctx.roundRect(-s * 0.72, -s * 0.85, s * 1.44, s * 1.4, 2);
      ctx.stroke();
      ctx.fillRect(-s * 0.45, -s * 0.55, s * 0.9, s * 0.5);
      ctx.beginPath();
      ctx.arc(-s * 0.32, s * 0.28, s * 0.14, 0, Math.PI * 2);
      ctx.arc(s * 0.32, s * 0.28, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, s * 0.6);
      ctx.lineTo(-s * 0.78, s * 0.95);
      ctx.moveTo(s * 0.5, s * 0.6);
      ctx.lineTo(s * 0.78, s * 0.95);
      ctx.stroke();
      break;
    }
    case 'cafe': {
      // Coffee cup + handle
      ctx.beginPath();
      ctx.roundRect(-s * 0.78, -s * 0.35, s * 1.2, s * 1.05, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 0.45, s * 0.15, s * 0.34, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.32, -s * 0.62);
      ctx.lineTo(-s * 0.32, -s * 0.9);
      ctx.moveTo(s * 0.08, -s * 0.62);
      ctx.lineTo(s * 0.08, -s * 0.9);
      ctx.stroke();
      break;
    }
    case 'restaurant': {
      // Fork & knife
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, -s * 0.9);
      ctx.lineTo(-s * 0.42, s * 0.9);
      ctx.moveTo(-s * 0.68, -s * 0.9);
      ctx.lineTo(-s * 0.68, -s * 0.25);
      ctx.lineTo(-s * 0.16, -s * 0.25);
      ctx.lineTo(-s * 0.16, -s * 0.9);
      ctx.moveTo(s * 0.42, -s * 0.9);
      ctx.lineTo(s * 0.42, s * 0.9);
      ctx.moveTo(s * 0.42, -s * 0.9);
      ctx.quadraticCurveTo(s * 0.85, -s * 0.4, s * 0.42, s * 0.05);
      ctx.stroke();
      break;
    }
    case 'shop': {
      // Shopping bag
      ctx.beginPath();
      ctx.roundRect(-s * 0.76, -s * 0.38, s * 1.52, s * 1.2, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -s * 0.42, s * 0.4, Math.PI, 0);
      ctx.stroke();
      break;
    }
    case 'museum':
    case 'civic':
    case 'bank': {
      // Classical pediment & columns
      ctx.beginPath();
      ctx.moveTo(-s * 0.95, -s * 0.35);
      ctx.lineTo(0, -s * 0.95);
      ctx.lineTo(s * 0.95, -s * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.62, -s * 0.25);
      ctx.lineTo(-s * 0.62, s * 0.65);
      ctx.moveTo(0, -s * 0.25);
      ctx.lineTo(0, s * 0.65);
      ctx.moveTo(s * 0.62, -s * 0.25);
      ctx.lineTo(s * 0.62, s * 0.65);
      ctx.moveTo(-s * 0.95, s * 0.78);
      ctx.lineTo(s * 0.95, s * 0.78);
      ctx.stroke();
      break;
    }
    case 'theater': {
      // Stage mask / star emblem
      ctx.beginPath();
      ctx.arc(0, -s * 0.05, s * 0.76, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.28, -s * 0.22, s * 0.12, 0, Math.PI * 2);
      ctx.arc(s * 0.28, -s * 0.22, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.04, s * 0.38, 0.2, Math.PI - 0.2);
      ctx.stroke();
      break;
    }
    case 'school':
    case 'university': {
      // Academic mortarboard cap
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.85);
      ctx.lineTo(s * 0.98, -s * 0.22);
      ctx.lineTo(0, s * 0.35);
      ctx.lineTo(-s * 0.98, -s * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, s * 0.12);
      ctx.lineTo(-s * 0.55, s * 0.68);
      ctx.quadraticCurveTo(0, s * 0.95, s * 0.55, s * 0.68);
      ctx.lineTo(s * 0.55, s * 0.12);
      ctx.stroke();
      break;
    }
    case 'monument': {
      // Obelisk / statue on pedestal
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.98);
      ctx.lineTo(s * 0.34, s * 0.45);
      ctx.lineTo(-s * 0.34, s * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-s * 0.75, s * 0.52, s * 1.5, s * 0.36);
      break;
    }
    case 'park': {
      // Stylized tree
      ctx.beginPath();
      ctx.arc(0, -s * 0.22, s * 0.68, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, s * 0.35);
      ctx.lineTo(0, s * 0.95);
      ctx.stroke();
      break;
    }
    case 'sport': {
      // Trophy / cup
      ctx.beginPath();
      ctx.moveTo(-s * 0.68, -s * 0.78);
      ctx.lineTo(s * 0.68, -s * 0.78);
      ctx.quadraticCurveTo(s * 0.55, s * 0.2, 0, s * 0.28);
      ctx.quadraticCurveTo(-s * 0.55, s * 0.2, -s * 0.68, -s * 0.78);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, s * 0.25);
      ctx.lineTo(0, s * 0.8);
      ctx.moveTo(-s * 0.48, s * 0.82);
      ctx.lineTo(s * 0.48, s * 0.82);
      ctx.stroke();
      break;
    }
    case 'post': {
      // Envelope
      ctx.beginPath();
      ctx.roundRect(-s * 0.88, -s * 0.62, s * 1.76, s * 1.24, 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.82, -s * 0.55);
      ctx.lineTo(0, s * 0.12);
      ctx.lineTo(s * 0.82, -s * 0.55);
      ctx.stroke();
      break;
    }
    case 'hotel': {
      // Bed icon
      ctx.beginPath();
      ctx.moveTo(-s * 0.88, -s * 0.55);
      ctx.lineTo(-s * 0.88, s * 0.7);
      ctx.moveTo(-s * 0.88, s * 0.25);
      ctx.lineTo(s * 0.88, s * 0.25);
      ctx.lineTo(s * 0.88, s * 0.7);
      ctx.stroke();
      ctx.fillRect(-s * 0.68, -s * 0.25, s * 0.48, s * 0.36);
      ctx.fillRect(-s * 0.08, -s * 0.15, s * 0.92, s * 0.28);
      break;
    }
    case 'fuel': {
      // Fuel pump
      ctx.beginPath();
      ctx.roundRect(-s * 0.72, -s * 0.8, s * 1.05, s * 1.6, 1.5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.35, -s * 0.35);
      ctx.lineTo(s * 0.78, -s * 0.1);
      ctx.lineTo(s * 0.78, s * 0.58);
      ctx.stroke();
      break;
    }
    case 'factory': {
      // Sawtooth roof factory
      ctx.beginPath();
      ctx.moveTo(-s * 0.88, s * 0.75);
      ctx.lineTo(-s * 0.88, -s * 0.35);
      ctx.lineTo(-s * 0.22, s * 0.05);
      ctx.lineTo(-s * 0.22, -s * 0.35);
      ctx.lineTo(s * 0.45, s * 0.05);
      ctx.lineTo(s * 0.45, -s * 0.78);
      ctx.lineTo(s * 0.88, -s * 0.78);
      ctx.lineTo(s * 0.88, s * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'office': {
      // Briefcase
      ctx.beginPath();
      ctx.roundRect(-s * 0.85, -s * 0.42, s * 1.7, s * 1.18, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.36, -s * 0.44);
      ctx.lineTo(-s * 0.36, -s * 0.75);
      ctx.lineTo(s * 0.36, -s * 0.75);
      ctx.lineTo(s * 0.36, -s * 0.44);
      ctx.stroke();
      break;
    }
    case 'residential': {
      // House
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.88);
      ctx.lineTo(s * 0.88, -s * 0.08);
      ctx.lineTo(s * 0.62, -s * 0.08);
      ctx.lineTo(s * 0.62, s * 0.78);
      ctx.lineTo(-s * 0.62, s * 0.78);
      ctx.lineTo(-s * 0.62, -s * 0.08);
      ctx.lineTo(-s * 0.88, -s * 0.08);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'star':
    default: {
      // 5-point star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const rad = i % 2 === 0 ? s * 0.95 : s * 0.42;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

/**
 * Draws a stylish Yandex-Maps-grade circular/teardrop symbol badge on the 2D canvas
 * for standalone POIs (businesses, monuments) and notable building categories.
 */
export function drawMapSymbolBadge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  icon: PoiIconKind,
  options: {
    color?: string;
    radius?: number;
    isSelected?: boolean;
    isHovered?: boolean;
    isStandalone?: boolean;
    isDark?: boolean;
  } = {}
): void {
  const meta = POI_ICON_MAP[icon] ?? POI_ICON_MAP.star;
  const fillColor = options.color || meta.color;
  const baseR = options.radius ?? (options.isStandalone ? 10.5 : 8.5);
  const r = options.isSelected ? baseR + 2 : options.isHovered ? baseR + 1.2 : baseR;

  ctx.save();
  ctx.translate(sx, sy);

  // Subtle shadow under standalone pin
  if (options.isStandalone) {
    ctx.beginPath();
    ctx.ellipse(0, r + 2.5, r * 0.55, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();
  }

  // Selection halo
  if (options.isSelected) {
    ctx.beginPath();
    ctx.arc(0, 0, r + 3.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 204, 0, 0.48)';
    ctx.fill();
  }

  // Pointer tail for standalone POIs
  if (options.isStandalone) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, r * 0.72);
    ctx.lineTo(0, r + 4.5);
    ctx.lineTo(r * 0.45, r * 0.72);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // Main colored circle with crisp white border
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = options.isSelected ? 2.4 : 1.7;
  ctx.strokeStyle = options.isDark ? '#181B22' : '#FFFFFF';
  ctx.stroke();

  // Crisp vector glyph
  drawIconGlyph(ctx, icon, r);

  ctx.restore();
}
