import React from 'react';
import type { MtrStation, TransportKind } from '../types/map';
import { resolveStationStopSymbol } from '../utils/transitStopIcons';
import { MuromorskMetroBadge } from './MuromorskMetroBadge';

interface TransitStopBadgeProps {
  station: Pick<MtrStation, 'id' | 'name' | 'x' | 'z' | 'color' | 'kinds' | 'district'>;
  nearbyKinds?: TransportKind[];
  size?: number;
  className?: string;
}

const VehicleSvgGlyph: React.FC<{
  kind: 'bus' | 'tram' | 'trolleybus' | 'rail' | 'metro';
  size: number;
}> = ({ kind, size }) => {
  if (kind === 'metro') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <path
          d="M4.5 18L8 6.5L12 13.5L16 6.5L19.5 18"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'bus') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <rect x="5" y="4" width="14" height="13" rx="2.8" fill="currentColor" />
        <rect x="7" y="6.2" width="10" height="5.2" rx="1.2" fill="#FFFFFF" fillOpacity="0.92" />
        <circle cx="8.4" cy="14.2" r="1.2" fill="#FFFFFF" />
        <circle cx="15.6" cy="14.2" r="1.2" fill="#FFFFFF" />
        <rect x="6.5" y="16.8" width="2.8" height="2.6" rx="0.8" fill="currentColor" />
        <rect x="14.7" y="16.8" width="2.8" height="2.6" rx="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'tram') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <path d="M8.5 3H15.5M12 3L9.8 5.2L12 7L14.2 5.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="5.5" y="7" width="13" height="10.8" rx="2.6" fill="currentColor" />
        <rect x="7.5" y="8.8" width="9" height="4.8" rx="1" fill="#FFFFFF" fillOpacity="0.92" />
        <circle cx="12" cy="15.4" r="1.2" fill="#FFFFFF" />
        <path d="M8.5 18L6.8 21M15.5 18L17.2 21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'trolleybus') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <path d="M9.6 7L6.5 3M14.4 7L17.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="5.2" y="6.8" width="13.6" height="11" rx="2.6" fill="currentColor" />
        <rect x="7.2" y="8.6" width="9.6" height="4.8" rx="1" fill="#FFFFFF" fillOpacity="0.92" />
        <circle cx="8.6" cy="15.4" r="1.15" fill="#FFFFFF" />
        <circle cx="15.4" cy="15.4" r="1.15" fill="#FFFFFF" />
        <rect x="6.8" y="17.6" width="2.6" height="2.4" rx="0.7" fill="currentColor" />
        <rect x="14.6" y="17.6" width="2.6" height="2.4" rx="0.7" fill="currentColor" />
      </svg>
    );
  }
  // rail
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="5.5" y="3.5" width="13" height="13.2" rx="3.8" fill="currentColor" />
      <rect x="7.5" y="6" width="9" height="4.8" rx="1.4" fill="#FFFFFF" fillOpacity="0.92" />
      <circle cx="8.8" cy="13.8" r="1.2" fill="#FFFFFF" />
      <circle cx="15.2" cy="13.8" r="1.2" fill="#FFFFFF" />
      <path d="M8.4 17L6 20.8M15.6 17L18 20.8M7.2 19.3H16.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
};

/**
 * Stylish transit stop/station badge supporting bus, tram, trolleybus, metro, rail,
 * combined bus+tram, and combined rail+metro — always preserving unique emblems like Muromorsk Metro.
 */
export const TransitStopBadge: React.FC<TransitStopBadgeProps> = ({
  station,
  nearbyKinds,
  size = 22,
  className = '',
}) => {
  const resolved = resolveStationStopSymbol(station, nearbyKinds);
  const inner = Math.round(size * 0.68);

  if (resolved.symbol === 'muromorsk-metro') {
    return (
      <MuromorskMetroBadge
        color={resolved.primaryColor}
        size={size}
        className={className}
        title={resolved.labelRu}
      />
    );
  }

  if (resolved.symbol === 'muromorsk-metro-rail') {
    return (
      <span
        title={resolved.labelRu}
        aria-label={resolved.labelRu}
        className={`inline-flex items-center gap-0.5 p-0.5 rounded-full bg-white dark:bg-[#181B22] border border-neutral-200 dark:border-neutral-700 shrink-0 ${className}`}
      >
        <MuromorskMetroBadge
          color={resolved.primaryColor}
          size={Math.max(16, size - 2)}
          title="Муроморский метрополитен"
        />
        <span
          className="inline-flex items-center justify-center rounded-full text-white shrink-0"
          style={{
            width: Math.max(16, size - 2),
            height: Math.max(16, size - 2),
            backgroundColor: resolved.secondaryColor || '#2CA05A',
          }}
        >
          <VehicleSvgGlyph kind="rail" size={Math.round((size - 2) * 0.68)} />
        </span>
      </span>
    );
  }

  if (resolved.symbol === 'rail-metro') {
    const sub = Math.max(16, size - 2);
    return (
      <span
        title={resolved.labelRu}
        aria-label={resolved.labelRu}
        className={`inline-flex items-center gap-0.5 p-0.5 rounded-full bg-white dark:bg-[#181B22] border border-neutral-200 dark:border-neutral-700 shrink-0 ${className}`}
      >
        <span
          className="inline-flex items-center justify-center rounded-full text-white shrink-0"
          style={{ width: sub, height: sub, backgroundColor: resolved.primaryColor }}
        >
          <VehicleSvgGlyph kind="metro" size={Math.round(sub * 0.68)} />
        </span>
        <span
          className="inline-flex items-center justify-center rounded-full text-white shrink-0"
          style={{
            width: sub,
            height: sub,
            backgroundColor: resolved.secondaryColor || '#2CA05A',
          }}
        >
          <VehicleSvgGlyph kind="rail" size={Math.round(sub * 0.68)} />
        </span>
      </span>
    );
  }

  if (resolved.symbol === 'bus-tram') {
    const sub = Math.max(16, size - 2);
    return (
      <span
        title={resolved.labelRu}
        aria-label={resolved.labelRu}
        className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-white dark:bg-[#181B22] border border-neutral-200 dark:border-neutral-700 shrink-0 ${className}`}
      >
        <span
          className="inline-flex items-center justify-center rounded-[5px] text-white shrink-0"
          style={{ width: sub, height: sub, backgroundColor: resolved.primaryColor }}
        >
          <VehicleSvgGlyph kind="bus" size={Math.round(sub * 0.72)} />
        </span>
        <span
          className="inline-flex items-center justify-center rounded-[5px] text-white shrink-0"
          style={{
            width: sub,
            height: sub,
            backgroundColor: resolved.secondaryColor || '#C8102E',
          }}
        >
          <VehicleSvgGlyph kind="tram" size={Math.round(sub * 0.72)} />
        </span>
      </span>
    );
  }

  if (
    resolved.symbol === 'metro' ||
    resolved.symbol === 'rail' ||
    resolved.symbol === 'bus' ||
    resolved.symbol === 'tram' ||
    resolved.symbol === 'trolleybus'
  ) {
    const isRound = resolved.symbol === 'metro';
    return (
      <span
        title={resolved.labelRu}
        aria-label={resolved.labelRu}
        className={`inline-flex items-center justify-center text-white shrink-0 ${
          isRound ? 'rounded-full' : 'rounded-md'
        } ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: resolved.primaryColor,
        }}
      >
        <VehicleSvgGlyph kind={resolved.symbol} size={inner} />
      </span>
    );
  }

  return (
    <span
      title={resolved.labelRu}
      aria-label={resolved.labelRu}
      className={`inline-flex items-center justify-center rounded-full shrink-0 ${className}`}
      style={{
        width: Math.max(12, size * 0.65),
        height: Math.max(12, size * 0.65),
        backgroundColor: resolved.primaryColor,
      }}
    />
  );
};
