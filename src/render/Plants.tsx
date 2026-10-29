import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3,
} from 'three';
import { useApp } from '../core/store';
import type { PlacedEntity, SpeciesDef } from '../core/types';
import { templateDesignId } from '../core/types';
import { SPECIES } from '../species';
import { designTextures } from './designTextures';
import { createPlantMaterial, ensureSwayAttributes } from './plantShader';

/**
 * Instanced renderer for every species with locomotion 'sway-plant': one InstancedMesh (one draw
 * call) and one shared material per species. Motion is entirely in the vertex shader, driven by
 * the shared env uniforms, so there is no per-frame CPU work here.
 *
 * `mesh.userData.entityIds[instanceId]` maps a raycast hit back to the PlacedEntity id.
 */
export function Plants() {
  const entities = useApp((s) => s.entities);
  const species = useMemo(() => SPECIES.filter((s) => s.locomotion === 'sway-plant'), []);
  return (
    <>
      {species.map((s) => (
        <PlantInstances key={s.id} species={s} entities={entities} />
      ))}
    </>
  );
}

/** Extra radius around each instance for sway and blade trailing, metres at scale 1. */
const SWAY_MARGIN = 2.5;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Vector3();
const _up = new Vector3(0, 1, 0);
const _box = new Box3();
const _ibox = new Box3();

function PlantInstances({ species, entities }: { species: SpeciesDef; entities: PlacedEntity[] }) {
  const base = useMemo(() => ensureSwayAttributes(species.buildGeometry()), [species]);
  const material = useMemo(
    () => createPlantMaterial({ height: Math.max(base.boundingBox!.max.y, 0.1) }),
    [base],
  );
  useEffect(
    () => () => {
      material.dispose();
      base.dispose();
    },
    [material, base],
  );

  const list = useMemo(() => entities.filter((e) => e.speciesId === species.id), [entities, species.id]);

  // Capacity only grows (doubling), so placing plants rarely rebuilds the mesh.
  const capRef = useRef(0);
  if (list.length > capRef.current) {
    let cap = Math.max(64, capRef.current);
    while (cap < list.length) cap *= 2;
    capRef.current = cap;
  }
  const capacity = capRef.current;

  const mesh = useMemo(() => {
    const geometry: BufferGeometry = base.clone();
    geometry.setAttribute('aDesignLayer', new InstancedBufferAttribute(new Float32Array(capacity), 1));
    const m = new InstancedMesh(geometry, material, capacity);
    m.count = 0;
    m.name = `plants:${species.id}`;
    m.userData.entityIds = [] as string[];
    m.boundingSphere = new Sphere();
    return m;
  }, [base, material, capacity, species.id]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      mesh.dispose();
    },
    [mesh],
  );

  // Instance transforms + bounding sphere, whenever the entity list changes.
  useLayoutEffect(() => {
    const bs = base.boundingSphere!;
    const radial = bs.radius + Math.hypot(bs.center.x, bs.center.z) + SWAY_MARGIN;
    _box.makeEmpty();
    const ids: string[] = mesh.userData.entityIds;
    ids.length = list.length;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      _p.set(e.position[0], e.position[1], e.position[2]);
      _q.setFromAxisAngle(_up, e.rotationY);
      _s.setScalar(e.scale);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      ids[i] = e.id;
      _c.set(_p.x, _p.y + bs.center.y * e.scale, _p.z);
      _ibox.min.copy(_c).addScalar(-radial * e.scale);
      _ibox.max.copy(_c).addScalar(radial * e.scale);
      _box.union(_ibox);
    }
    mesh.count = list.length;
    mesh.visible = list.length > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (list.length > 0) _box.getBoundingSphere(mesh.boundingSphere!);
    writeLayers(mesh, list, species.id);
  }, [mesh, list, base, species.id]);

  // Design layers change when a design is saved, replaced or deleted.
  useEffect(() => designTextures.subscribe(() => writeLayers(mesh, list, species.id)), [mesh, list, species.id]);

  return <primitive object={mesh} />;
}

function writeLayers(mesh: InstancedMesh, list: PlacedEntity[], speciesId: string) {
  const attr = mesh.geometry.getAttribute('aDesignLayer') as InstancedBufferAttribute;
  const arr = attr.array as Float32Array;
  const fallback = Math.max(0, designTextures.layerOf(templateDesignId(speciesId)));
  for (let i = 0; i < list.length; i++) {
    const layer = designTextures.layerOf(list[i].designId);
    arr[i] = layer >= 0 ? layer : fallback;
  }
  attr.needsUpdate = true;
}
