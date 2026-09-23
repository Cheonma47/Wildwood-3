/** Assembles every 3D system of the world. */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { ChunkManager } from '../systems/chunks/chunkManager';
import { SkyAndLighting } from '../systems/time/SkyAndLighting';
import { Traffic } from '../systems/traffic/Traffic';
import { Pedestrians } from '../systems/pedestrians/Pedestrians';
import { TramCar } from '../systems/traffic/TramCar';
import { RouteLine } from '../systems/navigation/RouteLine';
import { useGame, telemetry } from '../store/gameStore';
import { FirstPersonController, playerRef } from '../player/FirstPersonController';
import { Boardwalk } from './boardwalk/Boardwalk';
import { Landmarks } from './landmarks/Landmarks';
import { Ocean, OuterOcean } from './ocean/Ocean';
import { LampLights } from './props/LampLights';
import { NightGlow } from '../systems/time/NightGlow';
import type { WorldModel } from './worldModel';

export function WorldScene({ world, onChunkManager }: { world: WorldModel; onChunkManager?: (m: ChunkManager) => void }) {
  const manager = useMemo(() => new ChunkManager(world), [world]);
  const drawDistance = useGame((s) => s.settings.drawDistance);

  useEffect(() => {
    manager.drawDistance = drawDistance;
  }, [manager, drawDistance]);

  useEffect(() => {
    const p = playerRef.current;
    if (p) manager.preload(p.x, p.z);
    onChunkManager?.(manager);
  }, [manager, onChunkManager]);

  const fps = useMemo(() => ({ acc: 0, frames: 0 }), []);
  useFrame(({ camera, gl }, dt) => {
    manager.update(camera.position.x, camera.position.z, 5);
    telemetry.chunks = manager.stats;
    telemetry.drawCalls = gl.info.render.calls;
    telemetry.triangles = gl.info.render.triangles;
    fps.acc += dt;
    fps.frames++;
    if (fps.acc > 0.5) {
      telemetry.fps = fps.frames / fps.acc;
      telemetry.frameMs = (fps.acc / fps.frames) * 1000;
      fps.acc = 0;
      fps.frames = 0;
    }
  });

  return (
    <>
      <SkyAndLighting />
      <FirstPersonController world={world} />
      <primitive object={manager.root} />
      <Boardwalk world={world} />
      <Ocean world={world} />
      <OuterOcean />
      <NightGlow />
      <Landmarks world={world} />
      <LampLights manager={manager} />
      <RouteLine world={world} />
      <Traffic world={world} />
      <Pedestrians world={world} />
      <TramCar world={world} />
    </>
  );
}
