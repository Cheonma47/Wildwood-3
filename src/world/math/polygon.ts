/** 2D polygon helpers in world XZ space. Points are [x, z] tuples. */
export type V2 = [number, number];

export function signedArea(ring: readonly V2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

export function polygonArea(ring: readonly V2[]): number {
  return Math.abs(signedArea(ring));
}

export function centroid(ring: readonly V2[]): V2 {
  let x = 0, z = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f;
    z += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [x / (3 * a), z / (3 * a)];
}

export function pointInRing(x: number, z: number, ring: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, z: number, outer: readonly V2[], holes?: readonly V2[][]): boolean {
  if (!pointInRing(x, z, outer)) return false;
  if (holes) for (const h of holes) if (pointInRing(x, z, h)) return false;
  return true;
}

export interface BBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function bboxOf(pts: readonly V2[]): BBox {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Closest point on segment ab to p, returns [x, z, t, distSq]. */
export function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number, number, number] {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cz = az + t * dz;
  return [cx, cz, t, (px - cx) ** 2 + (pz - cz) ** 2];
}

export function distToPolyline(px: number, pz: number, pts: readonly V2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = closestOnSegment(px, pz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])[3];
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Removes a duplicated closing vertex. */
export function openRing(ring: V2[]): V2[] {
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) return ring.slice(0, -1);
  }
  return ring;
}

/** Oriented rectangle corners (counter-clockwise when viewed from above with +z south). */
export function orientedRect(cx: number, cz: number, dirX: number, dirZ: number, halfLen: number, halfWid: number): V2[] {
  const nx = -dirZ, nz = dirX;
  return [
    [cx - dirX * halfLen - nx * halfWid, cz - dirZ * halfLen - nz * halfWid],
    [cx + dirX * halfLen - nx * halfWid, cz + dirZ * halfLen - nz * halfWid],
    [cx + dirX * halfLen + nx * halfWid, cz + dirZ * halfLen + nz * halfWid],
    [cx - dirX * halfLen + nx * halfWid, cz - dirZ * halfLen + nz * halfWid],
  ];
}

/** Separating-axis overlap test for two convex polygons. */
export function convexOverlap(a: readonly V2[], b: readonly V2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      const nx = p2[1] - p1[1], nz = p1[0] - p2[0];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const p of a) { const d = p[0] * nx + p[1] * nz; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const p of b) { const d = p[0] * nx + p[1] * nz; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function segmentsIntersect(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** General (possibly concave) polygon overlap test. */
export function polygonsOverlap(a: readonly V2[], b: readonly V2[]): boolean {
  for (const p of a) if (pointInRing(p[0], p[1], b)) return true;
  for (const p of b) if (pointInRing(p[0], p[1], a)) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/** Minimum distance between segment ab and polygon ring (0 if they touch/overlap). */
export function segmentPolygonDistance(a: V2, b: V2, ring: readonly V2[]): number {
  if (pointInRing(a[0], a[1], ring) || pointInRing(b[0], b[1], ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (segmentsIntersect(a, b, p, q)) return 0;
    best = Math.min(
      best,
      closestOnSegment(p[0], p[1], a[0], a[1], b[0], b[1])[3],
      closestOnSegment(a[0], a[1], p[0], p[1], q[0], q[1])[3],
      closestOnSegment(b[0], b[1], p[0], p[1], q[0], q[1])[3],
    );
  }
  return Math.sqrt(best);
}
