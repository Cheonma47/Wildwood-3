/**
 * Morey's Piers: amusement piers built on the real OSM pier polygons.
 * Rides are stylised silhouettes (Ferris wheel, coasters, drop tower,
 * swing ride, carousel) laid out along each pier's real axis.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Landmark } from '../../data/wildwood/landmarks';
import type { Area } from '../data/types';
import { hash01, pointInRing, rng, type V2 } from '../math/polygon';
import { DECK_HEIGHT } from '../physics/walkable';
import { registerNightMaterial } from '../render/materials';
import { textTexture } from '../render/textures';
import type { WorldModel } from '../worldModel';

interface PierFrame {
  origin: V2; // inland end, centreline
  u: V2; // unit axis towards ocean
  v: V2; // unit across
  length: number;
  width: number;
}

function pierFrame(area: Area): PierFrame {
  const pts = area.outer;
  let mx = 0, mz = 0;
  for (const p of pts) { mx += p[0]; mz += p[1]; }
  mx /= pts.length; mz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of pts) { const dx = p[0] - mx, dz = p[1] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let u: V2 = [Math.cos(ang), Math.sin(ang)];
  if (u[0] + u[1] < 0) u = [-u[0], -u[1]]; // towards ocean (SE = +x,+z)
  const v: V2 = [-u[1], u[0]];
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of pts) {
    const du = (p[0] - mx) * u[0] + (p[1] - mz) * u[1];
    const dv = (p[0] - mx) * v[0] + (p[1] - mz) * v[1];
    uMin = Math.min(uMin, du); uMax = Math.max(uMax, du); vMin = Math.min(vMin, dv); vMax = Math.max(vMax, dv);
  }
  const vc = (vMin + vMax) / 2;
  return {
    origin: [mx + u[0] * uMin + v[0] * vc, mz + u[1] * uMin + v[1] * vc],
    u, v, length: uMax - uMin, width: vMax - vMin,
  };
}

function bulbsMaterial(color: string) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.2 });
  registerNightMaterial(m, 3);
  return m;
}

function FerrisWheel({ height = 47 }: { height?: number }) {
  const R = height / 2 - 2;
  const wheel = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (wheel.current) wheel.current.rotation.z -= dt * 0.05;
  });
  const parts = useMemo(() => {
    const structure = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.5, metalness: 0.3 });
    const bulbs = [bulbsMaterial('#ff4081'), bulbsMaterial('#40c4ff'), bulbsMaterial('#ffd740')];
    const cabins = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const rim = new THREE.TorusGeometry(R, 0.35, 6, 64);
    const spokes = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);
    const bulbGeo = new THREE.SphereGeometry(0.28, 6, 4);
    const bulbPos = Array.from({ length: 96 }, (_, i) => (i / 96) * Math.PI * 2);
    return { structure, bulbs, cabins, rim, spokes, bulbGeo, bulbPos };
  }, [R]);
  const hub = height / 2;
  return (
    <group>
      {/* A-frame legs */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * 2.2]}>
          <mesh position={[-R * 0.35, hub / 2, 0]} rotation={[0, 0, -0.33]} material={parts.structure}>
            <boxGeometry args={[0.8, hub * 1.06, 0.8]} />
          </mesh>
          <mesh position={[R * 0.35, hub / 2, 0]} rotation={[0, 0, 0.33]} material={parts.structure}>
            <boxGeometry args={[0.8, hub * 1.06, 0.8]} />
          </mesh>
        </group>
      ))}
      <group ref={wheel} position={[0, hub, 0]}>
        {[-1.4, 1.4].map((z) => (
          <mesh key={z} geometry={parts.rim} material={parts.structure} position={[0, 0, z]} />
        ))}
        {parts.spokes.map((a, i) => (
          <mesh key={i} rotation={[0, 0, a]} position={[0, 0, 0]} material={parts.structure}>
            <boxGeometry args={[0.18, R * 2, 0.18]} />
          </mesh>
        ))}
        {parts.bulbPos.map((a, i) => (
          <mesh key={i} geometry={parts.bulbGeo} material={parts.bulbs[i % 3]} position={[Math.cos(a) * (R + 0.5), Math.sin(a) * (R + 0.5), 1.6]} />
        ))}
        {parts.spokes.map((a, i) => (
          <Cabin key={i} angle={a} R={R} material={parts.cabins[i % parts.cabins.length]} wheel={wheel} />
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]} material={parts.structure}>
          <cylinderGeometry args={[1.2, 1.2, 4, 12]} />
        </mesh>
      </group>
    </group>
  );
}

function Cabin({ angle, R, material, wheel }: { angle: number; R: number; material: THREE.Material; wheel: React.RefObject<THREE.Group | null> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    // keep cabins hanging upright while the wheel turns
    if (ref.current && wheel.current) ref.current.rotation.z = -wheel.current.rotation.z;
  });
  return (
    <group position={[Math.cos(angle) * R, Math.sin(angle) * R, 0]}>
      <group ref={ref}>
        <mesh position={[0, -1.3, 0]} material={material}>
          <boxGeometry args={[1.8, 2.0, 2.2]} />
        </mesh>
      </group>
    </group>
  );
}

/** Closed coaster circuit inside a rectangle of the pier (local u,v coords). */
function Coaster({ frame, u0, u1, halfW, peak, color, supportColor, seed }: { frame: PierFrame; u0: number; u1: number; halfW: number; peak: number; color: string; supportColor: string; seed: number }) {
  const { track, supports, lights } = useMemo(() => {
    const r = rng(seed);
    const pts: THREE.Vector3[] = [];
    const n = 80;
    const L = u1 - u0;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      // stretched loop with wiggles
      const lu = u0 + L / 2 + (L / 2) * Math.cos(t) * (0.92 + 0.08 * Math.sin(3 * t + seed));
      const lv = halfW * Math.sin(t) * (0.85 + 0.15 * Math.cos(2 * t + seed));
      // lift hill then descending hills
      const phase = (t / (Math.PI * 2) + 0.15) % 1;
      const h = phase < 0.25 ? 3 + (peak - 3) * (phase / 0.25) : 3 + (peak - 3) * Math.max(0, Math.cos((phase - 0.25) * 9) * (1 - (phase - 0.25) * 1.2)) ** 2 + r() * 0.2;
      const x = frame.origin[0] + frame.u[0] * lu + frame.v[0] * lv;
      const z = frame.origin[1] + frame.u[1] * lu + frame.v[1] * lv;
      pts.push(new THREE.Vector3(x, DECK_HEIGHT + Math.max(2.5, h), z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.3);
    const track = new THREE.TubeGeometry(curve, 400, 0.45, 5, true);
    const supports: THREE.Matrix4[] = [];
    const lights: THREE.Vector3[] = [];
    for (let i = 0; i < 90; i++) {
      const p = curve.getPoint(i / 90);
      const h = p.y - DECK_HEIGHT;
      supports.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, DECK_HEIGHT + h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
    }
    for (let i = 0; i < 160; i++) lights.push(curve.getPoint(i / 160).add(new THREE.Vector3(0, 0.6, 0)));
    return { track, supports, lights };
  }, [frame, u0, u1, halfW, peak, seed]);
  const supportMesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.35, 1, 0.35);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: supportColor, roughness: 0.7 }), supports.length);
    supports.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    return im;
  }, [supports, supportColor]);
  const lightMesh = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.18, 5, 4);
    const im = new THREE.InstancedMesh(geo, bulbsMaterial('#fff176'), lights.length);
    const m = new THREE.Matrix4();
    lights.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    im.computeBoundingSphere();
    return im;
  }, [lights]);
  return (
    <group>
      <mesh geometry={track} castShadow>
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.4} />
      </mesh>
      <primitive object={supportMesh} />
      <primitive object={lightMesh} />
    </group>
  );
}

function DropTower({ height }: { height: number }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const t = (clock.elapsedTime % 14) / 14;
    const y = t < 0.6 ? 3 + (height - 6) * (t / 0.6) : t < 0.7 ? height - 3 : Math.max(3, height - 3 - (height - 6) * ((t - 0.7) / 0.06) ** 2);
    ring.current.position.y = y;
  });
  const bulbs = useMemo(() => bulbsMaterial('#e040fb'), []);
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.9, 1.1, height, 10]} />
        <meshStandardMaterial color="#e0e0e0" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, height, 0]} material={bulbs}>
        <sphereGeometry args={[1.4, 10, 8]} />
      </mesh>
      <mesh ref={ring} position={[0, 3, 0]}>
        <cylinderGeometry args={[2.6, 2.6, 1.2, 16]} />
        <meshStandardMaterial color="#ff5252" />
      </mesh>
    </group>
  );
}

function SwingRide() {
  const top = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (top.current) top.current.rotation.y += dt * 1.1;
  });
  const bulbs = useMemo(() => bulbsMaterial('#40c4ff'), []);
  return (
    <group>
      <mesh position={[0, 9, 0]}>
        <cylinderGeometry args={[0.5, 0.7, 18, 10]} />
        <meshStandardMaterial color="#ffca28" />
      </mesh>
      <group ref={top} position={[0, 17, 0]}>
        <mesh material={bulbs}>
          <cylinderGeometry args={[6, 6.5, 0.8, 24]} />
        </mesh>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 8, -5, Math.sin(a) * 8]} rotation={[0, -a, 0.45]}>
              <boxGeometry args={[0.1, 9, 0.1]} />
              <meshStandardMaterial color="#9e9e9e" />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function Carousel() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.4;
  });
  const bulbs = useMemo(() => bulbsMaterial('#ffd740'), []);
  return (
    <group ref={ref}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[7, 7, 0.6, 24]} />
        <meshStandardMaterial color="#b71c1c" />
      </mesh>
      <mesh position={[0, 6.3, 0]} material={bulbs}>
        <coneGeometry args={[7.5, 3, 24]} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 5.5, 2.4, Math.sin(a) * 5.5]}>
            <cylinderGeometry args={[0.07, 0.07, 4.4, 5]} />
            <meshStandardMaterial color="#ffd54f" metalness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

export function MoreysPier({ landmark, area, world }: { landmark: Landmark; area: Area; world: WorldModel }) {
  const frame = useMemo(() => pierFrame(area), [area]);
  const place = (u: number, v: number): [number, number, number] => [
    frame.origin[0] + frame.u[0] * u + frame.v[0] * v,
    DECK_HEIGHT,
    frame.origin[1] + frame.u[1] * u + frame.v[1] * v,
  ];
  const inside = (u: number, v: number) => {
    const p = place(u, v);
    return pointInRing(p[0], p[2], area.outer);
  };
  // yaw that aligns local +x with the pier axis
  const yawAlongAxis = Math.atan2(-frame.u[1], frame.u[0]);
  const title = landmark.name.replace("Morey's Piers – ", "MOREY'S ").toUpperCase();
  const archMat = useMemo(() => {
    const map = textTexture(title, { bg: '#0d47a1', fg: '#ffffff', glow: '#82b1ff', w: 1024, h: 128 });
    const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#fff'), emissiveIntensity: 0.25, side: THREE.DoubleSide });
    registerNightMaterial(m, 1.8);
    return m;
  }, [title]);
  const isMariners = landmark.id === 'moreys-mariners';
  const L = frame.length, W = frame.width;
  const seed = Math.floor(hash01(area.id) * 1000);
  const halfW = Math.min(W / 2 - 4, 22);
  void world;
  return (
    <group name={landmark.name}>
      {/* entrance arch at the boardwalk end */}
      <group position={place(4, 0)} rotation={[0, yawAlongAxis + Math.PI / 2, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * Math.min(W / 2 - 1, 9), 4, 0]}>
            <boxGeometry args={[0.8, 8, 0.8]} />
            <meshStandardMaterial color="#1565c0" />
          </mesh>
        ))}
        <mesh position={[0, 8.6, 0]} material={archMat}>
          <boxGeometry args={[Math.min(W - 2, 18) + 1, 1.8, 0.4]} />
        </mesh>
      </group>
      {isMariners && inside(L * 0.3, 0) && (
        <group position={place(L * 0.3, 0)} rotation={[0, yawAlongAxis, 0]}>
          <FerrisWheel height={47} />
        </group>
      )}
      <Coaster frame={frame} u0={L * (isMariners ? 0.45 : 0.3)} u1={L * 0.92} halfW={halfW} peak={isMariners ? 24 : 32} color={seed % 2 ? '#1565c0' : '#e53935'} supportColor={landmark.id === 'moreys-adventure' ? '#f5f5f5' : '#9e9e9e'} seed={seed} />
      {inside(L * 0.18, -halfW * 0.6) && (
        <group position={place(L * 0.18, -halfW * 0.6)}>
          <DropTower height={isMariners ? 30 : 42} />
        </group>
      )}
      {inside(L * 0.2, halfW * 0.55) && (
        <group position={place(L * 0.2, halfW * 0.55)}>
          {landmark.id === 'moreys-surfside' ? <SwingRide /> : <Carousel />}
        </group>
      )}
    </group>
  );
}
