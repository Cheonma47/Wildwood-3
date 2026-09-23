/**
 * Buckets every world feature into 250 m × 250 m chunks and pre-computes
 * deterministic prop placements (lamps, parked cars, poles, beach items…).
 */
import type { Area, Building, PointFeature, Road } from '../../world/data/types';
import { DATA_RECT } from '../../world/geo/coordinates';
import { centroid, hash01, pointInRing, rng, type V2 } from '../../world/math/polygon';
import { SpatialGrid } from '../../world/math/spatialGrid';
import { splitRoadsByChunk, type RoadRun } from '../../world/roads/roadGeometry';
import { shortStreetName, SIDEWALK_WIDTH } from '../../world/roads/roadStyle';
import { TerrainClass } from '../../world/terrain/heightfield';
import { DECK_HEIGHT } from '../../world/physics/walkable';
import { CHUNK_SIZE, chunkKey, type WorldModel } from '../../world/worldModel';
import { computeSigns, type Sign } from '../../world/props/signs';

export interface PropInstance {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale?: number;
  color?: number;
}

export type PropKind =
  | 'lamp' | 'bwLamp' | 'tree' | 'pole' | 'signal' | 'stop' | 'car' | 'bench' | 'trash'
  | 'umbrella' | 'chair' | 'lifeguard' | 'signPost' | 'bike';

export interface StreetSign {
  x: number;
  z: number;
  blades: { name: string; angle: number; y: number }[];
}

export interface Crosswalk {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  width: number;
  y: number;
}

export interface ChunkData {
  key: string;
  ix: number;
  iz: number;
  minX: number;
  minZ: number;
  buildings: Building[];
  roadRuns: RoadRun[];
  areas: Area[];
  props: Map<PropKind, PropInstance[]>;
  wires: number[]; // flat xyz pairs for LineSegments
  signs: StreetSign[];
  crosswalks: Crosswalk[];
  boards: Sign[];
}

const CAR_COLORS = [0xf2f2f2, 0x1c1c1c, 0x9aa0a6, 0x2b4d7e, 0x8c1c1c, 0xd9d9d9, 0x4a4f55, 0x1e5b3a, 0xc9a86a, 0x5a2e6e];

export class ChunkIndex {
  readonly chunks = new Map<string, ChunkData>();
  readonly streetNames: string[];
  readonly allBoards: Sign[];

  constructor(world: WorldModel) {
    const get = (key: string): ChunkData => {
      let c = this.chunks.get(key);
      if (!c) {
        const [ix, iz] = key.split(',').map(Number);
        c = {
          key, ix, iz, minX: ix * CHUNK_SIZE, minZ: iz * CHUNK_SIZE,
          buildings: [], roadRuns: [], areas: [], props: new Map(), wires: [], signs: [], crosswalks: [], boards: [],
        };
        this.chunks.set(key, c);
      }
      return c;
    };
    // ensure every chunk in the data rect exists (terrain)
    for (let x = DATA_RECT.minX; x < DATA_RECT.maxX + CHUNK_SIZE; x += CHUNK_SIZE) {
      for (let z = DATA_RECT.minZ; z < DATA_RECT.maxZ + CHUNK_SIZE; z += CHUNK_SIZE) get(chunkKey(Math.min(x, DATA_RECT.maxX), Math.min(z, DATA_RECT.maxZ)));
    }
    const addProp = (kind: PropKind, p: PropInstance) => {
      const c = get(chunkKey(p.x, p.z));
      let l = c.props.get(kind);
      if (!l) c.props.set(kind, (l = []));
      l.push(p);
    };

    for (const b of world.buildings) {
      const c = centroid(b.outer);
      get(chunkKey(c[0], c[1])).buildings.push(b);
    }
    for (const [k, runs] of splitRoadsByChunk(world.data.roads, chunkKey)) get(k).roadRuns.push(...runs);
    for (const a of world.data.areas) {
      if (a.kind !== 'parking' && a.kind !== 'plaza') continue;
      const c = centroid(a.outer);
      get(chunkKey(c[0], c[1])).areas.push(a);
    }

    // Building footprint grid to keep props out of buildings
    const bgrid = new SpatialGrid<Building>(30);
    for (const b of world.buildings) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const p of b.outer) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
      bgrid.insert(b, { minX, minZ, maxX, maxZ });
    }
    const inBuilding = (x: number, z: number, r = 0.6) =>
      bgrid.query(x - r, z - r, x + r, z + r).some((b) => pointInRing(x, z, b.outer));
    const ground = (x: number, z: number) => world.groundAt(x, z);
    /** True if (x,z) lies on any drivable carriageway (+margin). Keeps props off the streets. */
    const onRoad = (x: number, z: number, margin = 0.4) => {
      for (const sgm of world.roadIndex.query(x, z, 12)) {
        if (!sgm.ref.drivable) continue;
        const dx = sgm.bx - sgm.ax, dz = sgm.bz - sgm.az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - sgm.ax) * dx + (z - sgm.az) * dz) / l2));
        const d = Math.hypot(x - (sgm.ax + dx * t), z - (sgm.az + dz * t));
        if (d < sgm.ref.width / 2 + margin) return true;
      }
      return false;
    };

    // ---- intersections (node degree) for signs / parked-car gaps
    const nodeRoads = new Map<number, { road: Road; i: number }[]>();
    for (const r of world.data.roads) {
      if (!r.drivable) continue;
      r.nodes.forEach((n, i) => {
        let l = nodeRoads.get(n);
        if (!l) nodeRoads.set(n, (l = []));
        l.push({ road: r, i });
      });
    }
    const junctions = new SpatialGrid<V2>(40);
    const names = new Set<string>();
    for (const [, list] of nodeRoads) {
      if (list.length < 2) continue;
      const { road, i } = list[0];
      const p = road.pts[i];
      junctions.insert(p, { minX: p[0], minZ: p[1], maxX: p[0], maxZ: p[1] });
      // street name sign when ≥2 different named streets meet
      const named = new Map<string, { road: Road; i: number }>();
      for (const e of list) if (e.road.name && e.road.kind !== 'service') named.set(e.road.name, e);
      if (named.size >= 2) {
        const entries = [...named.values()].slice(0, 2);
        const dirOf = (e: { road: Road; i: number }): V2 => {
          const a = e.road.pts[Math.max(0, e.i - 1)], b = e.road.pts[Math.min(e.road.pts.length - 1, e.i + 1)];
          const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
          return [dx / l, dz / l];
        };
        const d1 = dirOf(entries[0]), d2 = dirOf(entries[1]);
        const w1 = entries[0].road.width, w2 = entries[1].road.width;
        // corner: offset along both roads' normals
        const n1: V2 = [-d1[1], d1[0]], n2: V2 = [-d2[1], d2[0]];
        const off1 = w2 / 2 + SIDEWALK_WIDTH * 0.6, off2 = w1 / 2 + SIDEWALK_WIDTH * 0.6;
        let sx = p[0] + d1[0] * off1 + d2[0] * off2, sz = p[1] + d1[1] * off1 + d2[1] * off2;
        if (inBuilding(sx, sz) || onRoad(sx, sz, 0.2)) { sx = p[0] - n1[0] * off2 - n2[0] * off1; sz = p[1] - n1[1] * off2 - n2[1] * off1; }
        if (onRoad(sx, sz, 0.1)) continue;
        const ang = (d: V2) => Math.atan2(-d[1], d[0]);
        const y = ground(sx, sz);
        get(chunkKey(sx, sz)).signs.push({
          x: sx, z: sz,
          blades: [
            { name: shortStreetName(entries[0].road.name).toUpperCase(), angle: ang(d1), y: y + 2.95 },
            { name: shortStreetName(entries[1].road.name).toUpperCase(), angle: ang(d2), y: y + 3.2 },
          ],
        });
        names.add(shortStreetName(entries[0].road.name).toUpperCase());
        names.add(shortStreetName(entries[1].road.name).toUpperCase());
      }
    }
    this.streetNames = [...names].sort();
    const nearJunction = (x: number, z: number, r: number) =>
      junctions.query(x - r, z - r, x + r, z + r).some((j) => Math.hypot(j[0] - x, j[1] - z) < r);

    // ---- street lamps, utility poles, parked cars along roads
    for (const road of world.data.roads) {
      if (!road.drivable || road.kind === 'service' || !road.name) continue;
      const rand = rng(road.id * 7 + 1);
      const w = road.width;
      let lampAcc = rand() * 30, poleAcc = rand() * 38, carAcc = 0;
      let lampSide = 1;
      const poleSide = hash01(road.id) < 0.5 ? -1 : 1;
      let lastPole: [number, number, number] | null = null;
      for (let i = 1; i < road.pts.length; i++) {
        const a = road.pts[i - 1], b = road.pts[i];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.1) continue;
        const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
        for (let t = 0; t < len; t += 1) {
          const x = a[0] + ux * t, z = a[1] + uz * t;
          lampAcc += 1; poleAcc += 1; carAcc += 1;
          if (lampAcc >= 36) {
            const px = x + nx * lampSide * (w / 2 + 0.5), pz = z + nz * lampSide * (w / 2 + 0.5);
            if (!inBuilding(px, pz) && !onRoad(px, pz, 0.2) && world.terrain.classAt(px, pz) !== TerrainClass.Water && !world.isOnDeck(px, pz)) {
              addProp('lamp', { x: px, y: ground(px, pz), z: pz, rot: Math.atan2(nz * lampSide, -nx * lampSide) });
              lampAcc = 0;
              lampSide = -lampSide;
            }
          }
          if (poleAcc >= 40 && road.hasSidewalk) {
            const off = w / 2 + SIDEWALK_WIDTH + 0.35;
            const px = x + nx * poleSide * off, pz = z + nz * poleSide * off;
            if (!inBuilding(px, pz, 0.8) && !onRoad(px, pz, 0.6) && world.terrain.classAt(px, pz) === TerrainClass.Land && !nearJunction(px, pz, 6) && !world.isOnDeck(px, pz)) {
              const y = ground(px, pz);
              addProp('pole', { x: px, y, z: pz, rot: Math.atan2(-uz, ux) + Math.PI / 2 });
              if (lastPole && Math.hypot(lastPole[0] - px, lastPole[2] - pz) < 60) {
                const c = get(chunkKey(px, pz));
                for (const [h, o] of [[9.95, -1.0], [9.95, 1.0], [9.95, 0], [8.2, 0.2]] as const) {
                  const ox = -uz * o, oz = ux * o;
                  c.wires.push(lastPole[0] + ox, lastPole[1] + h, lastPole[2] + oz, px + ox, y + h, pz + oz);
                }
              }
              lastPole = [px, y, pz];
              poleAcc = 0;
            }
          }
          if (carAcc >= 6.6 && w >= 8 && road.kind !== 'primary') {
            carAcc = 0;
            if (rand() < 0.42 && t > 8 && t < len - 8 && !nearJunction(x, z, 13)) {
              const side = rand() < 0.5 ? -1 : 1;
              const px = x + nx * side * (w / 2 - 1.25), pz = z + nz * side * (w / 2 - 1.25);
              if (!world.isOnDeck(px, pz)) {
                const heading = side > 0 ? Math.atan2(-uz, ux) : Math.atan2(uz, -ux);
                addProp('car', { x: px, y: ground(px, pz) + 0.02, z: pz, rot: heading, color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)] });
              }
            }
          }
        }
      }
    }

    // ---- OSM point features
    for (const p of world.data.points) {
      const y = ground(p.x, p.z);
      if ((p.kind === 'tree' || p.kind === 'pole') && onRoad(p.x, p.z, 0.3)) continue;
      if (p.kind === 'tree') addProp('tree', { x: p.x, y, z: p.z, rot: hash01(Math.floor(p.x * 13)) * 6.28, scale: 0.8 + hash01(Math.floor(p.z * 7)) * 0.5 });
      else if (p.kind === 'pole' && !inBuilding(p.x, p.z)) addProp('pole', { x: p.x, y, z: p.z, rot: 0 });
      else if (p.kind === 'bike_parking') for (let k = 0; k < 4; k++) addProp('bike', { x: p.x + k * 0.7, y, z: p.z, rot: Math.PI / 2 });
      else if (p.kind === 'signal' || p.kind === 'stop' || p.kind === 'crossing') this.placeRoadside(world, p, (k, pr) => { if (!onRoad(pr.x, pr.z, 0.2)) addProp(k, pr); }, get);
    }

    // ---- trees scattered in parks
    for (const a of world.data.areas) {
      if (a.kind !== 'park') continue;
      const r = rng(a.id);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const p of a.outer) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
      const n = Math.min(60, Math.floor(((maxX - minX) * (maxZ - minZ)) / 400));
      for (let i = 0; i < n; i++) {
        const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ);
        if (!pointInRing(x, z, a.outer) || inBuilding(x, z, 2) || onRoad(x, z, 1.5)) continue;
        addProp('tree', { x, y: ground(x, z), z, rot: r() * 6.28, scale: 0.7 + r() * 0.6 });
      }
    }

    // ---- business / motel signage
    this.allBoards = computeSigns(world);
    for (const b of this.allBoards) {
      get(chunkKey(b.x, b.z)).boards.push(b);
      if (b.kind === 'pole') addProp('signPost', { x: b.x, y: b.y - 6.2, z: b.z, rot: b.yaw });
    }

    // ---- boardwalk furniture and beach items
    const line = world.boardwalkLine;
    const r = rng(99);
    for (let i = 0; i < line.length; i++) {
      const s = line[i];
      const next = line[Math.min(line.length - 1, i + 1)], prev = line[Math.max(0, i - 1)];
      let ux = next.p[0] - prev.p[0], uz = next.p[1] - prev.p[1];
      const l = Math.hypot(ux, uz) || 1;
      ux /= l; uz /= l;
      const ox = s.ocean[0] - s.p[0], oz = s.ocean[1] - s.p[1];
      const ol = Math.hypot(ox, oz) || 1;
      const onx = ox / ol, onz = oz / ol; // towards ocean
      const along = Math.atan2(-uz, ux);
      if (i % 4 === 0) {
        for (const side of [-1, 1]) {
          const d = s.width / 2 - 0.8;
          addProp('bwLamp', { x: s.p[0] + onx * d * side, y: DECK_HEIGHT, z: s.p[1] + onz * d * side, rot: 0 });
        }
      }
      if (i % 3 === 1) {
        const d = s.width / 2 - 1.3;
        addProp('bench', { x: s.p[0] + onx * d, y: DECK_HEIGHT, z: s.p[1] + onz * d, rot: along + Math.PI });
      }
      if (i % 14 === 7) {
        // bike rack on the inland edge of the deck: 3–5 parked bicycles
        const d = -(s.width / 2 - 1.1);
        const n = 3 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          addProp('bike', { x: s.p[0] + onx * d + ux * (k * 0.7 - n * 0.35), y: DECK_HEIGHT, z: s.p[1] + onz * d + uz * (k * 0.7 - n * 0.35), rot: Math.atan2(onz, -onx) + Math.PI / 2, color: 0 });
        }
      }
      if (i % 5 === 2) {
        const d = s.width / 2 - 1.0;
        addProp('trash', { x: s.p[0] + onx * d + ux * 2, y: DECK_HEIGHT, z: s.p[1] + onz * d + uz * 2, rot: 0 });
      }
      // beach: march towards the ocean to find the water line
      if (i % 2 === 0) {
        let wl = -1;
        for (let t = 5; t < 700; t += 4) {
          const x = s.ocean[0] + onx * t, z = s.ocean[1] + onz * t;
          const c = world.terrain.classAt(x, z);
          if (c === TerrainClass.Water || world.terrain.heightAt(x, z) < -0.5) { wl = t; break; }
        }
        if (wl < 40) continue;
        const pt = (t: number, lat = 0): [number, number] => [s.ocean[0] + onx * t + ux * lat, s.ocean[1] + onz * t + uz * lat];
        const onDeck = (x: number, z: number) => world.isOnDeck(x, z);
        if (i % 18 === 0) {
          const [x, z] = pt(wl - 22);
          if (!onDeck(x, z)) addProp('lifeguard', { x, y: world.terrain.heightAt(x, z), z, rot: Math.atan2(onz, -onx) + Math.PI / 2 });
        }
        // umbrellas + chairs clustered in the wetter half nearer the water (as on real Wildwood beach days)
        const count = Math.floor(r() * 3);
        for (let k = 0; k < count; k++) {
          const t = wl * (0.45 + r() * 0.42), lat = (r() - 0.5) * 14;
          const [x, z] = pt(t, lat);
          if (onDeck(x, z) || world.terrain.classAt(x, z) !== TerrainClass.Beach) continue;
          const y = world.terrain.heightAt(x, z);
          addProp('umbrella', { x, y, z, rot: r() * 6.28, color: [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xff7043, 0xffffff][Math.floor(r() * 6)] });
          addProp('chair', { x: x + onx * 1.2, y, z: z + onz * 1.2, rot: Math.atan2(onz, -onx) + Math.PI / 2, color: [0x1e88e5, 0xffffff, 0xfdd835][Math.floor(r() * 3)] });
        }
      }
    }
  }

  private placeRoadside(world: WorldModel, p: PointFeature, addProp: (k: PropKind, p: PropInstance) => void, get: (k: string) => ChunkData) {
    const n = world.roadIndex.nearest(p.x, p.z, 15, (s) => s.ref.drivable);
    if (!n) return;
    const road = n.seg.ref;
    let ux = n.seg.bx - n.seg.ax, uz = n.seg.bz - n.seg.az;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    const nx = -uz, nz = ux;
    const y = world.groundAt(p.x, p.z);
    if (p.kind === 'signal') {
      const off = road.width / 2 + 1.0;
      const x = n.x + nx * off - ux * 3, z = n.z + nz * off - uz * 3;
      // arm (local +x) points across the road (towards -normal)
      addProp('signal', { x, y: world.groundAt(x, z), z, rot: Math.atan2(nz, -nx) });
      get(chunkKey(p.x, p.z)).crosswalks.push({ x: n.x - ux * 6, z: n.z - uz * 6, dirX: ux, dirZ: uz, width: road.width, y: y + 0.07 });
    } else if (p.kind === 'stop') {
      const off = road.width / 2 + 0.7;
      const x = p.x + nx * off, z = p.z + nz * off;
      addProp('stop', { x, y: world.groundAt(x, z), z, rot: Math.atan2(-uz, ux) + Math.PI / 2 });
    } else {
      get(chunkKey(p.x, p.z)).crosswalks.push({ x: n.x, z: n.z, dirX: ux, dirZ: uz, width: road.width, y: y + 0.07 });
    }
  }
}
