/** Helpers shared by custom landmark renderers (all driven by real footprints). */
import * as THREE from 'three';
import { GeoBuilder } from '../render/geometry';
import { pointInRing, type V2 } from '../math/polygon';

export interface Facade {
  a: V2;
  b: V2;
  mid: V2;
  /** outward unit normal */
  n: V2;
  /** unit direction a→b */
  d: V2;
  len: number;
  /** yaw so that a plane's +z faces outward */
  yaw: number;
}

export function outwardEdges(ring: V2[]): Facade[] {
  const out: Facade[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.3) continue;
    const d: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let n: V2 = [d[1], -d[0]];
    const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pointInRing(mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05, ring)) n = [-n[0], -n[1]];
    out.push({ a, b, mid, n, d, len, yaw: Math.atan2(n[0], n[1]) });
  }
  return out;
}

/** Longest facade whose outward normal points most towards `target`. */
export function facadeFacing(ring: V2[], target: V2): Facade {
  const edges = outwardEdges(ring);
  let best = edges[0], bestScore = -Infinity;
  for (const e of edges) {
    const tx = target[0] - e.mid[0], tz = target[1] - e.mid[1];
    const tl = Math.hypot(tx, tz) || 1;
    const score = ((e.n[0] * tx + e.n[1] * tz) / tl) * 2 + Math.min(e.len, 30) / 30 - tl / 200;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/** Extruded footprint walls + flat roof into the given builders. */
export function extrude(ring: V2[], y0: number, y1: number, walls: GeoBuilder, roof: GeoBuilder | null, color?: THREE.Color, roofColor?: THREE.Color, uvScale = 1): void {
  for (const e of outwardEdges(ring)) {
    // orient so the left normal (geometry.ts convention) is outward
    const left: V2 = [e.d[1], -e.d[0]];
    const [a, b] = left[0] * e.n[0] + left[1] * e.n[1] > 0 ? [e.a, e.b] : [e.b, e.a];
    walls.quad([[a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]]], [[0, 0], [0, (y1 - y0) / uvScale], [e.len / uvScale, (y1 - y0) / uvScale], [e.len / uvScale, 0]], color);
  }
  roof?.flatPolygon(ring, undefined, y1, 4, roofColor);
}

/** Position + rotation for an object on a facade (u = metres along, y = height, out = offset). */
export function onFacade(f: Facade, u: number, y: number, out = 0.08): { position: [number, number, number]; rotation: [number, number, number] } {
  const x = f.mid[0] + f.d[0] * u + f.n[0] * out;
  const z = f.mid[1] + f.d[1] * u + f.n[1] * out;
  return { position: [x, y, z], rotation: [0, f.yaw, 0] };
}
