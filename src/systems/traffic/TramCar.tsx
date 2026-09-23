/**
 * The Boardwalk Sightseer Tram Car: a yellow/blue tram train that shuttles
 * along the real Boardwalk centreline at a slow ~3 m/s.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DECK_HEIGHT } from '../../world/physics/walkable';
import { textTexture } from '../../world/render/textures';
import type { WorldModel } from '../../world/worldModel';
import { telemetry } from '../../store/gameStore';
import { registerNightMaterial } from '../../world/render/materials';

const CAR_GAP = 7.2;

export function TramCar({ world }: { world: WorldModel }) {
  const path = useMemo(() => world.boardwalkLine.map((s) => s.p), [world]);
  const cum = useMemo(() => {
    const c = [0];
    for (let i = 1; i < path.length; i++) c.push(c[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    return c;
  }, [path]);
  const L = cum[cum.length - 1] ?? 0;
  const cars = useRef<(THREE.Group | null)[]>([]);
  const state = useRef({ s: L * 0.35, dir: 1 as 1 | -1, pause: 0 });
  const sign = useMemo(() => {
    const map = textTexture('TRAM CAR', { bg: '#0d47a1', fg: '#ffeb3b', w: 512, h: 96 });
    const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#fff'), emissiveIntensity: 0.2 });
    registerNightMaterial(m, 1.2);
    return m;
  }, []);
  const yellow = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f9c80e', roughness: 0.5 }), []);
  const blue = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1565c0', roughness: 0.5 }), []);
  const seat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e0e0e0', roughness: 0.7 }), []);

  const pos = (s: number): [number, number, number] => {
    s = Math.max(0, Math.min(L, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const a = path[i - 1], b = path[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(-(b[1] - a[1]), b[0] - a[0])];
  };

  useFrame((_, dt) => {
    if (L < 50) return;
    const st = state.current;
    if (st.pause > 0) st.pause -= dt;
    else {
      // slow down if the player is standing right in front of it
      const [fx, fz] = pos(st.s + st.dir * 6);
      const blocked = Math.hypot(fx - telemetry.x, fz - telemetry.z) < 2.2 && telemetry.y > 0.6;
      if (!blocked) st.s += st.dir * 3.0 * Math.min(dt, 0.1);
      if (st.s > L - 10) { st.s = L - 10; st.dir = -1; st.pause = 20; }
      if (st.s < 10 + CAR_GAP * 3) { st.s = 10 + CAR_GAP * 3; st.dir = 1; st.pause = 20; }
    }
    cars.current.forEach((g, k) => {
      if (!g) return;
      const [x, z, ang] = pos(st.s - st.dir * k * CAR_GAP);
      g.position.set(x - Math.sin(ang) * 0, DECK_HEIGHT, z);
      g.rotation.y = ang + (st.dir < 0 ? Math.PI : 0);
    });
  });

  if (L < 50) return null;
  return (
    <group name="tram">
      {[0, 1, 2, 3].map((k) => (
        <group key={k} ref={(el) => { cars.current[k] = el; }}>
          {k === 0 ? (
            <>
              <mesh position={[0, 0.9, 0]} material={yellow} castShadow>
                <boxGeometry args={[3.2, 1.2, 1.9]} />
              </mesh>
              <mesh position={[-0.3, 1.9, 0]} material={blue}>
                <boxGeometry args={[2.2, 0.9, 1.8]} />
              </mesh>
              <mesh position={[0.2, 2.75, 0]} material={sign} rotation={[0, Math.PI / 2, 0]}>
                <planeGeometry args={[1.8, 0.35]} />
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.55, 0]} material={blue} castShadow>
                <boxGeometry args={[6.2, 0.5, 2.1]} />
              </mesh>
              {[-2, -0.7, 0.6, 1.9].map((u) => (
                <mesh key={u} position={[u, 0.95, 0]} material={seat}>
                  <boxGeometry args={[0.35, 0.5, 1.9]} />
                </mesh>
              ))}
              <mesh position={[0, 2.65, 0]} material={yellow} castShadow>
                <boxGeometry args={[6.4, 0.12, 2.3]} />
              </mesh>
              {[-3, 3].map((u) => [-1, 1].map((v) => (
                <mesh key={`${u}${v}`} position={[u, 1.6, v * 1.0]} material={yellow}>
                  <boxGeometry args={[0.08, 2.1, 0.08]} />
                </mesh>
              )))}
            </>
          )}
          {[-1, 1].map((u) => [-1, 1].map((v) => (
            <mesh key={`w${u}${v}`} position={[u * (k === 0 ? 1.1 : 2.4), 0.3, v * 0.95]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 0.2, 10]} />
              <meshStandardMaterial color="#222" />
            </mesh>
          )))}
        </group>
      ))}
    </group>
  );
}
