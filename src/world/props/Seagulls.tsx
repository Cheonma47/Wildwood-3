/** A few seagulls circling over the beach near the player (daytime only). */
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { telemetry } from '../../store/gameStore';
import { nightUniform } from '../render/materials';
import { getPrototypes } from './prototypes';
import { TerrainClass } from '../terrain/heightfield';
import type { WorldModel } from '../worldModel';

const N = 14;

export function Seagulls({ world }: { world: WorldModel }) {
  const P = getPrototypes();
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(P.gull, new THREE.MeshStandardMaterial({ color: '#f4f4f4', side: THREE.DoubleSide, roughness: 0.8 }), N);
    m.frustumCulled = false;
    return m;
  }, [P]);
  const birds = useMemo(() => Array.from({ length: N }, (_, i) => ({
    r: 12 + Math.random() * 30, h: 10 + Math.random() * 18, w: (0.15 + Math.random() * 0.2) * (i % 2 ? 1 : -1),
    phase: Math.random() * 6.28, ox: (Math.random() - 0.5) * 160, oz: (Math.random() - 0.5) * 160, flap: 4 + Math.random() * 3,
  })), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(1.4, 1.4, 1.4) }), []);
  const anchor = useMemo(() => ({ x: 0, z: 0, t: 99 }), []);
  useFrame(({ clock }, dt) => {
    // re-anchor the flock over the nearest beach/boardwalk every few seconds
    anchor.t += dt;
    if (anchor.t > 4) {
      anchor.t = 0;
      const near = world.boardwalkEdges.nearest(telemetry.x, telemetry.z, 600);
      const onBeach = world.terrain.classAt(telemetry.x, telemetry.z) === TerrainClass.Beach;
      if (onBeach) { anchor.x = telemetry.x; anchor.z = telemetry.z; }
      else if (near) { anchor.x = near.x + 60; anchor.z = near.z + 60; }
    }
    const t = clock.elapsedTime;
    const visible = nightUniform.value < 0.6;
    mesh.visible = visible;
    if (!visible) return;
    birds.forEach((b, i) => {
      const a = b.phase + t * b.w;
      const x = anchor.x + b.ox + Math.cos(a) * b.r, z = anchor.z + b.oz + Math.sin(a) * b.r;
      const y = b.h + Math.sin(t * 0.5 + i) * 2;
      // heading along the circle, wings flap by rolling the geometry
      const heading = Math.atan2(-Math.cos(a) * Math.sign(b.w), -Math.sin(a) * Math.sign(b.w));
      tmp.e.set(Math.sin(t * b.flap + i) * 0.35, heading, 0, 'YXZ');
      tmp.q.setFromEuler(tmp.e);
      tmp.p.set(x, y, z);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.setMatrixAt(i, tmp.m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}
