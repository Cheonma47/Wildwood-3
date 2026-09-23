/** Reusable prop geometries (built once, instanced everywhere). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function colored(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of ni) { p.deleteAttribute('uv'); }
  const m = mergeGeometries(ni, false)!;
  m.computeBoundingSphere();
  return m;
}

let cache: ReturnType<typeof make> | null = null;
export function getPrototypes() {
  return (cache ??= make());
}

function make() {
  // Street light: 8 m cobra-head pole. Local +x is the arm direction (towards the road).
  const lampPole = merge([
    colored(at(new THREE.CylinderGeometry(0.08, 0.12, 8, 6), 0, 4, 0), '#5d6166'),
    colored(at(new THREE.BoxGeometry(1.8, 0.1, 0.1), 0.9, 7.9, 0), '#5d6166'),
    colored(at(new THREE.BoxGeometry(0.7, 0.18, 0.35), 1.8, 7.85, 0), '#44484c'),
  ]);
  const lampHead = at(new THREE.BoxGeometry(0.6, 0.06, 0.3), 1.8, 7.74, 0);
  // Boardwalk lamp: shorter post with globe
  const bwLampPole = merge([
    colored(at(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8), 0, 2.1, 0), '#1f3b2c'),
    colored(at(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 8), 0, 0.15, 0), '#1f3b2c'),
  ]);
  const bwLampGlobe = at(new THREE.SphereGeometry(0.28, 12, 8), 0, 4.45, 0);

  const treeTrunk = merge([colored(at(new THREE.CylinderGeometry(0.12, 0.2, 3, 6), 0, 1.5, 0), '#6b4f36')]);
  const treeCanopy = merge([
    colored(at(new THREE.IcosahedronGeometry(2.2, 1), 0, 4.4, 0), '#4f7a3a'),
    colored(at(new THREE.IcosahedronGeometry(1.5, 1), 0.8, 5.4, 0.4), '#5a8744'),
  ]);

  const utilityPole = merge([
    colored(at(new THREE.CylinderGeometry(0.13, 0.16, 10.5, 6), 0, 5.25, 0), '#6e5a44'),
    colored(at(new THREE.BoxGeometry(0.12, 0.12, 2.4), 0, 9.9, 0), '#6e5a44'),
    colored(at(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8), 0.3, 8.6, 0), '#8a8f94'),
  ]);

  const signalPole = merge([
    colored(at(new THREE.CylinderGeometry(0.1, 0.13, 6, 6), 0, 3, 0), '#3b3f43'),
    colored(at(new THREE.BoxGeometry(5, 0.14, 0.14), 2.5, 5.9, 0), '#3b3f43'),
    colored(at(new THREE.BoxGeometry(0.35, 1.0, 0.3), 4.6, 5.3, 0), '#e0b43a'),
  ]);
  const signalLights = merge([
    colored(at(new THREE.SphereGeometry(0.1, 6, 4), 4.6, 5.62, 0.17), '#ff3b30'),
    colored(at(new THREE.SphereGeometry(0.1, 6, 4), 4.6, 5.3, 0.17), '#ffcc00'),
    colored(at(new THREE.SphereGeometry(0.1, 6, 4), 4.6, 4.98, 0.17), '#34c759'),
  ]);

  const stopSign = merge([
    colored(at(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 5), 0, 1.15, 0), '#9aa1a8'),
    colored(at(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 8), 0, 2.3, 0.03, Math.PI / 2, 0, Math.PI / 8), '#c62828'),
  ]);

  const signPost = merge([colored(at(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), 0, 1.6, 0), '#9aa1a8')]);
  const signPole = merge([
    colored(at(new THREE.CylinderGeometry(0.12, 0.15, 5.4, 8), 0, 2.7, 0), '#c9ccd1'),
    colored(at(new THREE.BoxGeometry(3.9, 0.18, 0.35), 0, 5.3, 0), '#c9ccd1'),
    colored(at(new THREE.BoxGeometry(3.9, 0.18, 0.35), 0, 7.1, 0), '#c9ccd1'),
  ]);

  // Car ~4.6 × 1.8 × 1.45 m, local +x forward
  const carBody = merge([
    at(new THREE.BoxGeometry(4.5, 0.7, 1.8), 0, 0.55, 0),
    at(new THREE.BoxGeometry(2.3, 0.6, 1.6), -0.2, 1.15, 0),
  ]);
  const carGlass = merge([
    colored(at(new THREE.BoxGeometry(2.35, 0.45, 1.62), -0.2, 1.15, 0), '#23303a'),
    colored(at(new THREE.CylinderGeometry(0.33, 0.33, 1.84, 10), 1.4, 0.33, 0, Math.PI / 2), '#1a1a1a'),
    colored(at(new THREE.CylinderGeometry(0.33, 0.33, 1.84, 10), -1.45, 0.33, 0, Math.PI / 2), '#1a1a1a'),
  ]);

  const bench = merge([
    colored(at(new THREE.BoxGeometry(1.8, 0.06, 0.45), 0, 0.45, 0), '#6d4c33'),
    colored(at(new THREE.BoxGeometry(1.8, 0.45, 0.06), 0, 0.72, -0.22, -0.2), '#6d4c33'),
    colored(at(new THREE.BoxGeometry(0.06, 0.45, 0.45), -0.8, 0.22, 0), '#2d3135'),
    colored(at(new THREE.BoxGeometry(0.06, 0.45, 0.45), 0.8, 0.22, 0), '#2d3135'),
  ]);
  const trashCan = merge([colored(at(new THREE.CylinderGeometry(0.3, 0.28, 0.95, 10), 0, 0.475, 0), '#1f5e8c')]);

  const umbrellaPole = merge([colored(at(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 5), 0, 1.1, 0), '#eeeeee')]);
  const umbrellaTop = at(new THREE.ConeGeometry(1.1, 0.45, 8, 1, true), 0, 2.15, 0);
  const beachChair = merge([
    at(new THREE.BoxGeometry(0.55, 0.05, 0.6), 0, 0.3, 0),
    at(new THREE.BoxGeometry(0.55, 0.6, 0.05), 0, 0.55, -0.35, -0.45),
  ]);
  const lifeguard = merge([
    colored(at(new THREE.BoxGeometry(0.12, 2.0, 0.12), -0.6, 1.0, -0.6), '#f4f4f4'),
    colored(at(new THREE.BoxGeometry(0.12, 2.0, 0.12), 0.6, 1.0, -0.6), '#f4f4f4'),
    colored(at(new THREE.BoxGeometry(0.12, 2.0, 0.12), -0.6, 1.0, 0.6), '#f4f4f4'),
    colored(at(new THREE.BoxGeometry(0.12, 2.0, 0.12), 0.6, 1.0, 0.6), '#f4f4f4'),
    colored(at(new THREE.BoxGeometry(1.5, 0.1, 1.5), 0, 2.0, 0), '#f4f4f4'),
    colored(at(new THREE.BoxGeometry(1.3, 0.6, 0.08), 0, 2.4, -0.62), '#d32f2f'),
    colored(at(new THREE.BoxGeometry(0.9, 0.08, 0.5), 0, 1.0, 0.8, 0.5), '#f4f4f4'),
  ]);

  // Pedestrian: simple capsule body + head; vertex colours set per instance via instanceColor
  const person = merge([
    at(new THREE.CapsuleGeometry(0.2, 0.9, 2, 6), 0, 0.85, 0),
    at(new THREE.SphereGeometry(0.13, 6, 4), 0, 1.62, 0),
  ]);

  const piling = merge([colored(at(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), 0, -0.5, 0), '#5a4632')]);

  return {
    lampPole, lampHead, bwLampPole, bwLampGlobe, treeTrunk, treeCanopy, utilityPole, signalPole, signalLights,
    stopSign, signPost, signPole, carBody, carGlass, bench, trashCan, umbrellaPole, umbrellaTop, beachChair, lifeguard, person, piling,
  };
}

export type Prototypes = ReturnType<typeof make>;
