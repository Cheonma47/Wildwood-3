/**
 * Chunk-based world streaming.
 *
 * - Chunks are 250 m × 250 m (CHUNK_SIZE).
 * - "Base" content (terrain, roads, buildings) is built lazily for chunks
 *   within the draw distance and disposed when far away.
 * - "Detail" content (street furniture, parked cars, signs, textured facades)
 *   only exists for chunks near the player (LOD).
 * - Building is time-sliced (a few ms per frame) to avoid hitches.
 */
import * as THREE from 'three';
import { buildBuildingsChunk } from '../../world/buildings/buildingGeometry';
import { getMaterials, type Materials } from '../../world/render/materials';
import { GeoBuilder } from '../../world/render/geometry';
import { streetSignAtlas } from '../../world/render/textures';
import { buildRoadChunk } from '../../world/roads/roadGeometry';
import { buildTerrainChunk } from '../../world/terrain/terrainGeometry';
import { getPrototypes } from '../../world/props/prototypes';
import { CHUNK_SIZE, type WorldModel } from '../../world/worldModel';
import { ChunkIndex, type ChunkData, type PropInstance, type PropKind } from './chunkIndex';
import { SignAtlas } from '../../world/props/signs';
import { registerNightMaterial } from '../../world/render/materials';

interface LoadedChunk {
  data: ChunkData;
  base: THREE.Group;
  buildings: THREE.Mesh | null;
  detail: THREE.Group | null;
  lastSeen: number;
}

export interface ChunkStats {
  loaded: number;
  detailed: number;
  queued: number;
  total: number;
}

export class ChunkManager {
  readonly root = new THREE.Group();
  readonly index: ChunkIndex;
  private loaded = new Map<string, LoadedChunk>();
  private mats: Materials;
  private signAtlas: ReturnType<typeof streetSignAtlas>;
  private signMaterial: THREE.MeshStandardMaterial;
  private propMaterials: Record<string, THREE.Material>;
  drawDistance = 1100;
  detailDistance = 380;
  stats: ChunkStats = { loaded: 0, detailed: 0, queued: 0, total: 0 };
  private world: WorldModel;
  /** Coarse (32 m) terrain per chunk: simplified distant geometry shown while the detailed chunk is not loaded. */
  private coarse = new Map<string, THREE.Mesh>();
  private crosswalkMat: THREE.MeshStandardMaterial;
  private boardAtlas: SignAtlas;
  private neonMat: THREE.MeshStandardMaterial;
  private boardMat: THREE.MeshStandardMaterial;

  constructor(world: WorldModel) {
    this.world = world;
    this.root.name = 'chunks';
    this.index = new ChunkIndex(world);
    this.mats = getMaterials();
    this.signAtlas = streetSignAtlas(this.index.streetNames);
    this.signMaterial = new THREE.MeshStandardMaterial({ map: this.signAtlas.texture, roughness: 0.6 });
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.propMaterials = {
      vc,
      car: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.3 }),
      umbrella: new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.8 }),
      chair: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
      signal: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.6 }),
      wire: new THREE.LineBasicMaterial({ color: '#1d1d1d', transparent: true, opacity: 0.8 }),
    };
    this.boardAtlas = new SignAtlas(this.index.allBoards);
    const t = this.boardAtlas.texture;
    this.neonMat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.3, transparent: true, alphaTest: 0.05, side: THREE.FrontSide, roughness: 0.5 });
    this.boardMat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.05, roughness: 0.6 });
    registerNightMaterial(this.neonMat, 2.2);
    registerNightMaterial(this.boardMat, 0.7);
    this.crosswalkMat = this.mats.marking.clone();
    this.crosswalkMat.side = THREE.DoubleSide;
    this.stats.total = this.index.chunks.size;
    for (const c of this.index.chunks.values()) {
      const geo = buildTerrainChunk(world.terrain, c.minX, c.minZ, CHUNK_SIZE, 31.25);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mats.terrain);
      m.name = `coarse ${c.key}`;
      this.coarse.set(c.key, m);
      this.root.add(m);
    }
  }

  private chunkDistance(c: ChunkData, x: number, z: number): number {
    const dx = Math.max(c.minX - x, 0, x - (c.minX + CHUNK_SIZE));
    const dz = Math.max(c.minZ - z, 0, z - (c.minZ + CHUNK_SIZE));
    return Math.hypot(dx, dz);
  }

  /** Called every frame with the camera position. budgetMs limits build work. */
  update(x: number, z: number, budgetMs = 6): void {
    const t0 = performance.now();
    const want: { c: ChunkData; d: number }[] = [];
    for (const c of this.index.chunks.values()) {
      const d = this.chunkDistance(c, x, z);
      if (d <= this.drawDistance) want.push({ c, d });
    }
    want.sort((a, b) => a.d - b.d);
    let queued = 0;
    for (const { c, d } of want) {
      let lc = this.loaded.get(c.key);
      const needDetail = d <= this.detailDistance;
      if (!lc) {
        if (performance.now() - t0 > budgetMs) { queued++; continue; }
        lc = this.buildBase(c);
        this.loaded.set(c.key, lc);
        const cm = this.coarse.get(c.key);
        if (cm) cm.visible = false;
      }
      lc.lastSeen = performance.now();
      if (needDetail && !lc.detail) {
        if (performance.now() - t0 > budgetMs) { queued++; continue; }
        lc.detail = this.buildDetail(c);
        lc.base.add(lc.detail);
      } else if (!needDetail && lc.detail && d > this.detailDistance + 60) {
        this.disposeGroup(lc.detail);
        lc.base.remove(lc.detail);
        lc.detail = null;
      }
      if (lc.buildings) lc.buildings.material = d <= this.detailDistance + 150 ? this.mats.facade : this.mats.plainWall;
    }
    // unload far chunks
    for (const [k, lc] of this.loaded) {
      if (this.chunkDistance(lc.data, x, z) > this.drawDistance + 200) {
        this.disposeGroup(lc.base);
        this.root.remove(lc.base);
        this.loaded.delete(k);
        const cm = this.coarse.get(k);
        if (cm) cm.visible = true;
      }
    }
    let detailed = 0;
    for (const lc of this.loaded.values()) if (lc.detail) detailed++;
    this.stats = { loaded: this.loaded.size, detailed, queued, total: this.index.chunks.size };
  }

  /** Synchronously load everything around a point (initial spawn). */
  preload(x: number, z: number): void {
    this.update(x, z, 1e9);
  }

  private buildBase(c: ChunkData): LoadedChunk {
    const g = new THREE.Group();
    g.name = `chunk ${c.key}`;
    const w = this.world;
    const terrain = buildTerrainChunk(w.terrain, c.minX, c.minZ, CHUNK_SIZE, 8);
    if (terrain) {
      const m = new THREE.Mesh(terrain, this.mats.terrain);
      m.receiveShadow = true;
      g.add(m);
    }
    const roads = buildRoadChunk(c.roadRuns, c.areas, w.terrain, w.isOnDeck);
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadow = true) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = shadow;
      g.add(m);
    };
    add(roads.asphalt, this.mats.asphalt);
    add(roads.sidewalk, this.mats.sidewalk);
    add(roads.parking, this.mats.parking);
    add(roads.planks, this.mats.planks);
    add(roads.markings, this.mats.marking);
    add(roads.yellow, this.mats.markingYellow);
    const b = buildBuildingsChunk(c.buildings);
    let bm: THREE.Mesh | null = null;
    if (b.walls) {
      bm = new THREE.Mesh(b.walls, this.mats.facade);
      bm.castShadow = true;
      bm.receiveShadow = true;
      g.add(bm);
    }
    if (b.roofs) {
      const rm = new THREE.Mesh(b.roofs, this.mats.roof);
      rm.castShadow = true;
      g.add(rm);
    }
    this.root.add(g);
    return { data: c, base: g, buildings: bm, detail: null, lastSeen: performance.now() };
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: PropInstance[], colored = false): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot);
      s.setScalar(it.scale ?? 1);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
      if (colored) im.setColorAt(i, col.set(it.color ?? 0xffffff));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    return im;
  }

  private buildDetail(c: ChunkData): THREE.Group {
    const g = new THREE.Group();
    g.name = 'detail';
    const P = getPrototypes();
    const M = this.propMaterials;
    const mats = this.mats;
    const get = (k: PropKind) => c.props.get(k) ?? [];
    const addI = (geo: THREE.BufferGeometry, mat: THREE.Material, list: PropInstance[], colored = false, shadow = true) => {
      if (!list.length) return;
      const im = this.instanced(geo, mat, list, colored);
      im.castShadow = shadow;
      g.add(im);
    };
    addI(P.lampPole, M.vc, get('lamp'));
    addI(P.lampHead, mats.lampGlow, get('lamp'), false, false);
    addI(P.bwLampPole, M.vc, get('bwLamp'));
    addI(P.bwLampGlobe, mats.lampGlow, get('bwLamp'), false, false);
    addI(P.treeTrunk, M.vc, get('tree'));
    addI(P.treeCanopy, M.vc, get('tree'));
    addI(P.utilityPole, M.vc, get('pole'));
    addI(P.signalPole, M.vc, get('signal'));
    addI(P.signalLights, M.signal, get('signal'), false, false);
    addI(P.stopSign, M.vc, get('stop'));
    addI(P.signPole, M.vc, get('signPost'));
    addI(P.carBody, M.car, get('car'), true);
    addI(P.carGlass, M.glass, get('car'), false, false);
    addI(P.bench, M.vc, get('bench'));
    addI(P.trashCan, M.vc, get('trash'));
    addI(P.umbrellaPole, M.vc, get('umbrella'), false, false);
    addI(P.umbrellaTop, M.umbrella, get('umbrella'), true);
    addI(P.beachChair, M.chair, get('chair'), true, false);
    addI(P.lifeguard, M.vc, get('lifeguard'));

    if (c.wires.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(c.wires, 3));
      g.add(new THREE.LineSegments(geo, M.wire));
    }

    // Street name signs: posts + blades textured from the atlas
    if (c.signs.length) {
      addI(P.signPost, M.vc, c.signs.map((s) => ({ x: s.x, y: this.world.groundAt(s.x, s.z), z: s.z, rot: 0 })));
      const gb = new GeoBuilder();
      for (const s of c.signs) {
        for (const b of s.blades) {
          const r = this.signAtlas.rectOf.get(b.name);
          if (!r) continue;
          const [u0, v0, u1, v1] = r;
          const ca = Math.cos(b.angle), sa = -Math.sin(b.angle);
          const L = 1.0, H = 0.2;
          const px = (u: number) => [s.x + ca * u, s.z + sa * u];
          const [ax, az] = px(-L / 2), [bx, bz] = px(L / 2);
          // front (reads left→right) and back faces
          gb.quad([[ax, b.y, az], [ax, b.y + H, az], [bx, b.y + H, bz], [bx, b.y, bz]], [[u1, v0], [u1, v1], [u0, v1], [u0, v0]]);
          gb.quad([[bx, b.y, bz], [bx, b.y + H, bz], [ax, b.y + H, az], [ax, b.y, az]], [[u1, v0], [u1, v1], [u0, v1], [u0, v0]]);
        }
      }
      const geo = gb.build();
      if (geo) g.add(new THREE.Mesh(geo, this.signMaterial));
    }

    // Business / motel signs from the atlas
    if (c.boards.length) {
      const neon = new GeoBuilder(), board = new GeoBuilder();
      for (const s of c.boards) {
        const uv = this.boardAtlas.uv(s);
        if (!uv) continue;
        const [u0, v0, u1, v1] = uv;
        const Xx = Math.cos(s.yaw), Xz = -Math.sin(s.yaw);
        const hw = s.w / 2, y0 = s.y - s.h / 2, y1 = s.y + s.h / 2;
        const L = [s.x - Xx * hw, s.z - Xz * hw], R = [s.x + Xx * hw, s.z + Xz * hw];
        const gb = s.kind === 'board' ? board : neon;
        gb.quad([[R[0], y0, R[1]], [R[0], y1, R[1]], [L[0], y1, L[1]], [L[0], y0, L[1]]], [[u1, v0], [u1, v1], [u0, v1], [u0, v0]]);
        if (s.kind === 'pole') {
          gb.quad([[L[0], y0, L[1]], [L[0], y1, L[1]], [R[0], y1, R[1]], [R[0], y0, R[1]]], [[u1, v0], [u1, v1], [u0, v1], [u0, v0]]);
        }
      }
      const ng = neon.build(), bg = board.build();
      if (ng) g.add(new THREE.Mesh(ng, this.neonMat));
      if (bg) g.add(new THREE.Mesh(bg, this.boardMat));
    }

    // Crosswalk stripes (continental style)
    if (c.crosswalks.length) {
      const gb = new GeoBuilder();
      for (const cw of c.crosswalks) {
        const nx = -cw.dirZ, nz = cw.dirX;
        for (let o = -cw.width / 2 + 0.4; o < cw.width / 2 - 0.3; o += 1.1) {
          const cx = cw.x + nx * o, cz = cw.z + nz * o;
          const hx = cw.dirX * 1.5, hz = cw.dirZ * 1.5; // 3 m long stripes along the road
          const wx = nx * 0.25, wz = nz * 0.25;
          gb.quad(
            [[cx - hx - wx, cw.y, cz - hz - wz], [cx - hx + wx, cw.y, cz - hz + wz], [cx + hx + wx, cw.y, cz + hz + wz], [cx + hx - wx, cw.y, cz + hz - wz]],
            [[0, 0], [0, 1], [1, 1], [1, 0]],
          );
        }
      }
      const geo = gb.build();
      if (geo) g.add(new THREE.Mesh(geo, this.crosswalkMat));
    }
    return g;
  }

  private disposeGroup(g: THREE.Object3D): void {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !isShared(m.geometry)) m.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  }
}

const sharedGeos = new WeakSet<THREE.BufferGeometry>();
function isShared(g: THREE.BufferGeometry): boolean {
  if (sharedGeos.has(g)) return true;
  const P = getPrototypes();
  for (const v of Object.values(P)) sharedGeos.add(v);
  return sharedGeos.has(g);
}
