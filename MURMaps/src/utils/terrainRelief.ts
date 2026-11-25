import type { TerrainTileData } from '../types/map';
import { SERVER_GROUND_Y } from './geometry';

/**
 * Decodes signed 16-bit surface elevation heights from the lower half of a heightmap tile PNG
 * into a compact terrain relief grid (e.g. 100x100 for a 500x500 block tile -> 5m resolution).
 */
export function decodeTerrainElevationTile(
  rgba: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  tx: number,
  tz: number,
  lod: 1 | 2 | 3 = 1,
  targetGridSize = 84
): TerrainTileData | null {
  const halfH = Math.floor(imgHeight / 2);
  if (imgWidth < 4 || halfH < 4) return null;

  const tileSpan = lod === 1 ? 500 : lod === 2 ? 2500 : 12500;
  const cols = Math.min(imgWidth, Math.max(8, targetGridSize));
  const rows = Math.min(halfH, Math.max(8, targetGridSize));
  const heights = new Int16Array(cols * rows);

  let minY = 32767;
  let maxY = -32768;

  for (let r = 0; r < rows; r++) {
    const py = Math.min(halfH - 1, Math.floor(((r + 0.5) / rows) * halfH));
    for (let c = 0; c < cols; c++) {
      const px = Math.min(imgWidth - 1, Math.floor(((c + 0.5) / cols) * imgWidth));
      const botOff = ((py + halfH) * imgWidth + px) * 4;
      const gH = rgba[botOff + 1];
      const bH = rgba[botOff + 2];
      const raw16 = (gH << 8) | bH;
      const signedY = raw16 >= 32768 ? raw16 - 65536 : raw16;
      const clampedY = signedY < -64 || signedY > 320 ? SERVER_GROUND_Y : signedY;
      heights[r * cols + c] = clampedY;
      if (clampedY < minY) minY = clampedY;
      if (clampedY > maxY) maxY = clampedY;
    }
  }

  // Extract natural ground DEM by suppressing sharp building rooftops while preserving hills & basins
  let smoothed = new Int16Array(cols * rows);
  if (cols >= 32 && rows >= 32) {
    // 1) Morphological erosion (lower-decile over 5x5) to strip wide building roofs down to street/ground level
    const eroded = new Int16Array(cols * rows);
    const win25 = new Int16Array(25);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let count = 0;
        for (let dr = -2; dr <= 2; dr++) {
          const rr = Math.max(0, Math.min(rows - 1, r + dr));
          for (let dc = -2; dc <= 2; dc++) {
            const cc = Math.max(0, Math.min(cols - 1, c + dc));
            win25[count++] = heights[rr * cols + cc];
          }
        }
        win25.sort();
        // 15th percentile (idx 3 of 25) strips structures while resisting single-pixel pits
        eroded[r * cols + c] = win25[3];
      }
    }
    // 2) Two-pass separable box smoothing (radius 2) to yield smooth topographic contours
    const tmp = new Float32Array(cols * rows);
    const smoothF = new Float32Array(cols * rows);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? eroded : smoothF;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let sum = 0;
          let cnt = 0;
          for (let dc = -2; dc <= 2; dc++) {
            const cc = Math.max(0, Math.min(cols - 1, c + dc));
            sum += src[r * cols + cc];
            cnt++;
          }
          tmp[r * cols + c] = sum / cnt;
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let sum = 0;
          let cnt = 0;
          for (let dr = -2; dr <= 2; dr++) {
            const rr = Math.max(0, Math.min(rows - 1, r + dr));
            sum += tmp[rr * cols + c];
            cnt++;
          }
          smoothF[r * cols + c] = sum / cnt;
        }
      }
    }
    for (let i = 0; i < smoothF.length; i++) {
      smoothed[i] = Math.round(smoothF[i]);
    }
  } else {
    // Compact 3x3 lower-quartile filter for small synthetic grids
    const win = new Int16Array(9);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = Math.max(0, Math.min(rows - 1, r + dr));
          for (let dc = -1; dc <= 1; dc++) {
            const cc = Math.max(0, Math.min(cols - 1, c + dc));
            win[count++] = heights[rr * cols + cc];
          }
        }
        win.sort();
        smoothed[r * cols + c] = win[2];
      }
    }
  }

  let sMin = 32767;
  let sMax = -32768;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] < sMin) sMin = smoothed[i];
    if (smoothed[i] > sMax) sMax = smoothed[i];
  }

  return {
    tx,
    tz,
    lod,
    worldX: tx * tileSpan,
    worldZ: tz * tileSpan,
    sizeBlocks: tileSpan,
    cols,
    rows,
    heights: smoothed,
    minY: sMin,
    maxY: sMax,
  };
}

/**
 * Computes hypsometric RGB color + directional hillshade + topographic contour tint
 * for a single terrain height sample and its slope gradient.
 */
export function computeTerrainReliefRgba(
  y: number,
  dx: number,
  dz: number,
  darkMode: boolean,
  isContour: boolean,
  isIndexContour: boolean
): [number, number, number, number] {
  const rel = y - SERVER_GROUND_Y;

  // Hypsometric elevation tint ramp (water depressions -> coastal lowland -> plains -> hills -> ridges)
  let r: number;
  let g: number;
  let b: number;

  if (darkMode) {
    if (rel <= -3) {
      r = 36; g = 66; b = 94;
    } else if (rel <= 1) {
      r = 46; g = 64; b = 58;
    } else if (rel <= 8) {
      r = 58; g = 66; b = 58;
    } else if (rel <= 18) {
      r = 76; g = 72; b = 60;
    } else if (rel <= 34) {
      r = 92; g = 78; b = 64;
    } else {
      r = 110; g = 100; b = 94;
    }
  } else {
    if (rel <= -3) {
      r = 178; g = 212; b = 234;
    } else if (rel <= 1) {
      r = 224; g = 235; b = 214;
    } else if (rel <= 8) {
      r = 238; g = 237; b = 222;
    } else if (rel <= 18) {
      r = 238; g = 226; b = 202;
    } else if (rel <= 34) {
      r = 230; g = 208; b = 180;
    } else {
      r = 220; g = 198; b = 182;
    }
  }

  // Softly clamped NW directional Lambertian hillshade (prevents harsh black wall artifacts)
  const softDx = Math.tanh(dx / 6) * 2.4;
  const softDz = Math.tanh(dz / 6) * 2.4;
  const nx = -softDx * 0.34;
  const nz = -softDz * 0.34;
  const ny = 1.0;
  const invLen = 1 / Math.hypot(nx, ny, nz);
  const lx = -0.52;
  const ly = 0.67;
  const lz = -0.52;
  const dot = Math.max(0.72, Math.min(1.16, (nx * lx + ny * ly + nz * lz) * invLen * 0.72 + 0.52));

  r = Math.max(0, Math.min(255, Math.round(r * dot)));
  g = Math.max(0, Math.min(255, Math.round(g * dot)));
  b = Math.max(0, Math.min(255, Math.round(b * dot)));

  // Subtle topographic contour lines every 4m (and stronger index contours every 16m)
  if (isIndexContour) {
    r = darkMode ? Math.min(255, r + 32) : Math.max(0, r - 36);
    g = darkMode ? Math.min(255, g + 28) : Math.max(0, g - 34);
    b = darkMode ? Math.min(255, b + 22) : Math.max(0, b - 30);
  } else if (isContour) {
    r = darkMode ? Math.min(255, r + 14) : Math.max(0, r - 18);
    g = darkMode ? Math.min(255, g + 12) : Math.max(0, g - 16);
    b = darkMode ? Math.min(255, b + 10) : Math.max(0, b - 14);
  }

  return [r, g, b, 214];
}

/**
 * Renders a pre-shaded topographic hillshade + contour offscreen canvas for fast 60fps map drawing.
 */
export function buildTerrainReliefCanvas(
  terrain: TerrainTileData,
  darkMode: boolean
): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const { cols, rows, heights } = terrain;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const img = ctx.createImageData(cols, rows);
  const out = img.data;

  for (let r = 0; r < rows; r++) {
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(rows - 1, r + 1);
    for (let c = 0; c < cols; c++) {
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(cols - 1, c + 1);
      const idx = r * cols + c;
      const y = heights[idx];
      const yLeft = heights[r * cols + cPrev];
      const yRight = heights[r * cols + cNext];
      const yUp = heights[rPrev * cols + c];
      const yDown = heights[rNext * cols + c];

      const dx = (yRight - yLeft) * 0.5;
      const dz = (yDown - yUp) * 0.5;

      // Detect contour boundary crossing every 4m and index contour every 16m
      const band4 = Math.floor(y / 4);
      const isContour =
        band4 !== Math.floor(yRight / 4) || band4 !== Math.floor(yDown / 4);
      const band16 = Math.floor(y / 16);
      const isIndexContour =
        band16 !== Math.floor(yRight / 16) || band16 !== Math.floor(yDown / 16);

      const [cr, cg, cb, ca] = computeTerrainReliefRgba(
        y,
        dx,
        dz,
        darkMode,
        isContour,
        isIndexContour
      );
      const off = idx * 4;
      out[off] = cr;
      out[off + 1] = cg;
      out[off + 2] = cb;
      out[off + 3] = ca;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Samples terrain height (in world blocks Y) at arbitrary (x, z) from loaded terrain tiles.
 */
export function sampleTerrainElevation(
  tiles: TerrainTileData[],
  x: number,
  z: number
): number {
  for (const t of tiles) {
    if (
      x >= t.worldX &&
      x < t.worldX + t.sizeBlocks &&
      z >= t.worldZ &&
      z < t.worldZ + t.sizeBlocks
    ) {
      const c = Math.max(
        0,
        Math.min(t.cols - 1, Math.floor(((x - t.worldX) / t.sizeBlocks) * t.cols))
      );
      const r = Math.max(
        0,
        Math.min(t.rows - 1, Math.floor(((z - t.worldZ) / t.sizeBlocks) * t.rows))
      );
      return t.heights[r * t.cols + c];
    }
  }
  return SERVER_GROUND_Y;
}
