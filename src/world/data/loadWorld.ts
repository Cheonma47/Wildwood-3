/**
 * Loads the preprocessed OSM data (public/data/wildwood/*.json) and projects
 * every coordinate from lat/lon into world metres.
 */
import { latLonToWorld } from '../geo/projection';
import { openRing, type V2 } from '../math/polygon';
import { hasSidewalks, isDrivable, roadWidth } from '../roads/roadStyle';
import type {
  Area, Line, PointFeature, Poi, RawArea, RawBuilding, RawLine, RawPoi, RawPoint, RawRoad, Road,
} from './types';

export interface WorldData {
  roads: Road[];
  rawBuildings: RawBuilding[];
  osmBuildingRings: Map<number, { outer: V2[]; holes?: V2[][] }[]>;
  areas: Area[];
  lines: Line[];
  water: V2[][];
  pois: Poi[];
  points: PointFeature[];
  meta: { source: string; generated: string; counts: Record<string, number> };
}

export function projectFlat(flat: number[]): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const p = latLonToWorld(flat[i], flat[i + 1]);
    out.push([p.x, p.z]);
  }
  return out;
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/wildwood/${name}.json`);
  if (!res.ok) throw new Error(`Failed to load ${name}.json (${res.status})`);
  return res.json() as Promise<T>;
}

export async function loadWorldData(onProgress?: (msg: string) => void): Promise<WorldData> {
  onProgress?.('Downloading OpenStreetMap data…');
  const [rawRoads, rawBuildings, rawAreas, rawLines, rawWater, rawPois, rawPoints, meta] = await Promise.all([
    getJson<RawRoad[]>('roads'),
    getJson<RawBuilding[]>('buildings'),
    getJson<RawArea[]>('areas'),
    getJson<RawLine[]>('lines'),
    getJson<number[][]>('water'),
    getJson<RawPoi[]>('pois'),
    getJson<RawPoint[]>('points'),
    getJson<WorldData['meta']>('meta'),
  ]);
  onProgress?.('Projecting coordinates to local metres…');

  const roads: Road[] = rawRoads.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    oneway: !!r.oneway,
    width: roadWidth(r.kind, r.lanes, r.service),
    drivable: isDrivable(r.kind),
    hasSidewalk: hasSidewalks(r.kind, r.name),
    nodes: r.nodes,
    pts: projectFlat(r.pts),
    surface: r.surface,
  }));

  const osmBuildingRings = new Map<number, { outer: V2[]; holes?: V2[][] }[]>();
  for (const b of rawBuildings) {
    const list = osmBuildingRings.get(b.id) ?? [];
    list.push({ outer: openRing(projectFlat(b.pts)), holes: b.holes?.map((h) => openRing(projectFlat(h))) });
    osmBuildingRings.set(b.id, list);
  }

  const areas: Area[] = rawAreas.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    outer: openRing(projectFlat(a.pts)),
    holes: a.holes?.map((h) => openRing(projectFlat(h))),
  }));

  const lines: Line[] = rawLines.map((l) => ({ id: l.id, kind: l.kind, name: l.name, pts: projectFlat(l.pts) }));
  const water = rawWater.map((w) => openRing(projectFlat(w)));
  const pois: Poi[] = rawPois.map((p) => {
    const w = latLonToWorld(p.lat, p.lon);
    return { ...p, x: w.x, z: w.z };
  });
  const points: PointFeature[] = rawPoints.map((p) => {
    const w = latLonToWorld(p.lat, p.lon);
    return { kind: p.kind, name: p.name, x: w.x, z: w.z };
  });

  return { roads, rawBuildings, osmBuildingRings, areas, lines, water, pois, points, meta };
}
