/**
 * First-person controller: pointer-lock mouse look, WASD movement, jumping,
 * head bob, footsteps and interaction. Physics lives in PlayerPhysics.ts.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SPAWN } from '../data/wildwood/landmarks';
import { latLonToWorld } from '../world/geo/projection';
import { useGame, telemetry, TIME_PRESETS, type TimePreset } from '../store/gameStore';
import { audio } from '../systems/audio/ambientAudio';
import { findInteractable } from '../systems/navigation/interact';
import type { WorldModel } from '../world/worldModel';
import { EYE_HEIGHT, PlayerPhysics } from './PlayerPhysics';

const keys = new Set<string>();
let fastToggle = false;

export const playerRef: { current: PlayerPhysics | null } = { current: null };
/** Developer free camera (aerial screenshots); null = normal first-person view. */
const debugCam: { current: { x: number; y: number; z: number; yaw: number; pitch: number } | null } = { current: null };

export function requestLock(): void {
  const c = document.querySelector('canvas');
  try {
    const p = c?.requestPointerLock?.() as unknown as Promise<void> | undefined;
    p?.catch?.(() => { /* user gesture required */ });
  } catch { /* ignore */ }
}

export function FirstPersonController({ world }: { world: WorldModel }) {
  const { camera, gl } = useThree();
  const settings = useGame((s) => s.settings);
  const yaw = useRef(((-SPAWN.headingDeg) * Math.PI) / 180);
  const pitch = useRef(-0.05);
  const player = useMemo(() => {
    const p = latLonToWorld(SPAWN.latitude, SPAWN.longitude);
    return new PlayerPhysics(world, p.x, p.z);
  }, [world]);
  playerRef.current = player;

  // Developer hook for automated screenshots / checks (window.__wildwoodPlayer).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__wildwoodPlayer = {
      teleportLatLon: (lat: number, lon: number, headingDeg = 0, pitchDeg = 0) => {
        const p = latLonToWorld(lat, lon);
        player.teleport(p.x, p.z);
        yaw.current = (-headingDeg * Math.PI) / 180;
        pitch.current = (pitchDeg * Math.PI) / 180;
      },
      teleportWorld: (x: number, z: number, headingDeg = 0, pitchDeg = 0) => {
        player.teleport(x, z);
        yaw.current = (-headingDeg * Math.PI) / 180;
        pitch.current = (pitchDeg * Math.PI) / 180;
      },
      look: (headingDeg: number, pitchDeg = 0) => {
        yaw.current = (-headingDeg * Math.PI) / 180;
        pitch.current = (pitchDeg * Math.PI) / 180;
      },
      state: () => ({ x: player.x, y: player.y, z: player.z }),
      freeCam: (c: { x: number; y: number; z: number; headingDeg: number; pitchDeg: number } | null) => {
        debugCam.current = c ? { x: c.x, y: c.y, z: c.z, yaw: (-c.headingDeg * Math.PI) / 180, pitch: (c.pitchDeg * Math.PI) / 180 } : null;
      },
      step: (seconds: number, forward = 1, run = false) => {
        for (let t = 0; t < seconds; t += 1 / 60) player.step(1 / 60, yaw.current, { forward, right: 0, run, fast: false, jump: false });
      },
    };
  }, [player]);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = settings.fov;
    cam.near = 0.25;
    cam.far = 9000;
    cam.updateProjectionMatrix();
  }, [camera, settings.fov]);

  useEffect(() => {
    const el = gl.domElement;
    // Fallback for embedded/sandboxed pages where pointer lock is unavailable: drag to look.
    let dragging = false;
    const onDown = (e: MouseEvent) => { if (e.target === el && document.pointerLockElement !== el) dragging = true; };
    const onUp = () => { dragging = false; };
    const onMouse = (e: MouseEvent) => {
      if (document.pointerLockElement !== el && !dragging) return;
      const s = useGame.getState().settings;
      const k = 0.0022 * s.mouseSensitivity;
      yaw.current -= e.movementX * k;
      pitch.current -= e.movementY * k * (s.invertY ? -1 : 1);
      pitch.current = Math.max(-1.45, Math.min(1.45, pitch.current));
    };
    const onLockChange = () => {
      const locked = document.pointerLockElement === el;
      const st = useGame.getState();
      if (locked) {
        st.set({ phase: 'playing', settingsOpen: false, mapOpen: false });
        audio.resume();
      } else if (st.phase === 'playing' && !st.mapOpen) {
        st.set({ phase: 'paused', settingsOpen: true });
      }
    };
    const onClick = () => {
      const st = useGame.getState();
      if (st.phase === 'ready' || st.phase === 'paused' || st.phase === 'playing') {
        if (!st.mapOpen && !st.settingsOpen) requestLock();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useGame.getState();
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'F3') {
        e.preventDefault();
        st.set({ debugOpen: !st.debugOpen });
        return;
      }
      if (e.code === 'KeyM') {
        const open = !st.mapOpen;
        st.set({ mapOpen: open, settingsOpen: false });
        if (open) document.exitPointerLock?.();
        else requestLock();
        return;
      }
      if (e.code === 'Escape' && st.mapOpen) {
        st.set({ mapOpen: false });
        return;
      }
      if (e.code === 'Escape' && document.pointerLockElement !== el) {
        // no pointer lock (drag-to-look mode): Esc toggles the menu directly
        st.set({ settingsOpen: !st.settingsOpen, phase: st.settingsOpen ? 'playing' : 'paused' });
        return;
      }
      if (e.code === 'KeyF') {
        const hit = findInteractable(world, player.x, player.z);
        st.set({ infoCard: hit ? { title: hit.title, lines: hit.lines } : null });
        return;
      }
      if (e.code === 'KeyC') fastToggle = !fastToggle;
      if (e.code === 'KeyT') {
        const order: TimePreset[] = ['morning', 'afternoon', 'sunset', 'evening', 'night'];
        const cur = st.timeOfDay;
        const idx = order.findIndex((p) => TIME_PRESETS[p] > cur + 0.01);
        st.set({ timeOfDay: TIME_PRESETS[order[idx < 0 ? 0 : idx]] });
      }
      if (e.code === 'Space') e.preventDefault();
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onBlur = () => keys.clear();
    document.addEventListener('mousemove', onMouse);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('pointerlockchange', onLockChange);
    el.addEventListener('click', onClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      el.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, world, player]);

  const lastStep = useRef(0);
  const hintTimer = useRef(0);
  useFrame((_, dt) => {
    const st = useGame.getState();
    const active = st.phase === 'playing' && !st.mapOpen && !st.settingsOpen;
    const k = (c: string) => (active && keys.has(c) ? 1 : 0);
    const input = {
      forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'),
      right: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft'),
      run: active && (keys.has('ShiftLeft') || keys.has('ShiftRight')),
      fast: fastToggle,
      jump: active && keys.has('Space'),
    };
    if (!active) { input.forward = 0; input.right = 0; }
    const moved = player.step(dt, yaw.current, input);
    telemetry.distanceWalked += moved;

    // camera
    const bobAmt = st.settings.headBob && player.grounded ? Math.min(1, Math.hypot(player.vx, player.vz) / 1.4) : 0;
    const bob = Math.sin(player.bobPhase * Math.PI) * 0.035 * bobAmt;
    const sway = Math.cos(player.bobPhase * Math.PI * 0.5) * 0.02 * bobAmt;
    camera.position.set(player.x + Math.cos(yaw.current) * sway, player.visualY + EYE_HEIGHT + bob, player.z - Math.sin(yaw.current) * sway);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, 0);
    if (debugCam.current) {
      const d = debugCam.current;
      camera.position.set(d.x, d.y, d.z);
      camera.rotation.set(d.pitch, d.yaw, 0);
    }

    // footsteps
    const stride = input.run ? 1.35 : 0.75;
    if (player.stepDistance - lastStep.current > stride) {
      lastStep.current = player.stepDistance;
      audio.footstep(player.surface(), input.run);
    }

    const speed = Math.hypot(player.vx, player.vz);
    telemetry.x = player.x;
    telemetry.y = player.y;
    telemetry.z = player.z;
    telemetry.yaw = yaw.current;
    telemetry.pitch = pitch.current;
    telemetry.speed = speed;
    telemetry.mode = input.run ? 'run' : input.fast ? 'fast' : 'walk';
    telemetry.grounded = player.grounded;

    hintTimer.current += dt;
    if (hintTimer.current > 0.4) {
      hintTimer.current = 0;
      telemetry.surface = player.surface();
      const hit = findInteractable(world, player.x, player.z);
      const hint = hit ? `Press F – ${hit.title}` : null;
      if (hint !== st.interactHint) st.set({ interactHint: hint });
      if (st.infoCard && !st.infoCard.sticky && !hit) st.set({ infoCard: null });
      audio.updateZone(world, player.x, player.z, player.y);
    }
  });

  return null;
}
