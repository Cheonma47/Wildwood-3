/**
 * Ambient pedestrians (no AI): Boardwalk crowds walking up and down the real
 * Boardwalk centreline, people on nearby sidewalks, and beach visitors.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { telemetry } from '../../store/gameStore';
import { rng, type V2 } from '../../world/math/polygon';
import { DECK_HEIGHT } from '../../world/physics/walkable';
import { getPrototypes } from '../../world/props/prototypes';
import { TerrainClass } from '../../world/terrain/heightfield';
import type { WorldModel } from '../../world/worldModel';

interface Walker {
  path: V2[];
  cum: number[];
  s: number;
  dir: 1 | -1;
  speed: number;
  lateral: number;
  y: number | null; // fixed height (deck) or null = ground
  color: THREE.Color;
  still: boolean;
  rot: number;
}

const SHIRTS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ffffff', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#212121', '#90caf9', '#a5d6a7'];

function cumulative(path: V2[]): number[] {
  const c = [0];
  for (let i = 1; i < path.length; i++) c.push(c[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return c;
}

function at(path: V2[], cum: number[], s: number): [number, number, number, number] {
  const L = cum[cum.length - 1];
  s = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = path[i - 1], b = path[i];
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [a[0] + dx * t, a[1] + dz * t, dx / l, dz / l];
}

export function Pedestrians({ world }: { world: WorldModel }) {
  const P = getPrototypes();
  const walkers = useMemo<Walker[]>(() => {
    const r = rng(2024);
    const out: Walker[] = [];
    const bw = world.boardwalkLine.map((s) => s.p);
    if (bw.length > 2) {
      const cum = cumulative(bw);
      const L = cum[cum.length - 1];
      for (let i = 0; i < 320; i++) {
        const width = world.boardwalkLine[Math.floor(r() * world.boardwalkLine.length)].width;
        out.push({
          path: bw, cum, s: r() * L, dir: r() < 0.5 ? 1 : -1, speed: 0.9 + r() * 0.6,
          lateral: (r() - 0.5) * Math.max(4, width - 3), y: DECK_HEIGHT,
          color: new THREE.Color(SHIRTS[Math.floor(r() * SHIRTS.length)]), still: r() < 0.12, rot: 0,
        });
      }
      // beach visitors (standing/sitting still), seaward of the boardwalk
      for (let i = 0; i < 260; i++) {
        const k = Math.floor(r() * world.boardwalkLine.length);
        const sm = world.boardwalkLine[k];
        const ox = sm.ocean[0] - sm.p[0], oz = sm.ocean[1] - sm.p[1];
        const ol = Math.hypot(ox, oz) || 1;
        const t = 60 + r() * 240;
        const x = sm.ocean[0] + (ox / ol) * t, z = sm.ocean[1] + (oz / ol) * t;
        if (world.terrain.classAt(x, z) !== TerrainClass.Beach || world.isOnDeck(x, z)) continue;
        out.push({ path: [[x, z], [x + 0.01, z]], cum: [0, 0.01], s: 0, dir: 1, speed: 0, lateral: 0, y: null, color: new THREE.Color(SHIRTS[Math.floor(r() * SHIRTS.length)]), still: true, rot: r() * 6.28 });
      }
    }
    // sidewalk walkers along named streets
    const streets = world.data.roads.filter((rd) => rd.hasSidewalk && rd.pts.length >= 2);
    for (let i = 0; i < 220 && streets.length; i++) {
      const rd = streets[Math.floor(r() * streets.length)];
      const cum = cumulative(rd.pts);
      if (cum[cum.length - 1] < 40) continue;
      const side = r() < 0.5 ? -1 : 1;
      out.push({
        path: rd.pts, cum, s: r() * cum[cum.length - 1], dir: r() < 0.5 ? 1 : -1, speed: 1.1 + r() * 0.4,
        lateral: side * (rd.width / 2 + 1.0), y: null, color: new THREE.Color(SHIRTS[Math.floor(r() * SHIRTS.length)]), still: false, rot: 0,
      });
    }
    return out;
  }, [world]);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(P.person, new THREE.MeshStandardMaterial({ roughness: 0.8 }), walkers.length);
    walkers.forEach((w, i) => m.setColorAt(i, w.color));
    m.frustumCulled = false;
    m.castShadow = true;
    return m;
  }, [P, walkers]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0) }), []);
  const clock = useRef(0);
  useFrame((_, dt) => {
    const m = mesh;
    clock.current += dt;
    const px = telemetry.x, pz = telemetry.z;
    let n = 0; // visible instances are packed at the front; mesh.count limits the draw
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      if (!w.still) {
        w.s += w.speed * w.dir * Math.min(dt, 0.1);
        const L = w.cum[w.cum.length - 1];
        if (w.s > L) { w.s = L; w.dir = -1; }
        if (w.s < 0) { w.s = 0; w.dir = 1; }
      }
      const [x0, z0, dx, dz] = at(w.path, w.cum, w.s);
      const x = x0 - dz * w.lateral, z = z0 + dx * w.lateral;
      if (Math.hypot(x - px, z - pz) > 450) continue;
      const y = w.y ?? world.groundAt(x, z);
      const bob = w.still ? 0 : Math.abs(Math.sin(clock.current * 6 * w.speed + i)) * 0.04;
      const rot = w.still ? w.rot : Math.atan2(-(dz * w.dir), dx * w.dir) - Math.PI / 2;
      tmp.q.setFromAxisAngle(tmp.up, rot);
      tmp.p.set(x, y + bob, z);
      const h = 0.92 + ((i * 7919) % 100) / 100 * 0.16;
      tmp.s.set(1, h, 1);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      m.setMatrixAt(n, tmp.m);
      m.setColorAt(n, w.color);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
