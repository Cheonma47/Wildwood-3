/**
 * Real building footprints from Microsoft Global ML Building Footprints (ODbL),
 * used for every building OpenStreetMap does not map. Shape, position and
 * (for ~2/3 of them) height are real; the *use* (house / motel / shop …) is
 * inferred from OSM points of interest inside the footprint, the street it
 * faces, its size and its distance to the Boardwalk.
 */
import type { Building, BuildingStyle, Poi, Road } from '../data/types';
import { centroid, hash01, pointInRing, polygonArea, type V2 } from '../math/polygon';
import { SpatialGrid } from '../math/spatialGrid';
import type { SegmentIndex } from '../math/segmentIndex';
import { facadeFacing } from '../landmarks/landmarkUtils';

export interface FootprintRaw {
  outer: V2[];
  h?: number;
}

const POI_STYLE: Record<string, BuildingStyle> = {
  restaurant: 'restaurant', cheap_food: 'restaurant', shop: 'shop', supermarket: 'shop', convenience: 'shop',
  pharmacy: 'shop', laundromat: 'shop', bank: 'commercial', lodging: 'motel', worship: 'civic', civic: 'civic',
  emergency: 'civic', venue: 'civic', attraction: 'commercial',
};

export function poiGrid(pois: Poi[]): SpatialGrid<Poi> {
  const g = new SpatialGrid<Poi>(40);
  for (const p of pois) g.insert(p, { minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z });
  return g;
}

/** POI whose point lies inside the footprint (or within 6 m of it). */
export function poiFor(outer: V2[], grid: SpatialGrid<Poi>): Poi | undefined {
  const c = centroid(outer);
  let best: Poi | undefined, bd = 1e9;
  for (const p of grid.query(c[0] - 40, c[1] - 40, c[0] + 40, c[1] + 40)) {
    if (!POI_STYLE[p.cat]) continue;
    if (pointInRing(p.x, p.z, outer)) return p;
    const d = Math.hypot(p.x - c[0], p.z - c[1]);
    if (d < bd) { bd = d; best = p; }
  }
  const r = Math.sqrt(polygonArea(outer) / Math.PI);
  return best && bd < r + 6 ? best : undefined;
}

export function buildFootprintBuildings(
  raws: FootprintRaw[],
  pois: SpatialGrid<Poi>,
  roadIndex: SegmentIndex<Road>,
  distToBoardwalk: (x: number, z: number) => number,
  isOnDeck: (x: number, z: number) => boolean,
  deckHeight: number,
): Building[] {
  const out: Building[] = [];
  raws.forEach((r, i) => {
    if (r.outer.length < 3) return;
    const area = polygonArea(r.outer);
    if (area < 12) return;
    const c = centroid(r.outer);
    const seed = Math.floor(hash01(i * 7919 + 13) * 1e6);
    const rnd = hash01(seed);
    const poi = poiFor(r.outer, pois);
    const dBw = distToBoardwalk(c[0], c[1]);
    const street = roadIndex.nearest(c[0], c[1], 45, (s) => s.ref.drivable && !!s.ref.name)?.seg.ref.name ?? '';
    const s = street.replace(/^(East|West|North|South) /, '');
    let style: BuildingStyle;
    if (poi) style = POI_STYLE[poi.cat] ?? 'commercial';
    else if (area < 40) style = 'garage';
    else if (dBw < 35) style = 'boardwalk_shop';
    else if ((s === 'Pacific Avenue' || s === 'Rio Grande Avenue') && area > 90) style = rnd < 0.6 ? 'shop' : 'commercial';
    else if (area < 260) style = 'house';
    else if (area < 900) style = dBw < 420 || s === 'Atlantic Avenue' || s === 'Ocean Avenue' ? (rnd < 0.65 ? 'motel' : 'apartment') : 'apartment';
    else style = dBw < 500 ? 'motel' : 'commercial';
    // Height: real (Microsoft estimate, roof top) when present, else a typical value for the use.
    const typical: Record<string, number> = { house: 7, garage: 3, motel: 8, apartment: 8, shop: 5, restaurant: 5, commercial: 6, boardwalk_shop: 6, civic: 8, industrial: 6 };
    let height = r.h && r.h > 2 ? r.h : typical[style] ?? 6;
    if (style === 'house') height = Math.max(3.2, height * 0.78); // walls; the gable roof adds the rest
    if (style === 'garage') height = Math.min(height, 3.2);
    const onDeck = isOnDeck(c[0], c[1]);
    out.push({
      id: -(i + 1), source: 'footprint', type: style, name: poi?.name, outer: r.outer, height: Math.max(2.8, height),
      baseY: onDeck ? deckHeight : 0, style, seed, amenity: poi?.detail, shop: poi?.cat === 'shop' ? poi.detail : undefined,
      tourism: poi?.cat === 'lodging' ? 'motel' : undefined,
    });
  });
  return out;
}

/** Street-facing facade (for doors, porches, awnings, signs). */
export function computeFront(b: Building, roadIndex: SegmentIndex<Road>): Building['front'] {
  const c = centroid(b.outer);
  const n = roadIndex.nearest(c[0], c[1], 60, (s) => s.ref.drivable && s.ref.kind !== 'service');
  if (!n) return undefined;
  const f = facadeFacing(b.outer, [n.x, n.z]);
  return f ? { mid: f.mid, n: f.n, d: f.d, len: f.len } : undefined;
}
