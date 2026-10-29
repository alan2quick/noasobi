import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { ConeGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { useApp } from '../../core/store';
import { runtime } from '../../core/runtime';
import type { PlacedEntity } from '../../core/types';
import { modelHeight, trySpecies } from '../speciesInfo';

/**
 * Highlights the selected entity: a bobbing arrow above it plus a ring (camera-facing around a
 * creature, flat on the ground around a plant). Moving creatures are tracked through
 * `runtime.transforms`; the component re-renders only when the selection changes.
 */
export function SelectionMarker() {
  const mode = useApp((s) => s.mode);
  const entity = useApp((s) => (s.selectedId ? s.entities.find((e) => e.id === s.selectedId) : undefined));
  if (!entity || (mode !== 'world' && mode !== 'edit')) return null;
  return <Marker entity={entity} editing={mode === 'edit'} />;
}

function Marker({ entity, editing }: { entity: PlacedEntity; editing: boolean }) {
  const species = trySpecies(entity.speciesId);
  const parts = useMemo(() => {
    const color = editing ? 0xffa726 : 0xffeb3b;
    const arrowGeo = new ConeGeometry(0.16, 0.34, 4);
    arrowGeo.rotateX(Math.PI); // point down
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false });
    const arrow = new Mesh(arrowGeo, mat);
    arrow.renderOrder = 20;
    const ringGeo = new RingGeometry(0.86, 1, 48);
    const ringMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, fog: false });
    const ring = new Mesh(ringGeo, ringMat);
    ring.renderOrder = 20;
    const root = new Group();
    root.add(arrow, ring);
    return { root, arrow, ring, arrowGeo, ringGeo, mat, ringMat };
  }, [editing]);

  useEffect(
    () => () => {
      parts.arrowGeo.dispose();
      parts.ringGeo.dispose();
      parts.mat.dispose();
      parts.ringMat.dispose();
    },
    [parts],
  );

  const mobile = species?.kind === 'creature';
  const height = species ? modelHeight(species) * entity.scale : 1;

  useFrame((state) => {
    const { arrow, ring } = parts;
    const t = state.clock.elapsedTime;
    const live = runtime.transforms.get(entity.id);
    const bob = Math.sin(t * 3.2) * 0.12;
    if (live) {
      const p = live.position;
      const r = Math.max(0.15, live.radius);
      arrow.position.set(p.x, p.y + r * 1.6 + 0.35 + bob, p.z);
      arrow.scale.setScalar(Math.max(0.8, r * 3));
      ring.position.copy(p);
      ring.quaternion.copy(state.camera.quaternion);
      ring.scale.setScalar(r * 1.9 * (1 + Math.sin(t * 4) * 0.06));
    } else {
      const [x, y, z] = entity.position;
      const top = mobile ? y + 0.6 : y + Math.min(height, 3.2) + 0.4;
      arrow.position.set(x, top + bob, z);
      arrow.scale.setScalar(1.4);
      ring.position.set(x, y + 0.06, z);
      ring.rotation.set(-Math.PI / 2, 0, 0);
      ring.scale.setScalar(Math.max(0.7, entity.scale * 0.9) * (1 + Math.sin(t * 4) * 0.06));
    }
    arrow.rotation.y = t * 1.5;
  });

  return <primitive object={parts.root} />;
}
