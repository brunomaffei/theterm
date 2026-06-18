import React, { useEffect, useRef, useState } from 'react';
import { THEMES } from '../theme';

export interface ThemePickerProps {
  currentId: string;
  onSelect: (id: string) => void;
}

export default function ThemePicker({ currentId, onSelect }: ThemePickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={ref}>
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setOpen((o) => !o)}
        title="Trocar tema"
        aria-label="Trocar tema"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <i className="ti ti-palette" aria-hidden="true" />
      </button>

      {open && (
        <div className="theme-menu" role="menu">
          <span className="theme-menu__title">Temas</span>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === currentId}
              className={`theme-item ${t.id === currentId ? 'theme-item--active' : ''}`}
              onClick={() => {
                onSelect(t.id);
                setOpen(false);
              }}
            >
              <span
                className="theme-swatch"
                style={{ background: t.colors.bg, borderColor: t.colors.border }}
              >
                <span className="theme-swatch__dot" style={{ background: t.colors.accent }} />
                <span className="theme-swatch__dot" style={{ background: t.colors.accent2 }} />
              </span>
              <span className="theme-item__name">{t.name}</span>
              {t.id === currentId && (
                <i className="ti ti-check theme-item__check" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
