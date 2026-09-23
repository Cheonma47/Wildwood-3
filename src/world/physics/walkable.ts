/**
 * Walkable surfaces above the terrain: the elevated Boardwalk deck, piers and
 * the ramps/stairs that connect them to streets and beach.
 */
import type { Area, Road } from '../data/types';
import { bboxOf, closestOnSegment, orientedRect, pointInPolygon, pointInRing, type BBox, type V2 } from '../math/polygon';
import { SpatialGrid } from '../math/spatialGrid';
import type { Terrain } from '../terrain/heightfield';

/** Height of the Boardwalk deck above street level (metres). */
export const DECK_HEIGHT = 1.0;

export interface Surface {
  kind: 'deck' | 'ramp' | 'stairs';
  outer: V2[];
  holes?: V2[][];
  bbox: BBox;
  /** Flat height, or for ramps: height at start (h0) → end (h1) along axis. */
  h0: number;
  h1: number;
  axis?: { ox: number; oz: number; dx: number; dz: number; len: number };
  areaId?: number;
}

export class WalkableSurfaces {
  readonly list: Surface[] = [];
  private grid = new SpatialGrid<Surface>(50);

  add(s: Surface): void {
    this.list.push(s);
    this.grid.insert(s, s.bbox);
  }

  /** Height of surface at (x,z) if inside, else null. */
  static heightOn(s: Surface, x: number, z: number): number | null {
    if (x < s.bbox.minX || x > s.bbox.maxX || z < s.bbox.minZ || z > s.bbox.maxZ) return null;
    if (!pointInPolygon(x, z, s.outer, s.holes)) return null;
    if (!s.axis) return s.h0;
    const t = Math.min(1, Math.max(0, ((x - s.axis.ox) * s.axis.dx + (z - s.axis.oz) * s.axis.dz) / s.axis.len));
    if (s.kind === 'stairs') {
      const steps = Math.max(2, Math.round(Math.abs(s.h1 - s.h0) / 0.18));
      return s.h0 + (s.h1 - s.h0) * Math.min(1, Math.round(t * steps) / steps);
    }
    return s.h0 + (s.h1 - s.h0) * t;
  }

  /** Highest surface ≤ maxY at (x,z), or -Infinity. */
  highestAt(x: number, z: number, maxY = Infinity): { h: number; s: Surface | null } {
    let best = -Infinity;
    let bs: Surface | null = null;
    for (const s of this.grid.queryPoint(x, z)) {
      const h = WalkableSurfaces.heightOn(s, x, z);
      if (h !== null && h <= maxY && h > best) { best = h; bs = s; }
    }
    return { h: best, s: bs };
  }
}

function rampRect(ox: number, oz: number, dx: number, dz: number, len: number, width: number): V2[] {
  return orientedRect(ox + dx * len / 2, oz + dz * len / 2, dx, dz, len / 2, width / 2);
}

export function buildWalkables(areas: Area[], roads: Road[], terrain: Terrain): { surfaces: WalkableSurfaces; boardwalks: Area[]; decks: Area[] } {
  const surfaces = new WalkableSurfaces();
  const boardwalks = areas.filter((a) => a.kind === 'boardwalk');
  // Piers and amusement piers that sit on the beach are elevated decks too.
  const decks = areas.filter((a) => {
    if (a.kind === 'boardwalk' || a.kind === 'pier') return true;
    if (a.kind !== 'themepark') return false;
    // theme parks on the beach side (Morey's piers, water parks) are on piers
    const c = a.outer[Math.floor(a.outer.length / 2)];
    return terrain.classAt(c[0], c[1]) === 2 || boardwalks.some((b) => b.outer.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 120));
  });
  for (const a of decks) {
    surfaces.add({ kind: 'deck', outer: a.outer, holes: a.holes, bbox: bboxOf(a.outer), h0: DECK_HEIGHT, h1: DECK_HEIGHT, areaId: a.id });
  }

  const inDeck = (x: number, z: number) => decks.some((d) => pointInRing(x, z, d.outer));
  const rampPoints: V2[] = [];

  // Ramps where streets and paths meet the boardwalk / pier edge.
  for (const road of roads) {
    if (road.kind === 'steps' && road.pts.length < 2) continue;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const ia = inDeck(a[0], a[1]), ib = inDeck(b[0], b[1]);
      if (ia === ib) continue;
      // binary search the crossing point
      let lo = 0, hi = 1;
      for (let k = 0; k < 20; k++) {
        const m = (lo + hi) / 2;
        const inside = inDeck(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m);
        if (inside === ib) hi = m; else lo = m;
      }
      const cx = a[0] + (b[0] - a[0]) * hi, cz = a[1] + (b[1] - a[1]) * hi;
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz);
      dx /= l; dz /= l;
      if (!ib) { dx = -dx; dz = -dz; } // point from outside → inside
      addRamp(cx, cz, dx, dz, Math.max(3, Math.min(8, road.width)));
    }
    // Road ending just short of the deck: ramp bridging the gap.
    for (const end of [road.pts[0], road.pts[road.pts.length - 1]]) {
      if (inDeck(end[0], end[1])) continue;
      let best: { x: number; z: number; d: number } | null = null;
      for (const d of decks) {
        for (let i = 0; i < d.outer.length; i++) {
          const p = d.outer[i], q = d.outer[(i + 1) % d.outer.length];
          const [x, z, , d2] = closestOnSegment(end[0], end[1], p[0], p[1], q[0], q[1]);
          if (!best || d2 < best.d) best = { x, z, d: d2 };
        }
      }
      if (best && Math.sqrt(best.d) < 25 && Math.sqrt(best.d) > 0.2) {
        const dist = Math.sqrt(best.d);
        const dx = (best.x - end[0]) / dist, dz = (best.z - end[1]) / dist;
        addRamp(best.x, best.z, dx, dz, Math.max(3, Math.min(8, road.width)), dist);
      }
    }
  }

  // Beach stairs along the ocean-facing edge of the boardwalk, every ~90 m.
  const SE: V2 = [Math.SQRT1_2, Math.SQRT1_2];
  for (const bw of boardwalks) {
    const ring = bw.outer;
    let since = 45;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const ex = q[0] - p[0], ez = q[1] - p[1];
      const len = Math.hypot(ex, ez);
      if (len < 1e-3) continue;
      let nx = ez / len, nz = -ex / len;
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      if (pointInRing(mx + nx * 0.5, mz + nz * 0.5, ring)) { nx = -nx; nz = -nz; }
      if (nx * SE[0] + nz * SE[1] < 0.6) continue; // not ocean-facing
      let t = 0;
      while (since + (len - t) >= 90) {
        t += 90 - since;
        since = 0;
        const sx = p[0] + ex * (t / len), sz = p[1] + ez * (t / len);
        if (!rampPoints.some((r) => Math.hypot(r[0] - sx, r[1] - sz) < 40) && !inDeck(sx + nx * 3, sz + nz * 3)) {
          addStairs(sx, sz, -nx, -nz, 4);
        }
      }
      since += len - t;
    }
  }

  function addRamp(cx: number, cz: number, dx: number, dz: number, width: number, gap = 0) {
    if (rampPoints.some((r) => Math.hypot(r[0] - cx, r[1] - cz) < 4)) return;
    rampPoints.push([cx, cz]);
    const len = Math.max(9, gap + 1);
    const ox = cx - dx * len, oz = cz - dz * len;
    const h0 = Math.max(0, terrain.heightAt(ox, oz));
    const outer = rampRect(ox, oz, dx, dz, len + 1.2, width);
    surfaces.add({ kind: 'ramp', outer, bbox: bboxOf(outer), h0, h1: DECK_HEIGHT, axis: { ox, oz, dx, dz, len } });
  }

  function addStairs(cx: number, cz: number, dx: number, dz: number, width: number) {
    rampPoints.push([cx, cz]);
    // dx,dz points into the deck; stairs descend outward onto the sand
    const len = 4.5;
    const ox = cx - dx * len, oz = cz - dz * len;
    const h0 = terrain.heightAt(ox, oz);
    const outer = rampRect(ox, oz, dx, dz, len + 0.6, width);
    surfaces.add({ kind: 'stairs', outer, bbox: bboxOf(outer), h0, h1: DECK_HEIGHT, axis: { ox, oz, dx, dz, len } });
  }

  return { surfaces, boardwalks, decks };
}
