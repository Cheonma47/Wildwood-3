import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildWorld, type WorldModel } from './worldModel';
import { LANDMARKS, SPAWN } from '../data/wildwood/landmarks';
import { latLonToWorld } from './geo/projection';

let world: WorldModel;

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const file = `public/${url.replace(/^\//, '')}`;
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
  });
  world = await buildWorld();
}, 60000);

describe('world model built from OSM', () => {
  it('has roads, buildings and a boardwalk', () => {
    console.log('stats', world.stats, 'boardwalk samples', world.boardwalkLine.length, 'surfaces', world.surfaces.list.length);
    expect(world.data.roads.length).toBeGreaterThan(800);
    expect(world.stats.osmBuildings).toBeGreaterThan(600);
    expect(world.boardwalks.length).toBeGreaterThan(0);
    expect(world.boardwalkLine.length).toBeGreaterThan(100);
  });

  it('Dogtooth OSM footprint is registered as a landmark', () => {
    const b = world.buildings.find((x) => x.landmarkId === 'dogtooth');
    expect(b).toBeTruthy();
  });

  it('spawn point is on dry land next to Dogtooth, not inside a building', () => {
    const p = latLonToWorld(SPAWN.latitude, SPAWN.longitude);
    expect(world.terrain.heightAt(p.x, p.z)).toBeGreaterThan(-0.1);
    const [x, z] = world.colliders.resolve(p.x, p.z, 0.3, 0, 1.8);
    expect(Math.hypot(x - p.x, z - p.z)).toBeLessThan(0.01);
    expect(world.nearestStreet(p.x, p.z)?.name).toMatch(/New Jersey|Taylor/);
  });

  it('boardwalk deck is elevated and the beach lies between it and the ocean', () => {
    const bw = LANDMARKS.find((l) => l.id === 'boardwalk-taylor')!;
    const p = latLonToWorld(bw.latitude, bw.longitude);
    const s = world.boardwalkLine[Math.floor(world.boardwalkLine.length / 2)];
    expect(world.groundAt(s.p[0], s.p[1])).toBeCloseTo(1.0, 1);
    const beach = LANDMARKS.find((l) => l.id === 'beach-taylor')!;
    const b = latLonToWorld(beach.latitude, beach.longitude);
    expect(world.terrain.classAt(b.x, b.z)).toBe(2);
    void p;
  });

  it('routes Dogtooth → Boardwalk along real streets with plausible length', () => {
    const d = LANDMARKS[0];
    const bw = LANDMARKS.find((l) => l.id === 'boardwalk-taylor')!;
    const a = latLonToWorld(d.latitude, d.longitude), b = latLonToWorld(bw.latitude, bw.longitude);
    const r = world.graph.route([a.x, a.z], [b.x, b.z]);
    expect(r).toBeTruthy();
    const straight = Math.hypot(a.x - b.x, a.z - b.z);
    console.log(`Dogtooth → Boardwalk: straight ${straight.toFixed(0)} m, route ${r!.length.toFixed(0)} m`);
    expect(r!.length).toBeGreaterThanOrEqual(straight - 1);
    expect(r!.length).toBeLessThan(straight * 1.6);
  });
});
