/** Merged building meshes (walls with facade atlas + roofs) for one chunk. */
import * as THREE from 'three';
import type { Building, BuildingStyle } from '../data/types';
import { GeoBuilder } from '../render/geometry';
import { hash01, pointInRing, type V2 } from '../math/polygon';

const PALETTES: Record<BuildingStyle, string[]> = {
  house: ['#f4f1ea', '#e9e2d0', '#c9d8e4', '#d8d4c8', '#f1e3b5', '#bcc9c0', '#e4d0c0', '#9fb8c8', '#ffffff'],
  motel: ['#7fd1d8', '#f6a6c1', '#fbe38a', '#ffffff', '#9fd6a9', '#f9c28b', '#b7c9f2', '#f5f0e0'],
  apartment: ['#e8e1d3', '#d3c7b4', '#f0ece2', '#c7d1d9', '#e7d7c1', '#ffffff'],
  commercial: ['#d9cfbf', '#b85b4b', '#e6e0d4', '#c8b79d', '#9ea7ae', '#ffffff'],
  shop: ['#f0e6d2', '#c05a4a', '#6aa6b8', '#f3d27a', '#ffffff', '#88b27a'],
  restaurant: ['#c9513f', '#f2e8d6', '#3f6f8f', '#f0c66b', '#ffffff'],
  boardwalk_shop: ['#ff6f61', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#ffffff', '#f8961e', '#90be6d'],
  civic: ['#d8d2c4', '#bfb6a5', '#e8e4da'],
  garage: ['#bdb8ad', '#9a958b'],
  industrial: ['#a9a9a4'],
};

const ROOF_COLORS = ['#5b5d61', '#6e6258', '#4c5563', '#7a7f85', '#8a5a44', '#3f4a3c'];
const FLAT_ROOF = ['#8d8f91', '#a3a19c', '#77797b', '#b4b1aa'];

const TILE: Record<BuildingStyle, number> = {
  house: 0, motel: 1, apartment: 2, commercial: 2, civic: 2, industrial: 2, garage: 2,
  shop: 3, restaurant: 3, boardwalk_shop: 3,
};

export function buildingColor(b: Building): THREE.Color {
  const p = PALETTES[b.style] ?? PALETTES.commercial;
  return new THREE.Color(p[Math.floor(hash01(b.seed + 17) * p.length)]);
}

/** Ensure the left-hand normal of each edge points outward. */
function outwardRing(ring: V2[]): V2[] {
  const a = ring[0], b = ring[1];
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const l = Math.hypot(ex, ez) || 1;
  const nx = ez / l, nz = -ex / l; // left normal (see geometry.ts)
  const mx = (a[0] + b[0]) / 2 + nx * 0.05, mz = (a[1] + b[1]) / 2 + nz * 0.05;
  return pointInRing(mx, mz, ring) ? [...ring].reverse() : ring;
}

const FLOOR = 3.1;
const BAY = 3.4;

export function buildBuildingsChunk(buildings: Building[]): { walls: THREE.BufferGeometry | null; roofs: THREE.BufferGeometry | null } {
  const walls = new GeoBuilder({ color: true, extra: true });
  const roofs = new GeoBuilder({ color: true });

  for (const b of buildings) {
    if (b.landmarkId) continue; // custom landmark renderer
    const color = buildingColor(b);
    const ring = outwardRing(b.outer);
    const y0 = b.baseY - 0.3, y1 = b.baseY + b.height;
    const groundBand = (b.style === 'shop' || b.style === 'restaurant' || b.style === 'boardwalk_shop') ? Math.min(3.8, b.height) : 0;
    const tile = TILE[b.style] ?? 2;
    const upperTile = groundBand ? 2 : tile;
    const floorsTop = (y1 - b.baseY - groundBand) / FLOOR;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      const bays = Math.max(1, Math.round(len / BAY));
      if (groundBand) {
        walls.quad(
          [[p[0], y0, p[1]], [p[0], b.baseY + groundBand, p[1]], [q[0], b.baseY + groundBand, q[1]], [q[0], y0, q[1]]],
          [[0, 0], [0, 1], [bays, 1], [bays, 0]], color, 3,
        );
        if (b.height > groundBand + 0.3) {
          walls.quad(
            [[p[0], b.baseY + groundBand, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [q[0], b.baseY + groundBand, q[1]]],
            [[0, 0], [0, floorsTop], [bays, floorsTop], [bays, 0]], color, upperTile,
          );
        }
      } else {
        const floors = (y1 - b.baseY) / FLOOR;
        walls.quad(
          [[p[0], y0, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [q[0], y0, q[1]]],
          [[0, -0.3 / FLOOR], [0, floors], [bays, floors], [bays, -0.3 / FLOOR]], color, b.style === 'garage' ? 2 : tile,
        );
      }
    }

    // Roofs
    const pitched = ring.length === 4 && (b.style === 'house' || (b.source === 'osm' && b.type === 'house'));
    if (pitched) {
      gableRoof(walls, roofs, ring, y1, color, new THREE.Color(ROOF_COLORS[Math.floor(hash01(b.seed) * ROOF_COLORS.length)]), hash01(b.seed + 3) < 0.5);
    } else {
      const rc = new THREE.Color(FLAT_ROOF[Math.floor(hash01(b.seed) * FLAT_ROOF.length)]);
      roofs.flatPolygon(ring, b.holes, y1, 4, rc);
      // parapet cap
      if (b.style !== 'house') {
        const cap = color.clone().multiplyScalar(0.85);
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          roofs.quad([[p[0], y1, p[1]], [p[0], y1 + 0.5, p[1]], [q[0], y1 + 0.5, q[1]], [q[0], y1, q[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], cap);
        }
      }
    }
  }
  return { walls: walls.build(), roofs: roofs.build() };
}

function gableRoof(walls: GeoBuilder, roofs: GeoBuilder, ring: V2[], y: number, wallColor: THREE.Color, roofColor: THREE.Color, alongFirst: boolean) {
  // ring has 4 corners; choose ridge along edge 0→1 (or 1→2)
  const r = alongFirst ? ring : [ring[1], ring[2], ring[3], ring[0]];
  const [a, b, c, d] = r; // a→b and d→c are the long sides (eaves), b→c, d→a gables
  const w = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const rise = Math.min(4, w * 0.35);
  const m1: V2 = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2];
  const m2: V2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const yr = y + rise;
  const o = 0.4; // overhang
  const ov = (p: V2, m: V2): V2 => {
    const dx = p[0] - m[0], dz = p[1] - m[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] + (dx / l) * o, p[1] + (dz / l) * o];
  };
  const A = ov(a, m1), B = ov(b, m2), C = ov(c, m2), D = ov(d, m1);
  const ylow = y - o * (rise / (w / 2));
  // slope 1 (a-b side)
  roofs.quad([[A[0], ylow, A[1]], [m1[0], yr, m1[1]], [m2[0], yr, m2[1]], [B[0], ylow, B[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], roofColor);
  // slope 2 (c-d side)
  roofs.quad([[C[0], ylow, C[1]], [m2[0], yr, m2[1]], [m1[0], yr, m1[1]], [D[0], ylow, D[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], roofColor);
  // gable triangles (wall colour)
  const tri = (p: V2, q: V2, m: V2) => {
    const n = walls.vertexCount;
    const ex = q[0] - p[0], ez = q[1] - p[1];
    const l = Math.hypot(ex, ez) || 1;
    const nx = ez / l, nz = -ex / l;
    walls.vertex(p[0], y, p[1], nx, 0, nz, 0.5, 0.95, wallColor, 2);
    walls.vertex(m[0], yr, m[1], nx, 0, nz, 0.5, 0.95, wallColor, 2);
    walls.vertex(q[0], y, q[1], nx, 0, nz, 0.5, 0.95, wallColor, 2);
    walls.tri(n, n + 1, n + 2);
  };
  tri(b, c, m2);
  tri(d, a, m1);
  // make the roof visible from below too (cheap: duplicate reversed)
  void 0;
}
