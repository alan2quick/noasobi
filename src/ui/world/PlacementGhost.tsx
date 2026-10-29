import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { getDesignSource, getTemplateSource, useApp } from '../../core/store';
import { terrainHeight } from '../../core/terrain';
import { getSpecies } from '../../species';
import { anchorAt, isMobile, midScale, modelUnit } from './placement';

/**
 * Translucent preview of what place mode will drop. Follows `ghost.target` (written by the
 * pointer-hover and tap code) with easing, bobs and spins slowly. Plain Lambert mesh with the
 * design as a map: no sway/swim shader needed.
 */

export const ghost = {
  /** Ground point the ghost should sit above. */
  target: new Vector3(),
  valid: false,
};

export function PlacementGhost() {
  const mode = useApp((s) => s.mode);
  const placement = useApp((s) => s.placement);
  if (mode !== 'place' || !placement) return null;
  return <Ghost key={`${placement.speciesId}|${placement.designId}`} speciesId={placement.speciesId} designId={placement.designId} />;
}

const _goal = new Vector3();

function Ghost({ speciesId, designId }: { speciesId: string; designId: string }) {
  const species = useMemo(() => getSpecies(speciesId), [speciesId]);

  const parts = useMemo(() => {
    const source = getDesignSource(designId) ?? getTemplateSource(speciesId);
    const map = source ? new CanvasTexture(source) : null;
    if (map) map.colorSpace = SRGBColorSpace;
    const geometry = species.buildGeometry();
    const material = new MeshLambertMaterial({
      map,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: DoubleSide,
      emissive: 0x335566,
    });
    const body = new Mesh(geometry, material);
    body.scale.setScalar(modelUnit(species) * midScale(species));
    body.renderOrder = 5;
    const holder = new Group();
    holder.add(body);

    // Bright ground ring (drawn on top so it shows through kelp) and, for floating creatures, a
    // thin stem from the ring up to the preview so the spot is easy to read from any angle.
    const ringGeo = new RingGeometry(0.72, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const ring = new Mesh(ringGeo, ringMat);
    ring.renderOrder = 6;
    const stemGeo = new CylinderGeometry(0.03, 0.03, 1, 6);
    stemGeo.translate(0, 0.5, 0);
    const stem = new Mesh(stemGeo, ringMat);
    stem.renderOrder = 6;

    const root = new Group();
    root.add(holder, ring, stem);
    root.visible = false;
    return { root, holder, body, ring, stem, map, geometry, material, ringGeo, stemGeo, ringMat };
  }, [species, speciesId, designId]);

  useEffect(
    () => () => {
      parts.geometry.dispose();
      parts.material.dispose();
      parts.map?.dispose();
      parts.ringGeo.dispose();
      parts.stemGeo.dispose();
      parts.ringMat.dispose();
    },
    [parts],
  );

  const mobile = isMobile(species);
  const ringScale = mobile ? 0.9 : Math.max(0.9, midScale(species));

  useFrame((state, rawDt) => {
    const { root, holder, body, ring, stem, material, ringMat } = parts;
    root.visible = ghost.valid;
    if (!ghost.valid) return;
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    anchorAt(species, ghost.target.x, ghost.target.z, 0.5, _goal);
    const k = 1 - Math.exp(-14 * dt);
    if (holder.position.lengthSq() === 0) holder.position.copy(_goal);
    holder.position.lerp(_goal, k);
    holder.rotation.y += dt * 0.7;
    body.position.y = Math.sin(t * 2.2) * (mobile ? 0.08 : 0.04);
    const ground = terrainHeight(holder.position.x, holder.position.z) + 0.08;
    ring.position.set(holder.position.x, ground, holder.position.z);
    stem.visible = mobile;
    stem.position.copy(ring.position);
    stem.scale.y = Math.max(0.01, holder.position.y - ground - 0.15);
    const pulse = 1 + Math.sin(t * 4) * 0.08;
    ring.scale.setScalar(ringScale * pulse);
    material.opacity = 0.5 + Math.sin(t * 3) * 0.12;
    ringMat.opacity = 0.7 + Math.sin(t * 4) * 0.2;
  });

  return <primitive object={parts.root} />;
}
