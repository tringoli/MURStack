import type {
  BlockMaterialGroup,
  Building3D,
  BuildingCategory,
  BuildingShapeType,
  BuildingWing,
  MtrRoute,
  RoadClass,
  RoofType,
  StreetSegment,
  SynthesisStats,
  SynthesisTargetMode,
  WorldPoint,
  WorldPoint3D,
} from '../types/map';
import { inferDistrict } from './mtrParser';
import {
  createCircleFootprint,
  createParallelogramFootprint,
  createRectFootprint,
  createTriangleFootprint,
  pointToSegmentDistance,
} from './projection';
import { detectParallelogramSkewFromFootprint } from './buildingOps';
import {
  removePathVortices3D,
  SERVER_GROUND_Y,
  smoothMagic3DPath,
  smoothStreetPolyline,
} from './geometry';
import {
  connectBidirectionalRouteTermini,
  type MagicRailSegment,
  traceRoutesFromMagicRails,
} from './magicTracks';
import { mergeAndSmoothRoadNetwork } from './roadMerger';

/**
 * Unified 2D+Height 3D analysis grid (1 cell = `cellSize` Minecraft blocks).
 * Can be populated directly from real BlueMap 501x1002 RGBA heightmap+color tiles (LOD 1/2/3)
 * OR from synthetic 3D object primitives (`Object3DPrimitive[]`).
 */
export interface HeightColorGrid {
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  cellSize: number;
  /** Minecraft Y height per cell */
  heights: Float32Array;
  /** Top surface RGB colors per cell (length = cols * rows * 3) */
  rgb: Uint8Array;
  /** Optional explicit material tags from 3D object primitives */
  materialTag?: Uint8Array; // 0 = unknown/auto, 1 = building, 2 = road, 3 = foliage, 4 = water
}

export interface Object3DPrimitive {
  id?: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  baseY: number;
  topY: number;
  /** Optional roof profile for procedural 3D tests (flat, pitched gable, curved dome, stepped complex) */
  roofStyle?: RoofType;
  /** Optional hollow frame test (no roof deck -> must be rejected as non-building) */
  hollowNoRoof?: boolean;
  /** Optional footprint shape for procedural 3D tests ('rect', 'circle', 'triangle', or 'parallelogram') */
  shape?: 'rect' | 'circle' | 'triangle' | 'parallelogram';
  /** Right-angle corner index (0=NW, 1=NE, 2=SE, 3=SW) when shape === 'triangle' */
  triangleCorner?: 0 | 1 | 2 | 3;
  /** Oblique shear angle in degrees (-60..60) when shape === 'parallelogram' */
  skewDeg?: number;
  angleDeg?: number;
  material: 'building' | 'road' | 'foliage' | 'water';
  rgb?: [number, number, number];
}

export interface SynthesisOptions {
  targetMode?: SynthesisTargetMode;
  tileLod?: 1 | 2 | 3;
  areaSideBlocks?: number;
  /** 0..100 strictness for filtering server block RGB materials (higher = stricter architectural blocks) */
  blockStrictness?: number;
  allowedBlockGroups?: BlockMaterialGroup[];
  minBuildingHeight?: number;
  minBuildingAreaBlocks?: number;
  maxBuildingAreaBlocks?: number;
  minStreetWidthBlocks?: number;
  maxStreetWidthBlocks?: number;
  /** Optional filter of road classes to emit (highway, avenue, street, lane, pedestrian) */
  allowedRoadClasses?: RoadClass[];
  /** 0.25..0.95 legacy minimum footprint solidity/compactness */
  minShapeSolidity?: number;
  /** 0..1 building shape simplification strength (absorbs balconies, porches, complex roof overhangs into crisp silhouettes) */
  shapeSimplification?: number;
  allowedRoofTypes?: RoofType[];
  buildingShapeFilter?: 'all' | 'rectangular' | 'complex';
  maxBuildingsPerRun?: number;
  snapSurfaceTransit?: boolean;
  /** Optional arbitrary polygon boundary (world X, Z vertices) restricting synthesis strictly inside */
  cropPolygon?: WorldPoint[];
}

export interface CropBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Ray-casting point-in-polygon check in Minecraft world (X, Z) plane.
 */
export function pointInPolygon(x: number, z: number, polygon: WorldPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const intersect =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes tight axis-aligned bounding box for a world polygon.
 */
export function computePolygonBounds(polygon: WorldPoint[]): CropBounds | null {
  if (polygon.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    minX: Math.floor(minX),
    maxX: Math.ceil(Math.max(minX + 1, maxX)),
    minZ: Math.floor(minZ),
    maxZ: Math.ceil(Math.max(minZ + 1, maxZ)),
  };
}

/**
 * Computes exact polygon area in square blocks (m²) via the Shoelace formula.
 */
export function computePolygonArea(polygon: WorldPoint[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j].x * polygon[i].z - polygon[i].x * polygon[j].z;
  }
  return Math.abs(sum) * 0.5;
}

/**
 * Decodes a real BlueMap 5.3 lowres RGBA tile (501x1002 where top 501x501 is RGB color
 * and bottom 501x501 encodes signed 16-bit Minecraft Y height in (G, B) channels).
 * Supports LOD 1 (500 bl/tile), LOD 2 (2500 bl/tile), LOD 3 (12500 bl/tile) and exact area cropping.
 */
export function decodeBlueMapTileRgba(
  rgba: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  tileX: number,
  tileZ: number,
  cellSize = 2,
  lod: 1 | 2 | 3 = 1,
  cropBounds?: CropBounds
): HeightColorGrid {
  const blocksPerPixel = lod === 1 ? 1 : lod === 2 ? 5 : 25;
  const tileWorldSpan = 500 * blocksPerPixel;
  const tileOriginX = tileX * tileWorldSpan;
  const tileOriginZ = tileZ * tileWorldSpan;

  const halfH = Math.floor(imgHeight / 2);
  const pixelSpan = Math.min(500, imgWidth, halfH);
  const pixelStep = Math.max(1, Math.round(cellSize / blocksPerPixel));
  const actualCellSize = pixelStep * blocksPerPixel;

  const startPx = cropBounds
    ? Math.max(0, Math.floor((cropBounds.minX - tileOriginX) / blocksPerPixel))
    : 0;
  const endPx = cropBounds
    ? Math.min(pixelSpan, Math.ceil((cropBounds.maxX - tileOriginX) / blocksPerPixel))
    : pixelSpan;
  const startPy = cropBounds
    ? Math.max(0, Math.floor((cropBounds.minZ - tileOriginZ) / blocksPerPixel))
    : 0;
  const endPy = cropBounds
    ? Math.min(pixelSpan, Math.ceil((cropBounds.maxZ - tileOriginZ) / blocksPerPixel))
    : pixelSpan;

  const cols = Math.max(0, Math.floor((endPx - startPx) / pixelStep));
  const rows = Math.max(0, Math.floor((endPy - startPy) / pixelStep));

  const heights = new Float32Array(cols * rows);
  const rgb = new Uint8Array(cols * rows * 3);

  for (let r = 0; r < rows; r++) {
    const py = Math.min(halfH - 1, startPy + r * pixelStep + Math.floor(pixelStep / 2));
    for (let c = 0; c < cols; c++) {
      const px = Math.min(imgWidth - 1, startPx + c * pixelStep + Math.floor(pixelStep / 2));
      const idx = r * cols + c;

      const topOff = (py * imgWidth + px) * 4;
      const botOff = ((py + halfH) * imgWidth + px) * 4;

      rgb[idx * 3] = rgba[topOff];
      rgb[idx * 3 + 1] = rgba[topOff + 1];
      rgb[idx * 3 + 2] = rgba[topOff + 2];

      const g = rgba[botOff + 1];
      const b = rgba[botOff + 2];
      const u16 = (g << 8) | b;
      const signedY = u16 > 32767 ? u16 - 65536 : u16;
      heights[idx] = signedY;
    }
  }

  return {
    originX: tileOriginX + startPx * blocksPerPixel,
    originZ: tileOriginZ + startPy * blocksPerPixel,
    cols,
    rows,
    cellSize: actualCellSize,
    heights,
    rgb,
  };
}

/**
 * Stitches multiple same-resolution BlueMap tile crops into one continuous HeightColorGrid
 * so buildings and streets spanning tile seams are never sliced or dropped.
 */
export function stitchHeightColorGrids(grids: HeightColorGrid[]): HeightColorGrid | null {
  const valid = grids.filter((g) => g.cols > 0 && g.rows > 0);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const cellSize = valid[0].cellSize;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const g of valid) {
    if (g.originX < minX) minX = g.originX;
    if (g.originZ < minZ) minZ = g.originZ;
    const gx2 = g.originX + g.cols * g.cellSize;
    const gz2 = g.originZ + g.rows * g.cellSize;
    if (gx2 > maxX) maxX = gx2;
    if (gz2 > maxZ) maxZ = gz2;
  }

  const cols = Math.max(1, Math.min(1000, Math.ceil((maxX - minX) / cellSize)));
  const rows = Math.max(1, Math.min(1000, Math.ceil((maxZ - minZ) / cellSize)));
  const heights = new Float32Array(cols * rows);
  const rgb = new Uint8Array(cols * rows * 3);
  const hasMaterial = valid.some((g) => Boolean(g.materialTag));
  const materialTag = hasMaterial ? new Uint8Array(cols * rows) : undefined;

  heights.fill(SERVER_GROUND_Y);

  for (const g of valid) {
    for (let r = 0; r < g.rows; r++) {
      const wz = g.originZ + (r + 0.5) * g.cellSize;
      const dstR = Math.floor((wz - minZ) / cellSize);
      if (dstR < 0 || dstR >= rows) continue;
      for (let c = 0; c < g.cols; c++) {
        const wx = g.originX + (c + 0.5) * g.cellSize;
        const dstC = Math.floor((wx - minX) / cellSize);
        if (dstC < 0 || dstC >= cols) continue;
        const srcIdx = r * g.cols + c;
        const dstIdx = dstR * cols + dstC;
        heights[dstIdx] = g.heights[srcIdx];
        rgb[dstIdx * 3] = g.rgb[srcIdx * 3];
        rgb[dstIdx * 3 + 1] = g.rgb[srcIdx * 3 + 1];
        rgb[dstIdx * 3 + 2] = g.rgb[srcIdx * 3 + 2];
        if (materialTag && g.materialTag) {
          materialTag[dstIdx] = g.materialTag[srcIdx];
        }
      }
    }
  }

  return {
    originX: minX,
    originZ: minZ,
    cols,
    rows,
    cellSize,
    heights,
    rgb,
    materialTag,
  };
}

/**
 * Rasterizes arbitrary 3D object primitives (buildings, roads, water, trees)
 * into a HeightColorGrid for deterministic testing and procedural 3D scenes.
 */
export function voxelize3DObjects(
  objects: Object3DPrimitive[],
  bounds: { originX: number; originZ: number; widthBlocks: number; depthBlocks: number },
  cellSize = 2,
  groundY = 67
): HeightColorGrid {
  const cols = Math.ceil(bounds.widthBlocks / cellSize);
  const rows = Math.ceil(bounds.depthBlocks / cellSize);
  const heights = new Float32Array(cols * rows);
  const rgb = new Uint8Array(cols * rows * 3);
  const materialTag = new Uint8Array(cols * rows);

  // Fill neutral grass/ground baseline
  heights.fill(groundY);
  for (let i = 0; i < cols * rows; i++) {
    rgb[i * 3] = 88;
    rgb[i * 3 + 1] = 112;
    rgb[i * 3 + 2] = 72;
  }

  for (const obj of objects) {
    const rad = ((obj.angleDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);
    const hw = obj.width * 0.5;
    const hd = obj.depth * 0.5;
    const skewClamped =
      obj.shape === 'parallelogram' ? Math.max(-60, Math.min(60, obj.skewDeg ?? 25)) : 0;
    const skewTan = obj.shape === 'parallelogram' ? Math.tan((skewClamped * Math.PI) / 180) : 0;
    const maxR = Math.hypot(hw + Math.abs(skewTan * hd), hd) + cellSize;

    const minC = Math.max(0, Math.floor((obj.x - maxR - bounds.originX) / cellSize));
    const maxC = Math.min(cols - 1, Math.ceil((obj.x + maxR - bounds.originX) / cellSize));
    const minR = Math.max(0, Math.floor((obj.z - maxR - bounds.originZ) / cellSize));
    const maxRIdx = Math.min(rows - 1, Math.ceil((obj.z + maxR - bounds.originZ) / cellSize));

    const tag =
      obj.material === 'building'
        ? 1
        : obj.material === 'road'
        ? 2
        : obj.material === 'foliage'
        ? 3
        : 4;
    const defaultRgb: [number, number, number] =
      obj.rgb ??
      (obj.material === 'building'
        ? [164, 134, 118]
        : obj.material === 'road'
        ? [44, 46, 50]
        : obj.material === 'foliage'
        ? [56, 98, 42]
        : [52, 112, 178]);

    for (let r = minR; r <= maxRIdx; r++) {
      const wz = bounds.originZ + (r + 0.5) * cellSize;
      for (let c = minC; c <= maxC; c++) {
        const wx = bounds.originX + (c + 0.5) * cellSize;
        const dx = wx - obj.x;
        const dz = wz - obj.z;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;

        let insidePrimitive: boolean;
        if (obj.shape === 'circle') {
          insidePrimitive = (lx / Math.max(0.5, hw)) ** 2 + (lz / Math.max(0.5, hd)) ** 2 <= 1;
        } else if (obj.shape === 'triangle') {
          const inBox = Math.abs(lx) <= hw && Math.abs(lz) <= hd;
          if (!inBox) {
            insidePrimitive = false;
          } else {
            const nu = (lx + hw) / Math.max(1, hw * 2); // 0..1 left->right
            const nv = (lz + hd) / Math.max(1, hd * 2); // 0..1 top->bottom
            const c = obj.triangleCorner ?? 0;
            insidePrimitive =
              c === 0
                ? nu + nv <= 1.02
                : c === 1
                ? 1 - nu + nv <= 1.02
                : c === 2
                ? 1 - nu + (1 - nv) <= 1.02
                : nu + (1 - nv) <= 1.02;
          }
        } else if (obj.shape === 'parallelogram') {
          insidePrimitive = Math.abs(lz) <= hd && Math.abs(lx + skewTan * lz) <= hw;
        } else {
          insidePrimitive = Math.abs(lx) <= hw && Math.abs(lz) <= hd;
        }

        if (insidePrimitive) {
          // Support hollow wall/fence primitives (no roof deck in interior) for roof-rejection testing
          if (obj.hollowNoRoof) {
            const onWall =
              obj.shape === 'circle'
                ? Math.hypot(lx / Math.max(0.5, hw), lz / Math.max(0.5, hd)) >= 0.82
                : hw - Math.abs(lx) <= cellSize * 1.4 || hd - Math.abs(lz) <= cellSize * 1.4;
            if (!onWall) continue;
          }

          let cellTopY = obj.topY;
          if (obj.material === 'building' && obj.roofStyle) {
            const baseRoofY = obj.baseY + Math.max(4, (obj.topY - obj.baseY) * 0.65);
            const roofRise = Math.max(4, obj.topY - baseRoofY);
            if (obj.roofStyle === 'pitched') {
              const frac = 1 - Math.abs(lz) / Math.max(1, hd);
              cellTopY = baseRoofY + roofRise * frac;
            } else if (obj.roofStyle === 'curved') {
              const rNorm = Math.min(1, Math.hypot(lx / Math.max(1, hw), lz / Math.max(1, hd)));
              cellTopY = baseRoofY + roofRise * Math.sqrt(Math.max(0, 1 - rNorm * rNorm));
            } else if (obj.roofStyle === 'complex') {
              cellTopY = lx < 0 ? obj.topY : baseRoofY + roofRise * 0.35;
            }
          }

          const idx = r * cols + c;
          if (obj.material === 'building' || obj.material === 'water' || heights[idx] <= cellTopY) {
            heights[idx] = cellTopY;
            rgb[idx * 3] = defaultRgb[0];
            rgb[idx * 3 + 1] = defaultRgb[1];
            rgb[idx * 3 + 2] = defaultRgb[2];
            materialTag[idx] = tag;
          }
        }
      }
    }
  }

  return {
    originX: bounds.originX,
    originZ: bounds.originZ,
    cols,
    rows,
    cellSize,
    heights,
    rgb,
    materialTag,
  };
}

function isFoliageRgb(r: number, g: number, b: number): boolean {
  // Minecraft tree canopies & grass: green channel dominates both red and blue
  return g > r + 10 && g > b + 12 && g < 165;
}

function isWaterRgb(r: number, g: number, b: number): boolean {
  return b > r + 18 && b > g + 8 && r < 105;
}

function isElevatedWaterSurface(r: number, g: number, b: number, elev: number): boolean {
  // Genuine Minecraft water sits near ground/sea level. Elevated blue stone, slate,
  // purple/blue terracotta, and prismarine roofs MUST NOT be discarded as water!
  if (elev >= 3.2) return false;
  return isWaterRgb(r, g, b);
}

function isRoadRgb(r: number, g: number, b: number, strictness = 50): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const chroma = maxC - minC;
  const lum = (r + g + b) / 3;
  const maxChroma = Math.max(8, 30 - strictness * 0.2);
  const maxLum = 188 - strictness * 0.25;
  if (lum < 14 || lum > maxLum) return false;
  return chroma <= maxChroma;
}

function isArchitecturalRoofSurface(r: number, g: number, b: number, elev = 10): boolean {
  if (isFoliageRgb(r, g, b) || isElevatedWaterSurface(r, g, b, elev)) return false;
  return true;
}

function isDarkAsphaltRgb(r: number, g: number, b: number): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const chroma = maxC - minC;
  const lum = (r + g + b) / 3;
  // Dark road asphalt (excludes light concrete sidewalks/courtyard paving that surround normal buildings)
  return lum >= 14 && lum <= 112 && chroma <= 22;
}

/**
 * Checks whether an elevated component is actually a bridge / overpass / viaduct rather than a building:
 * - Elongated narrow elevated deck (`aspect >= 2.5`, narrow width `<= 28m`, flat/gently sloped deck)
 * - Flanked on both long sides by water or deep valleys below groundY
 * - OR low-to-medium highway overpass flanked by dark road asphalt AND connected to road/elevated approaches at BOTH short ends
 * - OR directly aligned along an existing transit corridor (rail/tram/bus viaduct)
 */
function isBridgeLikeStructure(
  grid: HeightColorGrid,
  obb: {
    obbCx: number;
    obbCz: number;
    realWidth: number;
    realDepth: number;
    angleRad: number;
  },
  roofInfo: { roofType: RoofType; roofY: number; compactness: number },
  groundY: number,
  height: number,
  mtrRoutes: MtrRoute[] = []
): boolean {
  const longSide = Math.max(obb.realWidth, obb.realDepth);
  const shortSide = Math.max(1, Math.min(obb.realWidth, obb.realDepth));
  const aspect = longSide / shortSide;

  // Bridges are elongated narrow spans, not tall skyscrapers or square blocks
  if (aspect < 2.5 || shortSide > 28 || longSide < 24 || height > 34) {
    return false;
  }

  // Unit vectors along the bridge length (L) and perpendicular flank (P)
  const cos = Math.cos(obb.angleRad);
  const sin = Math.sin(obb.angleRad);
  const alongU = obb.realWidth >= obb.realDepth;
  const lx = alongU ? cos : -sin;
  const lz = alongU ? sin : cos;
  const px = -lz;
  const pz = lx;

  const { cols, rows, cellSize, heights, rgb, materialTag } = grid;
  const halfShort = shortSide * 0.5;
  const halfLong = longSide * 0.5;

  const sampleGrid = (wx: number, wz: number) => {
    const c = Math.floor((wx - grid.originX) / cellSize);
    const r = Math.floor((wz - grid.originZ) / cellSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    const idx = r * cols + c;
    return {
      y: heights[idx],
      r: rgb[idx * 3],
      g: rgb[idx * 3 + 1],
      b: rgb[idx * 3 + 2],
      tag: materialTag ? materialTag[idx] : 0,
    };
  };

  let flankSamples = 0;
  let waterFlank = 0;
  let darkRoadFlank = 0;
  let deepValleyFlank = 0;
  let leftWater = 0;
  let rightWater = 0;
  let leftDarkRoad = 0;
  let rightDarkRoad = 0;

  const numSteps = Math.max(5, Math.min(18, Math.floor(longSide / Math.max(4, cellSize * 2))));
  const flankOffsets = [halfShort + cellSize * 1.5, halfShort + Math.max(6, cellSize * 3)];

  for (let s = 1; s < numSteps; s++) {
    const uPos = -halfLong + (longSide * s) / numSteps;
    const bx = obb.obbCx + lx * uPos;
    const bz = obb.obbCz + lz * uPos;

    for (const side of [-1, 1] as const) {
      let sideWater = false;
      let sideRoad = false;
      for (const off of flankOffsets) {
        const sample = sampleGrid(bx + px * side * off, bz + pz * side * off);
        if (!sample) continue;
        flankSamples++;
        const isW = sample.tag === 4 || isWaterRgb(sample.r, sample.g, sample.b);
        const isDarkRd =
          (sample.tag === 2 || isDarkAsphaltRgb(sample.r, sample.g, sample.b)) &&
          Math.abs(sample.y - groundY) <= 5;
        if (isW) {
          waterFlank++;
          sideWater = true;
        } else if (isDarkRd) {
          darkRoadFlank++;
          sideRoad = true;
        }
        if (sample.y < groundY - 3) {
          deepValleyFlank++;
        }
      }
      if (sideWater) {
        if (side < 0) leftWater++;
        else rightWater++;
      }
      if (sideRoad) {
        if (side < 0) leftDarkRoad++;
        else rightDarkRoad++;
      }
    }
  }

  // 1. River / canal / bay bridge spanning water on both flanks
  const waterRatio = flankSamples > 0 ? waterFlank / flankSamples : 0;
  if (leftWater >= 2 && rightWater >= 2 && waterRatio >= 0.22) {
    return true;
  }

  // 2. Deep valley / canyon bridge
  if (flankSamples > 0 && deepValleyFlank / flankSamples >= 0.48 && aspect >= 3.2) {
    return true;
  }

  // 3. Highway overpass over dark road asphalt: must have road/elevated approaches at BOTH short ends
  //    (prevents false rejection of long residential apartment blocks bordered by sidewalks!)
  let endRoadHits = 0;
  for (const endSign of [-1, 1] as const) {
    const ex = obb.obbCx + lx * endSign * (halfLong + Math.max(4, cellSize * 2));
    const ez = obb.obbCz + lz * endSign * (halfLong + Math.max(4, cellSize * 2));
    const sample = sampleGrid(ex, ez);
    if (sample) {
      const isDarkRd = sample.tag === 2 || isDarkAsphaltRgb(sample.r, sample.g, sample.b);
      const isElevatedApproach = sample.y >= groundY + 2 && sample.y <= roofInfo.roofY + 2;
      if (isDarkRd || isElevatedApproach) endRoadHits++;
    }
  }
  const darkRoadRatio = flankSamples > 0 ? darkRoadFlank / flankSamples : 0;
  if (
    height <= 18 &&
    endRoadHits === 2 &&
    leftDarkRoad >= 2 &&
    rightDarkRoad >= 2 &&
    darkRoadRatio >= 0.24
  ) {
    return true;
  }

  // 4. Transit / rail viaduct aligned along an MTR route
  if (mtrRoutes.length > 0 && aspect >= 2.8) {
    let alignedPts = 0;
    for (const rt of mtrRoutes) {
      const pts = rt.tracedPath3D ?? rt.stops;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - obb.obbCx;
        const dz = pts[i].z - obb.obbCz;
        const lu = dx * lx + dz * lz;
        const lp = dx * px + dz * pz;
        if (Math.abs(lu) <= halfLong + 8 && Math.abs(lp) <= halfShort + 6) {
          alignedPts++;
        }
      }
      if (alignedPts >= 2) return true;
    }
  }

  return false;
}

function estimateGroundY(grid: HeightColorGrid): number {
  const hist = new Map<number, number>();
  for (let i = 0; i < grid.heights.length; i++) {
    const y = Math.round(grid.heights[i]);
    if (y < 30 || y > 150) continue;
    const r = grid.rgb[i * 3];
    const g = grid.rgb[i * 3 + 1];
    const b = grid.rgb[i * 3 + 2];
    if (isWaterRgb(r, g, b)) continue;
    hist.set(y, (hist.get(y) ?? 0) + 1);
  }
  let bestY = SERVER_GROUND_Y;
  let bestCount = -1;
  for (const [y, cnt] of hist.entries()) {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestY = y;
    }
  }
  return bestY;
}

function classifyBuildingFromRoof(
  avgR: number,
  avgG: number,
  avgB: number,
  width: number,
  depth: number,
  floors: number
): BuildingCategory {
  const area = width * depth;
  const maxC = Math.max(avgR, avgG, avgB);
  const minC = Math.min(avgR, avgG, avgB);
  const sat = maxC - minC;

  if (area > 5200 && floors <= 6 && sat < 26) return 'industrial';
  if (area > 4200 && floors <= 7) return 'commercial';
  if (avgR > avgG + 18 && avgR > avgB + 15 && floors <= 7) return 'civic';
  if (avgB > avgR + 12 && floors >= 5) return 'transport';
  if (floors >= 8) return 'residential';
  if (area > 2200) return 'culture';
  return 'residential';
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

/**
 * Verifies that an elevated 3D component actually possesses an architectural roof
 * (flat, pitched, curved/domed, or complex stepped) above local server ground Y,
 * rejecting hollow wall shells, fences, pillars, and non-roofed terrain.
 * Uses true 4-connected interior roof-deck erosion so hollow walls are rejected even
 * while L-shaped / courtyard wings pass accurately.
 */
function analyzeRoofAndShape(
  cells: Array<{ wx: number; wz: number; c: number; r: number; u: number; v: number; h: number }>,
  groundY: number,
  realWidth: number,
  realDepth: number,
  cellSize: number,
  minBuildingHeight: number
): {
  hasValidRoof: boolean;
  roofType: RoofType;
  shapeType: BuildingShapeType;
  compactness: number;
  roofY: number;
} {
  const obbArea = Math.max(1, realWidth * realDepth);
  const coveredArea = cells.length * cellSize * cellSize;
  const compactness = Math.min(1, coveredArea / obbArea);

  const elevs = cells.map((c) => c.h - groundY).sort((a, b) => a - b);
  const n = elevs.length;
  const p20 = elevs[Math.floor(n * 0.2)];
  const p50 = elevs[Math.floor(n * 0.5)];
  const p85 = elevs[Math.min(n - 1, Math.floor(n * 0.85))];
  const iqr = p85 - p20;

  // Build exact cell set to measure true solid roof deck interior (rejects 1-cell hollow walls/fences!)
  const cellKeySet = new Set<number>();
  for (const cell of cells) {
    cellKeySet.add(cell.r * 16384 + cell.c);
  }
  let erodedInteriorCells = 0;
  for (const cell of cells) {
    const k = cell.r * 16384 + cell.c;
    if (
      cellKeySet.has(k - 1) &&
      cellKeySet.has(k + 1) &&
      cellKeySet.has(k - 16384) &&
      cellKeySet.has(k + 16384)
    ) {
      erodedInteriorCells++;
    }
  }

  // Compute center vs edge elevation profile to distinguish roofed decks/domes/gables from hollow walls
  const hw = realWidth * 0.5;
  const hd = realDepth * 0.5;
  let centerCount = 0;
  let centerSumY = 0;
  let edgeCount = 0;
  let edgeSumY = 0;

  // Height histogram buckets (2-block bins) for multi-tier/complex roof detection
  const heightBins = new Map<number, number>();

  for (const cell of cells) {
    const nu = Math.abs(cell.u) / Math.max(1, hw);
    const nv = Math.abs(cell.v) / Math.max(1, hd);
    const radDist = Math.max(nu, nv);
    if (radDist <= 0.58) {
      centerCount++;
      centerSumY += cell.h;
    } else {
      edgeCount++;
      edgeSumY += cell.h;
    }
    const bin = Math.round((cell.h - groundY) / 2);
    heightBins.set(bin, (heightBins.get(bin) ?? 0) + 1);
  }

  const interiorCoverage = centerCount / Math.max(1, n);
  const erodedRatio = erodedInteriorCells / Math.max(1, n);
  const hasDeckAboveGround = p50 >= minBuildingHeight;
  const hasRoofDeck =
    (erodedInteriorCells >= 1 && erodedRatio >= 0.08) ||
    (n <= 12 && interiorCoverage >= 0.2 && compactness >= 0.5) ||
    (n <= 4 && compactness >= 0.65);
  const notHollowRing = n <= 4 || interiorCoverage >= 0.1 || erodedRatio >= 0.22;
  const hasValidRoof = hasDeckAboveGround && hasRoofDeck && notHollowRing;

  // Classify roof type: flat vs pitched vs curved vs complex
  const centerMeanY = centerCount > 0 ? centerSumY / centerCount : groundY + p50;
  const edgeMeanY = edgeCount > 0 ? edgeSumY / edgeCount : groundY + p50;
  const centerLift = centerMeanY - edgeMeanY;

  let distinctPlateaus = 0;
  for (const cnt of heightBins.values()) {
    if (cnt >= Math.max(4, n * 0.16)) distinctPlateaus++;
  }

  let roofType: RoofType = 'flat';
  if (iqr <= 2.2) {
    roofType = compactness < 0.62 ? 'complex' : 'flat';
  } else if (distinctPlateaus >= 2 && centerLift < 1.2) {
    roofType = 'complex';
  } else if (centerLift >= 1.4) {
    let domeScore = 0;
    let gableScore = 0;
    for (const cell of cells) {
      const nu = Math.abs(cell.u) / Math.max(1, hw);
      const nv = Math.abs(cell.v) / Math.max(1, hd);
      const hNorm = (cell.h - groundY - p20) / Math.max(1, iqr);
      const expectedDome = Math.sqrt(Math.max(0, 1 - Math.min(1, nu * nu + nv * nv)));
      const expectedGable = 1 - Math.min(nu, nv);
      domeScore += Math.abs(hNorm - expectedDome);
      gableScore += Math.abs(hNorm - expectedGable);
    }
    roofType = domeScore < gableScore * 0.94 ? 'curved' : 'pitched';
  } else {
    roofType = 'complex';
  }

  // Classify footprint shape
  const aspect = Math.max(realWidth, realDepth) / Math.max(1, Math.min(realWidth, realDepth));
  let shapeType: BuildingShapeType = 'rectangular';
  if (compactness < 0.58) {
    shapeType = 'complex';
  } else if (compactness < 0.74) {
    shapeType = 'l-shaped';
  } else if (aspect <= 1.28) {
    shapeType = 'square';
  } else if (aspect >= 2.6) {
    shapeType = 'elongated';
  } else {
    shapeType = 'rectangular';
  }

  return {
    hasValidRoof,
    roofType,
    shapeType,
    compactness: Math.round(compactness * 100) / 100,
    roofY: Math.round(groundY + p85),
  };
}

interface RawCellSample {
  wx: number;
  wz: number;
  c: number;
  r: number;
  h: number;
  rCol: number;
  gCol: number;
  bCol: number;
}

/**
 * Finds the exact dominant facade/wall orientation angle in [0, PI/2) using
 * phase-invariant Boundary-Projection Wall-Alignment Energy (immune to PCA L-shape skew!).
 * Straight walls along theta and theta+90° collapse onto sharp histogram spikes,
 * accurately locking axis-aligned (0°), diagonal (45°), and arbitrary-angle buildings.
 */
function findDominantWallAngle(cells: RawCellSample[], cellSize: number): number {
  const n = cells.length;
  if (n < 4) return 0;

  let sumX = 0;
  let sumZ = 0;
  const cellSet = new Set<number>();
  for (let i = 0; i < n; i++) {
    sumX += cells[i].wx;
    sumZ += cells[i].wz;
    cellSet.add(cells[i].r * 16384 + cells[i].c);
  }
  const cx = sumX / n;
  const cz = sumZ / n;

  // Extract perimeter boundary cells (cells touching outside space)
  const bDx: number[] = [];
  const bDz: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const k = c.r * 16384 + c.c;
    if (
      !cellSet.has(k - 1) ||
      !cellSet.has(k + 1) ||
      !cellSet.has(k - 16384) ||
      !cellSet.has(k + 16384)
    ) {
      bDx.push(c.wx - cx);
      bDz.push(c.wz - cz);
    }
  }
  const m = bDx.length;
  if (m < 4) return 0;

  const bw = Math.max(1, cellSize * 1.12);
  const invBw = 1 / bw;
  const cellArea = n * cellSize * cellSize;

  const scoreAngle = (rad: number): { score: number; compactness: number } => {
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);
    const uBins0 = new Map<number, number>();
    const vBins0 = new Map<number, number>();
    const uBins1 = new Map<number, number>();
    const vBins1 = new Map<number, number>();
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (let i = 0; i < m; i++) {
      const dx = bDx[i];
      const dz = bDz[i];
      const u = dx * cos - dz * sin;
      const v = dx * sin + dz * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;

      const bu0 = Math.floor(u * invBw);
      const bv0 = Math.floor(v * invBw);
      const bu1 = Math.floor(u * invBw + 0.5);
      const bv1 = Math.floor(v * invBw + 0.5);
      uBins0.set(bu0, (uBins0.get(bu0) ?? 0) + 1);
      vBins0.set(bv0, (vBins0.get(bv0) ?? 0) + 1);
      uBins1.set(bu1, (uBins1.get(bu1) ?? 0) + 1);
      vBins1.set(bv1, (vBins1.get(bv1) ?? 0) + 1);
    }

    let energy0 = 0;
    for (const cnt of uBins0.values()) energy0 += cnt * cnt;
    for (const cnt of vBins0.values()) energy0 += cnt * cnt;
    let energy1 = 0;
    for (const cnt of uBins1.values()) energy1 += cnt * cnt;
    for (const cnt of vBins1.values()) energy1 += cnt * cnt;

    const w = Math.max(cellSize, maxU - minU + cellSize);
    const d = Math.max(cellSize, maxV - minV + cellSize);
    const compactness = Math.min(1, cellArea / Math.max(1, w * d));

    // Scale compactness contribution with m*m so voxel staircase artifacts at 0°
    // never overpower a tight minimum-area rotated bounding box on diagonal buildings!
    const score = (energy0 + energy1) * 0.5 + compactness * m * m * 0.14;
    return { score, compactness };
  };

  // Coarse 3° sweep over [0°, 90°) tracking BOTH wall-energy peak AND min-area compactness peak
  let bestDeg = 0;
  let bestEnergy = -Infinity;
  let bestCompactAtBest = 0;
  let secondDeg = 45;
  let secondEnergy = -Infinity;
  let bestCompactDeg = 0;
  let bestCompactness = 0;
  let res0 = { score: 0, compactness: 0 };
  let res45 = { score: 0, compactness: 0 };

  for (let deg = 0; deg < 90; deg += 3) {
    const res = scoreAngle((deg * Math.PI) / 180);
    if (deg === 0) res0 = res;
    if (deg === 45) res45 = res;
    if (res.compactness > bestCompactness) {
      bestCompactness = res.compactness;
      bestCompactDeg = deg;
    }
    if (res.score > bestEnergy) {
      if (Math.abs(deg - bestDeg) >= 9) {
        secondDeg = bestDeg;
        secondEnergy = bestEnergy;
      }
      bestEnergy = res.score;
      bestDeg = deg;
      bestCompactAtBest = res.compactness;
    } else if (res.score > secondEnergy && Math.abs(deg - bestDeg) >= 9) {
      secondEnergy = res.score;
      secondDeg = deg;
    }
  }

  // Fine 0.5° refinement around top wall-energy peaks AND minimum-area compactness peak
  const peaks = [bestDeg, secondDeg, bestCompactDeg];
  for (const peak of peaks) {
    for (let off = -2.5; off <= 2.5; off += 0.5) {
      const deg = ((peak + off) % 90 + 90) % 90;
      const res = scoreAngle((deg * Math.PI) / 180);
      if (res.compactness > bestCompactness) {
        bestCompactness = res.compactness;
        bestCompactDeg = deg;
      }
      if (res.score > bestEnergy) {
        bestEnergy = res.score;
        bestDeg = deg;
        bestCompactAtBest = res.compactness;
      }
    }
  }

  // Diagonal-building protection: if a rotated angle produces a genuinely tight rectangular fit
  // (compactness >= 0.78) that beats axis-aligned 0° by >= 8 percentage points, lock onto it directly!
  const isClearDiagonalRect =
    bestCompactness >= 0.78 &&
    bestCompactness >= res0.compactness + 0.08 &&
    bestCompactDeg > 5 &&
    bestCompactDeg < 85;

  if (isClearDiagonalRect) {
    if (Math.abs(bestCompactDeg - 45) <= 3 && res45.compactness >= bestCompactness * 0.96) {
      return Math.PI / 4;
    }
    const nearest15 = Math.round(bestCompactDeg / 15) * 15;
    if (nearest15 > 0 && nearest15 < 90 && Math.abs(bestCompactDeg - nearest15) <= 2) {
      const snappedRad = (nearest15 * Math.PI) / 180;
      if (scoreAngle(snappedRad).compactness >= bestCompactness * 0.97) {
        return snappedRad;
      }
    }
    return (Math.round(bestCompactDeg) * Math.PI) / 180;
  }

  // Crisp architectural angle snapping (eliminates noisy 2–7° raster tilt on orthogonal/diagonal buildings)
  if (
    (bestDeg <= 7 || bestDeg >= 83) &&
    res0.score >= bestEnergy * 0.80 &&
    res0.compactness >= bestCompactAtBest - 0.05
  ) {
    return 0;
  }
  if (
    Math.abs(bestDeg - 45) <= 6 &&
    res45.score >= bestEnergy * 0.84 &&
    res45.compactness >= bestCompactAtBest - 0.04
  ) {
    return Math.PI / 4;
  }
  const nearest15 = Math.round(bestDeg / 15) * 15;
  if (Math.abs(bestDeg - nearest15) <= 2.5) {
    const snappedRad = ((nearest15 % 90) * Math.PI) / 180;
    const snappedRes = scoreAngle(snappedRad);
    if (snappedRes.score >= bestEnergy * 0.92 && snappedRes.compactness >= bestCompactAtBest - 0.03) {
      return snappedRad;
    }
  }

  return (Math.round(bestDeg) * Math.PI) / 180;
}

/**
 * Computes wall-aligned OBB metrics for a cluster of elevated roof cells
 * (either at its exact dominant facade orientation or at an explicit locked angle).
 */
function computeClusterObb(
  cells: RawCellSample[],
  cellSize: number,
  forcedAngleRad?: number
) {
  let sumX = 0;
  let sumZ = 0;
  for (const cell of cells) {
    sumX += cell.wx;
    sumZ += cell.wz;
  }
  const n = cells.length;
  const cx = sumX / n;
  const cz = sumZ / n;

  let angleRad =
    forcedAngleRad !== undefined ? forcedAngleRad : findDominantWallAngle(cells, cellSize);
  if (!Number.isFinite(angleRad)) angleRad = 0;

  const cos = Math.cos(-angleRad);
  const sin = Math.sin(-angleRad);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  const projected = cells.map((cell) => {
    const dx = cell.wx - cx;
    const dz = cell.wz - cz;
    const u = dx * cos - dz * sin;
    const v = dx * sin + dz * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    return { ...cell, u, v };
  });

  // Continuous sub-meter dimensions without arbitrary block-minimum inflation
  const realWidth = Math.max(1, Math.round((maxU - minU + cellSize) * 10) / 10);
  const realDepth = Math.max(1, Math.round((maxV - minV + cellSize) * 10) / 10);
  const obbArea = Math.max(1, realWidth * realDepth);
  const compactness = Math.min(1, (n * cellSize * cellSize) / obbArea);

  const midU = (minU + maxU) * 0.5;
  const midV = (minV + maxV) * 0.5;
  for (const p of projected) {
    p.u -= midU;
    p.v -= midV;
  }

  const obbCx = Math.round((cx + midU * Math.cos(angleRad) - midV * Math.sin(angleRad)) * 10) / 10;
  const obbCz = Math.round((cz + midU * Math.sin(angleRad) + midV * Math.cos(angleRad)) * 10) / 10;

  return {
    projected,
    angleRad,
    realWidth,
    realDepth,
    obbArea,
    compactness,
    obbCx,
    obbCz,
  };
}

/**
 * Detects whether a roof cluster is genuinely circular or elliptical (rotunda, cylindrical tower,
 * circus, round arena/pavilion) rather than a square/rectangle or L-shape.
 * Uses Ellipse IoU, empty bounding-box corners, and boundary radial uniformity.
 */
function detectCircularCluster(
  cells: RawCellSample[],
  obb: ReturnType<typeof computeClusterObb>,
  cellSize: number
): boolean {
  const n = cells.length;
  if (n < 10) return false;
  if (Math.min(obb.realWidth, obb.realDepth) < Math.max(6, cellSize * 3)) return false;

  const aspect = Math.max(obb.realWidth, obb.realDepth) / Math.max(1, Math.min(obb.realWidth, obb.realDepth));
  if (aspect > 1.65) return false;

  // A wall-aligned square/rectangle has compactness >= 0.90; a circle/ellipse fills pi/4 ~= 0.785
  if (obb.compactness < 0.60 || obb.compactness > 0.875) return false;

  const rx = Math.max(1, obb.realWidth * 0.5);
  const ry = Math.max(1, obb.realDepth * 0.5);
  const cellSet = new Set<number>();
  for (let i = 0; i < n; i++) {
    cellSet.add(cells[i].r * 16384 + cells[i].c);
  }

  let insideEllipse = 0;
  let outerCornerCells = 0;
  const boundaryRadii: number[] = [];

  for (let i = 0; i < n; i++) {
    const p = obb.projected[i];
    const nu = Math.abs(p.u) / rx;
    const nv = Math.abs(p.v) / ry;
    const rE = Math.hypot(nu, nv);
    if (rE <= 1.08) insideEllipse++;
    if (nu + nv > 1.38) outerCornerCells++;

    const k = p.r * 16384 + p.c;
    if (
      !cellSet.has(k - 1) ||
      !cellSet.has(k + 1) ||
      !cellSet.has(k - 16384) ||
      !cellSet.has(k + 16384)
    ) {
      boundaryRadii.push(rE);
    }
  }

  if (boundaryRadii.length < 8) return false;

  const cellArea = n * cellSize * cellSize;
  const insideArea = insideEllipse * cellSize * cellSize;
  const outsideArea = cellArea - insideArea;
  const ellipseArea = Math.PI * rx * ry;
  const ellipseIoU = insideArea / Math.max(1, ellipseArea + outsideArea);
  const cornerFraction = outerCornerCells / n;

  let rSum = 0;
  for (const r of boundaryRadii) rSum += r;
  const rMean = rSum / boundaryRadii.length;
  let rVar = 0;
  for (const r of boundaryRadii) {
    const diff = r - rMean;
    rVar += diff * diff;
  }
  const rStd = Math.sqrt(rVar / boundaryRadii.length);

  return ellipseIoU >= 0.83 && cornerFraction <= 0.045 && rStd <= 0.12 && rMean >= 0.78 && rMean <= 1.12;
}

/**
 * Detects whether a roof cluster is a right-angled triangular corner building
 * (e.g. a corner building cut at 45° along a diagonal embankment or canal intersection).
 * Evaluates all 4 right-triangle orientations inscribed in the OBB and requires high Triangle IoU
 * + decisive improvement over a rectangular bounding box + an empty opposite corner.
 */
function detectTriangularCluster(
  cells: RawCellSample[],
  obb: ReturnType<typeof computeClusterObb>,
  cellSize: number
): { isTriangular: boolean; corner: 0 | 1 | 2 | 3; iou: number } {
  const n = cells.length;
  if (n < 10) return { isTriangular: false, corner: 0, iou: 0 };
  if (Math.min(obb.realWidth, obb.realDepth) < Math.max(6, cellSize * 3)) {
    return { isTriangular: false, corner: 0, iou: 0 };
  }

  // A crisp right triangle fills ~0.50 of its bounding box (vs ~0.95 for a rectangle, ~0.785 for a circle)
  if (obb.compactness < 0.34 || obb.compactness > 0.67) {
    return { isTriangular: false, corner: 0, iou: 0 };
  }

  const halfU = Math.max(1, obb.realWidth * 0.5);
  const halfV = Math.max(1, obb.realDepth * 0.5);
  const fullU = halfU * 2;
  const fullV = halfV * 2;
  const cellArea = n * cellSize * cellSize;
  const triArea = obb.realWidth * obb.realDepth * 0.5;

  let bestCorner: 0 | 1 | 2 | 3 = 0;
  let bestIoU = 0;
  let bestCoverage = 0;
  let bestOppositeCornerFrac = 1;
  let bestMidHypFill = 0;
  const expectedMidHypArea = 0.08 * obb.realWidth * obb.realDepth;

  for (let corner = 0; corner < 4; corner++) {
    let inside = 0;
    let farOutside = 0;
    let midHypCells = 0;
    for (let i = 0; i < n; i++) {
      const p = obb.projected[i];
      const nu = (p.u + halfU) / fullU; // 0..1
      const nv = (p.v + halfV) / fullV; // 0..1
      const tu = corner === 0 || corner === 3 ? nu : 1 - nu;
      const tv = corner === 0 || corner === 1 ? nv : 1 - nv;
      const sum = tu + tv;
      if (sum <= 1.07) inside++;
      if (sum > 1.24) farOutside++;
      // Inner hypotenuse zone (tu >= 0.30, tv >= 0.30, tu + tv <= 1.02):
      // ~100% solid in a real right triangle, ~0..30% empty courtyard in an L-shaped building!
      if (tu >= 0.3 && tv >= 0.3 && sum <= 1.02) midHypCells++;
    }
    const insideArea = inside * cellSize * cellSize;
    const outsideArea = Math.max(0, cellArea - insideArea);
    const iou = insideArea / Math.max(1, triArea + outsideArea);
    const coverage = inside / n;
    const oppFrac = farOutside / n;
    const midHypFill = (midHypCells * cellSize * cellSize) / Math.max(1, expectedMidHypArea);

    if (iou > bestIoU) {
      bestIoU = iou;
      bestCorner = corner as 0 | 1 | 2 | 3;
      bestCoverage = coverage;
      bestOppositeCornerFrac = oppFrac;
      bestMidHypFill = midHypFill;
    }
  }

  const rectIoU = obb.compactness;
  const isTriangular =
    bestIoU >= 0.76 &&
    bestCoverage >= 0.86 &&
    bestOppositeCornerFrac <= 0.05 &&
    bestMidHypFill >= 0.68 &&
    bestIoU >= rectIoU + 0.14;

  return { isTriangular, corner: bestCorner, iou: bestIoU };
}

interface ParallelogramFitResult {
  isParallelogram: boolean;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  angleDeg: number;
  skewDeg: number;
  compactness: number;
  footprint: WorldPoint[];
}

/**
 * Detects oblique parallelogram (parallelepiped) roof footprints such as slanted modernist slabs
 * or diagonal street-corner blocks whose non-orthogonal edges fit a sheared parallelogram
 * significantly tighter than an axis-orthogonal OBB rectangle.
 */
function detectParallelogramCluster(
  cells: RawCellSample[],
  obb: ReturnType<typeof computeClusterObb>,
  cellSize: number
): ParallelogramFitResult {
  const empty: ParallelogramFitResult = {
    isParallelogram: false,
    centerX: obb.obbCx,
    centerZ: obb.obbCz,
    width: obb.realWidth,
    depth: obb.realDepth,
    angleDeg: (obb.angleRad * 180) / Math.PI,
    skewDeg: 0,
    compactness: obb.compactness,
    footprint: [],
  };

  const n = cells.length;
  if (n < 14) return empty;
  if (Math.min(obb.realWidth, obb.realDepth) < Math.max(5, cellSize * 2.5)) return empty;
  // Already a crisp rectangle — never force a parallelogram skew on rectangular buildings
  if (obb.compactness > 0.87 || obb.compactness < 0.36) return empty;

  // Extract 4-connected boundary cells for fast O(B) oblique envelope sweeping
  const cellSet = new Set<number>();
  let sumX = 0;
  let sumZ = 0;
  for (let i = 0; i < n; i++) {
    cellSet.add(cells[i].r * 16384 + cells[i].c);
    sumX += cells[i].wx;
    sumZ += cells[i].wz;
  }
  const cx = sumX / n;
  const cz = sumZ / n;

  const boundary: Array<{ dx: number; dz: number }> = [];
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const k = c.r * 16384 + c.c;
    if (
      !cellSet.has(k - 1) ||
      !cellSet.has(k + 1) ||
      !cellSet.has(k - 16384) ||
      !cellSet.has(k + 16384)
    ) {
      boundary.push({ dx: c.wx - cx, dz: c.wz - cz });
    }
  }
  const pts = boundary.length >= 10 ? boundary : cells.map((c) => ({ dx: c.wx - cx, dz: c.wz - cz }));

  const evalPair = (t1Rad: number, t2Rad: number) => {
    const u1x = Math.cos(t1Rad);
    const u1z = Math.sin(t1Rad);
    const u2x = Math.cos(t2Rad);
    const u2z = Math.sin(t2Rad);
    const det = u1x * u2z - u1z * u2x; // sin(t2 - t1)
    const absDet = Math.abs(det);
    if (absDet < 0.35) return null; // avoid near-collinear shear (> 69°)

    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const { dx, dz } = pts[i];
      const a = (dx * u2z - dz * u2x) / det;
      const b = (-dx * u1z + dz * u1x) / det;
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
    const spanA = Math.max(cellSize, maxA - minA + cellSize);
    const spanB = Math.max(cellSize, maxB - minB + cellSize);
    const area = spanA * spanB * absDet;
    return { t1Rad, t2Rad, u1x, u1z, u2x, u2z, det, absDet, minA, maxA, minB, maxB, spanA, spanB, area };
  };

  type FitCand = NonNullable<ReturnType<typeof evalPair>>;
  let best: FitCand | null = null;

  // Coarse search over oblique axis pairs (non-orthogonal: diffDeg in [25..72] or [108..155])
  const DEG = Math.PI / 180;
  const candidateBaseAngles: number[] = [];
  for (let d = 0; d < 180; d += 10) candidateBaseAngles.push(d * DEG);
  candidateBaseAngles.push(obb.angleRad, obb.angleRad + Math.PI * 0.5);

  for (let i = 0; i < candidateBaseAngles.length; i++) {
    const t1 = candidateBaseAngles[i];
    for (let diff = 25; diff <= 155; diff += 6) {
      if (diff > 72 && diff < 108) continue; // skip near-orthogonal (rectangles!)
      const cand = evalPair(t1, t1 + diff * DEG);
      if (cand && (!best || cand.area < best.area)) {
        best = cand;
      }
    }
  }

  if (!best) return empty;

  // Fine local refinement ±6° in 2° increments around best (t1, t2)
  const coarseT1 = best.t1Rad;
  const coarseT2 = best.t2Rad;
  for (let d1 = -6; d1 <= 6; d1 += 2) {
    for (let d2 = -6; d2 <= 6; d2 += 2) {
      const t1 = coarseT1 + d1 * DEG;
      const t2 = coarseT2 + d2 * DEG;
      const diffDeg = Math.abs((((t2 - t1) / DEG) % 180 + 180) % 180);
      if (diffDeg < 22 || diffDeg > 158 || (diffDeg > 74 && diffDeg < 106)) continue;
      const cand = evalPair(t1, t2);
      if (cand && cand.area < best.area) {
        best = cand;
      }
    }
  }

  const cellArea = n * cellSize * cellSize;
  const paraCompactness = Math.min(1, cellArea / Math.max(1, best.area));
  // Require strict improvement over orthogonal OBB (>= 14% tighter area and >= 79% solid fill)
  if (best.area > obb.obbArea * 0.86 || paraCompactness < 0.79) {
    return empty;
  }

  // Also ensure interior core is genuinely solid (prevents hollow/L-shaped wings from mimicking a parallelogram)
  let coreHits = 0;
  const halfSpanA = Math.max(0.5, (best.maxA - best.minA) * 0.5);
  const halfSpanB = Math.max(0.5, (best.maxB - best.minB) * 0.5);
  const midA = (best.minA + best.maxA) * 0.5;
  const midB = (best.minB + best.maxB) * 0.5;
  for (let i = 0; i < n; i++) {
    const dx = cells[i].wx - cx;
    const dz = cells[i].wz - cz;
    const a = (dx * best.u2z - dz * best.u2x) / best.det;
    const b = (-dx * best.u1z + dz * best.u1x) / best.det;
    if (Math.abs(a - midA) <= halfSpanA * 0.55 && Math.abs(b - midB) <= halfSpanB * 0.55) {
      coreHits++;
    }
  }
  const coreFill = (coreHits * cellSize * cellSize) / Math.max(1, best.area * 0.3025);
  if (coreFill < 0.72) {
    return empty;
  }

  // Convert oblique (u1, u2) box into canonical (centerX, centerZ, width, depth, angleDeg, skewDeg)
  // Pick the longer edge as base axis for cleaner orientation
  const useU1AsBase = best.spanA >= best.spanB;
  const baseRad = useU1AsBase ? best.t1Rad : best.t2Rad;
  const sideRad = useU1AsBase ? best.t2Rad : best.t1Rad;
  const width = Math.round((useU1AsBase ? best.spanA : best.spanB) * 10) / 10;
  const depth = Math.round(((useU1AsBase ? best.spanB : best.spanA) * best.absDet) * 10) / 10;

  const centerX = Math.round((cx + midA * best.u1x + midB * best.u2x) * 10) / 10;
  const centerZ = Math.round((cz + midA * best.u1z + midB * best.u2z) * 10) / 10;

  // Build exact 4 corners from oblique bounds to derive canonical signed skewDeg
  const a0 = midA - best.spanA * 0.5;
  const a1 = midA + best.spanA * 0.5;
  const b0 = midB - best.spanB * 0.5;
  const b1 = midB + best.spanB * 0.5;
  const rawCorners: WorldPoint[] = [
    { x: cx + a0 * best.u1x + b0 * best.u2x, z: cz + a0 * best.u1z + b0 * best.u2z },
    { x: cx + a1 * best.u1x + b0 * best.u2x, z: cz + a1 * best.u1z + b0 * best.u2z },
    { x: cx + a1 * best.u1x + b1 * best.u2x, z: cz + a1 * best.u1z + b1 * best.u2z },
    { x: cx + a0 * best.u1x + b1 * best.u2x, z: cz + a0 * best.u1z + b1 * best.u2z },
  ];

  let angleDeg = Math.round(((baseRad * 180) / Math.PI) * 10) / 10;
  if (angleDeg > 90) angleDeg -= 180;
  if (angleDeg <= -90) angleDeg += 180;

  // Compute exact signed skew angle in local frame of baseRad
  const diffRad = sideRad - baseRad;
  const sinD = Math.sin(diffRad);
  const cosD = Math.cos(diffRad);
  // In createParallelogramFootprint, as lz goes from -hd to +hd, lx shifts by -tan(skew)*dz
  // Side vector along +lz has (lx, lz) = (-tan(skew)*dz, dz), so tan(skew) = -cosD / sinD when sinD > 0
  let rawSkewDeg = Math.round((Math.atan2(-cosD * Math.sign(sinD || 1), Math.abs(sinD)) * 180) / Math.PI);
  rawSkewDeg = Math.max(-55, Math.min(55, rawSkewDeg));
  if (Math.abs(rawSkewDeg) < 12) {
    // Fallback check via footprint analyzer
    rawSkewDeg = detectParallelogramSkewFromFootprint(rawCorners, centerX, centerZ, angleDeg);
  }
  if (Math.abs(rawSkewDeg) < 12) {
    return empty;
  }

  const footprint = createParallelogramFootprint(
    centerX,
    centerZ,
    width,
    depth,
    angleDeg,
    rawSkewDeg
  );

  return {
    isParallelogram: true,
    centerX,
    centerZ,
    width,
    depth,
    angleDeg,
    skewDeg: rawSkewDeg,
    compactness: paraCompactness,
    footprint,
  };
}

/**
 * Splits a single sub-cluster into 4-connected grid subcomponents after an axis cut.
 */
function splitIntoConnectedSubclusters(cells: RawCellSample[]): RawCellSample[][] {
  if (cells.length === 0) return [];
  const byKey = new Map<number, number>();
  for (let i = 0; i < cells.length; i++) {
    byKey.set(cells[i].r * 16384 + cells[i].c, i);
  }
  const visited = new Uint8Array(cells.length);
  const out: RawCellSample[][] = [];
  const stack: number[] = [];

  for (let i = 0; i < cells.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    stack.push(i);
    const group: RawCellSample[] = [];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const cell = cells[idx];
      group.push(cell);
      const baseKey = cell.r * 16384 + cell.c;
      const nbs = [baseKey - 1, baseKey + 1, baseKey - 16384, baseKey + 16384];
      for (const nk of nbs) {
        const ni = byKey.get(nk);
        if (ni !== undefined && !visited[ni]) {
          visited[ni] = 1;
          stack.push(ni);
        }
      }
    }
    out.push(group);
  }
  return out;
}

/**
 * Simplifies a raw roof cluster silhouette by trimming thin exterior facade protrusions
 * (balconies, entrance porches, bay windows, stepped diagonal eaves) that stick out
 * past the primary facade plane with sparse support, while preserving genuine architectural wings.
 */
function simplifyBuildingCluster(
  cells: RawCellSample[],
  cellSize: number,
  simplification: number
): RawCellSample[] {
  if (simplification <= 0.05 || cells.length < 18) return cells;

  const obb = computeClusterObb(cells, cellSize);
  const minSpan = Math.min(obb.realWidth, obb.realDepth);
  if (minSpan < Math.max(7, cellSize * 4)) return cells;

  // Don't trim circular/elliptical rotundas, crisp triangular corner buildings, or oblique parallelograms
  if (detectCircularCluster(cells, obb, cellSize)) return cells;
  if (detectTriangularCluster(cells, obb, cellSize).isTriangular) return cells;
  if (detectParallelogramCluster(cells, obb, cellSize).isParallelogram) return cells;

  // Build 1-cell grid along local OBB (u, v) to measure density along outer perimeter strips
  const halfU = obb.realWidth * 0.5;
  const halfV = obb.realDepth * 0.5;
  const uBins = Math.max(4, Math.min(80, Math.round(obb.realWidth / cellSize)));
  const vBins = Math.max(4, Math.min(80, Math.round(obb.realDepth / cellSize)));
  const uCounts = new Int32Array(uBins);
  const vCounts = new Int32Array(vBins);

  for (const p of obb.projected) {
    const ub = Math.max(0, Math.min(uBins - 1, Math.floor(((p.u + halfU) / Math.max(1, obb.realWidth)) * uBins)));
    const vb = Math.max(0, Math.min(vBins - 1, Math.floor(((p.v + halfV) / Math.max(1, obb.realDepth)) * vBins)));
    uCounts[ub]++;
    vCounts[vb]++;
  }

  // Median interior strip thickness along each axis
  const sortedU = Array.from(uCounts).filter((x) => x > 0).sort((a, b) => a - b);
  const sortedV = Array.from(vCounts).filter((x) => x > 0).sort((a, b) => a - b);
  const medU = sortedU[Math.floor(sortedU.length * 0.65)] ?? 1;
  const medV = sortedV[Math.floor(sortedV.length * 0.65)] ?? 1;

  // Fringe density threshold scales with simplification: sparse protruding balconies/porches (< threshold)
  // at the very outer 1-3 bins get trimmed so they don't bloat the OBB or spawn fake extra wings!
  const fringeRatio = 0.18 + simplification * 0.24;
  const maxTrimBins = Math.max(1, Math.min(4, Math.round(1 + simplification * 2.5)));

  let uLo = 0;
  while (uLo < maxTrimBins && uLo < uBins - 3 && uCounts[uLo] < medU * fringeRatio) uLo++;
  let uHi = uBins - 1;
  while (uBins - 1 - uHi < maxTrimBins && uHi > uLo + 2 && uCounts[uHi] < medU * fringeRatio) uHi--;

  let vLo = 0;
  while (vLo < maxTrimBins && vLo < vBins - 3 && vCounts[vLo] < medV * fringeRatio) vLo++;
  let vHi = vBins - 1;
  while (vBins - 1 - vHi < maxTrimBins && vHi > vLo + 2 && vCounts[vHi] < medV * fringeRatio) vHi--;

  if (uLo === 0 && uHi === uBins - 1 && vLo === 0 && vHi === vBins - 1) {
    return cells;
  }

  const trimmed: RawCellSample[] = [];
  for (let i = 0; i < obb.projected.length; i++) {
    const p = obb.projected[i];
    const ub = Math.max(0, Math.min(uBins - 1, Math.floor(((p.u + halfU) / Math.max(1, obb.realWidth)) * uBins)));
    const vb = Math.max(0, Math.min(vBins - 1, Math.floor(((p.v + halfV) / Math.max(1, obb.realDepth)) * vBins)));
    if (ub >= uLo && ub <= uHi && vb >= vLo && vb <= vHi) {
      trimmed.push(cells[i]);
    }
  }

  // Only keep trimmed cluster if it preserves >= 72% of original roof mass (never discard real L-wings!)
  if (trimmed.length >= cells.length * 0.72) {
    return trimmed;
  }
  return cells;
}

/**
 * Decomposes angular (L/Г/T/U/П-shaped), bent/stepped diagonal, and complex courtyard blocks
 * into crisp rectangular wings with exact straight inner corners using O(N) prefix/suffix
 * bounding-box waste minimization across both wall-aligned axes (u and v).
 * Preserves circular/elliptical buildings intact and leaves hollow 1-cell fences for roof rejection.
 */
function decomposeComplexBlock(
  cells: RawCellSample[],
  cellSize: number,
  minCells: number,
  maxAreaBlocks: number,
  depth = 0,
  simplification = 0.55
): RawCellSample[][] {
  if (cells.length < minCells) return [];
  const obb = computeClusterObb(cells, cellSize);

  // Do not decompose thin hollow wall/fence rings with virtually no interior roof deck — let roof verification reject them cleanly
  const cellSet = new Set<number>();
  for (const c of cells) cellSet.add(c.r * 16384 + c.c);
  let eroded = 0;
  for (const c of cells) {
    const k = c.r * 16384 + c.c;
    if (cellSet.has(k - 1) && cellSet.has(k + 1) && cellSet.has(k - 16384) && cellSet.has(k + 16384)) {
      eroded++;
    }
  }
  if (eroded / cells.length < 0.08) {
    return [cells];
  }

  // Keep genuine circular / oval, right-angled triangular, & oblique parallelogram buildings whole
  if (depth === 0 && detectCircularCluster(cells, obb, cellSize)) {
    return [cells];
  }
  if (detectTriangularCluster(cells, obb, cellSize).isTriangular) {
    return [cells];
  }
  if (detectParallelogramCluster(cells, obb, cellSize).isParallelogram) {
    return [cells];
  }

  const maxSpan = Math.max(obb.realWidth, obb.realDepth);
  // Simplification controls how readily complex protrusions are collapsed into a clean single volume:
  // at 0.0 -> 0.82 (preserves finer wings), at 0.55 -> 0.72 (absorbs porches/balconies), at 1.0 -> 0.54 (strong simplification)
  const compactThreshold = Math.max(0.50, Math.min(0.84, 0.82 - simplification * 0.28));
  if (obb.compactness >= compactThreshold && obb.obbArea <= maxAreaBlocks) {
    return [cells];
  }
  const maxDepth = simplification >= 0.85 ? 2 : simplification >= 0.55 ? 4 : 6;
  const needsSplit =
    depth < maxDepth &&
    cells.length >= minCells * 2 &&
    ((obb.compactness < compactThreshold && maxSpan >= Math.max(12, cellSize * 4)) ||
      obb.obbArea > maxAreaBlocks);

  if (!needsSplit) {
    return [cells];
  }

  const cellArea = cells.length * cellSize * cellSize;
  const parentBBox = Math.max(1, obb.realWidth * obb.realDepth);
  const parentWaste = Math.max(1, parentBBox - cellArea);

  let bestAxis: 'u' | 'v' = 'u';
  let bestCutCoord = 0;
  let bestScore = -Infinity;
  let bestWasteReductionRatio = 0;
  let bestStepDrop = 0;
  let bestSeamScore = 0;

  // Measure local pixel-to-pixel roof texture variance: variegated multi-block roofs
  // (terracotta + blue stone speckles/stripes) have high local color noise, whereas
  // two distinct uniform row-houses meeting at a clean wall have near-zero internal noise.
  const cellColorMap = new Map<number, RawCellSample>();
  for (let i = 0; i < cells.length; i++) {
    cellColorMap.set(cells[i].r * 16384 + cells[i].c, cells[i]);
  }
  let localNoiseSum = 0;
  let localNoisePairs = 0;
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    const rightNb = cellColorMap.get(a.r * 16384 + (a.c + 1));
    if (rightNb) {
      localNoiseSum += Math.hypot(
        a.rCol - rightNb.rCol,
        (a.gCol - rightNb.gCol) * 1.15,
        (a.bCol - rightNb.bCol) * 0.9
      );
      localNoisePairs++;
    }
    const downNb = cellColorMap.get((a.r + 1) * 16384 + a.c);
    if (downNb) {
      localNoiseSum += Math.hypot(
        a.rCol - downNb.rCol,
        (a.gCol - downNb.gCol) * 1.15,
        (a.bCol - downNb.bCol) * 0.9
      );
      localNoisePairs++;
    }
  }
  const localRoofColorNoise = localNoisePairs > 0 ? localNoiseSum / localNoisePairs : 0;
  const colorSeamDamping = localRoofColorNoise > 12 ? 1 / (1 + (localRoofColorNoise - 12) / 10) : 1;

  for (const axis of ['u', 'v'] as const) {
    const span = axis === 'u' ? obb.realWidth : obb.realDepth;
    if (span < cellSize * 3) continue;
    const halfSpan = span * 0.5;
    const numBins = Math.max(4, Math.min(48, Math.round(span / Math.max(cellSize, span / 48))));
    const binW = span / numBins;

    const counts = new Int32Array(numBins);
    const minOther = new Float64Array(numBins).fill(Infinity);
    const maxOther = new Float64Array(numBins).fill(-Infinity);
    const sumH = new Float64Array(numBins);
    const sumR = new Float64Array(numBins);
    const sumG = new Float64Array(numBins);
    const sumB = new Float64Array(numBins);

    for (const p of obb.projected) {
      const coord = axis === 'u' ? p.u : p.v;
      const other = axis === 'u' ? p.v : p.u;
      const bin = Math.max(0, Math.min(numBins - 1, Math.floor(((coord + halfSpan) / span) * numBins)));
      counts[bin]++;
      if (other < minOther[bin]) minOther[bin] = other;
      if (other > maxOther[bin]) maxOther[bin] = other;
      sumH[bin] += p.h;
      sumR[bin] += p.rCol;
      sumG[bin] += p.gCol;
      sumB[bin] += p.bCol;
    }

    let maxBinCount = 1;
    for (let b = 0; b < numBins; b++) {
      if (counts[b] > maxBinCount) maxBinCount = counts[b];
    }

    // Prefix bounding boxes for left half [0..b]
    const prefCount = new Int32Array(numBins);
    const prefMinO = new Float64Array(numBins);
    const prefMaxO = new Float64Array(numBins);
    const prefFirst = new Int32Array(numBins);
    let cAcc = 0;
    let mn = Infinity;
    let mx = -Infinity;
    let firstIdx = -1;
    for (let b = 0; b < numBins; b++) {
      if (counts[b] > 0) {
        if (firstIdx < 0) firstIdx = b;
        cAcc += counts[b];
        if (minOther[b] < mn) mn = minOther[b];
        if (maxOther[b] > mx) mx = maxOther[b];
      }
      prefCount[b] = cAcc;
      prefMinO[b] = mn;
      prefMaxO[b] = mx;
      prefFirst[b] = firstIdx;
    }

    // Suffix bounding boxes for right half [b+1..numBins-1]
    const suffCount = new Int32Array(numBins);
    const suffMinO = new Float64Array(numBins);
    const suffMaxO = new Float64Array(numBins);
    const suffLast = new Int32Array(numBins);
    cAcc = 0;
    mn = Infinity;
    mx = -Infinity;
    let lastIdx = -1;
    for (let b = numBins - 1; b >= 0; b--) {
      if (counts[b] > 0) {
        if (lastIdx < 0) lastIdx = b;
        cAcc += counts[b];
        if (minOther[b] < mn) mn = minOther[b];
        if (maxOther[b] > mx) mx = maxOther[b];
      }
      suffCount[b] = cAcc;
      suffMinO[b] = mn;
      suffMaxO[b] = mx;
      suffLast[b] = lastIdx;
    }

    for (let b = 0; b < numBins - 1; b++) {
      const lCnt = prefCount[b];
      const rCnt = suffCount[b + 1];
      if (lCnt < minCells || rCnt < minCells) continue;
      if (prefFirst[b] < 0 || suffLast[b + 1] < 0) continue;

      const leftAxisSpan = Math.max(cellSize, (b - prefFirst[b] + 1) * binW);
      const leftOtherSpan = Math.max(cellSize, prefMaxO[b] - prefMinO[b] + cellSize);
      const rightAxisSpan = Math.max(cellSize, (suffLast[b + 1] - (b + 1) + 1) * binW);
      const rightOtherSpan = Math.max(cellSize, suffMaxO[b + 1] - suffMinO[b + 1] + cellSize);

      // Avoid slicing off razor-thin 1-cell slivers when wider clean cuts exist
      if (leftAxisSpan < Math.max(3, cellSize * 1.4) || rightAxisSpan < Math.max(3, cellSize * 1.4)) {
        continue;
      }

      const combinedBBox = leftAxisSpan * leftOtherSpan + rightAxisSpan * rightOtherSpan;
      const wasteReduction = Math.max(0, parentBBox - combinedBBox);
      const wasteReductionRatio = wasteReduction / parentWaste;

      // Exact inner-corner width step (crucial for symmetric П/U/H/O courtyard buildings where
      // both opposite legs share the same outer span so single-span bbox wasteReduction is 0!)
      const stepDrop = Math.abs(counts[b + 1] - counts[b]) / maxBinCount;
      const stepScore = stepDrop >= 0.24 ? stepDrop * 95 : 0;

      // Also detect roof height/color seam across cut boundary (closed-block row houses)
      let seamScore = 0;
      if (counts[b] > 0 && counts[b + 1] > 0) {
        const dh = Math.abs(sumH[b + 1] / counts[b + 1] - sumH[b] / counts[b]);
        const dR = sumR[b + 1] / counts[b + 1] - sumR[b] / counts[b];
        const dG = sumG[b + 1] / counts[b + 1] - sumG[b] / counts[b];
        const dB = sumB[b + 1] / counts[b + 1] - sumB[b] / counts[b];
        const colorJump = Math.hypot(dR, dG * 1.15, dB * 0.9) * colorSeamDamping;
        seamScore = dh * 6 + colorJump * 0.55;
      }

      // Bonus if cut crosses an empty gap or sharp width step (courtyard opening / L/U/O corner!)
      const gapBonus = counts[b] === 0 || counts[b + 1] === 0 ? 25 : 0;
      const totalScore =
        wasteReductionRatio * 100 +
        (wasteReduction / parentBBox) * 65 +
        stepScore +
        seamScore * 0.7 +
        gapBonus;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestAxis = axis;
        bestCutCoord = -halfSpan + (b + 1) * binW;
        bestWasteReductionRatio = wasteReductionRatio;
        bestStepDrop = stepDrop;
        bestSeamScore = seamScore;
      }
    }
  }

  // Keep uniform compact structures intact unless an unmistakable building seam or maxAreaBlocks cap requires splitting
  if (obb.compactness >= 0.78 && obb.obbArea <= maxAreaBlocks && bestSeamScore < 24) {
    return [cells];
  }
  if (
    bestWasteReductionRatio < 0.12 &&
    bestStepDrop < 0.24 &&
    bestSeamScore < 16 &&
    obb.obbArea <= maxAreaBlocks
  ) {
    return [cells];
  }

  const left: RawCellSample[] = [];
  const right: RawCellSample[] = [];
  for (let i = 0; i < obb.projected.length; i++) {
    const coord = bestAxis === 'u' ? obb.projected[i].u : obb.projected[i].v;
    if (coord < bestCutCoord) left.push(cells[i]);
    else right.push(cells[i]);
  }

  if (left.length < minCells || right.length < minCells) {
    return [cells];
  }

  const results: RawCellSample[][] = [];
  for (const part of [left, right]) {
    const subClusters = splitIntoConnectedSubclusters(part);
    for (const sub of subClusters) {
      if (sub.length >= minCells) {
        results.push(
          ...decomposeComplexBlock(sub, cellSize, minCells, maxAreaBlocks, depth + 1, simplification)
        );
      }
    }
  }

  // Guard against degenerate staircase slicing (chopping a slanted block into 3+ small square fragments
  // without meaningful bounding-box waste reduction!)
  if (results.length >= 3 && obb.obbArea <= maxAreaBlocks) {
    let sumChildObb = 0;
    for (const ch of results) {
      sumChildObb += computeClusterObb(ch, cellSize).obbArea;
    }
    if (sumChildObb >= parentBBox * 0.88) {
      return [cells];
    }
  }

  return results.length > 0 ? results : [cells];
}

/**
 * STAGE 1: Extracts simplified 3D buildings with real proportions (OBB width, depth,
 * orientation angle, server baseY/roofY, roof type, shape class) from a 3D height+color grid.
 */
export function extractBuildingsFrom3DGrid(
  grid: HeightColorGrid,
  existingBuildings: Building3D[],
  options: SynthesisOptions = {},
  mtrRoutes: MtrRoute[] = []
): {
  buildings: Building3D[];
  buildingMask: Uint8Array;
  groundY: number;
  rejectedNoRoof: number;
  rejectedBridges: number;
  roofBreakdown: Record<RoofType, number>;
} {
  const { cols, rows, cellSize, heights, rgb, materialTag } = grid;
  const minHeight = options.minBuildingHeight ?? 3;
  const minAreaBlocks = options.minBuildingAreaBlocks ?? 4;
  const maxAreaBlocks = options.maxBuildingAreaBlocks ?? Number.POSITIVE_INFINITY;
  const minSolidity = options.minShapeSolidity ?? 0.25;
  const shapeSimplification = Math.max(
    0,
    Math.min(1, options.shapeSimplification ?? 0.55)
  );
  const allowedRoofTypes = options.allowedRoofTypes;
  const shapeFilter = options.buildingShapeFilter ?? 'all';
  const maxBuildings =
    options.maxBuildingsPerRun &&
    options.maxBuildingsPerRun > 0 &&
    Number.isFinite(options.maxBuildingsPerRun)
      ? options.maxBuildingsPerRun
      : Number.POSITIVE_INFINITY;
  const groundY = estimateGroundY(grid);

  const roofBreakdown: Record<RoofType, number> = {
    flat: 0,
    pitched: 0,
    curved: 0,
    complex: 0,
  };
  let rejectedNoRoof = 0;
  let rejectedBridges = 0;

  if (cols < 2 || rows < 2) {
    return {
      buildings: [],
      buildingMask: new Uint8Array(cols * rows),
      groundY,
      rejectedNoRoof: 0,
      rejectedBridges: 0,
      roofBreakdown,
    };
  }

  // No upper height cap (supports skyscrapers up to 300+ floors / 1500+ meters!)
  const cropPoly =
    options.cropPolygon && options.cropPolygon.length >= 3 ? options.cropPolygon : null;
  const rawMask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const wz = grid.originZ + (r + 0.5) * cellSize;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (cropPoly) {
        const wx = grid.originX + (c + 0.5) * cellSize;
        if (!pointInPolygon(wx, wz, cropPoly)) continue;
      }
      const elev = heights[i] - groundY;
      if (elev < minHeight) continue;

      const tag = materialTag ? materialTag[i] : 0;
      if (tag === 1) {
        rawMask[i] = 1;
        continue;
      }
      if (tag === 2 || tag === 3 || tag === 4) continue;

      const rCol = rgb[i * 3];
      const gCol = rgb[i * 3 + 1];
      const bCol = rgb[i * 3 + 2];

      if (isElevatedWaterSurface(rCol, gCol, bCol, elev)) continue;

      // Distinguish smooth architectural green roofs (copper/metal/painted) from rough tree canopies
      if (isFoliageRgb(rCol, gCol, bCol)) {
        let isSmoothGreenRoof = false;
        if (r > 0 && r < rows - 1 && c > 0 && c < cols - 1) {
          const h0 = heights[i];
          const maxDiff = Math.max(
            Math.abs(h0 - heights[i - 1]),
            Math.abs(h0 - heights[i + 1]),
            Math.abs(h0 - heights[i - cols]),
            Math.abs(h0 - heights[i + cols])
          );
          if (maxDiff <= 1.2 && elev >= minHeight + 1.5) {
            isSmoothGreenRoof = true;
          }
        }
        if (!isSmoothGreenRoof) continue;
        rawMask[i] = 1;
        continue;
      }

      if (!isArchitecturalRoofSurface(rCol, gCol, bCol, elev)) continue;
      rawMask[i] = 1;
    }
  }

  // Gentle 3x3 morphological filter preserving small buildings while cleaning 1px noise
  const cleanMask = new Uint8Array(cols * rows);
  const minNeighbors = minAreaBlocks <= 12 ? 2 : 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!rawMask[idx]) continue;
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        cleanMask[idx] = 1;
        continue;
      }
      let neighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (rawMask[(r + dr) * cols + (c + dc)]) neighbors++;
        }
      }
      if (neighbors >= minNeighbors) cleanMask[idx] = 1;
    }
  }

  // High-precision Roof-Boundary Region Growing:
  // Splits touching buildings inside closed blocks along sharp roof color/material changes
  // AND non-ramp roof height steps, while keeping smooth pitched/domed/same-material roofs unified!
  const visited = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  const extracted: Building3D[] = [];
  const minCells = Math.max(1, Math.floor(minAreaBlocks / (cellSize * cellSize)));

  // Spatial hash grids (16-block buckets) for O(1) overlap checks even with thousands of buildings
  const OVERLAP_BUCKET = 16;
  const existingBuckets = new Map<string, Array<{ x: number; z: number }>>();
  for (const ex of existingBuildings) {
    const key = `${Math.floor(ex.x / OVERLAP_BUCKET)}_${Math.floor(ex.z / OVERLAP_BUCKET)}`;
    let list = existingBuckets.get(key);
    if (!list) {
      list = [];
      existingBuckets.set(key, list);
    }
    list.push({ x: ex.x, z: ex.z });
  }
  const extractedBuckets = new Map<string, Array<{ x: number; z: number; minDim: number }>>();

  const roofLabelRu: Record<RoofType, string> = {
    flat: 'плоская',
    pitched: 'скатная',
    curved: 'кривая/купольная',
    complex: 'сложная',
  };

  interface RawRoofRegion {
    id: number;
    cells: RawCellSample[];
    medianH: number;
    meanR: number;
    meanG: number;
    meanB: number;
    minC: number;
    maxC: number;
    minR: number;
    maxR: number;
    perimeter: number;
  }

  const regionIdOfCell = new Int32Array(cols * rows).fill(-1);
  const rawRegions: RawRoofRegion[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const startIdx = r * cols + c;
      if (!cleanMask[startIdx] || visited[startIdx]) continue;

      const regId = rawRegions.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      visited[startIdx] = 1;
      regionIdOfCell[startIdx] = regId;

      const rawCells: RawCellSample[] = [];
      let sumR = rgb[startIdx * 3];
      let sumG = rgb[startIdx * 3 + 1];
      let sumB = rgb[startIdx * 3 + 2];
      let regCount = 1;
      let minC = c;
      let maxC = c;
      let minR = r;
      let maxR = r;

      while (head < tail) {
        const cur = queue[head++];
        const cr = Math.floor(cur / cols);
        const cc = cur % cols;
        if (cc < minC) minC = cc;
        if (cc > maxC) maxC = cc;
        if (cr < minR) minR = cr;
        if (cr > maxR) maxR = cr;

        const curR = rgb[cur * 3];
        const curG = rgb[cur * 3 + 1];
        const curB = rgb[cur * 3 + 2];
        const curH = heights[cur];

        rawCells.push({
          wx: grid.originX + (cc + 0.5) * cellSize,
          wz: grid.originZ + (cr + 0.5) * cellSize,
          c: cc,
          r: cr,
          h: curH,
          rCol: curR,
          gCol: curG,
          bCol: curB,
        });

        const meanR = sumR / regCount;
        const meanG = sumG / regCount;
        const meanB = sumB / regCount;

        const nbs: Array<[number, number, number]> = [
          [cur - 1, cr, cc - 1],
          [cur + 1, cr, cc + 1],
          [cur - cols, cr - 1, cc],
          [cur + cols, cr + 1, cc],
        ];
        for (let k = 0; k < 4; k++) {
          const [nb, nr, nc] = nbs[k];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (!cleanMask[nb] || visited[nb]) continue;

          const nbH = heights[nb];
          const nbR = rgb[nb * 3];
          const nbG = rgb[nb * 3 + 1];
          const nbB = rgb[nb * 3 + 2];

          const dh = Math.abs(nbH - curH);
          const localColorDist = Math.hypot(
            (nbR - curR) * 1.0,
            (nbG - curG) * 1.15,
            (nbB - curB) * 0.9
          );
          const meanColorDist = Math.hypot(
            (nbR - meanR) * 1.0,
            (nbG - meanG) * 1.15,
            (nbB - meanB) * 0.9
          );

          // 1. Sharp roof material/color seam -> distinct touching building in closed block!
          // Slightly more tolerant on exact same-height flat planes so textured blocks stay cohesive
          const samePlane = dh <= 1.0;
          if (
            localColorDist >= (samePlane ? 42 : 34) ||
            meanColorDist >= (samePlane ? 54 : 44)
          ) {
            continue;
          }

          // 2. Combined height + color step -> adjacent building with slightly different roof!
          if (dh >= 1.5 && (localColorDist >= 20 || meanColorDist >= 26)) continue;

          // 3. Sharp vertical roof height step between flat planes (separate touching buildings of different heights)
          // Preserve smooth pitched/curved ramps (where slope continues smoothly across cur)
          if (dh >= 3.2) {
            const oppR = cr - (nr - cr);
            const oppC = cc - (nc - cc);
            const oppIdx = oppR >= 0 && oppR < rows && oppC >= 0 && oppC < cols ? oppR * cols + oppC : -1;
            const prevStep = oppIdx >= 0 && cleanMask[oppIdx] ? curH - heights[oppIdx] : 0;
            const currStep = nbH - curH;
            const isSmoothRamp =
              Math.sign(prevStep) === Math.sign(currStep) &&
              Math.abs(currStep - prevStep) <= 2.2;
            if (!isSmoothRamp && dh >= 4.0) {
              if (dh > 11 || localColorDist > 12) continue;
            }
          }

          visited[nb] = 1;
          regionIdOfCell[nb] = regId;
          queue[tail++] = nb;
          sumR += nbR;
          sumG += nbG;
          sumB += nbB;
          regCount++;
        }
      }

      const hs = rawCells.map((x) => x.h).sort((a, b) => a - b);
      rawRegions.push({
        id: regId,
        cells: rawCells,
        medianH: hs[Math.floor(hs.length * 0.5)] ?? groundY,
        meanR: sumR / regCount,
        meanG: sumG / regCount,
        meanB: sumB / regCount,
        minC,
        maxC,
        minR,
        maxR,
        perimeter: 0,
      });
    }
  }

  // Smart Same-Building Roof & Protrusion Absorption Pass (4-connected + 8-connected diagonal!):
  // Re-absorbs balconies, porches, stepped diagonal overhangs/eaves, parapet rims, skylights,
  // rooftop HVAC/stairwell units, and shadowed roof slopes back into their parent building
  // while keeping distinct adjacent full-sized row-houses in closed blocks strictly separated!
  const numRegions = rawRegions.length;
  const pairShared = new Map<string, number>();
  const pairDiagTouch = new Map<string, number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const aId = regionIdOfCell[idx];
      if (aId < 0) continue;
      // Count 4-neighbor perimeter & shared region borders
      const checks4: Array<[number, number]> = [
        [r, c + 1],
        [r + 1, c],
        [r, c - 1],
        [r - 1, c],
      ];
      for (const [nr, nc] of checks4) {
        const bId =
          nr >= 0 && nr < rows && nc >= 0 && nc < cols ? regionIdOfCell[nr * cols + nc] : -1;
        if (bId !== aId) {
          rawRegions[aId].perimeter++;
          if (bId > aId) {
            const key = `${aId}_${bId}`;
            pairShared.set(key, (pairShared.get(key) ?? 0) + 1);
          }
        }
      }
      // Also detect 8-neighbor diagonal contact (critical for 45° diagonal buildings with balconies/eaves!)
      const checksDiag: Array<[number, number]> = [
        [r + 1, c + 1],
        [r + 1, c - 1],
        [r - 1, c + 1],
        [r - 1, c - 1],
      ];
      for (const [nr, nc] of checksDiag) {
        const bId =
          nr >= 0 && nr < rows && nc >= 0 && nc < cols ? regionIdOfCell[nr * cols + nc] : -1;
        if (bId > aId) {
          const key = `${aId}_${bId}`;
          pairDiagTouch.set(key, (pairDiagTouch.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const ufParent = new Int32Array(numRegions);
  for (let i = 0; i < numRegions; i++) ufParent[i] = i;
  const ufFind = (x: number): number => {
    let cur = x;
    while (ufParent[cur] !== cur) {
      ufParent[cur] = ufParent[ufParent[cur]];
      cur = ufParent[cur];
    }
    return cur;
  };
  const ufUnion = (a: number, b: number) => {
    const ra = ufFind(a);
    const rb = ufFind(b);
    if (ra === rb) return;
    if (rawRegions[ra].cells.length >= rawRegions[rb].cells.length) {
      ufParent[rb] = ra;
    } else {
      ufParent[ra] = rb;
    }
  };

  // Evaluate both orthogonal and diagonal touching region pairs
  const allTouchKeys = new Set<string>([...pairShared.keys(), ...pairDiagTouch.keys()]);
  const maxAppendageArea = 42 + shapeSimplification * 125;
  const maxAppendageThickness = 3.5 + shapeSimplification * 5.0;

  // Precompute same-height neighborhood fragmentation stats so variegated multi-block roofs
  // (e.g., terracotta + blue stone speckles, stripes, checkerboards, or skylight ribs at the
  // same roof elevation) unify cleanly without merging large distinct uniform row-houses!
  const sameHeightNeighbors = new Int32Array(numRegions);
  const sameHeightBorder = new Float64Array(numRegions);
  for (const key of allTouchKeys) {
    const sharedEdges = pairShared.get(key) ?? 0;
    const diagTouches = pairDiagTouch.get(key) ?? 0;
    if (sharedEdges === 0 && diagTouches === 0) continue;
    const sep = key.indexOf('_');
    const aId = Number(key.slice(0, sep));
    const bId = Number(key.slice(sep + 1));
    if (Math.abs(rawRegions[aId].medianH - rawRegions[bId].medianH) <= 2.2) {
      sameHeightNeighbors[aId]++;
      sameHeightNeighbors[bId]++;
      // Count orthogonal 4-neighbor shared edges to stay commensurate with 4-neighbor perimeter
      sameHeightBorder[aId] += sharedEdges;
      sameHeightBorder[bId] += sharedEdges;
    }
  }

  for (const key of allTouchKeys) {
    const sharedEdges = pairShared.get(key) ?? 0;
    const diagTouches = pairDiagTouch.get(key) ?? 0;
    const totalContact = sharedEdges + diagTouches * 0.7;
    if (totalContact < 0.7) continue;

    const sep = key.indexOf('_');
    const aId = Number(key.slice(0, sep));
    const bId = Number(key.slice(sep + 1));
    const regA = rawRegions[aId];
    const regB = rawRegions[bId];
    const smaller = regA.cells.length <= regB.cells.length ? regA : regB;
    const larger = regA.cells.length <= regB.cells.length ? regB : regA;

    const dh = Math.abs(regA.medianH - regB.medianH);
    const smallArea = smaller.cells.length * cellSize * cellSize;
    const smallSpanW = (smaller.maxC - smaller.minC + 1) * cellSize;
    const smallSpanD = (smaller.maxR - smaller.minR + 1) * cellSize;
    const smallMinDim = Math.min(smallSpanW, smallSpanD);
    const sharedFracOfSmall = sharedEdges / Math.max(1, smaller.perimeter);
    const contactFracOfSmall = totalContact / Math.max(1, smaller.perimeter);

    // Case 1: Parapet rim, rooftop trim, skylight, dormer, or penthouse box touching the main roof
    const isMinorRoofFeature =
      sharedEdges >= 2 &&
      (smaller.cells.length < larger.cells.length * 0.42 || smallArea < 170 || smallMinDim <= 7) &&
      sharedFracOfSmall >= 0.20 &&
      dh <= 7.5 + shapeSimplification * 4.5;

    // Case 2: Protruding balcony, porch, entrance canopy, bay window, or diagonal stepped eave
    // clinging to a larger building (even if lower by several floors or touching diagonally!)
    const isProtrudingFacadeAppendage =
      larger.cells.length >= smaller.cells.length * 2.4 &&
      (smallArea <= maxAppendageArea || smallMinDim <= maxAppendageThickness) &&
      (sharedEdges >= 1 || diagTouches >= 1) &&
      contactFracOfSmall >= 0.10 &&
      smaller.medianH <= larger.medianH + 4.5;

    // Case 3: Enclosed or flanked roof sub-patch (e.g. central roof deck or trim embedded in roof)
    const isEmbeddedPatch = sharedEdges >= 2 && sharedFracOfSmall >= 0.44 && dh <= 8.0;

    // Case 4: Shaded / pitched-slope luminance shift of the SAME roof material (same hue, different brightness)
    const dRG = Math.abs((regA.meanR - regA.meanG) - (regB.meanR - regB.meanG));
    const dGB = Math.abs((regA.meanG - regA.meanB) - (regB.meanG - regB.meanB));
    const colorDist = Math.hypot(
      regA.meanR - regB.meanR,
      (regA.meanG - regB.meanG) * 1.15,
      (regA.meanB - regB.meanB) * 0.9
    );
    const isSameHueShadow =
      dh <= 3.5 + shapeSimplification * 2.0 &&
      sharedEdges >= 3 &&
      dRG + dGB <= 24 &&
      colorDist < 72;

    // Case 5: Multi-block variegated / mixed-material roof at the SAME roof elevation
    // (e.g., terracotta + blue stone speckles, patterned strips, skylights, ornamental borders).
    // Preserves large uniform touching row-houses (which have large area, wide minDim, and low fragmentation).
    const sameHeightFracSmall = sameHeightBorder[smaller.id] / Math.max(1, smaller.perimeter);
    const isMixedMaterialRoofPatch =
      dh <= 2.2 &&
      (((smallArea <= 180 || smallMinDim <= 9) &&
        (sharedEdges >= 1 || (diagTouches >= 1 && smallArea <= 80))) ||
        (sharedEdges >= 2 &&
          sameHeightFracSmall >= 0.48 &&
          (sameHeightNeighbors[smaller.id] >= 2 || smallArea <= 360)) ||
        (sameHeightNeighbors[aId] >= 3 &&
          sameHeightNeighbors[bId] >= 3 &&
          (sharedEdges >= 1 || diagTouches >= 2)));

    if (
      isMinorRoofFeature ||
      isProtrudingFacadeAppendage ||
      isEmbeddedPatch ||
      isSameHueShadow ||
      isMixedMaterialRoofPatch
    ) {
      ufUnion(aId, bId);
    }
  }

  // Second-pass absorption against merged roof roots so medium patches/stripes touching a now-unified
  // multi-block roof deck are also smoothly folded into the parent building.
  const rootCellCount = new Int32Array(numRegions);
  const rootSumH = new Float64Array(numRegions);
  for (let i = 0; i < numRegions; i++) {
    const rt = ufFind(i);
    rootCellCount[rt] += rawRegions[i].cells.length;
    rootSumH[rt] += rawRegions[i].medianH * rawRegions[i].cells.length;
  }
  const rootPairShared = new Map<string, number>();
  for (const [key, shared] of pairShared.entries()) {
    const sep = key.indexOf('_');
    const ra = ufFind(Number(key.slice(0, sep)));
    const rb = ufFind(Number(key.slice(sep + 1)));
    if (ra === rb) continue;
    const rKey = ra < rb ? `${ra}_${rb}` : `${rb}_${ra}`;
    rootPairShared.set(rKey, (rootPairShared.get(rKey) ?? 0) + shared);
  }
  for (const [rKey, shared] of rootPairShared.entries()) {
    const sep = rKey.indexOf('_');
    const ra = Number(rKey.slice(0, sep));
    const rb = Number(rKey.slice(sep + 1));
    const cntA = rootCellCount[ra];
    const cntB = rootCellCount[rb];
    if (cntA === 0 || cntB === 0) continue;
    const hA = rootSumH[ra] / cntA;
    const hB = rootSumH[rb] / cntB;
    const dh = Math.abs(hA - hB);
    const smallCnt = Math.min(cntA, cntB);
    const largeCnt = Math.max(cntA, cntB);
    const smallArea = smallCnt * cellSize * cellSize;
    if (dh <= 2.2 && shared >= 2 && smallArea <= 220 && smallCnt <= largeCnt * 0.45) {
      ufUnion(ra, rb);
    }
  }

  const mergedClusters = new Map<number, RawCellSample[]>();
  for (let i = 0; i < numRegions; i++) {
    const root = ufFind(i);
    let list = mergedClusters.get(root);
    if (!list) {
      list = [];
      mergedClusters.set(root, list);
    }
    const cells = rawRegions[i].cells;
    for (let k = 0; k < cells.length; k++) list.push(cells[k]);
  }

  for (const rawCells of mergedClusters.values()) {
    {
      if (rawCells.length < minCells) continue;

      // Reject intact bridges / overpasses / viaducts BEFORE decomposing long structures into wings
      const rawObb = computeClusterObb(rawCells, cellSize);
      const rawElevs = rawCells.map((cell) => cell.h - groundY).sort((a, b) => a - b);
      const rawP85 = rawElevs[Math.min(rawElevs.length - 1, Math.floor(rawElevs.length * 0.85))] ?? 0;
      const rawHeight = Math.max(2, Math.round(rawP85));
      if (
        isBridgeLikeStructure(
          grid,
          rawObb,
          { roofType: 'flat', roofY: groundY + rawHeight, compactness: rawObb.compactness },
          groundY,
          rawHeight,
          mtrRoutes
        )
      ) {
        rejectedBridges++;
        continue;
      }

      // Apply shape simplification (trims sparse balcony/porch/stepped-eave fringes along outer facade)
      const simplifiedCells = simplifyBuildingCluster(rawCells, cellSize, shapeSimplification);
      const simpObb =
        simplifiedCells === rawCells ? rawObb : computeClusterObb(simplifiedCells, cellSize);
      const parentAngleRad = simpObb.angleRad;
      const isWholeCircular = detectCircularCluster(simplifiedCells, simpObb, cellSize);
      const wholeTriangle = isWholeCircular
        ? { isTriangular: false, corner: 0 as 0 | 1 | 2 | 3, iou: 0 }
        : detectTriangularCluster(simplifiedCells, simpObb, cellSize);
      const wholeParallelogram =
        isWholeCircular || wholeTriangle.isTriangular
          ? null
          : detectParallelogramCluster(simplifiedCells, simpObb, cellSize);
      const candidateWings =
        isWholeCircular || wholeTriangle.isTriangular || wholeParallelogram?.isParallelogram
          ? [simplifiedCells]
          : decomposeComplexBlock(
              simplifiedCells,
              cellSize,
              minCells,
              Number.isFinite(maxAreaBlocks) ? maxAreaBlocks : 250_000,
              0,
              shapeSimplification
            );

      interface ValidWingCandidate {
        obb: ReturnType<typeof computeClusterObb>;
        roofInfo: ReturnType<typeof analyzeRoofAndShape>;
        height: number;
        floors: number;
        angleDeg: number;
        isCircular: boolean;
        isTriangular: boolean;
        isParallelogram: boolean;
        skewDeg?: number;
        avgR: number;
        avgG: number;
        avgB: number;
        area: number;
        footprint: WorldPoint[];
      }

      const validWings: ValidWingCandidate[] = [];

      for (const wingCells of candidateWings) {
        if (wingCells.length < minCells) continue;

        let obb = computeClusterObb(wingCells, cellSize);
        // Lock orthogonal wings of an L/U/T/courtyard complex to the exact shared parent wall orientation
        // while allowing genuine diagonal wings (e.g. 45° relative to 0°) to keep their own crisp angle!
        if (candidateWings.length > 1) {
          const rawDiffDeg = Math.abs(((obb.angleRad - parentAngleRad) * 180) / Math.PI) % 90;
          const modDiffDeg = Math.min(rawDiffDeg, 90 - rawDiffDeg);
          if (modDiffDeg <= 16) {
            const parentAligned = computeClusterObb(wingCells, cellSize, parentAngleRad);
            if (parentAligned.compactness >= obb.compactness * 0.90) {
              obb = parentAligned;
            }
          }
        }

        const { realWidth, realDepth, obbArea, angleRad, obbCx, obbCz, projected } = obb;
        if (Math.min(realWidth, realDepth) < 1) continue;
        if (obbArea < minAreaBlocks || obbArea > maxAreaBlocks) continue;

        const roofInfo = analyzeRoofAndShape(
          projected,
          groundY,
          realWidth,
          realDepth,
          cellSize,
          minHeight
        );

        if (!roofInfo.hasValidRoof) {
          rejectedNoRoof++;
          continue;
        }

        const height = Math.max(2, Math.round(roofInfo.roofY - groundY));

        // Reject bridges / overpasses / elevated viaducts from being emitted as buildings!
        if (candidateWings.length === 1 && isBridgeLikeStructure(grid, obb, roofInfo, groundY, height, mtrRoutes)) {
          rejectedBridges++;
          continue;
        }

        const isWingCircular = isWholeCircular || detectCircularCluster(wingCells, obb, cellSize);
        const wingTri = isWingCircular
          ? { isTriangular: false, corner: 0 as 0 | 1 | 2 | 3, iou: 0 }
          : wholeTriangle.isTriangular && candidateWings.length === 1
          ? wholeTriangle
          : detectTriangularCluster(wingCells, obb, cellSize);
        const wingPara =
          isWingCircular || wingTri.isTriangular
            ? null
            : wholeParallelogram?.isParallelogram && candidateWings.length === 1
            ? wholeParallelogram
            : detectParallelogramCluster(wingCells, obb, cellSize);

        const isWingPara = Boolean(wingPara?.isParallelogram);
        const effectiveCompactness = wingTri.isTriangular
          ? wingTri.iou
          : isWingPara && wingPara
          ? wingPara.compactness
          : roofInfo.compactness;
        if (effectiveCompactness < minSolidity) continue;
        if (
          allowedRoofTypes &&
          allowedRoofTypes.length > 0 &&
          !allowedRoofTypes.includes(roofInfo.roofType)
        ) {
          continue;
        }

        const effectiveObb =
          isWingPara && wingPara
            ? {
                ...obb,
                obbCx: wingPara.centerX,
                obbCz: wingPara.centerZ,
                realWidth: wingPara.width,
                realDepth: wingPara.depth,
              }
            : obb;
        const angleDeg =
          isWingPara && wingPara
            ? wingPara.angleDeg
            : Math.round(((angleRad * 180) / Math.PI) * 10) / 10;
        const segments = Math.max(realWidth, realDepth) >= 32 ? 24 : 20;
        const footprint = isWingCircular
          ? createCircleFootprint(obbCx, obbCz, realWidth, realDepth, angleDeg, segments)
          : wingTri.isTriangular
          ? createTriangleFootprint(obbCx, obbCz, realWidth, realDepth, angleDeg, wingTri.corner)
          : isWingPara && wingPara
          ? wingPara.footprint
          : createRectFootprint(obbCx, obbCz, realWidth, realDepth, angleDeg);

        let sR = 0;
        let sG = 0;
        let sB = 0;
        for (const cell of wingCells) {
          sR += cell.rCol;
          sG += cell.gCol;
          sB += cell.bCol;
        }
        const n = wingCells.length;

        validWings.push({
          obb: effectiveObb,
          roofInfo: isWingCircular
            ? { ...roofInfo, shapeType: 'circular' }
            : wingTri.isTriangular
            ? { ...roofInfo, shapeType: 'triangular', compactness: wingTri.iou }
            : isWingPara && wingPara
            ? { ...roofInfo, shapeType: 'parallelogram', compactness: wingPara.compactness }
            : roofInfo,
          height,
          floors: Math.max(1, Math.round(height / 3.8)),
          angleDeg,
          isCircular: isWingCircular,
          isTriangular: wingTri.isTriangular,
          isParallelogram: isWingPara,
          skewDeg: isWingPara && wingPara ? wingPara.skewDeg : undefined,
          avgR: sR / n,
          avgG: sG / n,
          avgB: sB / n,
          area: wingTri.isTriangular
            ? realWidth * realDepth * 0.5
            : isWingPara && wingPara
            ? wingPara.width * wingPara.depth
            : realWidth * realDepth,
          footprint,
        });
      }

      if (validWings.length === 0) continue;

      // Sort largest wing first and drop tiny noise slivers / balcony stubs when assembling a multi-wing building
      validWings.sort((a, b) => b.area - a.area);
      const largestArea = validWings[0].area;
      const minWingDim = Math.max(2, cellSize, 2.5 + shapeSimplification * 4.5);
      const minWingAreaFrac = 0.04 + shapeSimplification * 0.10;
      const cleanWings =
        validWings.length > 1
          ? validWings.filter(
              (w, idx) =>
                idx === 0 ||
                (Math.min(w.obb.realWidth, w.obb.realDepth) >= minWingDim &&
                  w.area >= Math.max(minAreaBlocks, largestArea * minWingAreaFrac))
            )
          : validWings;

      const primary = cleanWings[0];
      const finalShapeType: BuildingShapeType =
        cleanWings.length >= 2
          ? cleanWings.length === 2
            ? 'l-shaped'
            : 'complex'
          : primary.roofInfo.shapeType;

      if (
        shapeFilter === 'rectangular' &&
        (finalShapeType === 'complex' || finalShapeType === 'l-shaped' || finalShapeType === 'circular')
      ) {
        continue;
      }
      if (
        shapeFilter === 'complex' &&
        finalShapeType !== 'complex' &&
        finalShapeType !== 'l-shaped' &&
        finalShapeType !== 'circular'
      ) {
        continue;
      }

      // Check overlap against existing & already-extracted buildings using spatial hash buckets
      const checkOverlap = (cx: number, cz: number, w: number, d: number) => {
        const overlapTol = Math.min(14, Math.min(w, d) * 0.42);
        const bx = Math.floor(cx / OVERLAP_BUCKET);
        const bz = Math.floor(cz / OVERLAP_BUCKET);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const eList = existingBuckets.get(`${bx + dx}_${bz + dz}`);
            if (eList) {
              for (const ex of eList) {
                if (Math.hypot(ex.x - cx, ex.z - cz) < overlapTol) return true;
              }
            }
            const xList = extractedBuckets.get(`${bx + dx}_${bz + dz}`);
            if (xList) {
              for (const ex of xList) {
                if (Math.hypot(ex.x - cx, ex.z - cz) < Math.min(overlapTol, Math.max(3, ex.minDim * 0.4))) {
                  return true;
                }
              }
            }
          }
        }
        return false;
      };

      const nonOverlappingWings = cleanWings.filter(
        (w) => !checkOverlap(w.obb.obbCx, w.obb.obbCz, w.obb.realWidth, w.obb.realDepth)
      );
      if (nonOverlappingWings.length === 0) continue;

      const lead = nonOverlappingWings[0];
      const { obbCx, obbCz, realWidth, realDepth } = lead.obb;
      const district = inferDistrict(obbCx, obbCz);
      const houseNum = String((Math.abs(Math.round(obbCx) * 7 + Math.round(obbCz) * 13) % 96) + 1);
      const bldgId = `auto-b-${Math.round(obbCx * 10)}-${Math.round(obbCz * 10)}`;

      // Register all wing centers in the extracted spatial hash
      for (const w of nonOverlappingWings) {
        const bx = Math.floor(w.obb.obbCx / OVERLAP_BUCKET);
        const bz = Math.floor(w.obb.obbCz / OVERLAP_BUCKET);
        const bKey = `${bx}_${bz}`;
        let exList = extractedBuckets.get(bKey);
        if (!exList) {
          exList = [];
          extractedBuckets.set(bKey, exList);
        }
        exList.push({
          x: w.obb.obbCx,
          z: w.obb.obbCz,
          minDim: Math.min(w.obb.realWidth, w.obb.realDepth),
        });
      }

      const maxWingHeight = Math.max(...nonOverlappingWings.map((w) => w.height));
      const maxWingFloors = Math.max(...nonOverlappingWings.map((w) => w.floors));
      const totalSpanW = nonOverlappingWings.length > 1 ? rawObb.realWidth : realWidth;
      const totalSpanD = nonOverlappingWings.length > 1 ? rawObb.realDepth : realDepth;
      const category = classifyBuildingFromRoof(
        lead.avgR,
        lead.avgG,
        lead.avgB,
        totalSpanW,
        totalSpanD,
        maxWingFloors
      );

      roofBreakdown[lead.roofInfo.roofType]++;

      const wings: BuildingWing[] | undefined =
        nonOverlappingWings.length > 1
          ? nonOverlappingWings.map((w, idx) => ({
              id: `${bldgId}-w${idx + 1}`,
              label: `Корпус ${idx + 1}`,
              x: w.obb.obbCx,
              z: w.obb.obbCz,
              footprint: w.footprint,
              height: w.height,
              floors: w.floors,
              baseY: Math.round(groundY),
              roofY: w.roofInfo.roofY,
              roofType: w.roofInfo.roofType,
              shapeType: w.isCircular
                ? 'circular'
                : w.isTriangular
                ? 'triangular'
                : w.isParallelogram
                ? 'parallelogram'
                : w.roofInfo.shapeType,
              measuredWidth: w.obb.realWidth,
              measuredDepth: w.obb.realDepth,
              orientationDeg: w.angleDeg,
              skewDeg: w.skewDeg,
            }))
          : undefined;

      const shapeDescRu =
        nonOverlappingWings.length > 1
          ? `Комплексное (${nonOverlappingWings.length} корп.)`
          : lead.isCircular
          ? 'Круглое'
          : lead.isTriangular
          ? 'Угловое (треугольное)'
          : lead.isParallelogram
          ? `Параллелепипед (скос ${lead.skewDeg ?? 0}°)`
          : `Крыша: ${roofLabelRu[lead.roofInfo.roofType]}`;

      extracted.push({
        id: bldgId,
        name:
          nonOverlappingWings.length > 1
            ? `Строение ${houseNum} (${nonOverlappingWings.length} корп.)`
            : lead.isCircular
            ? `Круглое строение ${houseNum} (Ø${Math.round((realWidth + realDepth) * 0.5)} м)`
            : lead.isTriangular
            ? `Угловое строение ${houseNum} (${Math.round(realWidth)}×${Math.round(realDepth)} м)`
            : lead.isParallelogram
            ? `Параллелепипед ${houseNum} (${Math.round(realWidth)}×${Math.round(realDepth)} м)`
            : `Строение ${houseNum} (${Math.round(realWidth)}×${Math.round(realDepth)} м)`,
        street: district,
        houseNumber: houseNum,
        district,
        category,
        x: obbCx,
        z: obbCz,
        footprint: lead.footprint,
        wings,
        height: maxWingHeight,
        floors: maxWingFloors,
        baseY: Math.round(groundY),
        roofY: lead.roofInfo.roofY,
        roofType: lead.roofInfo.roofType,
        shapeType: finalShapeType,
        compactness: lead.roofInfo.compactness,
        measuredWidth: realWidth,
        measuredDepth: realDepth,
        orientationDeg: lead.angleDeg,
        skewDeg: lead.skewDeg,
        roofColor: rgbToHex(lead.avgR, lead.avgG, lead.avgB),
        description: `${shapeDescRu} (Y=${lead.roofInfo.roofY}, земля Y=${Math.round(groundY)}). Габариты ${Math.round(totalSpanW)}×${Math.round(totalSpanD)} м, высота ${maxWingHeight} м (${maxWingFloors} эт.).`,
        isAutoSynthesized: true,
      });
    }
  }

  // Post-extraction satellite micro-protrusion suppression:
  // Any tiny residual balcony/porch/eave square clinging flush to the facade of a much larger building
  // (e.g. diagonal voxel-step balconies) is suppressed instead of becoming a separate house.
  extracted.sort(
    (a, b) =>
      (b.measuredWidth ?? 0) * (b.measuredDepth ?? 0) -
      (a.measuredWidth ?? 0) * (a.measuredDepth ?? 0)
  );

  const filteredExtracted: Building3D[] = [];
  const maxSatelliteArea = 28 + shapeSimplification * 72;
  const maxSatelliteDim = 3.5 + shapeSimplification * 4.5;

  for (const cand of extracted) {
    const cW = cand.measuredWidth ?? 1;
    const cD = cand.measuredDepth ?? 1;
    const cArea = cW * cD;
    const cMinDim = Math.min(cW, cD);
    let isFacadeSatellite = false;

    if (
      shapeSimplification > 0.08 &&
      (!cand.wings || cand.wings.length <= 1) &&
      (cArea <= maxSatelliteArea || cMinDim <= maxSatelliteDim)
    ) {
      for (const host of filteredExtracted) {
        const hW = host.measuredWidth ?? 1;
        const hD = host.measuredDepth ?? 1;
        const hArea = hW * hD;
        if (hArea < cArea * 4.2) continue;
        if (cand.height > host.height + 3) continue;

        // Fast broad-phase radius check
        const maxReach = Math.hypot(hW, hD) * 0.5 + Math.hypot(cW, cD) * 0.5 + 3.5;
        if (Math.hypot(cand.x - host.x, cand.z - host.z) > maxReach) continue;

        // Check in host's rotated local frame whether candidate sits flush on or overlapping host's wall!
        const rad = -((host.orientationDeg ?? 0) * Math.PI) / 180;
        const dx = cand.x - host.x;
        const dz = cand.z - host.z;
        const lu = dx * Math.cos(rad) - dz * Math.sin(rad);
        const lv = dx * Math.sin(rad) + dz * Math.cos(rad);
        const padU = hW * 0.5 + Math.max(cW, cD) * 0.55 + 2.2;
        const padV = hD * 0.5 + Math.max(cW, cD) * 0.55 + 2.2;
        if (Math.abs(lu) <= padU && Math.abs(lv) <= padV) {
          isFacadeSatellite = true;
          break;
        }
      }
    }

    if (!isFacadeSatellite) {
      filteredExtracted.push(cand);
    }
  }

  return {
    buildings: Number.isFinite(maxBuildings)
      ? filteredExtracted.slice(0, maxBuildings)
      : filteredExtracted,
    buildingMask: cleanMask,
    groundY,
    rejectedNoRoof,
    rejectedBridges,
    roofBreakdown,
  };
}

/**
 * Ramer-Douglas-Peucker polyline simplification for clean vector streets.
 */
export function simplifyPolyline(points: WorldPoint[], epsilon: number): WorldPoint[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let splitIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i].x, points[i].z, first.x, first.z, last.x, last.z);
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolyline(points.slice(0, splitIdx + 1), epsilon);
    const right = simplifyPolyline(points.slice(splitIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * STAGE 2: Extracts streets with REAL MEASURED WIDTHS (in blocks) using a
 * 2-pass Chamfer Euclidean Distance Transform (EDT) on the ground road mask,
 * followed by medial-axis ridge tracing and Ramer-Douglas-Peucker vectorization.
 */
export function extractStreetsWithRealWidth(
  grid: HeightColorGrid,
  buildingMask: Uint8Array,
  groundY: number,
  options: SynthesisOptions = {}
): StreetSegment[] {
  const { cols, rows, cellSize, heights, rgb, materialTag } = grid;
  if (cols < 3 || rows < 3) return [];

  const minWidthBlocks = options.minStreetWidthBlocks ?? 8;
  const maxWidthBlocks = options.maxStreetWidthBlocks ?? 44;
  const allowedRoadClasses = options.allowedRoadClasses;
  const blockStrictness = options.blockStrictness ?? 45;
  const minRadiusCells = Math.max(1.2, minWidthBlocks / (2 * cellSize));
  const maxRadiusCells = Math.max(minRadiusCells + 1.5, maxWidthBlocks / (2 * cellSize));

  // 1. Road mask: ground-level asphalt/paving outside 3D building footprints (clipped to arbitrary polygon if provided)
  const cropPoly =
    options.cropPolygon && options.cropPolygon.length >= 3 ? options.cropPolygon : null;
  const roadMask = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    if (buildingMask[i]) continue;
    if (cropPoly) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const wx = grid.originX + (c + 0.5) * cellSize;
      const wz = grid.originZ + (r + 0.5) * cellSize;
      if (!pointInPolygon(wx, wz, cropPoly)) continue;
    }
    const tag = materialTag ? materialTag[i] : 0;
    if (tag === 2) {
      roadMask[i] = 1;
      continue;
    }
    if (tag === 1 || tag === 3 || tag === 4) continue;

    if (Math.abs(heights[i] - groundY) > 4) continue;
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    if (isFoliageRgb(r, g, b) || isWaterRgb(r, g, b)) continue;
    if (isRoadRgb(r, g, b, blockStrictness)) {
      roadMask[i] = 1;
    }
  }

  // 2. Fast 2-pass Chamfer Distance Transform (orthogonal = 1.0, diagonal = 1.414)
  const dist = new Float32Array(cols * rows);
  const INF = 1e6;
  for (let i = 0; i < cols * rows; i++) {
    dist[i] = roadMask[i] ? INF : 0;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (dist[idx] === 0) continue;
      let d = dist[idx];
      if (c > 0) d = Math.min(d, dist[idx - 1] + 1);
      if (r > 0) d = Math.min(d, dist[idx - cols] + 1);
      if (c > 0 && r > 0) d = Math.min(d, dist[idx - cols - 1] + 1.414);
      if (c < cols - 1 && r > 0) d = Math.min(d, dist[idx - cols + 1] + 1.414);
      dist[idx] = d;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const idx = r * cols + c;
      if (dist[idx] === 0) continue;
      let d = dist[idx];
      if (c < cols - 1) d = Math.min(d, dist[idx + 1] + 1);
      if (r < rows - 1) d = Math.min(d, dist[idx + cols] + 1);
      if (c < cols - 1 && r < rows - 1) d = Math.min(d, dist[idx + cols + 1] + 1.414);
      if (c > 0 && r < rows - 1) d = Math.min(d, dist[idx + cols - 1] + 1.414);
      dist[idx] = d;
    }
  }

  // 2b. Suppress wide open spaces (inner-block courtyards, plazas, squares wider than maxWidthBlocks)
  // Using a reverse distance propagation from open-space cores (dist > maxRadiusCells) so their perimeter rim
  // never creates false ring-roads around an open yard!
  const openSpaceRem = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    if (dist[i] > maxRadiusCells + 0.5) {
      openSpaceRem[i] = dist[i] + 1.5;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!roadMask[idx]) continue;
      let rem = openSpaceRem[idx];
      if (c > 0) rem = Math.max(rem, openSpaceRem[idx - 1] - 1);
      if (r > 0) rem = Math.max(rem, openSpaceRem[idx - cols] - 1);
      if (c > 0 && r > 0) rem = Math.max(rem, openSpaceRem[idx - cols - 1] - 1.414);
      if (c < cols - 1 && r > 0) rem = Math.max(rem, openSpaceRem[idx - cols + 1] - 1.414);
      openSpaceRem[idx] = rem;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const idx = r * cols + c;
      if (!roadMask[idx]) continue;
      let rem = openSpaceRem[idx];
      if (c < cols - 1) rem = Math.max(rem, openSpaceRem[idx + 1] - 1);
      if (r < rows - 1) rem = Math.max(rem, openSpaceRem[idx + cols] - 1);
      if (c < cols - 1 && r < rows - 1) rem = Math.max(rem, openSpaceRem[idx + cols + 1] - 1.414);
      if (c > 0 && r < rows - 1) rem = Math.max(rem, openSpaceRem[idx + cols - 1] - 1.414);
      openSpaceRem[idx] = rem;
    }
  }

  // 3. Medial-axis ridge detection (excluding open courtyards / wide squares)
  const ridge = new Uint8Array(cols * rows);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c;
      if (openSpaceRem[idx] > 0.5) continue;
      const d = dist[idx];
      if (d < minRadiusCells || d > maxRadiusCells) continue;

      const horizMax = d >= dist[idx - 1] && d > dist[idx + 1];
      const vertMax = d >= dist[idx - cols] && d > dist[idx + cols];
      const horizMaxEq = d > dist[idx - 1] && d >= dist[idx + 1];
      const vertMaxEq = d > dist[idx - cols] && d >= dist[idx + cols];

      if (horizMax || vertMax || horizMaxEq || vertMaxEq) {
        ridge[idx] = 1;
      }
    }
  }

  // 4. Trace connected ridge chains into polylines and measure median real width
  const visited = new Uint8Array(cols * rows);
  const streets: StreetSegment[] = [];
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];

  let streetSeq = 1;

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const startIdx = r * cols + c;
      if (!ridge[startIdx] || visited[startIdx]) continue;

      const traceFrom = (sr: number, sc: number) => {
        const chain: Array<{ r: number; c: number; d: number }> = [];
        let cr = sr;
        let cc = sc;
        let prevDr = 0;
        let prevDc = 0;

        for (let step = 0; step < 300; step++) {
          let bestNb: { nr: number; nc: number; score: number } | null = null;
          for (const [dr, dc] of dirs) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr <= 0 || nr >= rows - 1 || nc <= 0 || nc >= cols - 1) continue;
            const nIdx = nr * cols + nc;
            if (!ridge[nIdx] || visited[nIdx]) continue;
            const dot = prevDr * dr + prevDc * dc;
            const score = dist[nIdx] + dot * 2.5;
            if (!bestNb || score > bestNb.score) {
              bestNb = { nr, nc, score };
            }
          }
          if (!bestNb) break;
          const nIdx = bestNb.nr * cols + bestNb.nc;
          visited[nIdx] = 1;
          prevDr = bestNb.nr - cr;
          prevDc = bestNb.nc - cc;
          cr = bestNb.nr;
          cc = bestNb.nc;
          chain.push({ r: cr, c: cc, d: dist[nIdx] });
        }
        return chain;
      };

      visited[startIdx] = 1;
      const forward = traceFrom(r, c);
      const backward = traceFrom(r, c);
      const fullChain = [
        ...backward.reverse(),
        { r, c, d: dist[startIdx] },
        ...forward,
      ];

      if (fullChain.length < 8) continue;

      const rawPts: WorldPoint[] = fullChain.map((pt) => ({
        x: Math.round((grid.originX + (pt.c + 0.5) * cellSize) * 10) / 10,
        z: Math.round((grid.originZ + (pt.r + 0.5) * cellSize) * 10) / 10,
      }));

      let totalLen = 0;
      for (let i = 1; i < rawPts.length; i++) {
        totalLen += Math.hypot(rawPts[i].x - rawPts[i - 1].x, rawPts[i].z - rawPts[i - 1].z);
      }

      const radii = fullChain.map((p) => p.d).sort((a, b) => a - b);
      const medianRadius = radii[Math.floor(radii.length * 0.55)];
      const p90Radius = radii[Math.floor(radii.length * 0.9)];
      const rawMeasuredWidth = Math.round(medianRadius * 2 * cellSize);

      if (rawMeasuredWidth > maxWidthBlocks || p90Radius * 2 * cellSize > maxWidthBlocks * 1.18) {
        continue;
      }
      if (totalLen < Math.max(26, rawMeasuredWidth * 2.15)) {
        continue;
      }

      const realWidth = Math.max(minWidthBlocks, Math.min(maxWidthBlocks, rawMeasuredWidth));

      const simplified = simplifyPolyline(rawPts, Math.max(3.5, cellSize * 1.9));
      if (simplified.length < 2) continue;

      // Apply constant-curvature circular-arc smoothing to synthesized roads
      const smoothed = smoothStreetPolyline(simplified, Math.max(14, Math.min(28, realWidth * 1.1)), 6);

      const roadClass: RoadClass =
        realWidth >= 26
          ? 'highway'
          : realWidth >= 19
          ? 'avenue'
          : realWidth >= 12
          ? 'street'
          : realWidth >= 7
          ? 'lane'
          : 'pedestrian';

      if (
        allowedRoadClasses &&
        allowedRoadClasses.length > 0 &&
        !allowedRoadClasses.includes(roadClass)
      ) {
        continue;
      }

      const midPt = smoothed[Math.floor(smoothed.length / 2)];
      const district = inferDistrict(midPt.x, midPt.z);
      const classPrefix =
        roadClass === 'highway'
          ? 'Трасса'
          : roadClass === 'avenue'
          ? 'Проспект'
          : roadClass === 'street'
          ? 'Улица'
          : roadClass === 'lane'
          ? 'Переулок'
          : 'Проход';

      streets.push({
        id: `auto-st-${grid.originX}-${grid.originZ}-${streetSeq}`,
        name: `${classPrefix} №${streetSeq} (${realWidth} м)`,
        district,
        roadClass,
        width: realWidth,
        elevationY: Math.round(groundY),
        points: smoothed,
        simAllowed: roadClass !== 'pedestrian',
        isAutoSynthesized: true,
      });
      streetSeq++;
    }
  }

  const mergedStreets = mergeAndSmoothRoadNetwork(streets, {
    endpointSnapBlocks: Math.max(18, cellSize * 9),
    corridorMergeFactor: 0.65,
    simplifyEpsilon: Math.max(3.5, cellSize * 1.8),
    smoothFillets: true,
  });

  mergedStreets.sort((a, b) => b.width * b.points.length - a.width * a.points.length);
  return mergedStreets.slice(0, 120);
}

/**
 * STAGE 3: Inspects the traced real-width street network and automatically aligns
 * public transport (MTR) routes onto real street corridors with parallel lane separation.
 * - Bus / Trolleybus / Tram: A* traced over real-width streets (wide avenues preferred).
 * - Metro / Suburban Rail: Smooth spline curves respecting underground/rail geometry.
 */
export function tracePublicTransitOverStreets(
  routes: MtrRoute[],
  streets: StreetSegment[]
): {
  tracedRoutes: MtrRoute[];
  routesSnapped: number;
  totalSurfaceRoutes: number;
  avgStreetCoveragePct: number;
} {
  interface CorridorNode {
    id: number;
    x: number;
    z: number;
    edges: Array<{
      to: number;
      dist: number;
      width: number;
      roadClass: RoadClass;
      edgeKey: string;
    }>;
  }

  const nodes: CorridorNode[] = [];
  const CELL = 64;
  const MERGE_TOL = 28;
  const spatial = new Map<string, number[]>();

  const cellKey = (cx: number, cz: number) => `${cx}_${cz}`;

  const addToSpatial = (id: number, x: number, z: number) => {
    const k = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    const bucket = spatial.get(k);
    if (bucket) bucket.push(id);
    else spatial.set(k, [id]);
  };

  const getNearbyCandidates = (x: number, z: number, radius: number): number[] => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const span = Math.ceil(radius / CELL);
    const out: number[] = [];
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const b = spatial.get(cellKey(cx + dx, cz + dz));
        if (b) {
          for (let i = 0; i < b.length; i++) out.push(b[i]);
        }
      }
    }
    return out;
  };

  const findOrAdd = (x: number, z: number): number => {
    const cands = getNearbyCandidates(x, z, MERGE_TOL);
    for (let i = 0; i < cands.length; i++) {
      const n = nodes[cands[i]];
      if (Math.hypot(n.x - x, n.z - z) <= MERGE_TOL) {
        return n.id;
      }
    }
    const id = nodes.length;
    nodes.push({ id, x, z, edges: [] });
    addToSpatial(id, x, z);
    return id;
  };

  for (const street of streets) {
    if (street.points.length < 2) continue;
    const densePts: WorldPoint[] = [street.points[0]];
    for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1];
      const b = street.points[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.min(8, Math.ceil(segLen / 140)));
      for (let s = 1; s <= steps; s++) {
        densePts.push({
          x: Math.round(a.x + ((b.x - a.x) * s) / steps),
          z: Math.round(a.z + ((b.z - a.z) * s) / steps),
        });
      }
    }

    let prevId = findOrAdd(densePts[0].x, densePts[0].z);
    for (let i = 1; i < densePts.length; i++) {
      const currId = findOrAdd(densePts[i].x, densePts[i].z);
      if (currId !== prevId) {
        const a = nodes[prevId];
        const b = nodes[currId];
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        const edgeKey = prevId < currId ? `${prevId}_${currId}` : `${currId}_${prevId}`;
        if (!a.edges.some((e) => e.to === currId)) {
          a.edges.push({ to: currId, dist: d, width: street.width, roadClass: street.roadClass, edgeKey });
          b.edges.push({ to: prevId, dist: d, width: street.width, roadClass: street.roadClass, edgeKey });
        }
      }
      prevId = currId;
    }
  }

  // O(N) spatial-hash true intersection linking (within 48 blocks — never cutting across city blocks)
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const cands = getNearbyCandidates(a.x, a.z, 48);
    for (let k = 0; k < cands.length; k++) {
      const j = cands[k];
      if (j <= i) continue;
      const b = nodes[j];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d <= 48 && !a.edges.some((e) => e.to === j)) {
        const edgeKey = `${i}_${j}`;
        a.edges.push({ to: j, dist: d * 1.15, width: 14, roadClass: 'street', edgeKey });
        b.edges.push({ to: i, dist: d * 1.15, width: 14, roadClass: 'street', edgeKey });
      }
    }
  }

  const findNearestNode = (x: number, z: number, maxDist: number): number | null => {
    const cands = getNearbyCandidates(x, z, maxDist);
    let bestId: number | null = null;
    let bestD = maxDist;
    for (let i = 0; i < cands.length; i++) {
      const n = nodes[cands[i]];
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) {
        bestD = d;
        bestId = n.id;
      }
    }
    return bestId;
  };

  type AStarResult = { pts: WorldPoint[]; edgeKeys: string[]; totalDist: number } | null;
  const astarCache = new Map<string, AStarResult>();

  const traceCorridorAStar = (
    startIdx: number,
    goalIdx: number,
    isTram: boolean
  ): AStarResult => {
    if (startIdx === goalIdx) {
      return { pts: [{ x: nodes[startIdx].x, z: nodes[startIdx].z }], edgeKeys: [], totalDist: 0 };
    }
    const cacheKey = `${startIdx}_${goalIdx}_${isTram ? 1 : 0}`;
    if (astarCache.has(cacheKey)) {
      return astarCache.get(cacheKey)!;
    }

    const goal = nodes[goalIdx];
    const gScore = new Map<number, number>();
    const prev = new Map<number, { id: number; edgeKey: string }>();
    const closed = new Set<number>();

    const heap: Array<{ id: number; f: number }> = [
      { id: startIdx, f: Math.hypot(goal.x - nodes[startIdx].x, goal.z - nodes[startIdx].z) },
    ];
    gScore.set(startIdx, 0);

    const pushHeap = (item: { id: number; f: number }) => {
      heap.push(item);
      let idx = heap.length - 1;
      while (idx > 0) {
        const p = (idx - 1) >> 1;
        if (heap[p].f <= heap[idx].f) break;
        [heap[p], heap[idx]] = [heap[idx], heap[p]];
        idx = p;
      }
    };

    const popHeap = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let idx = 0;
        while (true) {
          let sm = idx;
          const l = 2 * idx + 1;
          const r = 2 * idx + 2;
          if (l < heap.length && heap[l].f < heap[sm].f) sm = l;
          if (r < heap.length && heap[r].f < heap[sm].f) sm = r;
          if (sm === idx) break;
          [heap[idx], heap[sm]] = [heap[sm], heap[idx]];
          idx = sm;
        }
      }
      return top;
    };

    let iterations = 0;
    while (heap.length > 0 && iterations < 260) {
      iterations++;
      const curr = popHeap();
      if (curr.id === goalIdx) break;
      if (closed.has(curr.id)) continue;
      closed.add(curr.id);

      const currG = gScore.get(curr.id) ?? Infinity;
      const node = nodes[curr.id];
      for (const edge of node.edges) {
        if (closed.has(edge.to)) continue;
        let weightFactor = 1.0;
        if (edge.roadClass === 'pedestrian') weightFactor = 3.2;
        else if (isTram && edge.width < 14) weightFactor = 1.65;
        else if (edge.width >= 20) weightFactor = 0.85;
        else if (edge.width >= 14) weightFactor = 0.94;

        const nextG = currG + edge.dist * weightFactor;
        if (nextG < (gScore.get(edge.to) ?? Infinity)) {
          gScore.set(edge.to, nextG);
          prev.set(edge.to, { id: curr.id, edgeKey: edge.edgeKey });
          const h = Math.hypot(goal.x - nodes[edge.to].x, goal.z - nodes[edge.to].z) * 0.85;
          pushHeap({ id: edge.to, f: nextG + h });
        }
      }
    }

    if (!prev.has(goalIdx)) {
      astarCache.set(cacheKey, null);
      return null;
    }

    const pts: WorldPoint[] = [];
    const edgeKeys: string[] = [];
    let totalDist = 0;
    let cur: number | undefined = goalIdx;
    while (cur !== undefined) {
      pts.push({ x: nodes[cur].x, z: nodes[cur].z });
      const step = prev.get(cur);
      if (step) {
        totalDist += Math.hypot(nodes[cur].x - nodes[step.id].x, nodes[cur].z - nodes[step.id].z);
        edgeKeys.push(step.edgeKey);
        cur = step.id;
      } else {
        cur = undefined;
      }
    }
    pts.reverse();
    const res = { pts, edgeKeys, totalDist };
    astarCache.set(cacheKey, res);
    return res;
  };

  const edgeUsage = new Map<string, number>();
  let routesSnapped = 0;
  let totalSurfaceRoutes = 0;
  let coverageSum = 0;

  const tracedRoutes: MtrRoute[] = routes.map((route) => {
    if (route.stops.length < 2) return route;

    const isSurface =
      route.kind === 'bus' || route.kind === 'trolleybus' || route.kind === 'tram';

    if (!isSurface) {
      // MAGIC 3D spline smoothing with real server Y coordinates (tunnels, viaducts, cable, flight)
      const raw3D: WorldPoint3D[] = route.stops.map((s) => ({
        x: s.x,
        y: Number.isFinite(s.y) ? s.y : SERVER_GROUND_Y,
        z: s.z,
      }));
      const smoothed3D = smoothMagic3DPath(raw3D, 3);
      return {
        ...route,
        tracedPath: smoothed3D.map((p) => ({ x: p.x, z: p.z })),
        tracedPath3D: smoothed3D,
        magicSmoothed: true,
        snappedToStreets: false,
        corridorOffset: 0,
      };
    }

    totalSurfaceRoutes++;
    const isTram = route.kind === 'tram';
    const fullPath3D: WorldPoint3D[] = [];
    const usedEdges = new Set<string>();
    let snappedSegments = 0;
    const totalSegments = route.stops.length - 1;

    for (let i = 0; i < totalSegments; i++) {
      const a = route.stops[i];
      const b = route.stops[i + 1];
      const ay = Number.isFinite(a.y) ? a.y : SERVER_GROUND_Y;
      const by = Number.isFinite(b.y) ? b.y : SERVER_GROUND_Y;
      const directDist = Math.hypot(b.x - a.x, b.z - a.z);

      if (i === 0) fullPath3D.push({ x: a.x, y: ay, z: a.z });

      if (directDist <= 1800 && nodes.length > 0) {
        const nA = findNearestNode(a.x, a.z, 260);
        const nB = findNearestNode(b.x, b.z, 260);

        if (nA !== null && nB !== null && nA !== nB) {
          const res = traceCorridorAStar(nA, nB, isTram);
          if (res && res.pts.length >= 2 && res.totalDist <= Math.max(450, directDist * 2.35)) {
            // Eliminate stop-to-node backward overshoot vortices!
            // If res.pts[0] sits BEHIND stop `a` relative to res.pts[1], skip res.pts[0].
            // If res.pts[last] sits BEYOND stop `b` relative to res.pts[last-1], skip res.pts[last].
            let trimmed = res.pts;
            while (trimmed.length >= 2) {
              const p0 = trimmed[0];
              const p1 = trimmed[1];
              const vx = p1.x - p0.x;
              const vz = p1.z - p0.z;
              const ax = a.x - p0.x;
              const az = a.z - p0.z;
              const vLenSq = vx * vx + vz * vz;
              if (vLenSq > 1) {
                const projT = (ax * vx + az * vz) / vLenSq;
                // Stop `a` already lies past p0 along segment p0->p1 -> drop p0 to avoid backward vortex!
                if (projT > 0.12) {
                  trimmed = trimmed.slice(1);
                  continue;
                }
              }
              break;
            }
            while (trimmed.length >= 2) {
              const pLast = trimmed[trimmed.length - 1];
              const pPrev = trimmed[trimmed.length - 2];
              const vx = pLast.x - pPrev.x;
              const vz = pLast.z - pPrev.z;
              const bx = b.x - pPrev.x;
              const bz = b.z - pPrev.z;
              const vLenSq = vx * vx + vz * vz;
              if (vLenSq > 1) {
                const projT = (bx * vx + bz * vz) / vLenSq;
                // Stop `b` lies BEFORE pLast along segment pPrev->pLast -> drop pLast to avoid overshoot vortex!
                if (projT < 0.88) {
                  trimmed = trimmed.slice(0, -1);
                  continue;
                }
              }
              break;
            }

            const pLen = Math.max(1, trimmed.length);
            trimmed.forEach((pt, idx) => {
              const frac = (idx + 0.5) / (pLen + 1);
              const interpY = ay + (by - ay) * frac;
              const last = fullPath3D[fullPath3D.length - 1];
              if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) > 10) {
                fullPath3D.push({ x: pt.x, y: interpY, z: pt.z });
              }
            });
            for (const ek of res.edgeKeys) usedEdges.add(ek);
            snappedSegments++;
          }
        }
      }

      const last = fullPath3D[fullPath3D.length - 1];
      if (!last || Math.hypot(b.x - last.x, b.z - last.z) > 6) {
        fullPath3D.push({ x: b.x, y: by, z: b.z });
      }
    }

    const vortexFree3D = removePathVortices3D(fullPath3D, { minPointGap: 2.5, maxSpikeLen: 95 });
    const smoothed3D = smoothMagic3DPath(vortexFree3D, 3);
    const coveragePct = totalSegments > 0 ? Math.round((snappedSegments / totalSegments) * 100) : 0;
    if (snappedSegments > 0) {
      routesSnapped++;
      coverageSum += coveragePct;
    }

    let maxShared = 0;
    for (const ek of usedEdges) {
      const cnt = edgeUsage.get(ek) ?? 0;
      if (cnt > maxShared) maxShared = cnt;
      edgeUsage.set(ek, cnt + 1);
    }
    const offsetSign = maxShared % 2 === 0 ? 1 : -1;
    const corridorOffset =
      maxShared === 0 ? 0 : offsetSign * Math.min(10, Math.ceil(maxShared / 2) * 3.2);

    return {
      ...route,
      tracedPath: smoothed3D.map((p) => ({ x: p.x, z: p.z })),
      tracedPath3D: smoothed3D,
      magicSmoothed: true,
      snappedToStreets: snappedSegments > 0,
      streetCoveragePct: coveragePct,
      corridorOffset,
    };
  });

  const connectedRoutes = connectBidirectionalRouteTermini(tracedRoutes);

  return {
    tracedRoutes: connectedRoutes,
    routesSnapped,
    totalSurfaceRoutes,
    avgStreetCoveragePct: routesSnapped > 0 ? Math.round(coverageSum / routesSnapped) : 0,
  };
}

/**
 * Runs the complete 3-Stage Urban Synthesis Pipeline with target mode ('both' | 'buildings' | 'streets'),
 * roof verification, real server elevation coordinates, real-width highways/streets, and MAGIC 3D transit smoothing.
 */
export function runUrbanSynthesisPipeline(
  grids: HeightColorGrid[],
  existingBuildings: Building3D[],
  existingStreets: StreetSegment[],
  mtrRoutes: MtrRoute[],
  options: SynthesisOptions = {},
  source: 'bluemap-live' | 'procedural-3d' = 'bluemap-live',
  magicRails: MagicRailSegment[] = []
): {
  buildings: Building3D[];
  streets: StreetSegment[];
  routes: MtrRoute[];
  stats: SynthesisStats;
} {
  const t0 = performance.now();
  const targetMode: SynthesisTargetMode = options.targetMode ?? 'both';
  const tileLod = options.tileLod ?? 1;
  const areaBlocks = options.areaSideBlocks ?? 1000;

  const autoBuildings: Building3D[] = [];
  const autoStreets: StreetSegment[] = [];
  let totalRejectedNoRoof = 0;
  let totalRejectedBridges = 0;
  const roofBreakdown: Record<RoofType, number> = {
    flat: 0,
    pitched: 0,
    curved: 0,
    complex: 0,
  };

  // Stitch multi-tile grids into one seamless analysis grid so buildings/streets spanning tile borders are never lost
  const stitched = grids.length > 1 ? stitchHeightColorGrids(grids) : grids[0] ?? null;
  const analysisGrids = stitched ? [stitched] : [];

  for (const grid of analysisGrids) {
    // Always compute buildingMask so roads exclude buildings even in 'streets'-only mode
    const bRes = extractBuildingsFrom3DGrid(
      grid,
      [...existingBuildings, ...autoBuildings],
      options,
      mtrRoutes
    );

    if (targetMode === 'both' || targetMode === 'buildings') {
      autoBuildings.push(...bRes.buildings);
      totalRejectedNoRoof += bRes.rejectedNoRoof;
      totalRejectedBridges += bRes.rejectedBridges;
      roofBreakdown.flat += bRes.roofBreakdown.flat;
      roofBreakdown.pitched += bRes.roofBreakdown.pitched;
      roofBreakdown.curved += bRes.roofBreakdown.curved;
      roofBreakdown.complex += bRes.roofBreakdown.complex;
    }

    if (targetMode === 'both' || targetMode === 'streets') {
      const sRes = extractStreetsWithRealWidth(grid, bRes.buildingMask, bRes.groundY, options);
      autoStreets.push(...sRes);
    }
  }

  // Stage 3: Prioritize real MAGIC API rail traces when available; otherwise MAGIC 3D smoothing (with optional street snapping)
  const allStreets = [...existingStreets, ...autoStreets];
  let tracedRoutes = mtrRoutes;
  let routesSnapped = 0;
  const totalSurfaceRoutes = mtrRoutes.filter((r) => r.kind !== 'metro' && r.kind !== 'rail').length;
  let avgStreetCoveragePct = 0;

  if (magicRails.length > 0 && mtrRoutes.length > 0) {
    const magicRes = traceRoutesFromMagicRails(mtrRoutes, magicRails);
    tracedRoutes = magicRes.routes;
    routesSnapped = magicRes.routesTracedFromMagicRails;
    avgStreetCoveragePct =
      mtrRoutes.length > 0
        ? Math.round((magicRes.routesTracedFromMagicRails / mtrRoutes.length) * 100)
        : 0;
  } else if (options.snapSurfaceTransit !== false && mtrRoutes.length > 0) {
    const transitResult = tracePublicTransitOverStreets(mtrRoutes, allStreets);
    tracedRoutes = transitResult.tracedRoutes;
    routesSnapped = transitResult.routesSnapped;
    avgStreetCoveragePct = transitResult.avgStreetCoveragePct;
  }

  let minBuildingHeight = 0;
  let maxBuildingHeight = 0;
  if (autoBuildings.length > 0) {
    minBuildingHeight = Infinity;
    maxBuildingHeight = -Infinity;
    for (const b of autoBuildings) {
      if (b.height < minBuildingHeight) minBuildingHeight = b.height;
      if (b.height > maxBuildingHeight) maxBuildingHeight = b.height;
    }
  }

  let minStreetWidth = 0;
  let maxStreetWidth = 0;
  let avgStreetWidth = 0;
  if (autoStreets.length > 0) {
    minStreetWidth = Infinity;
    maxStreetWidth = -Infinity;
    let sumStreetWidth = 0;
    for (const s of autoStreets) {
      if (s.width < minStreetWidth) minStreetWidth = s.width;
      if (s.width > maxStreetWidth) maxStreetWidth = s.width;
      sumStreetWidth += s.width;
    }
    avgStreetWidth = Math.round(sumStreetWidth / autoStreets.length);
  }

  const stats: SynthesisStats = {
    tilesScanned: grids.length,
    tileLod,
    areaBlocks,
    targetMode,
    buildingsExtracted: autoBuildings.length,
    buildingsRejectedNoRoof: totalRejectedNoRoof,
    buildingsRejectedBridges: totalRejectedBridges,
    minBuildingHeight,
    maxBuildingHeight,
    roofBreakdown,
    streetsExtracted: autoStreets.length,
    minStreetWidth,
    maxStreetWidth,
    avgStreetWidth,
    routesSnapped,
    totalSurfaceRoutes,
    avgStreetCoveragePct,
    elapsedMs: Math.round(performance.now() - t0),
    source,
  };

  return {
    buildings: autoBuildings,
    streets: autoStreets,
    routes: tracedRoutes,
    stats,
  };
}
