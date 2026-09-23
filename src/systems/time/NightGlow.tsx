/**
 * Bloom post-processing for neon signs, ride lights and street lamps. Only
 * active in the evening/night (and when enabled in settings) to save GPU time.
 */
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useMemo } from 'react';
import { useGame } from '../../store/gameStore';
import { sunAt } from './sun';

export function NightGlow() {
  const time = useGame((s) => s.timeOfDay);
  const enabled = useGame((s) => s.settings.bloom);
  const night = useMemo(() => sunAt(time).night, [time]);
  if (!enabled || night < 0.25) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.9 * night} luminanceThreshold={0.75} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
