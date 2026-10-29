import { useState } from 'react';
import { IconButton } from './IconButton';
import { promptInstall, useInstallKind } from './install';

/** iOS share glyph: a box with an arrow pointing up. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="#1a73e8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="#1a73e8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Small corner button that installs the game as an app; hidden when already installed. */
export function InstallButton() {
  const kind = useInstallKind();
  const [showIosHint, setShowIosHint] = useState(false);
  if (!kind) return null;

  return (
    <div className="hud-install">
      <IconButton
        icon="📲"
        title="Install app"
        small
        active={showIosHint}
        onClick={() => {
          if (kind === 'prompt') void promptInstall();
          else setShowIosHint((v) => !v);
        }}
      />
      {kind === 'ios' && showIosHint && (
        <div className="hud-install-hint" role="dialog" aria-label="Install on iPhone or iPad" onClick={() => setShowIosHint(false)}>
          <span className="step">
            <ShareIcon />
          </span>
          <span className="arrow">→</span>
          <span className="step">➕</span>
          <span className="text">Add to Home Screen</span>
        </div>
      )}
    </div>
  );
}
