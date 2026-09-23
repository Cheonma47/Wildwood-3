import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useGame } from './store/gameStore';
import { buildWorld, type WorldModel } from './world/worldModel';
import { WorldScene } from './world/WorldScene';
import { Hud } from './ui/hud/Hud';
import { MapScreen } from './ui/map/MapScreen';
import { SettingsMenu } from './ui/settings/SettingsMenu';
import { DebugOverlay } from './ui/debug/DebugOverlay';
import { requestLock } from './player/FirstPersonController';
import { audio } from './systems/audio/ambientAudio';

export default function App() {
  const [world, setWorld] = useState<WorldModel | null>(null);
  const phase = useGame((s) => s.phase);
  const loadingMsg = useGame((s) => s.loadingMsg);
  const error = useGame((s) => s.error);
  const volume = useGame((s) => s.settings.volume);
  const shadows = useGame((s) => s.settings.shadows);

  useEffect(() => {
    let cancelled = false;
    buildWorld((m) => useGame.setState({ loadingMsg: m }))
      .then((w) => {
        if (cancelled) return;
        setWorld(w);
        useGame.setState({ phase: 'ready', loadingMsg: 'Ready' });
        // expose for debugging / automated checks
        (window as unknown as { __wildwood: unknown }).__wildwood = { world: w, store: useGame };
      })
      .catch((e: unknown) => useGame.setState({ phase: 'error', error: String(e) }));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => audio.setVolume(volume), [volume]);

  const start = () => {
    audio.resume();
    requestLock();
    useGame.setState({ phase: 'playing' });
  };

  return (
    <>
      {world && (
        <Canvas
          shadows={shadows}
          dpr={[1, 1.75]}
          gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
          camera={{ fov: 70, near: 0.25, far: 9000, position: [0, 2, 0] }}
          onCreated={({ scene, gl }) => Object.assign((window as unknown as { __wildwood: object }).__wildwood ?? {}, { scene, gl })}
        >
          <WorldScene world={world} />
        </Canvas>
      )}
      {world && <Hud world={world} />}
      {world && <MapScreen world={world} />}
      {world && <DebugOverlay world={world} />}
      <SettingsMenu />

      {(phase === 'loading' || phase === 'error') && (
        <div className="overlay splash">
          <h1>Wildwood Walk</h1>
          <p className="muted">A 1:1 scale walking simulator of Wildwood, New Jersey</p>
          {phase === 'loading' && <p className="loading">{loadingMsg}</p>}
          {error && <p className="bad">Failed to load: {error}</p>}
        </div>
      )}
      {phase === 'ready' && (
        <div className="overlay splash" onClick={start}>
          <h1>Wildwood Walk</h1>
          <p className="muted">Real OpenStreetMap geography · 1 game metre = 1 real metre · walking at 1.4 m/s</p>
          <p>You are standing outside <b>Dogtooth Bar &amp; Grill</b> (100 E Taylor Ave) – your Work &amp; Travel workplace.</p>
          <p>The Boardwalk is ~600 m east down Taylor Avenue (≈ 8 minutes on foot). Press <b>M</b> to open the map and pick a destination.</p>
          <div className="controls-grid">
            <span>W A S D</span><span>Walk</span>
            <span>Mouse</span><span>Look</span>
            <span>Shift</span><span>Run</span>
            <span>Space</span><span>Small jump</span>
            <span>M</span><span>Map</span>
            <span>F</span><span>Interact</span>
            <span>Esc</span><span>Settings</span>
            <span>F3</span><span>Debug</span>
          </div>
          <button className="primary big-btn">Click to start walking</button>
          <p className="muted small">If the mouse isn't captured (e.g. inside an embedded page), drag with the mouse to look around.</p>
        </div>
      )}
    </>
  );
}
