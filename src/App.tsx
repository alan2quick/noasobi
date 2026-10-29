import { Canvas } from '@react-three/fiber';
import { useApp } from './core/store';
import { OceanBiome } from './biomes/ocean/OceanBiome';
import { Plants } from './render/Plants';
import { Swimmers } from './render/Swimmers';
import { DesignStudio } from './studio/DesignStudio';
import { DevBar } from './ui/DevBar';

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
        <OceanBiome />
        <Plants />
        <Swimmers />
      </Canvas>
      {mode === 'studio' ? <DesignStudio /> : <DevBar />}
    </>
  );
}
