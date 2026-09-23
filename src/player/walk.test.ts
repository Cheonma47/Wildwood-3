/**
 * Integration test: physically walk the player from Dogtooth to the Boardwalk
 * along the planned route at normal walking speed, using the real physics
 * (collision, ramps, step-up). Verifies accessibility and real-time duration.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildWorld, type WorldModel } from '../world/worldModel';
import { LANDMARKS, SPAWN } from '../data/wildwood/landmarks';
import { latLonToWorld } from '../world/geo/projection';
import { PlayerPhysics } from './PlayerPhysics';
import { DECK_HEIGHT } from '../world/physics/walkable';

let world: WorldModel;
beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(`public/${url.replace(/^\//, '')}`, 'utf8')) }));
  world = await buildWorld();
}, 60000);

function walkRoute(player: PlayerPhysics, pts: [number, number][], maxSeconds: number) {
  const dt = 1 / 60;
  let t = 0, k = 1, stuck = 0, lastX = player.x, lastZ = player.z;
  while (k < pts.length && t < maxSeconds) {
    const [tx, tz] = pts[k];
    const dx = tx - player.x, dz = tz - player.z;
    if (Math.hypot(dx, dz) < 1.2) { k++; continue; }
    const yaw = Math.atan2(-dx, -dz); // forward = (-sin yaw, -cos yaw)
    player.step(dt, yaw, { forward: 1, right: 0, run: false, fast: false, jump: false });
    t += dt;
    if (Math.floor(t) !== Math.floor(t - dt)) {
      if (Math.hypot(player.x - lastX, player.z - lastZ) < 0.3) stuck++;
      else stuck = 0;
      lastX = player.x; lastZ = player.z;
      if (stuck > 5) break;
    }
  }
  return { t, reached: k >= pts.length, k };
}

describe('walking at real scale', () => {
  it('walks from the Dogtooth spawn to the Boardwalk deck in real time (~8 min at 1.4 m/s)', () => {
    const s = latLonToWorld(SPAWN.latitude, SPAWN.longitude);
    const player = new PlayerPhysics(world, s.x, s.z);
    const bw = LANDMARKS.find((l) => l.id === 'boardwalk-taylor')!;
    const b = latLonToWorld(bw.latitude, bw.longitude);
    // a point 6 m onto the deck
    const target: [number, number] = [b.x + 4.2, b.z + 4.2];
    const r = world.graph.route([s.x, s.z], target)!;
    const res = walkRoute(player, r.points as [number, number][], 1200);
    console.log(`route ${r.length.toFixed(0)} m, walked in ${res.t.toFixed(0)} s (${(res.t / 60).toFixed(1)} min), reached=${res.reached}, final y=${player.y.toFixed(2)}`);
    expect(res.reached).toBe(true);
    expect(player.y).toBeCloseTo(DECK_HEIGHT, 1);
    // real time: distance / 1.4 m/s (+ small acceleration / corner overhead)
    expect(res.t).toBeGreaterThan(r.length / 1.45);
    expect(res.t).toBeLessThan(r.length / 1.25);
  });

  it('buildings block the player', () => {
    const d = world.buildings.find((b) => b.landmarkId === 'dogtooth')!;
    const c = d.outer.reduce((a, p) => [a[0] + p[0] / d.outer.length, a[1] + p[1] / d.outer.length], [0, 0]);
    const s = latLonToWorld(SPAWN.latitude, SPAWN.longitude);
    const player = new PlayerPhysics(world, s.x, s.z);
    walkRoute(player, [[s.x, s.z], [c[0], c[1]]], 60);
    const inside = world.colliders.resolve(player.x, player.z, 0.29, 0.2, 1.5);
    // must stop at the wall, never end up at the centroid
    expect(Math.hypot(player.x - c[0], player.z - c[1])).toBeGreaterThan(2);
    expect(Math.hypot(inside[0] - player.x, inside[1] - player.z)).toBeLessThan(0.05);
  });

  it('can get down to the beach and walk to the water', () => {
    const bw = LANDMARKS.find((l) => l.id === 'beach-taylor')!;
    const b = latLonToWorld(bw.latitude, bw.longitude);
    const player = new PlayerPhysics(world, b.x, b.z);
    // walk SE towards the ocean for up to 6 minutes
    const far: [number, number] = [b.x + 400, b.z + 400];
    walkRoute(player, [[b.x, b.z], far], 360);
    expect(player.y).toBeLessThan(-0.2); // reached the wet sand / shallow water
  });
});
