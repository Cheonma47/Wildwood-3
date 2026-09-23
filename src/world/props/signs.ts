/**
 * Building signage — real names only.
 * Businesses from OpenStreetMap and Overture Maps are put on the building
 * whose footprint contains them (or the nearest one), on the facade facing
 * the street / Boardwalk. Several businesses in one building are spread along
 * its facade. Motels get a Doo-Wop style pole sign. Buildings with no known
 * business get no sign (nothing is invented).
 */
import * as THREE from 'three';
import type { Building, Poi } from '../data/types';
import { centroid, hash01, pointInRing, type V2 } from '../math/polygon';
import { SpatialGrid } from '../math/spatialGrid';
import { facadeFacing } from '../landmarks/landmarkUtils';
import type { WorldModel } from '../worldModel';

export interface Sign {
  x: number;
  y: number;
  z: number;
  /** yaw: plane +z faces this direction */
  yaw: number;
  w: number;
  h: number;
  text: string;
  kind: 'board' | 'neon' | 'pole';
  bg: string;
  fg: string;
}

const NEON = ['#ff4fa3', '#4fe3ff', '#ffe14f', '#7dff6a', '#ff7a3d', '#c77dff'];
const BOARD_BG = ['#b3261e', '#1b4f72', '#1e7d4b', '#6a1b9a', '#e0a100', '#263238', '#00838f'];

const SIGN_POI = new Set(['restaurant', 'cheap_food', 'shop', 'supermarket', 'convenience', 'pharmacy', 'laundromat', 'bank', 'lodging', 'attraction', 'venue', 'worship', 'civic', 'emergency']);

export function computeSigns(world: WorldModel): Sign[] {
  const signs: Sign[] = [];
  const grid = new SpatialGrid<Building>(40);
  for (const b of world.buildings) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of b.outer) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    grid.insert(b, { minX, minZ, maxX, maxZ });
  }
  const named = new Map<Building, Poi[]>();
  for (const p of world.data.pois) {
    if (!p.name || !SIGN_POI.has(p.cat)) continue;
    let host: Building | null = null;
    let best = 14;
    for (const b of grid.query(p.x - 14, p.z - 14, p.x + 14, p.z + 14)) {
      if (b.landmarkId) continue;
      if (pointInRing(p.x, p.z, b.outer)) { host = b; break; }
      const c = centroid(b.outer);
      const d = Math.hypot(c[0] - p.x, c[1] - p.z);
      if (d < best) { best = d; host = b; }
    }
    if (!host) continue;
    const list = named.get(host) ?? [];
    if (list.length < 6 && !list.some((q) => q.name.toLowerCase() === p.name.toLowerCase())) list.push(p);
    named.set(host, list);
  }

  const streetFacade = (b: Building) => {
    const c = centroid(b.outer);
    const n = world.roadIndex.nearest(c[0], c[1], 60, (s) => s.ref.drivable || s.ref.kind === 'pedestrian');
    let target: V2 = n ? [n.x, n.z] : c;
    if (b.style === 'boardwalk_shop' || world.distToBoardwalk(c[0], c[1]) < 25) {
      const e = world.boardwalkEdges.nearest(c[0], c[1], 60);
      if (e) target = [e.x, e.z];
    }
    return facadeFacing(b.outer, target);
  };

  // Only real names (OSM / Overture Maps). Buildings without a known business get no sign.
  for (const b of world.buildings) {
    if (b.landmarkId) continue;
    const list = named.get(b);
    if (!list?.length) continue;
    const f = streetFacade(b);
    if (!f || f.len < 3) continue;
    const r = hash01(b.seed + 91);
    // several businesses in one building (strip malls, Boardwalk rows): spread them along the facade
    const slot = f.len / list.length;
    list.forEach((poi, k) => {
      const text = poi.name.toUpperCase();
      const u = -f.len / 2 + slot * (k + 0.5);
      const cx = f.mid[0] + f.d[0] * u, cz = f.mid[1] + f.d[1] * u;
      const rk = hash01(b.seed + 91 + k * 17);
      if (poi.cat === 'lodging' && list.length === 1) {
        const px = f.mid[0] + f.n[0] * 4 + f.d[0] * (f.len / 2 - 1.5);
        const pz = f.mid[1] + f.n[1] * 4 + f.d[1] * (f.len / 2 - 1.5);
        const col = NEON[Math.floor(r * NEON.length)];
        signs.push({ x: px, y: world.groundAt(px, pz) + 6.2, z: pz, yaw: Math.atan2(f.d[0], f.d[1]), w: 3.6, h: 1.6, text, kind: 'pole', bg: '#101820', fg: col });
        const y = b.baseY + Math.min(b.height - 0.6, 5.5);
        signs.push({ x: cx + f.n[0] * 0.12, y, z: cz + f.n[1] * 0.12, yaw: f.yaw, w: Math.min(f.len * 0.6, 12), h: 1.1, text, kind: 'neon', bg: '#ffffff00', fg: col });
      } else {
        const w = Math.min(slot * 0.85, Math.max(2.5, text.length * 0.5));
        const y = b.baseY + Math.min(b.height - 0.7, 3.9);
        const bg = BOARD_BG[Math.floor(rk * BOARD_BG.length)];
        const neon = b.style === 'boardwalk_shop' || poi.cat === 'lodging';
        signs.push({ x: cx + f.n[0] * 0.14, y, z: cz + f.n[1] * 0.14, yaw: f.yaw, w, h: Math.min(0.95, w * 0.3), text, kind: neon ? 'neon' : 'board', bg, fg: neon ? NEON[Math.floor(rk * NEON.length)] : '#ffffff' });
      }
    });
  }
  return signs;
}

/** Texture atlas of all sign texts (one slot per unique text/style). */
export class SignAtlas {
  readonly texture: THREE.CanvasTexture;
  private slots = new Map<string, [number, number, number, number]>();
  private static COLS = 12;
  private static SW = 256;
  private static SH = 48;

  constructor(signs: Sign[]) {
    const keys = [...new Set(signs.map((s) => SignAtlas.key(s)))];
    const rows = Math.ceil(keys.length / SignAtlas.COLS);
    const W = SignAtlas.COLS * SignAtlas.SW, H = Math.max(64, Math.min(4096, rows * SignAtlas.SH));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const bySlot = new Map<string, Sign>();
    for (const s of signs) bySlot.set(SignAtlas.key(s), s);
    keys.forEach((k, i) => {
      const s = bySlot.get(k)!;
      const col = i % SignAtlas.COLS, row = Math.floor(i / SignAtlas.COLS);
      const x = col * SignAtlas.SW, y = row * SignAtlas.SH;
      if (y + SignAtlas.SH > H) return;
      const neon = s.kind !== 'board';
      if (s.bg.length <= 7) {
        ctx.fillStyle = s.bg;
        ctx.fillRect(x, y, SignAtlas.SW, SignAtlas.SH);
      }
      if (!neon) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 3, y + 3, SignAtlas.SW - 6, SignAtlas.SH - 6);
      }
      let size = 30;
      const font = neon ? '"Brush Script MT", "Segoe Script", cursive' : 'Arial Black, Arial, sans-serif';
      ctx.font = `bold ${size}px ${font}`;
      while (ctx.measureText(s.text).width > SignAtlas.SW - 16 && size > 11) {
        size -= 1;
        ctx.font = `bold ${size}px ${font}`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (neon) {
        ctx.shadowColor = s.fg;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = s.fg;
      ctx.fillText(s.text, x + SignAtlas.SW / 2, y + SignAtlas.SH / 2 + 2);
      ctx.shadowBlur = 0;
      this.slots.set(k, [x / W, 1 - (y + SignAtlas.SH) / H, (x + SignAtlas.SW) / W, 1 - y / H]);
    });
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  static key(s: Sign): string {
    return `${s.kind}|${s.bg}|${s.fg}|${s.text}`;
  }

  uv(s: Sign): [number, number, number, number] | undefined {
    return this.slots.get(SignAtlas.key(s));
  }
}
