import { useEffect } from 'react';
import { Vector3 } from 'three';
import { useApp } from '../core/store';
import { runtime } from '../core/runtime';
import { jumpToDay, jumpToNight } from '../biomes/ocean/dayNight';
import { sound } from '../audio/engine';
import { Catalog } from './Catalog';
import { CreatureCard } from './CreatureCard';
import { IconButton } from './IconButton';
import { useIsNight, useTemplateThumb } from './hooks';
import { trySpecies } from './speciesInfo';
import { useUi } from './uiStore';
import { puff } from './world/PuffFx';
import './hud.css';

const _p = new Vector3();

/** The player HUD for every non-studio mode. */
export function Hud() {
  const mode = useApp((s) => s.mode);

  // Escape backs out of the current mode (desktop convenience).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const s = useApp.getState();
      if (s.mode === 'catalog' || s.mode === 'place' || s.mode === 'edit') s.setMode('world');
      else if (useUi.getState().feeding) useUi.getState().setFeeding(false);
      else if (s.selectedId) {
        s.follow(null);
        s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (mode === 'studio') return null;
  return (
    <div className="hud">
      {mode === 'world' && <CreatureCard />}
      {mode === 'world' && <MainBar />}
      {mode === 'catalog' && <Catalog />}
      {mode === 'place' && <PlaceBar />}
      {mode === 'edit' && <EditBar />}
    </div>
  );
}

function MainBar() {
  const feeding = useUi((s) => s.feeding);
  const muted = useApp((s) => s.muted);
  const [night, refreshNight] = useIsNight();
  const app = useApp.getState();

  return (
    <>
      {feeding && (
        <div className="hud-hint" aria-hidden="true">
          <span className="tap-hand">👆</span>🍤
        </div>
      )}
      <nav className="hud-bar" aria-label="Main">
        <IconButton icon="➕" title="Add" onClick={() => app.setMode('catalog')} />
        <IconButton icon="🍤" title="Feed" active={feeding} onClick={() => useUi.getState().setFeeding(!feeding)} />
        <IconButton
          icon={night ? '🌙' : '☀️'}
          title={night ? 'Night (tap for day)' : 'Day (tap for night)'}
          onClick={() => {
            if (night) jumpToDay();
            else jumpToNight();
            refreshNight();
          }}
        />
        <IconButton
          icon="✋"
          title="Move and remove"
          onClick={() => {
            useUi.getState().setFeeding(false);
            app.follow(null);
            app.setMode('edit');
          }}
        />
        <IconButton
          icon={muted ? '🔇' : '🔊'}
          title={muted ? 'Sound on' : 'Sound off'}
          active={!muted}
          onClick={() => {
            sound.unlock();
            app.setMuted(!muted);
          }}
        />
      </nav>
    </>
  );
}

function PlaceBar() {
  const placement = useApp((s) => s.placement);
  const design = useApp((s) => (s.placement ? s.designs[s.placement.designId] : undefined));
  const placed = useUi((s) => s.placed);
  const species = placement ? trySpecies(placement.speciesId) : undefined;
  const templateThumb = useTemplateThumb(species, 96);
  const app = useApp.getState();
  const pic = design?.thumbnail || templateThumb;

  const undo = () => {
    const last = placed[placed.length - 1];
    if (!last) return;
    app.removeEntity(last);
    useUi.getState().setPlaced(placed.slice(0, -1));
  };

  return (
    <>
      <div className="hud-hint" aria-hidden="true">
        <span className="tap-hand">👆</span>
        {species?.icon ?? '✨'}
      </div>
      <nav className="hud-bar" aria-label="Place">
        <IconButton icon="✕" title="Back" onClick={() => app.setMode('catalog')} />
        <div className="hud-chip" title={design?.name ?? species?.name}>
          {pic ? <img src={pic} alt="" /> : species?.icon}
          {placed.length > 0 && <b style={{ fontSize: 18 }}>×{placed.length}</b>}
        </div>
        <IconButton icon="↩️" title="Undo" disabled={placed.length === 0} onClick={undo} />
        <IconButton
          icon="✓"
          title="Done"
          variant="ok"
          onClick={() => {
            app.select(null);
            app.setMode('world');
          }}
        />
      </nav>
    </>
  );
}

function EditBar() {
  const selected = useApp((s) => (s.selectedId ? s.entities.find((e) => e.id === s.selectedId) : undefined));
  const design = useApp((s) => (selected ? s.designs[selected.designId] : undefined));
  const species = selected ? trySpecies(selected.speciesId) : undefined;
  const templateThumb = useTemplateThumb(species, 96);
  const app = useApp.getState();
  const mobile = species?.kind === 'creature';
  const pic = design?.thumbnail || templateThumb;

  return (
    <>
      <div className="hud-hint" aria-hidden="true">
        {!selected ? (
          <>
            <span className="tap-hand">👆</span>🐠🌿
          </>
        ) : mobile ? (
          <>
            <span className="tap-hand">👆</span>📍
          </>
        ) : (
          <>
            <span className="tap-hand">✊</span>↔️
          </>
        )}
      </div>
      <nav className="hud-bar" aria-label="Edit">
        {selected && (
          <>
            <div className="hud-chip" title={selected.name}>
              {pic ? <img src={pic} alt="" /> : species?.icon}
            </div>
            <IconButton
              icon="🗑️"
              title="Remove"
              variant="danger"
              onClick={() => {
                const live = runtime.transforms.get(selected.id);
                puff(live ? live.position : _p.fromArray(selected.position), mobile ? 1 : 1.4);
                app.removeEntity(selected.id);
              }}
            />
            <IconButton icon="✕" title="Unselect" onClick={() => app.select(null)} />
            <div className="hud-sep" />
          </>
        )}
        <IconButton
          icon="✓"
          title="Done"
          variant="ok"
          onClick={() => {
            app.select(null);
            app.setMode('world');
          }}
        />
      </nav>
    </>
  );
}
