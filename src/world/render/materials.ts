/**
 * Shared, reusable materials. Created once; every mesh references these so
 * the renderer can batch efficiently. `setNightFactor` drives all night-time
 * emissive lighting (windows, signs, lamps).
 */
import * as THREE from 'three';
import {
  asphaltTexture, facadeTextures, grassTexture, planksTexture, sandTexture, sidewalkTexture,
} from './textures';

export interface Materials {
  asphalt: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  marking: THREE.MeshStandardMaterial;
  markingYellow: THREE.MeshStandardMaterial;
  parking: THREE.MeshStandardMaterial;
  planks: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  terrain: THREE.MeshStandardMaterial;
  facade: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  plainWall: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshStandardMaterial;
  neon: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  vertexColor: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  foliage: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  sand: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
}

let mats: Materials | null = null;
/** Material → emissive intensity at full night. */
const nightEmissive = new Map<THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, number>();
export const nightUniform = { value: 0 };

export function getMaterials(): Materials {
  if (mats) return mats;
  const asphaltMap = asphaltTexture();
  const facade = facadeTextures();

  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...p });

  const facadeMat = std({ map: facade.map, emissiveMap: facade.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, vertexColors: true, roughness: 0.85 });
  facadeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tile;\nvarying float vTile;\nvarying vec2 vFacadeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = tile;\nvFacadeUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTile;\nvarying vec2 vFacadeUv;\nuniform float uNight;')
      .replace('#include <map_fragment>', `
        vec2 fcell = floor(vFacadeUv);
        vec2 fuv = vec2((fract(vFacadeUv.x) + vTile) * 0.25, fract(vFacadeUv.y));
        vec2 gx = dFdx(vFacadeUv * vec2(0.25, 1.0));
        vec2 gy = dFdy(vFacadeUv * vec2(0.25, 1.0));
        vec4 sampledDiffuseColor = textureGrad(map, fuv, gx, gy);
        diffuseColor *= sampledDiffuseColor;`)
      .replace('#include <emissivemap_fragment>', `
        vec4 emissiveColor = textureGrad(emissiveMap, fuv, gx, gy);
        float wh = fract(sin(dot(fcell + vec2(vTile * 7.13, vTile * 3.1) + floor(vColor.rg * 37.0), vec2(12.9898, 78.233))) * 43758.5453);
        totalEmissiveRadiance *= emissiveColor.rgb * step(0.5, wh) * uNight * 1.4;`);
  };

  mats = {
    asphalt: std({ map: asphaltMap, color: '#ffffff', roughness: 0.95 }),
    sidewalk: std({ map: sidewalkTexture(), roughness: 0.9 }),
    marking: std({ color: '#f2f2ee', roughness: 0.7 }),
    markingYellow: std({ color: '#e8b923', roughness: 0.7 }),
    parking: std({ map: asphaltMap, color: '#c9c9c9', roughness: 0.95 }),
    planks: std({ map: planksTexture(), roughness: 0.85 }),
    wood: std({ color: '#8b6a48', roughness: 0.9 }),
    terrain: std({ vertexColors: true, roughness: 1, map: grassTexture() }),
    facade: facadeMat,
    roof: std({ vertexColors: true, roughness: 0.95 }),
    plainWall: std({ vertexColors: true, roughness: 0.9 }),
    metal: std({ color: '#9aa1a8', roughness: 0.4, metalness: 0.6 }),
    darkMetal: std({ color: '#2d3135', roughness: 0.5, metalness: 0.5 }),
    lampGlow: std({ color: '#fff6dc', emissive: new THREE.Color('#ffd89a'), emissiveIntensity: 0.1 }),
    neon: std({ vertexColors: true, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.15, roughness: 0.5 }),
    white: std({ color: '#f5f5f0' }),
    vertexColor: std({ vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ color: '#ffd89a', transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }),
    foliage: std({ color: '#4f7a3a', roughness: 1 }),
    trunk: std({ color: '#6b4f36' }),
    sand: std({ map: sandTexture(), roughness: 1 }),
    grass: std({ color: '#7fa45a', map: grassTexture(), roughness: 1 }),
  };
  nightEmissive.set(mats.lampGlow, 3.0);
  nightEmissive.set(mats.neon, 2.2);
  // ensure road markings are drawn above the asphalt
  for (const m of [mats.marking, mats.markingYellow]) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
  mats.sidewalk.polygonOffset = true;
  mats.sidewalk.polygonOffsetFactor = -0.5;
  mats.asphalt.polygonOffset = true;
  mats.asphalt.polygonOffsetFactor = -1;
  mats.asphalt.polygonOffsetUnits = -1;
  mats.parking.polygonOffset = true;
  mats.parking.polygonOffsetFactor = -0.5;
  return mats;
}

/** Registers an extra material whose emissive should follow the day/night cycle. */
export function registerNightMaterial(m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, fullNight: number): void {
  nightEmissive.set(m, fullNight);
}

export function setNightFactor(f: number): void {
  nightUniform.value = f;
  for (const [m, full] of nightEmissive) {
    if (m instanceof THREE.MeshStandardMaterial) m.emissiveIntensity = 0.1 + f * full;
    else m.opacity = f * full;
  }
  if (mats) mats.glow.opacity = f * 0.8;
}
