/**
 * Atlantic Ocean (and back bays): one large animated water plane.
 * Shore foam and shallow-water colour come from the terrain height raster,
 * so the surf line follows the real OSM coastline.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { DATA_RECT } from '../geo/coordinates';
import { SEA_LEVEL } from '../terrain/heightfield';
import type { WorldModel } from '../worldModel';

export const oceanUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
  uSunColor: { value: new THREE.Color('#fff5e0') },
  uSkyColor: { value: new THREE.Color('#9fc7ea') },
  uAmbient: { value: 0.6 },
};

const vertex = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vWave;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // swell travelling towards the shore (NW)
  vec2 d1 = normalize(vec2(-0.72, -0.69));
  vec2 d2 = normalize(vec2(-0.5, -0.86));
  float w = 0.16 * sin(dot(wp.xz, d1) * 0.09 - uTime * 0.95)
          + 0.07 * sin(dot(wp.xz, d2) * 0.21 - uTime * 1.6)
          + 0.03 * sin(wp.x * 0.7 + wp.z * 0.4 + uTime * 2.3);
  wp.y += w;
  vWave = w;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uAmbient;
uniform sampler2D uHeight;
uniform vec4 uRect; // minX, minZ, sizeX, sizeZ
varying vec3 vWorld;
varying float vWave;
#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 tuv = (vWorld.xz - uRect.xy) / uRect.zw;
  float ground = texture2D(uHeight, tuv).r;
  float depth = vWorld.y - ground;
  if (depth < -0.05) discard;

  // procedural normal from layered noise
  vec2 p = vWorld.xz * 0.35;
  float t = uTime * 0.6;
  float n1 = noise(p + vec2(t, t * 0.7)), n2 = noise(p * 2.3 - vec2(t * 1.3, t * 0.4));
  vec3 N = normalize(vec3((n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.3, 1.0, (n2 - 0.5) * 0.5 - (n1 - 0.5) * 0.3));

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 deep = vec3(0.05, 0.22, 0.33);
  vec3 shallow = vec3(0.22, 0.52, 0.52);
  vec3 col = mix(shallow, deep, smoothstep(0.2, 3.0, depth));
  col *= (uAmbient + 0.6 * max(dot(N, uSunDir), 0.0) * uSunColor);
  col = mix(col, uSkyColor, fres * 0.55);
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 180.0) * 1.2 * step(0.0, uSunDir.y);

  // surf: foam bands where the water is shallow, moving shoreward
  float band = sin(depth * 9.0 - uTime * 1.8 + noise(vWorld.xz * 0.08) * 6.0);
  float foam = smoothstep(0.55, 0.0, depth) * (0.55 + 0.45 * band);
  foam += smoothstep(1.2, 0.3, depth) * smoothstep(0.8, 1.0, band) * 0.6;
  foam *= 0.6 + 0.4 * noise(vWorld.xz * 0.9 + t);
  col = mix(col, vec3(0.93, 0.95, 0.95) * (uAmbient + 0.5), clamp(foam, 0.0, 0.85));

  float alpha = clamp(0.55 + depth * 0.8, 0.55, 0.97);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function Ocean({ world }: { world: WorldModel }) {
  const { material, geometry } = useMemo(() => {
    const t = world.terrain;
    // Half-float so linear filtering works on every WebGL2 device.
    const half = new Uint16Array(t.height.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(t.height[i]);
    const heightTex = new THREE.DataTexture(half, t.nx, t.nz, THREE.RedFormat, THREE.HalfFloatType);
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...oceanUniforms,
        uHeight: { value: heightTex },
        uRect: { value: new THREE.Vector4(t.minX, t.minZ, (t.nx - 1) * t.res, (t.nz - 1) * t.res) },
      },
    });
    const w = DATA_RECT.maxX - DATA_RECT.minX + 400, h = DATA_RECT.maxZ - DATA_RECT.minZ + 400;
    const geometry = new THREE.PlaneGeometry(w, h, 220, 220);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate((DATA_RECT.minX + DATA_RECT.maxX) / 2, SEA_LEVEL, (DATA_RECT.minZ + DATA_RECT.maxZ) / 2);
    return { material, geometry };
  }, [world]);

  useFrame((_, dt) => {
    oceanUniforms.uTime.value += dt;
  });
  return <mesh geometry={geometry} material={material} renderOrder={1} frustumCulled={false} />;
}

/** Big ocean beyond the data bounds so the horizon is water, not void. */
export function OuterOcean() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(60000, 60000, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, SEA_LEVEL - 0.12, 0);
    return g;
  }, []);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#1f4f66" roughness={0.3} metalness={0.1} />
    </mesh>
  );
}
