import { memo, useEffect, useRef, useState } from 'react';
import { useApp } from '../core/store';
import type { PlacedEntity } from '../core/types';
import { templateDesignId } from '../core/types';
import { cleanName } from '../core/storage/serialize';
import { sound } from '../audio/engine';
import { DepthIcon, IconButton } from './IconButton';
import { useTemplateThumb } from './hooks';
import { ACTIVITY_ICON, habitatLevel, trySpecies } from './speciesInfo';

/**
 * Small icon-first card for the selected creature or plant. Subscribes only to that entity, its
 * design meta and the follow flag, so it never re-renders per frame (the 3D marker moves itself).
 */
export function CreatureCard() {
  const entity = useApp((s) => (s.selectedId ? s.entities.find((e) => e.id === s.selectedId) : undefined));
  if (!entity) return null;
  return <Card key={entity.id} entity={entity} />;
}

const Card = memo(function Card({ entity }: { entity: PlacedEntity }) {
  const species = trySpecies(entity.speciesId);
  const design = useApp((s) => s.designs[entity.designId]);
  const following = useApp((s) => s.followId === entity.id);
  const templateThumb = useTemplateThumb(species, 96);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entity.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!species) return null;
  const app = useApp.getState();
  const mobile = species.kind === 'creature';
  const pic = design?.thumbnail || templateThumb;

  const commit = () => {
    const name = cleanName(draft, entity.name);
    if (name !== entity.name) app.updateEntity(entity.id, { name });
    setDraft(name);
    setEditing(false);
  };

  const repaint = () => {
    const isTemplate = entity.designId === templateDesignId(species.id) || !design;
    if (isTemplate) app.openStudio(species.id, undefined, { returnTo: 'world', applyTo: entity.id });
    else app.openStudio(species.id, entity.designId, { returnTo: 'world' });
  };

  return (
    <div className="card" role="dialog" aria-label={entity.name}>
      <div className="card-pic">
        {pic ? <img src={pic} alt="" /> : species.icon}
        <span className="badge" aria-hidden="true">
          {species.icon}
        </span>
      </div>
      <div className="card-name">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={24}
            aria-label="Name"
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(entity.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <>
            <span className="nm" title={entity.name}>
              {entity.name}
            </span>
            <button
              type="button"
              className="icon-mini"
              aria-label="Rename"
              title="Rename"
              onClick={() => {
                sound.pop();
                setDraft(entity.name);
                setEditing(true);
              }}
            >
              ✏️
            </button>
          </>
        )}
      </div>
      <div className="card-facts">
        <span className="fact" title={`Active: ${species.activity}`} aria-label={`Active: ${species.activity}`}>
          {ACTIVITY_ICON[species.activity]}
        </span>
        {mobile && (
          <span className="fact" title="Where it swims" aria-label="Where it swims">
            <DepthIcon level={habitatLevel(species)} />
          </span>
        )}
        {species.diet === 'flakes' && (
          <span className="fact" title="Eats food flakes" aria-label="Eats food flakes">
            🍤
          </span>
        )}
      </div>
      <div className="card-actions">
        {mobile && (
          <IconButton
            icon="📍"
            title={following ? 'Stop following' : 'Follow'}
            active={following}
            onClick={() => app.follow(following ? null : entity.id)}
          />
        )}
        <IconButton icon="🎨" title="Repaint" onClick={repaint} />
        <IconButton
          icon="✕"
          title="Close"
          onClick={() => {
            app.follow(null);
            app.select(null);
          }}
        />
      </div>
    </div>
  );
});
