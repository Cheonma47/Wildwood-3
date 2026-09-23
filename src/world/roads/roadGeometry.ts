/** Road, sidewalk, marking and flat-area meshes for one chunk. */
import * as THREE from 'three';
import type { Area, Road } from '../data/types';
import { GeoBuilder } from '../render/geometry';
import type { V2 } from '../math/polygon';
import { isMajor, SIDEWALK_WIDTH } from './roadStyle';
import { TerrainClass, type Terrain } from '../terrain/heightfield';

export interface RoadRun {
  road: Road;
  pts: V2[];
}

export interface RoadChunkGeometry {
  asphalt: THREE.BufferGeometry | null;
  sidewalk: THREE.BufferGeometry | null;
  markings: THREE.BufferGeometry | null;
  yellow: THREE.BufferGeometry | null;
  planks: THREE.BufferGeometry | null;
  parking: THREE.BufferGeometry | null;
}

const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track']);

export function buildRoadChunk(runs: RoadRun[], areas: Area[], terrain: Terrain, isOnDeck: (x: number, z: number) => boolean): RoadChunkGeometry {
  const asphalt = new GeoBuilder();
  const sidewalk = new GeoBuilder();
  const markings = new GeoBuilder();
  const yellow = new GeoBuilder();
  const planks = new GeoBuilder();
  const parking = new GeoBuilder();
  const yRoad = (x: number, z: number) => Math.max(terrain.heightAt(x, z), -0.35) + 0.05;
  const ySide = (x: number, z: number) => Math.max(terrain.heightAt(x, z), -0.35) + 0.04;

  for (const { road, pts } of runs) {
    const mid = pts[Math.floor(pts.length / 2)];
    const w = road.width;
    if (FOOT.has(road.kind)) {
      if (isOnDeck(mid[0], mid[1])) continue; // covered by the Boardwalk deck mesh
      const onSand = terrain.classAt(mid[0], mid[1]) === TerrainClass.Beach;
      (onSand ? planks : sidewalk).ribbon(pts, -w / 2, w / 2, 0, 2, undefined, onSand ? (x, z) => terrain.heightAt(x, z) + 0.06 : ySide);
      continue;
    }
    asphalt.ribbon(pts, -w / 2, w / 2, 0, 4, undefined, yRoad);
    if (road.hasSidewalk) {
      sidewalk.ribbon(pts, -w / 2 - SIDEWALK_WIDTH, -w / 2, 0, 2, undefined, ySide);
      sidewalk.ribbon(pts, w / 2, w / 2 + SIDEWALK_WIDTH, 0, 2, undefined, ySide);
    }
    if (isMajor(road.kind) && !road.oneway) {
      // double yellow centre line
      yellow.ribbon(pts, -0.2, -0.08, 0, 1, undefined, (x, z) => yRoad(x, z) + 0.01);
      yellow.ribbon(pts, 0.08, 0.2, 0, 1, undefined, (x, z) => yRoad(x, z) + 0.01);
    } else if (road.kind !== 'service' && road.drivable && w >= 8) {
      // white parking-lane edge lines
      markings.ribbon(pts, -w / 2 + 2.3, -w / 2 + 2.42, 0, 1, undefined, (x, z) => yRoad(x, z) + 0.01);
      markings.ribbon(pts, w / 2 - 2.42, w / 2 - 2.3, 0, 1, undefined, (x, z) => yRoad(x, z) + 0.01);
    }
  }

  for (const a of areas) {
    const y = Math.max(0, terrain.heightAt(a.outer[0][0], a.outer[0][1])) + 0.035;
    if (a.kind === 'parking') parking.flatPolygon(a.outer, a.holes, y, 4);
    else if (a.kind === 'plaza') sidewalk.flatPolygon(a.outer, a.holes, y, 2);
  }

  return {
    asphalt: asphalt.build(),
    sidewalk: sidewalk.build(),
    markings: markings.build(),
    yellow: yellow.build(),
    planks: planks.build(),
    parking: parking.build(),
  };
}

/** Splits every road polyline into runs of consecutive segments grouped by chunk. */
export function splitRoadsByChunk(roads: Road[], chunkOf: (x: number, z: number) => string): Map<string, RoadRun[]> {
  const out = new Map<string, RoadRun[]>();
  for (const road of roads) {
    let cur: V2[] = [road.pts[0]];
    let curKey: string | null = null;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const k = chunkOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (curKey !== null && k !== curKey) {
        push(curKey, cur);
        cur = [a];
      }
      curKey = k;
      cur.push(b);
    }
    if (curKey !== null) push(curKey, cur);
    function push(k: string, pts: V2[]) {
      if (pts.length < 2) return;
      let list = out.get(k);
      if (!list) out.set(k, (list = []));
      list.push({ road, pts });
    }
  }
  return out;
}
