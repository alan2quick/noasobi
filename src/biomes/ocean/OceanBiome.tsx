import './water'; // installs the water fog chunks before any material compiles
import { DayNightClock } from './DayNightClock';
import { Seabed } from './Seabed';
import { Rocks } from './Rocks';
import { WaterBackdrop } from './WaterBackdrop';
import { WaterSurface } from './WaterSurface';
import { GodRays } from './GodRays';
import { MarineSnow } from './MarineSnow';
import { Bubbles } from './Bubbles';
import { CameraRig } from '../../render/CameraRig';
import { QualityManager, useQualityPreset } from '../../render/quality';
import { Stats } from '../../render/Stats';

/**
 * The open-water ocean world: clock + lights, quality manager, camera rig, seabed, rocks, water
 * volume (fog/backdrop/surface), god rays, marine snow and bubbles. Mount once inside the Canvas.
 */
export function OceanBiome() {
  const q = useQualityPreset();
  return (
    <>
      <QualityManager />
      <DayNightClock />
      <CameraRig />
      <WaterBackdrop />
      <Seabed />
      <Rocks />
      <WaterSurface />
      {q.godRays > 0 && <GodRays count={q.godRays} />}
      <MarineSnow count={q.snow} />
      <Bubbles streams={q.bubbleStreams} />
      <Stats />
    </>
  );
}
