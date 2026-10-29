import { memo, useMemo, useState } from 'react';
import { useApp } from '../core/store';
import type { DesignMeta, SpeciesDef, SpeciesKind } from '../core/types';
import { templateDesignId } from '../core/types';
import { sound } from '../audio/engine';
import { IconButton } from './IconButton';
import { usePress, useTemplateThumb } from './hooks';
import { speciesFor } from './speciesInfo';
import { useUi } from './uiStore';

/**
 * The catalog sheet: tabs per kind, one row per species with "new design", the natural look and
 * every saved design. Tap a picture to place it; long-press or ✏️ to repaint; 🗑️ (with an icon
 * confirm) to delete.
 */

const TABS: { kind: SpeciesKind; icon: string; title: string }[] = [
  { kind: 'creature', icon: '🐠', title: 'Creatures' },
  { kind: 'plant', icon: '🌿', title: 'Plants' },
  { kind: 'rock', icon: '🪨', title: 'Rocks' },
];

export function Catalog() {
  const tab = useUi((s) => s.catalogTab);
  const setTab = useUi((s) => s.setCatalogTab);
  const setMode = useApp((s) => s.setMode);
  const list = useMemo(() => speciesFor('ocean', tab), [tab]);
  const close = () => setMode('world');

  return (
    <>
      <div className="sheet-backdrop" onClick={close} />
      <div className="sheet" role="dialog" aria-label="Catalog">
        <div className="sheet-head">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.kind}
                type="button"
                role="tab"
                aria-selected={tab === t.kind}
                aria-label={t.title}
                title={t.title}
                className={`tab${tab === t.kind ? ' active' : ''}`}
                onClick={() => {
                  sound.pop();
                  setTab(t.kind);
                }}
              >
                {t.icon}
              </button>
            ))}
          </div>
          <IconButton icon="✕" title="Close" onClick={close} />
        </div>
        <div className="sheet-body">
          {list.length === 0 ? (
            <div className="soon">
              {TABS.find((t) => t.kind === tab)?.icon}🚧
              <div className="txt">Coming soon!</div>
            </div>
          ) : (
            list.map((s) => <SpeciesRow key={s.id} species={s} />)
          )}
        </div>
      </div>
    </>
  );
}

const SpeciesRow = memo(function SpeciesRow({ species }: { species: SpeciesDef }) {
  const designs = useApp((s) => s.designs);
  const mine = useMemo(
    () => Object.values(designs).filter((d) => d.speciesId === species.id).sort((a, b) => b.updatedAt - a.updatedAt),
    [designs, species.id],
  );
  const thumb = useTemplateThumb(species);
  const { openStudio, startPlacing } = useApp.getState();

  return (
    <div className="species-row">
      <div className="species-pic" title={species.name}>
        {thumb ? <img src={thumb} alt="" /> : species.icon}
        <span className="nm">{species.name}</span>
      </div>
      <div className="tiles">
        <button
          type="button"
          className="tile new"
          title="New design"
          aria-label={`New ${species.name} design`}
          onClick={() => {
            sound.pop();
            openStudio(species.id, undefined, { returnTo: 'catalog' });
          }}
        >
          🎨
          <br />➕
        </button>
        <button
          type="button"
          className="tile"
          title={`${species.name} (natural)`}
          aria-label={`Place natural ${species.name}`}
          onClick={() => {
            sound.pop();
            startPlacing(species.id, templateDesignId(species.id));
          }}
        >
          {thumb ? <img src={thumb} alt="" /> : species.icon}
          <span className="tag">🌱</span>
        </button>
        {mine.map((d) => (
          <DesignTile key={d.id} design={d} species={species} />
        ))}
      </div>
    </div>
  );
});

function DesignTile({ design, species }: { design: DesignMeta; species: SpeciesDef }) {
  const [confirm, setConfirm] = useState(false);
  const { openStudio, startPlacing, deleteDesign } = useApp.getState();
  const edit = () => openStudio(species.id, design.id, { returnTo: 'catalog' });
  const press = usePress(() => startPlacing(species.id, design.id), edit);

  return (
    <div className="tile" title={design.name}>
      <button
        type="button"
        aria-label={`Place ${design.name}`}
        style={{ all: 'unset', width: '100%', height: '100%', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
        {...press}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') startPlacing(species.id, design.id);
        }}
      >
        {design.thumbnail ? <img src={design.thumbnail} alt="" /> : species.icon}
      </button>
      <button
        type="button"
        className="corner tr"
        aria-label={`Repaint ${design.name}`}
        title="Repaint"
        onClick={() => {
          sound.pop();
          edit();
        }}
      >
        ✏️
      </button>
      <button
        type="button"
        className="corner tl"
        aria-label={`Delete ${design.name}`}
        title="Delete"
        onClick={() => {
          sound.pop();
          setConfirm(true);
        }}
      >
        🗑️
      </button>
      {confirm && (
        <div className="confirm">
          <button
            type="button"
            className="yes"
            aria-label="Yes, delete"
            onClick={() => {
              sound.pop();
              deleteDesign(design.id);
            }}
          >
            🗑️
          </button>
          <button
            type="button"
            className="no"
            aria-label="Keep"
            onClick={() => {
              sound.pop();
              setConfirm(false);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
