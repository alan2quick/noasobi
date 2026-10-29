import { Canvas } from '@react-three/fiber';
import { useApp } from './core/store';
import { OceanBiome } from './biomes/ocean/OceanBiome';
import { Plants } from './render/Plants';
import { Swimmers } from './render/Swimmers';
import { Drifters } from './render/Drifters';
import { SceneBridge } from './render/sceneRefs';
import { DesignStudio } from './studio/DesignStudio';
import { Hud } from './ui/Hud';
import { WorldInteraction } from './ui/world/WorldInteraction';
import { PlacementGhost } from './ui/world/PlacementGhost';
import { SelectionMarker } from './ui/world/SelectionMarker';
import { PuffFx } from './ui/world/PuffFx';

export function App() {
  const mode = useApp((s) => s.mode);
  return (
    <>
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 55, near: 0.1, far: 140, position: [0, 6, 18] }}
        frameloop={mode === 'studio' ? 'never' : 'always'}
      >
        <SceneBridge />
        <OceanBiome />
        <Plants />
        <Swimmers />
        <Drifters />
        <WorldInteraction />
        <PlacementGhost />
        <SelectionMarker />
        <PuffFx />
      </Canvas>
      {mode === 'studio' ? <DesignStudio /> : <Hud />}
    </>
  );
}
