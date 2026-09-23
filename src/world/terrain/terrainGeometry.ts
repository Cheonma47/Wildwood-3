/** Terrain mesh for one chunk, sampled from the terrain raster. */
import * as THREE from 'three';
import { GeoBuilder } from '../render/geometry';
import { TerrainClass, type Terrain } from './heightfield';

const COLORS: Record<number, THREE.Color> = {
  [TerrainClass.Land]: new THREE.Color('#9aa37a'),
  [TerrainClass.Water]: new THREE.Color('#b8a47a'),
  [TerrainClass.Beach]: new THREE.Color('#ead9ad'),
  [TerrainClass.Wetland]: new THREE.Color('#77875a'),
  [TerrainClass.Grass]: new THREE.Color('#7ea65a'),
  [TerrainClass.Scrub]: new THREE.Color('#8f9a62'),
};
const WET_SAND = new THREE.Color('#bda878');

export function buildTerrainChunk(terrain: Terrain, x0: number, z0: number, size: number, step: number): THREE.BufferGeometry | null {
  const g = new GeoBuilder({ color: true });
  const n = Math.round(size / step);
  const c = new THREE.Color();
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const h = terrain.heightAt(x, z);
      const cls = terrain.classAt(x, z);
      c.copy(COLORS[cls] ?? COLORS[0]);
      if (cls === TerrainClass.Beach || cls === TerrainClass.Water) {
        // darker wet sand close to / below the waterline
        const wet = Math.min(1, Math.max(0, (-h - 0.2) / 0.6));
        c.lerp(WET_SAND, wet);
      } else if (h < -0.15) {
        c.lerp(WET_SAND, Math.min(1, -h));
      }
      // finite-difference normal
      const hx = terrain.heightAt(x + 1, z) - terrain.heightAt(x - 1, z);
      const hz = terrain.heightAt(x, z + 1) - terrain.heightAt(x, z - 1);
      const nl = Math.hypot(hx, 2, hz);
      g.vertex(x, h, z, -hx / nl, 2 / nl, -hz / nl, x / 6, -z / 6, c);
    }
  }
  const row = n + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
      g.tri(a, d, b);
      g.tri(b, d, e);
    }
  }
  return g.build();
}
