/**
 * Lightweight ambient traffic: cars follow the real OSM drivable network,
 * keep right, respect one-way streets, pause at stop signs and signals,
 * and brake for the player. Low density, only near the player.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { telemetry } from '../../store/gameStore';
import { hash01, type V2 } from '../../world/math/polygon';
import { getPrototypes } from '../../world/props/prototypes';
import type { WorldModel } from '../../world/worldModel';

interface Edge {
  from: number;
  to: number;
  pts: V2[];
  len: number;
  cum: number[];
  speed: number;
}

interface Car {
  edge: Edge;
  s: number;
  v: number;
  wait: number;
  color: THREE.Color;
}

const COUNT = 36;
const SPEED_LIMIT = 11; // 25 mph

function buildNetwork(world: WorldModel) {
  const out = new Map<number, Edge[]>();
  const add = (e: Edge) => {
    let l = out.get(e.from);
    if (!l) out.set(e.from, (l = []));
    l.push(e);
  };
  for (const r of world.data.roads) {
    if (!r.drivable || r.kind === 'service' || r.pts.length < 2) continue;
    // split at every node that is shared (we simply use whole way between its end nodes, and at interior junction nodes)
    const make = (pts: V2[], from: number, to: number): Edge => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { from, to, pts, len: cum[cum.length - 1], cum, speed: r.kind === 'residential' ? SPEED_LIMIT * 0.85 : SPEED_LIMIT };
    };
    add(make(r.pts, r.nodes[0], r.nodes[r.nodes.length - 1]));
    if (!r.oneway) add(make([...r.pts].reverse(), r.nodes[r.nodes.length - 1], r.nodes[0]));
  }
  return out;
}

export function Traffic({ world }: { world: WorldModel }) {
  const P = getPrototypes();
  const net = useMemo(() => buildNetwork(world), [world]);
  const allEdges = useMemo(() => [...net.values()].flat().filter((e) => e.len > 20), [net]);
  const signals = useMemo(() => {
    const s: V2[] = [];
    for (const p of world.data.points) if (p.kind === 'signal' || p.kind === 'stop') s.push([p.x, p.z]);
    return s;
  }, [world]);
  const cars = useMemo<Car[]>(() => [], []);
  const { bodyMesh, glassMesh } = useMemo(() => {
    const bodyMesh = new THREE.InstancedMesh(P.carBody, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }), COUNT);
    const glassMesh = new THREE.InstancedMesh(P.carGlass, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.3 }), COUNT);
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < COUNT; i++) bodyMesh.setColorAt(i, white);
    for (const m of [bodyMesh, glassMesh]) { m.frustumCulled = false; m.castShadow = true; }
    return { bodyMesh, glassMesh };
  }, [P]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0) }), []);
  const colors = useMemo(() => [0xf2f2f2, 0x1c1c1c, 0x9aa0a6, 0x2b4d7e, 0x8c1c1c, 0xd9d9d9, 0x1e5b3a, 0xe0c060].map((c) => new THREE.Color(c)), []);

  const spawn = (px: number, pz: number): Car | null => {
    for (let tries = 0; tries < 30; tries++) {
      const e = allEdges[Math.floor(Math.random() * allEdges.length)];
      const s = Math.random() * e.len;
      const p = pointAt(e, s);
      const d = Math.hypot(p[0] - px, p[1] - pz);
      if (d > 90 && d < 550) return { edge: e, s, v: e.speed * 0.8, wait: 0, color: colors[Math.floor(Math.random() * colors.length)] };
    }
    return null;
  };

  const time = useRef(0);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    time.current += dt;
    const px = telemetry.x, pz = telemetry.z;
    while (cars.length < COUNT) {
      const c = spawn(px, pz);
      if (!c) break;
      cars.push(c);
    }
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const pos = pointAt(c.edge, c.s);
      if (Math.hypot(pos[0] - px, pos[1] - pz) > 750) {
        const n = spawn(px, pz);
        if (n) cars[i] = n;
        continue;
      }
      if (c.wait > 0) {
        c.wait -= dt;
        c.v = 0;
      } else {
        let target = c.edge.speed;
        // brake for the player standing in the lane ahead
        const ahead = pointAt(c.edge, c.s + 8);
        if (Math.hypot(ahead[0] - px, ahead[1] - pz) < 4 && telemetry.y < 0.5) target = 0;
        // slow near the end of an edge (intersection)
        const remain = c.edge.len - c.s;
        if (remain < 18) target = Math.min(target, 4 + remain * 0.3);
        c.v += (target - c.v) * Math.min(1, dt * 1.5);
        c.s += c.v * dt;
      }
      if (c.s >= c.edge.len) {
        const nexts = (net.get(c.edge.to) ?? []).filter((e) => e.to !== c.edge.from || (net.get(c.edge.to)?.length ?? 0) === 1);
        if (!nexts.length) {
          const n = spawn(px, pz);
          if (n) cars[i] = n;
          continue;
        }
        const next = nexts[Math.floor(Math.random() * nexts.length)];
        const end = c.edge.pts[c.edge.pts.length - 1];
        const sig = signals.find((s) => Math.hypot(s[0] - end[0], s[1] - end[1]) < 14);
        if (sig) {
          // signals/stop signs: brief stop; signals use a per-node cycle
          const h = hash01(Math.floor(sig[0] * 10) ^ Math.floor(sig[1] * 10));
          const cycle = (time.current + h * 40) % 40;
          const dir = next.pts[1] ? Math.abs(next.pts[1][0] - next.pts[0][0]) > Math.abs(next.pts[1][1] - next.pts[0][1]) : true;
          const green = dir ? cycle < 18 : cycle >= 20 && cycle < 38;
          c.wait = green ? 0.3 : dir ? 40 - cycle : Math.max(0.5, 20 - cycle);
          c.wait = Math.min(c.wait, 12);
        }
        c.s -= c.edge.len;
        c.edge = next;
      }
    }
    const b = bodyMesh, g = glassMesh;
    for (let i = 0; i < COUNT; i++) {
      const c = cars[i];
      if (!c) {
        tmp.m.makeScale(0, 0, 0);
        b.setMatrixAt(i, tmp.m);
        g.setMatrixAt(i, tmp.m);
        continue;
      }
      const p = pointAt(c.edge, c.s);
      const q = pointAt(c.edge, Math.min(c.edge.len, c.s + 1.5));
      let dx = q[0] - p[0], dz = q[1] - p[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // keep right: offset 2.2 m to the right of travel direction
      const rx = -dz, rz = dx;
      const x = p[0] + rx * 2.2, z = p[1] + rz * 2.2;
      const y = world.groundAt(x, z) + 0.05;
      tmp.q.setFromAxisAngle(tmp.up, Math.atan2(-dz, dx));
      tmp.p.set(x, y, z);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      b.setMatrixAt(i, tmp.m);
      g.setMatrixAt(i, tmp.m);
      b.setColorAt(i, c.color);
    }
    b.instanceMatrix.needsUpdate = true;
    g.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
  });

  return (
    <group name="traffic">
      <primitive object={bodyMesh} />
      <primitive object={glassMesh} />
    </group>
  );
}

function pointAt(e: Edge, s: number): V2 {
  if (s <= 0) return e.pts[0];
  if (s >= e.len) return e.pts[e.pts.length - 1];
  let i = 1;
  while (i < e.cum.length && e.cum[i] < s) i++;
  const t = (s - e.cum[i - 1]) / (e.cum[i] - e.cum[i - 1] || 1);
  const a = e.pts[i - 1], b = e.pts[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export { pointAt };
