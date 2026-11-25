import React from 'react';
import {
  MUROMORSK_METRO_EMBLEM_PATH,
  MUROMORSK_METRO_EMBLEM_VIEWBOX,
  MUROMORSK_WIKI_COLORS,
} from '../utils/mursTransitBrand';

interface MuromorskMetroBadgeProps {
  color?: string;
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Official Muromorsk Metro emblem: unified blue geometric "М" inside a crisp circular badge.
 */
export const MuromorskMetroBadge: React.FC<MuromorskMetroBadgeProps> = ({
  size = 22,
  className = '',
  title = 'Муроморский метрополитен',
}) => {
  const brandBlue = MUROMORSK_WIKI_COLORS.metroBrand;
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center rounded-full bg-white dark:bg-[#181B22] shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        border: `1.75px solid ${brandBlue}`,
      }}
    >
      <svg
        viewBox={`0 0 ${MUROMORSK_METRO_EMBLEM_VIEWBOX.width} ${MUROMORSK_METRO_EMBLEM_VIEWBOX.height}`}
        width={Math.round(size * 0.68)}
        height={Math.round(size * 0.51)}
        aria-hidden="true"
      >
        <path d={MUROMORSK_METRO_EMBLEM_PATH} fill={brandBlue} />
      </svg>
    </span>
  );
};
