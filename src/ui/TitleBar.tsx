import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ThemePicker from './ThemePicker';
import ClaudeMascot from './ClaudeMascot';
import { isMac } from '../platform';

const appWindow = getCurrentWindow();

export interface TitleBarProps {
  themeId: string;
  onSelectTheme: (id: string) => void;
}

/** Custom (frameless) window chrome: brand, drag region, theme picker, and the
 *  min/max/close controls. */
export default function TitleBar({ themeId, onSelectTheme }: TitleBarProps): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setMaximized).catch(() => {});
    appWindow
      .onResized(() => {
        appWindow.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const toggleMax = (): void => {
    void appWindow.toggleMaximize();
  };

  const minBtn = (
    <button
      type="button"
      className="wc-btn wc-btn--min"
      aria-label="Minimizar"
      title="Minimizar"
      onClick={() => void appWindow.minimize()}
    >
      <svg width="11" height="11" viewBox="0 0 11 11">
        <rect x="1" y="5" width="9" height="1" fill="currentColor" />
      </svg>
    </button>
  );
  const maxBtn = (
    <button
      type="button"
      className="wc-btn wc-btn--max"
      aria-label={maximized ? 'Restaurar' : 'Maximizar'}
      title={maximized ? 'Restaurar' : 'Maximizar'}
      onClick={toggleMax}
    >
      {maximized ? (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor">
          <rect x="1" y="3" width="6" height="6" />
          <path d="M3 3 V1 H10 V8 H8" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor">
          <rect x="1.5" y="1.5" width="8" height="8" />
        </svg>
      )}
    </button>
  );
  const closeBtn = (
    <button
      type="button"
      className="wc-btn wc-btn--close"
      aria-label="Fechar"
      title="Fechar"
      onClick={() => void appWindow.close()}
    >
      <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1">
        <path d="M1 1 L10 10 M10 1 L1 10" />
      </svg>
    </button>
  );

  // macOS: traffic lights on the LEFT (close, min, max). Others: right.
  const controls = isMac ? (
    <div className="window-controls window-controls--mac">
      {closeBtn}
      {minBtn}
      {maxBtn}
    </div>
  ) : (
    <div className="window-controls">
      {minBtn}
      {maxBtn}
      {closeBtn}
    </div>
  );

  return (
    <header className="titlebar">
      {isMac && controls}

      <div className="titlebar-brand" data-tauri-drag-region onDoubleClick={toggleMax}>
        <span className="titlebar-mark" aria-hidden="true">
          <ClaudeMascot size={17} />
        </span>
        <span className="titlebar-wordmark">THETERM</span>
        <span className="titlebar-divider" aria-hidden="true" />
        <span className="titlebar-subtitle">terminal nativo de IA</span>
      </div>

      <div className="titlebar-drag" data-tauri-drag-region onDoubleClick={toggleMax} />

      <ThemePicker currentId={themeId} onSelect={onSelectTheme} />

      {!isMac && controls}
    </header>
  );
}
