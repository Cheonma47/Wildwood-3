/**
 * A small pool of real point lights that follows the player at night and
 * sits on the nearest street/boardwalk lamps (emissive heads light the rest).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ChunkManager } from '../../systems/chunks/chunkManager';
import { telemetry } from '../../store/gameStore';
import { nightUniform } from '../render/materials';
import { CHUNK_SIZE } from '../worldModel';

const POOL = 10;

export function LampLights({ manager }: { manager: ChunkManager }) {
  const group = useRef<THREE.Group>(null);
  const lights = useMemo(
    () => Array.from({ length: POOL }, () => {
      const l = new THREE.PointLight('#ffd6a0', 0, 28, 1.6);
      l.castShadow = false;
      return l;
    }),
    [],
  );
  const timer = useRef(1);
  useFrame((_, dt) => {
    const night = nightUniform.value;
    timer.current += dt;
    if (timer.current < 0.5) {
      for (const l of lights) l.intensity = l.userData.on ? night * 60 : 0;
      return;
    }
    timer.current = 0;
    const px = telemetry.x, pz = telemetry.z;
    const cands: { x: number; y: number; z: number; d: number }[] = [];
    const cx = Math.floor(px / CHUNK_SIZE), cz = Math.floor(pz / CHUNK_SIZE);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const c = manager.index.chunks.get(`${cx + i},${cz + j}`);
        if (!c) continue;
        for (const k of ['lamp', 'bwLamp'] as const) {
          for (const p of c.props.get(k) ?? []) {
            const d = Math.hypot(p.x - px, p.z - pz);
            if (d < 90) cands.push({ x: k === 'lamp' ? p.x + Math.cos(p.rot) * 1.8 : p.x, y: p.y + (k === 'lamp' ? 7.5 : 4.3), z: k === 'lamp' ? p.z - Math.sin(p.rot) * 1.8 : p.z, d });
          }
        }
      }
    }
    cands.sort((a, b) => a.d - b.d);
    lights.forEach((l, i) => {
      const c = cands[i];
      l.userData.on = !!c && night > 0.05;
      if (c) l.position.set(c.x, c.y, c.z);
      l.intensity = l.userData.on ? night * 60 : 0;
    });
  });
  return (
    <group ref={group}>
      {lights.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </group>
  );
}
