/**
 * WorldModel: everything derived from the geographic data that the renderer,
 * physics, map and navigation need. Built once after loading.
 */
import { findLandmarkByBuilding } from '../data/wildwood/landmarks';
import { boardwalkCenterline, type CenterlineSample } from './boardwalk/centerline';
import { classifyOsmBuilding } from './buildings/classify';
import { generateProceduralBuildings } from './buildings/proceduralFill';
import { loadWorldData, type WorldData } from './data/loadWorld';
import type { Area, Building, Road } from './data/types';
import { bboxOf, centroid, pointInRing, type V2 } from './math/polygon';
import { SegmentIndex } from './math/segmentIndex';
import { Colliders } from './physics/collision';
import { buildWalkables, DECK_HEIGHT, type WalkableSurfaces } from './physics/walkable';
import { Terrain, TerrainClass } from './terrain/heightfield';
import { RoadGraph } from '../systems/navigation/roadGraph';

export const CHUNK_SIZE = 250;

export interface WorldModel {
  data: WorldData;
  terrain: Terrain;
  surfaces: WalkableSurfaces;
  boardwalks: Area[];
  decks: Area[];
  buildings: Building[];
  colliders: Colliders;
  roadIndex: SegmentIndex<Road>;
  boardwalkEdges: SegmentIndex<Area>;
  graph: RoadGraph;
  /** Centreline of the main Boardwalk, SW → NE. */
  boardwalkLine: CenterlineSample[];
  groundAt(x: number, z: number, maxY?: number): number;
  distToBoardwalk(x: number, z: number): number;
  isOnDeck(x: number, z: number): boolean;
  nearestStreet(x: number, z: number): { name: string; dist: number } | null;
  stats: { osmBuildings: number; proceduralBuildings: number; roads: number; buildMs: number };
}

let current: WorldModel | null = null;
export const getWorld = (): WorldModel => {
  if (!current) throw new Error('World not loaded');
  return current;
};

export function chunkKey(x: number, z: number): string {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}

export async function buildWorld(onProgress?: (msg: string) => void): Promise<WorldModel> {
  const data = await loadWorldData(onProgress);
  const t0 = performance.now();
  const tick = () => new Promise((r) => setTimeout(r, 0));

  onProgress?.('Rasterising coastline, beach and terrain…');
  await tick();
  const terrain = new Terrain(4);
  terrain.fill(data.water, TerrainClass.Water);
  for (const a of data.areas) {
    const rings = [a.outer, ...(a.holes ?? [])];
    if (a.kind === 'water' || a.kind === 'pool') continue;
    if (a.kind === 'wetland') terrain.fill(rings, TerrainClass.Wetland, [TerrainClass.Land]);
    else if (a.kind === 'park' || a.kind === 'pitch') terrain.fill(rings, TerrainClass.Grass, [TerrainClass.Land]);
    else if (a.kind === 'scrub') terrain.fill(rings, TerrainClass.Scrub, [TerrainClass.Land]);
  }
  for (const a of data.areas) if (a.kind === 'beach') terrain.fill([a.outer, ...(a.holes ?? [])], TerrainClass.Beach, [TerrainClass.Land, TerrainClass.Scrub, TerrainClass.Grass]);
  for (const a of data.areas) if (a.kind === 'water') terrain.fill([a.outer, ...(a.holes ?? [])], TerrainClass.Water);
  terrain.computeHeights();

  onProgress?.('Building Boardwalk decks and ramps…');
  await tick();
  const { surfaces, boardwalks, decks } = buildWalkables(data.areas, data.roads, terrain);
  const boardwalkEdges = new SegmentIndex<Area>(60);
  for (const b of boardwalks) boardwalkEdges.addPolyline(b.outer, b, true);
  const distToBoardwalk = (x: number, z: number) => boardwalkEdges.nearest(x, z, 800)?.dist ?? 9999;
  const isOnDeck = (x: number, z: number) => decks.some((d) => pointInRing(x, z, d.outer));

  const roadIndex = new SegmentIndex<Road>(40);
  for (const r of data.roads) roadIndex.addPolyline(r.pts, r);

  onProgress?.('Placing OSM building footprints…');
  await tick();
  const buildings: Building[] = [];
  const rawById = new Map(data.rawBuildings.map((b) => [b.id, b]));
  for (const [id, rings] of data.osmBuildingRings) {
    const raw = rawById.get(id)!;
    for (const ring of rings) {
      if (ring.outer.length < 3) continue;
      const c = centroid(ring.outer);
      const onDeck = isOnDeck(c[0], c[1]);
      const nearBw = distToBoardwalk(c[0], c[1]) < 60;
      const { style, height } = classifyOsmBuilding(raw, ring.outer, nearBw, onDeck);
      const landmark = findLandmarkByBuilding(id);
      const baseY = onDeck ? DECK_HEIGHT : Math.max(0, terrain.heightAt(c[0], c[1]));
      buildings.push({
        id, source: 'osm', type: raw.type, name: raw.name, outer: ring.outer, holes: ring.holes,
        height, baseY, style, amenity: raw.amenity, shop: raw.shop, tourism: raw.tourism,
        landmarkId: landmark?.id, seed: Math.abs(id) % 100000,
      });
    }
  }
  const osmCount = buildings.length;

  const mainBoardwalk = boardwalks.reduce<Area | null>((best, b) => (!best || b.outer.length > best.outer.length ? b : best), null);
  const boardwalkLine = mainBoardwalk ? boardwalkCenterline(mainBoardwalk.outer) : [];

  onProgress?.('Generating procedural buildings on real street frontage…');
  await tick();
  const procedural = generateProceduralBuildings({
    roads: data.roads, roadIndex, areas: data.areas, existing: buildings, terrain, distToBoardwalk, boardwalkLine,
    obstacles: surfaces.list.filter((s) => s.kind !== 'deck').map((s) => s.outer),
  });
  buildings.push(...procedural);

  onProgress?.('Building collision and navigation graph…');
  await tick();
  const colliders = new Colliders();
  for (const b of buildings) colliders.addBuilding(b);
  // Railings along the ocean edge of the deck are not collidable; the deck
  // edge itself acts as a step (walkable.ts).

  const graph = new RoadGraph(data.roads);
  if (boardwalkLine.length > 1) graph.addPolyline(boardwalkLine.map((s) => s.p), 30);

  const groundAt = (x: number, z: number, maxY = Infinity) => {
    const t = terrain.heightAt(x, z);
    const s = surfaces.highestAt(x, z, maxY).h;
    return s > t ? s : t;
  };

  const nearestStreet = (x: number, z: number) => {
    const n = roadIndex.nearest(x, z, 60, (s) => !!s.ref.name && (s.ref.drivable || s.ref.kind === 'pedestrian'));
    if (!n) {
      if (isOnDeck(x, z)) return { name: 'Wildwood Boardwalk', dist: 0 };
      const c = terrain.classAt(x, z);
      if (c === TerrainClass.Beach) return { name: 'Wildwood Beach', dist: 0 };
      if (c === TerrainClass.Water) return { name: 'Atlantic Ocean', dist: 0 };
      return null;
    }
    if (isOnDeck(x, z) && n.dist > 8) return { name: 'Wildwood Boardwalk', dist: 0 };
    if (terrain.classAt(x, z) === TerrainClass.Beach && n.dist > 25) return { name: 'Wildwood Beach', dist: 0 };
    return { name: n.seg.ref.name, dist: n.dist };
  };

  const buildMs = performance.now() - t0;
  current = {
    data, terrain, surfaces, boardwalks, decks, buildings, colliders, roadIndex, boardwalkEdges, graph, boardwalkLine,
    groundAt, distToBoardwalk, isOnDeck, nearestStreet,
    stats: { osmBuildings: osmCount, proceduralBuildings: procedural.length, roads: data.roads.length, buildMs },
  };
  return current;
}

/** Axis-aligned bounds of a polygon expressed in chunk indices. */
export function chunkOfPolygon(outer: V2[]): string {
  const b = bboxOf(outer);
  return chunkKey((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
}
