/**
 * First-person player physics in real units (metres, seconds).
 *
 * - Walk 1.4 m/s, fast walk 2.0 m/s, run 4.5 m/s (see distance.ts).
 * - Gravity 9.81 m/s², small jump (~0.45 m).
 * - Step-up up to 0.45 m (curbs, stairs, ramps); higher edges block.
 * - Circle-vs-wall collision against building footprints.
 * - Cannot wade deeper than ~0.8 m into the ocean or leave the map bounds.
 */
import { FAST_WALK_SPEED, RUN_SPEED, WALK_SPEED } from '../world/geo/distance';
import { PLAYABLE_RECT } from '../world/geo/coordinates';
import { SEA_LEVEL, TerrainClass } from '../world/terrain/heightfield';
import type { WorldModel } from '../world/worldModel';

export const EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.3;
export const STEP_HEIGHT = 0.45;
const GRAVITY = 9.81;
const JUMP_SPEED = 3.0;
const MAX_WADE_DEPTH = 0.8;

export interface MoveInput {
  forward: number; // -1..1
  right: number; // -1..1
  run: boolean;
  fast: boolean;
  jump: boolean;
}

export class PlayerPhysics {
  x: number;
  z: number;
  /** feet height */
  y: number;
  vy = 0;
  vx = 0;
  vz = 0;
  grounded = true;
  /** smoothed visual feet height (for stairs) */
  visualY: number;
  bobPhase = 0;
  stepDistance = 0;
  private world: WorldModel;

  constructor(world: WorldModel, x: number, z: number) {
    this.world = world;
    this.x = x;
    this.z = z;
    this.y = world.groundAt(x, z);
    this.visualY = this.y;
  }

  teleport(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.y = this.world.groundAt(x, z);
    this.visualY = this.y;
    this.vx = this.vz = this.vy = 0;
  }

  targetSpeed(input: MoveInput): number {
    return input.run ? RUN_SPEED : input.fast ? FAST_WALK_SPEED : WALK_SPEED;
  }

  /** Advances the simulation. yaw: camera yaw (0 = north). Returns metres travelled horizontally. */
  step(dt: number, yaw: number, input: MoveInput): number {
    dt = Math.min(dt, 0.1);
    const w = this.world;
    // desired horizontal velocity in world space
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // forward
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // right
    let dx = fx * input.forward + rx * input.right;
    let dz = fz * input.forward + rz * input.right;
    const l = Math.hypot(dx, dz);
    if (l > 1) { dx /= l; dz /= l; }
    const speed = this.targetSpeed(input);
    const tvx = dx * speed, tvz = dz * speed;
    // smooth acceleration (snappy on ground, weak in air)
    const accel = this.grounded ? 10 : 2;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (tvx - this.vx) * k;
    this.vz += (tvz - this.vz) * k;

    // horizontal move in sub-steps of ≤ 0.2 m
    const total = Math.hypot(this.vx, this.vz) * dt;
    const n = Math.max(1, Math.ceil(total / 0.2));
    const sx = (this.vx * dt) / n, sz = (this.vz * dt) / n;
    const startX = this.x, startZ = this.z;
    for (let i = 0; i < n; i++) {
      this.tryMove(sx, sz);
    }

    // vertical
    if (input.jump && this.grounded) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }
    this.vy -= GRAVITY * dt;
    this.y += this.vy * dt;
    const g = w.groundAt(this.x, this.z, this.y + STEP_HEIGHT);
    if (this.y <= g) {
      this.y = g;
      this.vy = 0;
      this.grounded = true;
    } else if (this.y - g < 0.06 && this.vy <= 0) {
      this.y = g;
      this.vy = 0;
      this.grounded = true;
    } else if (this.grounded && this.y - g < STEP_HEIGHT + 0.05 && this.vy <= 0) {
      // walking down stairs / curbs: stick to the ground
      this.y = g;
      this.vy = 0;
    } else {
      this.grounded = false;
    }
    // smooth camera for step-ups
    const vk = 1 - Math.exp(-18 * dt);
    this.visualY += (this.y - this.visualY) * vk;
    if (Math.abs(this.y - this.visualY) > 1.2) this.visualY = this.y;

    const moved = Math.hypot(this.x - startX, this.z - startZ);
    if (this.grounded) {
      this.bobPhase += moved * 1.9;
      this.stepDistance += moved;
    }
    return moved;
  }

  private tryMove(sx: number, sz: number): void {
    const w = this.world;
    const attempt = (nx: number, nz: number): boolean => {
      // map bounds
      if (nx < PLAYABLE_RECT.minX || nx > PLAYABLE_RECT.maxX || nz < PLAYABLE_RECT.minZ || nz > PLAYABLE_RECT.maxZ) return false;
      const g = w.groundAt(nx, nz, this.y + STEP_HEIGHT);
      // edge higher than a step blocks
      const gAll = w.groundAt(nx, nz);
      if (gAll > this.y + STEP_HEIGHT && gAll - g > 0.01) return false;
      // too deep water
      if (w.terrain.classAt(nx, nz) === TerrainClass.Water || g < SEA_LEVEL) {
        if (SEA_LEVEL - g > MAX_WADE_DEPTH) return false;
      }
      const [cx, cz] = w.colliders.resolve(nx, nz, PLAYER_RADIUS, this.y + 0.1, this.y + 1.8);
      if (Math.hypot(cx - nx, cz - nz) > 0.5) return false;
      // resolved position must itself be valid
      const g2 = w.groundAt(cx, cz);
      if (g2 > this.y + STEP_HEIGHT && g2 - w.groundAt(cx, cz, this.y + STEP_HEIGHT) > 0.01) return false;
      this.x = cx;
      this.z = cz;
      return true;
    };
    if (attempt(this.x + sx, this.z + sz)) return;
    // slide along axes
    if (Math.abs(sx) > 1e-5 && attempt(this.x + sx, this.z)) return;
    if (Math.abs(sz) > 1e-5) attempt(this.x, this.z + sz);
  }

  surface(): 'street' | 'boardwalk' | 'sand' | 'grass' | 'water' {
    const w = this.world;
    if (w.isOnDeck(this.x, this.z) && this.y > 0.6) return 'boardwalk';
    const c = w.terrain.classAt(this.x, this.z);
    if (this.y < SEA_LEVEL + 0.05) return 'water';
    if (c === TerrainClass.Beach) return 'sand';
    const road = w.roadIndex.nearest(this.x, this.z, 8);
    if (road && road.dist < road.seg.ref.width / 2 + 2.2) return 'street';
    if (c === TerrainClass.Grass || c === TerrainClass.Scrub || c === TerrainClass.Land) return 'grass';
    return 'street';
  }
}

export { WALK_SPEED, FAST_WALK_SPEED, RUN_SPEED };
