/** Day/night cycle: sun, sky, fog, ambient light and night-time emissives. */
import { Sky, Stars } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGame, telemetry } from '../../store/gameStore';
import { setNightFactor } from '../../world/render/materials';
import { oceanUniforms } from '../../world/ocean/Ocean';
import { sunAt } from './sun';

const DAY_FOG = new THREE.Color('#b9d3ea');
const GOLD_FOG = new THREE.Color('#f0b98a');
const NIGHT_FOG = new THREE.Color('#0b1220');
const DAY_SKY = new THREE.Color('#9fc7ea');
const NIGHT_SKY = new THREE.Color('#0a1424');

export function SkyAndLighting() {
  const timeOfDay = useGame((s) => s.timeOfDay);
  const timeAuto = useGame((s) => s.timeAuto);
  const shadows = useGame((s) => s.settings.shadows);
  const drawDistance = useGame((s) => s.settings.drawDistance);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const { scene, gl } = useThree();
  const target = useMemo(() => new THREE.Object3D(), []);
  const state = useMemo(() => sunAt(timeOfDay), [timeOfDay]);

  useEffect(() => {
    scene.add(target);
    return () => { scene.remove(target); };
  }, [scene, target]);

  useEffect(() => {
    if (!scene.fog) scene.fog = new THREE.Fog(DAY_FOG, 50, drawDistance);
  }, [scene, drawDistance]);

  useEffect(() => {
    gl.shadowMap.enabled = shadows;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
  }, [gl, shadows]);

  useEffect(() => {
    const s = state;
    const n = s.night;
    setNightFactor(n);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(DAY_FOG).lerp(GOLD_FOG, s.golden * 0.7).lerp(NIGHT_FOG, n);
    fog.near = 60;
    fog.far = drawDistance * (1 - n * 0.35);
    scene.background = fog.color.clone();
    const sunColor = new THREE.Color('#fff4e0').lerp(new THREE.Color('#ff9a4d'), s.golden);
    if (sun.current) {
      const up = Math.max(0, s.dir[1]);
      sun.current.intensity = n < 1 ? 2.6 * Math.min(1, up * 4) * (1 - n) : 0;
      sun.current.color.copy(sunColor);
    }
    if (hemi.current) {
      hemi.current.intensity = 1.35 * (1 - n) + 0.4 * n;
      hemi.current.color.copy(DAY_SKY).lerp(new THREE.Color('#5a6f99'), n);
      hemi.current.groundColor.set('#8a8068').lerp(new THREE.Color('#10131a'), n);
    }
    if (amb.current) amb.current.intensity = 0.25 * (1 - n) + 0.18 * n;
    oceanUniforms.uSunDir.value.set(...s.dir).normalize();
    oceanUniforms.uSunColor.value.copy(sunColor).multiplyScalar(1 - n);
    oceanUniforms.uSkyColor.value.copy(DAY_SKY).lerp(GOLD_FOG, s.golden * 0.5).lerp(NIGHT_SKY, n);
    oceanUniforms.uAmbient.value = 0.55 * (1 - n) + 0.08 * n;
    gl.toneMappingExposure = 1.0 - n * 0.25;
  }, [state, scene, gl, drawDistance]);

  // advance the clock (1 real minute = 1 game hour) and keep the shadow box around the player
  const acc = useRef(0);
  const shadowTimer = useRef(0);
  const shadowKey = useRef('');
  useFrame((_, dt) => {
    if (timeAuto) {
      acc.current += dt;
      if (acc.current > 0.5) {
        const t = (useGame.getState().timeOfDay + acc.current / 60) % 24;
        acc.current = 0;
        useGame.setState({ timeOfDay: t });
      }
    }
    if (sun.current) {
      // Performance: the shadow box snaps to a 25 m grid and the shadow map is only
      // re-rendered when the box moves, the sun moves, or every 2 s (new chunks).
      const d = state.dir;
      const sx = Math.round(telemetry.x / 25) * 25, sz = Math.round(telemetry.z / 25) * 25;
      shadowTimer.current += dt;
      const key = `${sx},${sz},${d[0].toFixed(3)},${d[1].toFixed(3)}`;
      if (key !== shadowKey.current || shadowTimer.current > 2) {
        shadowKey.current = key;
        shadowTimer.current = 0;
        sun.current.position.set(sx + d[0] * 300, Math.max(20, d[1] * 300), sz + d[2] * 300);
        target.position.set(sx, 0, sz);
        target.updateMatrixWorld();
        sun.current.target = target;
        gl.shadowMap.needsUpdate = true;
      }
    }
  });

  const sunPos = useMemo(() => new THREE.Vector3(...state.dir).multiplyScalar(1000), [state]);
  return (
    <>
      <Sky sunPosition={sunPos} turbidity={state.golden > 0.3 ? 5 : 2.2} rayleigh={state.golden > 0.3 ? 2.2 : 0.9} mieCoefficient={0.004} mieDirectionalG={0.8} distance={40000} />
      {state.night > 0.4 && <Stars radius={3000} depth={200} count={3000} factor={60} fade saturation={0} />}
      <directionalLight
        ref={sun}
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-near={10}
        shadow-camera-far={800}
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
      />
      <hemisphereLight ref={hemi} />
      <ambientLight ref={amb} />
      {/* moonlight */}
      <directionalLight position={[-300, 400, 200]} intensity={state.night * 0.35} color="#9fb4ff" />
    </>
  );
}
