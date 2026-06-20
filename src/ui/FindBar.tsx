import React, { useEffect, useRef, useState } from 'react';

export interface FindBarProps {
  /** Run a search; return false when there is no match. */
  onSearch: (term: string, opts: { back: boolean }) => boolean;
  onClose: () => void;
}

/**
 * Compact in-terminal search bar (Ctrl/Cmd+F). Enter → next match,
 * Shift+Enter → previous, Esc → close. Highlights are owned by the terminal's
 * SearchAddon; this is just the control surface.
 */
export default function FindBar({ onSearch, onClose }: FindBarProps): JSX.Element {
  const [term, setTerm] = useState('');
  const [noMatch, setNoMatch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const run = (back: boolean): void => {
    if (!term) {
      setNoMatch(false);
      return;
    }
    setNoMatch(!onSearch(term, { back }));
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="findbar" role="search">
      <i className="ti ti-search findbar__ic" aria-hidden="true" />
      <input
        ref={inputRef}
        className={`findbar__input ${noMatch ? 'findbar__input--nomatch' : ''}`}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setNoMatch(false);
        }}
        onKeyDown={onKeyDown}
        placeholder="Buscar no terminal…"
        spellCheck={false}
        aria-label="Buscar no terminal"
      />
      {noMatch && <span className="findbar__hint">sem resultados</span>}
      <button
        type="button"
        className="findbar__btn"
        onClick={() => run(true)}
        title="Anterior (Shift+Enter)"
        aria-label="Resultado anterior"
      >
        <i className="ti ti-chevron-up" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="findbar__btn"
        onClick={() => run(false)}
        title="Próximo (Enter)"
        aria-label="Próximo resultado"
      >
        <i className="ti ti-chevron-down" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="findbar__btn findbar__btn--close"
        onClick={onClose}
        title="Fechar (Esc)"
        aria-label="Fechar busca"
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  );
}
