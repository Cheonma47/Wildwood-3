/**
 * Derives a centreline for the Boardwalk polygon (OSM maps it as an area).
 * The centreline is used for the tram lane, lamps, benches, pedestrians and
 * pedestrian routing along the Boardwalk.
 */
import type { V2 } from '../math/polygon';

/** Boardwalk runs roughly SW→NE along the shore. */
const AXIS: V2 = [Math.SQRT1_2, -Math.SQRT1_2]; // unit vector towards NE (x east, z south)
const PERP: V2 = [Math.SQRT1_2, Math.SQRT1_2]; // towards SE (ocean side)

export interface CenterlineSample {
  p: V2;
  /** Width of the deck at this station (m). */
  width: number;
  /** Inland (NW) and ocean (SE) edge points. */
  inland: V2;
  ocean: V2;
}

export function boardwalkCenterline(ring: V2[], step = 8): CenterlineSample[] {
  let sMin = Infinity, sMax = -Infinity;
  for (const p of ring) {
    const s = p[0] * AXIS[0] + p[1] * AXIS[1];
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  const out: CenterlineSample[] = [];
  let prevMid: number | null = null;
  for (let s = sMin + step / 2; s < sMax; s += step) {
    // Intersect the polygon with the line {q : q·AXIS = s}; collect perpendicular coordinates.
    const hits: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const sa = a[0] * AXIS[0] + a[1] * AXIS[1], sb = b[0] * AXIS[0] + b[1] * AXIS[1];
      if ((sa > s) === (sb > s)) continue;
      const t = (s - sa) / (sb - sa);
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      hits.push(x * PERP[0] + z * PERP[1]);
    }
    hits.sort((a, b) => a - b);
    if (hits.length < 2) continue;
    // choose the interval closest to the previous centre (handles side spurs)
    let best: [number, number] | null = null;
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const iv: [number, number] = [hits[k], hits[k + 1]];
      if (!best) best = iv;
      else if (prevMid !== null) {
        const dm = Math.abs((iv[0] + iv[1]) / 2 - prevMid), db = Math.abs((best[0] + best[1]) / 2 - prevMid);
        if (dm < db) best = iv;
      } else if (iv[1] - iv[0] > best[1] - best[0]) best = iv;
    }
    if (!best) continue;
    const width = best[1] - best[0];
    if (width < 3 || width > 60) continue;
    const mid = (best[0] + best[1]) / 2;
    prevMid = mid;
    const at = (u: number): V2 => [AXIS[0] * s + PERP[0] * u, AXIS[1] * s + PERP[1] * u];
    out.push({ p: at(mid), width, inland: at(best[0]), ocean: at(best[1]) });
  }
  return out;
}
