/**
 * Procedural building fill.
 *
 * OSM has real footprints for only part of Wildwood (~770 buildings). To make
 * the town read as a dense shore resort, empty street frontage on the REAL
 * street network is filled with modular lots (houses, motels, apartments,
 * shops). Lots never overlap real buildings, roads/sidewalks, beach, water,
 * parks, parking or the boardwalk, so real geography always wins.
 *
 * These are marked `source: 'procedural'` and shown differently in the
 * debug map; their exact footprints are NOT real.
 */
import type { Area, Building, BuildingStyle, Road } from '../data/types';
import { DATA_RECT } from '../geo/coordinates';
import {
  bboxOf, hash01, orientedRect, pointInRing, polygonsOverlap, rng, segmentPolygonDistance, type V2,
} from '../math/polygon';
import { SpatialGrid } from '../math/spatialGrid';
import type { SegmentIndex } from '../math/segmentIndex';
import { SIDEWALK_WIDTH } from '../roads/roadStyle';
import { TerrainClass, type Terrain } from '../terrain/heightfield';

const EXCLUDE_AREAS = new Set(['boardwalk', 'plaza', 'pier', 'beach', 'water', 'wetland', 'themepark', 'parking', 'pool', 'pitch', 'park']);

interface Lot { style: BuildingStyle; frontage: number; depth: number; setback: number; levels: number }

function pickStyle(street: string, distBoardwalk: number, r: number): BuildingStyle {
  const s = street.replace(/^(East|West|North|South) /, '');
  if (s === 'Pacific Avenue') return r < 0.35 ? 'shop' : r < 0.6 ? 'restaurant' : r < 0.8 ? 'commercial' : 'apartment';
  if (s === 'Rio Grande Avenue') return r < 0.5 ? 'commercial' : r < 0.75 ? 'restaurant' : 'shop';
  if (distBoardwalk < 200) return r < 0.5 ? 'motel' : r < 0.75 ? 'apartment' : r < 0.87 ? 'commercial' : 'house';
  if (s === 'Atlantic Avenue' || s === 'Ocean Avenue') return r < 0.45 ? 'motel' : r < 0.75 ? 'apartment' : 'house';
  if (s === 'New Jersey Avenue' || s === 'Park Boulevard') return r < 0.3 ? 'commercial' : r < 0.45 ? 'restaurant' : r < 0.75 ? 'house' : 'apartment';
  if (distBoardwalk < 450) return r < 0.25 ? 'motel' : r < 0.55 ? 'apartment' : 'house';
  return r < 0.72 ? 'house' : r < 0.94 ? 'apartment' : 'motel';
}

function lotFor(style: BuildingStyle, rand: () => number): Lot {
  const u = () => rand();
  switch (style) {
    case 'house': return { style, frontage: 9 + u() * 5, depth: 11 + u() * 7, setback: 3 + u() * 2.5, levels: 1.5 + Math.round(u() * 2) * 0.5 };
    case 'apartment': return { style, frontage: 13 + u() * 9, depth: 15 + u() * 9, setback: 2 + u() * 2.5, levels: 2 + Math.floor(u() * 2.6) };
    case 'motel': return { style, frontage: 22 + u() * 18, depth: 13 + u() * 8, setback: 5 + u() * 8, levels: 2 + Math.floor(u() * 2.4) };
    case 'restaurant': return { style, frontage: 11 + u() * 8, depth: 14 + u() * 8, setback: 0.6 + u() * 2, levels: 1 + Math.floor(u() * 1.8) };
    case 'shop': return { style, frontage: 8 + u() * 8, depth: 14 + u() * 8, setback: 0.4 + u() * 0.8, levels: 1 + Math.floor(u() * 2) };
    default: return { style, frontage: 14 + u() * 14, depth: 16 + u() * 12, setback: 0.8 + u() * 3, levels: 1 + Math.floor(u() * 2.5) };
  }
}

export interface FillContext {
  roads: Road[];
  roadIndex: SegmentIndex<Road>;
  areas: Area[];
  existing: Building[];
  terrain: Terrain;
  distToBoardwalk: (x: number, z: number) => number;
  /** Boardwalk centreline samples (inland edge used for the shop row). */
  boardwalkLine: { p: V2; inland: V2; width: number }[];
  /** Extra polygons that must stay free (ramps, stairs). */
  obstacles: V2[][];
}

export function generateProceduralBuildings(ctx: FillContext): Building[] {
  const { roads, roadIndex, areas, terrain, distToBoardwalk } = ctx;
  const bgrid = new SpatialGrid<V2[]>(50);
  for (const b of ctx.existing) bgrid.insert(b.outer, bboxOf(b.outer));
  for (const o of ctx.obstacles) bgrid.insert(o, bboxOf(o));
  const agrid = new SpatialGrid<Area>(100);
  for (const a of areas) if (EXCLUDE_AREAS.has(a.kind)) agrid.insert(a, bboxOf(a.outer));

  const out: Building[] = [];
  let nextId = 1;
  const pad = 30;

  const isFree = (rect: V2[], owner: Road | null, allowBeachEdge = false): boolean => {
    const bb = bboxOf(rect);
    if (bb.minX < DATA_RECT.minX + pad || bb.maxX > DATA_RECT.maxX - pad || bb.minZ < DATA_RECT.minZ + pad || bb.maxZ > DATA_RECT.maxZ - pad) return false;
    // Must be on dry, ordinary land
    const samples: V2[] = [...rect, [(rect[0][0] + rect[2][0]) / 2, (rect[0][1] + rect[2][1]) / 2]];
    for (const p of samples) {
      const c = terrain.classAt(p[0], p[1]);
      if (c === TerrainClass.Water || c === TerrainClass.Wetland) return false;
      if (c === TerrainClass.Beach && !allowBeachEdge) return false;
      if (terrain.heightAt(p[0], p[1]) < -0.05) return false;
    }
    for (const a of agrid.query(bb.minX, bb.minZ, bb.maxX, bb.maxZ)) {
      if (allowBeachEdge && a.kind === 'beach') continue;
      if (polygonsOverlap(rect, a.outer)) return false;
    }
    // Keep 1.2 m between buildings
    const g = 1.2;
    for (const other of bgrid.query(bb.minX - g, bb.minZ - g, bb.maxX + g, bb.maxZ + g)) {
      if (polygonsOverlap(rect, other)) return false;
      for (let i = 0; i < other.length; i++) {
        if (segmentPolygonDistance(other[i], other[(i + 1) % other.length], rect) < g) return false;
      }
    }
    // Clear of every road carriageway (+ sidewalk)
    const cx = (bb.minX + bb.maxX) / 2, cz = (bb.minZ + bb.maxZ) / 2;
    const r = Math.hypot(bb.maxX - bb.minX, bb.maxZ - bb.minZ) / 2 + 12;
    for (const s of roadIndex.query(cx, cz, r)) {
      const road = s.ref;
      const clear = road.width / 2 + (road.hasSidewalk ? SIDEWALK_WIDTH + 0.3 : road.drivable ? 1.0 : 0.5);
      const d = segmentPolygonDistance([s.ax, s.az], [s.bx, s.bz], rect);
      if (d < clear - (road === owner ? 0.05 : 0)) return false;
    }
    return true;
  };

  // 1) Continuous row of modular shops along the inland edge of the Boardwalk.
  {
    const line = ctx.boardwalkLine;
    const rand = rng(4242);
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1].inland, b = line[i].inland;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      acc += len;
      if (acc < 0) continue;
      const ux = dx / len, uz = dz / len;
      // inland normal: away from the deck centre
      const c = line[i].p;
      let nx = -uz, nz = ux;
      if ((b[0] - c[0]) * nx + (b[1] - c[1]) * nz < 0) { nx = -nx; nz = -nz; }
      const frontage = 7 + rand() * 9, depth = 12 + rand() * 10;
      const cx = b[0] + nx * (0.3 + depth / 2), cz = b[1] + nz * (0.3 + depth / 2);
      const rect = orientedRect(cx, cz, ux, uz, frontage / 2 - 0.3, depth / 2);
      if (isFree(rect, null, true)) {
        out.push({
          id: -nextId++, source: 'procedural', type: 'boardwalk_shop', outer: rect,
          height: 4.5 + Math.floor(rand() * 2.2) * 3.2, baseY: 0, style: 'boardwalk_shop',
          frontDir: [ux, uz], seed: Math.floor(rand() * 1e9),
        });
        bgrid.insert(rect, bboxOf(rect));
        acc = -frontage + len * 0.5;
      }
    }
  }

  // 2) Street frontage lots.
  for (const road of roads) {
    if (!road.drivable || road.kind === 'service' || !road.name) continue;
    const rand = rng(road.id);
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 14) continue;
      const ux = dx / len, uz = dz / len;
      const nx = -uz, nz = ux;
      for (const side of [-1, 1]) {
        let t = 6 + rand() * 3;
        let guard = 0;
        while (t < len - 6 && guard++ < 200) {
          const px = a[0] + ux * t, pz = a[1] + uz * t;
          const r = hash01(Math.floor(px * 7.1) ^ Math.floor(pz * 13.7) ^ road.id);
          const style = pickStyle(road.name, distToBoardwalk(px, pz), r);
          const lot = lotFor(style, rand);
          const half = lot.frontage / 2;
          if (t + half > len - 4) break;
          const cx0 = a[0] + ux * (t + half), cz0 = a[1] + uz * (t + half);
          const off = road.width / 2 + SIDEWALK_WIDTH + lot.setback + lot.depth / 2;
          const cx = cx0 + nx * side * off, cz = cz0 + nz * side * off;
          const rect = orientedRect(cx, cz, ux, uz, half - 0.6, lot.depth / 2);
          if (isFree(rect, road)) {
            const seed = Math.floor(hash01(nextId * 31 + road.id) * 1e9);
            const height = lot.levels * 3.1 + (lot.style === 'house' ? 0 : 0.5);
            out.push({
              id: -nextId++,
              source: 'procedural',
              type: lot.style,
              outer: rect,
              height,
              baseY: 0,
              style: lot.style,
              frontDir: [ux, uz],
              seed,
            });
            bgrid.insert(rect, bboxOf(rect));
            t += lot.frontage + 0.5;
          } else {
            t += 3;
          }
        }
      }
    }
  }
  return out;
}

/** Utility: is point inside any polygon from list (bbox pre-check). */
export function insideAny(x: number, z: number, polys: { outer: V2[] }[]): boolean {
  for (const p of polys) if (pointInRing(x, z, p.outer)) return true;
  return false;
}
