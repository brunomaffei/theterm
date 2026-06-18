import React, { useEffect, useRef, useState } from 'react';
import { suggestCommand, aiSetKey } from '../ai/client';
import type { Suggestion } from '../types';
import { loadHistory, pushHistory, type HistoryItem } from '../storage';

export interface CommandPaletteProps {
  onClose: () => void;
  onInsert: (cmd: string) => void;
  onRun: (cmd: string) => void;
}

type Phase = 'idle' | 'loading' | 'result' | 'error' | 'needs-key';

function looksLikeMissingKey(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('api key') ||
    m.includes('api_key') ||
    m.includes('chave') ||
    m.includes('not configured') ||
    m.includes('unauthorized') ||
    m.includes('401')
  );
}

export default function CommandPalette({
  onClose,
  onInsert,
  onRun,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function runSuggest(q: string): Promise<void> {
    const trimmed = q.trim();
    if (!trimmed) return;
    setPhase('loading');
    setError('');
    setSuggestion(null);
    try {
      const result = await suggestCommand(trimmed);
      setSuggestion(result);
      setPhase('result');
      setHistory(pushHistory({ query: trimmed, command: result.command }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase(looksLikeMissingKey(message) ? 'needs-key' : 'error');
    }
  }

  async function saveKeyAndRetry(): Promise<void> {
    const key = apiKey.trim();
    if (!key) return;
    setPhase('loading');
    setError('');
    try {
      await aiSetKey(key);
      setApiKey('');
      await runSuggest(query);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase('error');
    }
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    void runSuggest(query);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowUp' && !query && history.length > 0) {
      e.preventDefault();
      setQuery(history[0].query);
    }
  }

  const showRecents = phase === 'idle' && !query.trim() && history.length > 0;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card palette pop-in"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
      >
        <form className="palette__form" onSubmit={handleSubmit}>
          <span className="palette__spark">✨</span>
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Descreva o que quer fazer… (ex: descompactar arquivo.zip na pasta build)"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="btn btn--ghost"
            disabled={phase === 'loading' || !query.trim()}
          >
            {phase === 'loading' ? '…' : 'Sugerir'}
          </button>
        </form>

        {showRecents && (
          <div className="palette__recents">
            <span className="palette__recents-label">Recentes</span>
            {history.slice(0, 6).map((item, i) => (
              <button
                key={`${item.query}-${i}`}
                type="button"
                className="recent-item"
                onClick={() => {
                  setQuery(item.query);
                  void runSuggest(item.query);
                }}
              >
                <span className="recent-item__q">{item.query}</span>
                <code className="recent-item__cmd">{item.command}</code>
              </button>
            ))}
          </div>
        )}

        {phase === 'loading' && (
          <div className="palette__status">
            <span className="spinner" aria-hidden="true" />
            Pedindo uma sugestão ao Claude…
          </div>
        )}

        {phase === 'result' && suggestion && (
          <div className="palette__result">
            {suggestion.danger && (
              <div className="warning-banner">
                ⚠ Comando potencialmente perigoso — revise antes de executar.
              </div>
            )}
            <pre className="cmd-preview">
              <code>{suggestion.command}</code>
            </pre>
            <p className="palette__explanation">{suggestion.explanation}</p>
            <div className="modal-actions">
              <button
                type="button"
                className={`btn btn--primary ${suggestion.danger ? 'btn--danger' : ''}`}
                onClick={() => {
                  onRun(suggestion.command);
                  onClose();
                }}
              >
                Executar
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onInsert(suggestion.command);
                  onClose();
                }}
              >
                Inserir
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {phase === 'needs-key' && (
          <div className="palette__result">
            <div className="warning-banner">
              Nenhuma chave da API Anthropic configurada. Cole sua chave para continuar.
            </div>
            {error && <div className="error-banner">{error}</div>}
            <input
              className="key-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void saveKeyAndRetry()}
                disabled={!apiKey.trim()}
              >
                Salvar e tentar de novo
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="palette__result">
            <div className="error-banner">Falha ao sugerir: {error}</div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void runSuggest(query)}
                disabled={!query.trim()}
              >
                Tentar de novo
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        )}

        <div className="palette__footer">
          <span><kbd>Enter</kbd> sugerir</span>
          <span><kbd>↑</kbd> última busca</span>
          <span><kbd>Esc</kbd> fechar</span>
        </div>
      </div>
    </div>
  );
}
