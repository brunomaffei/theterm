import React, { useState } from 'react';
import { aiSetKey } from '../ai/client';
import { modKey } from '../platform';

export interface OnboardingProps {
  onSkip: () => void;
  onSaved: () => void;
}

/**
 * First-run welcome. Shown when the AI key isn't configured yet and the user
 * hasn't dismissed onboarding. Lets them paste a key (optional) to light up
 * the AI features immediately.
 */
export default function Onboarding({ onSkip, onSaved }: OnboardingProps): JSX.Element {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(): Promise<void> {
    const k = key.trim();
    if (!k) return;
    setSaving(true);
    setError('');
    try {
      await aiSetKey(k);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop onboarding-backdrop">
      <div
        className="modal-card onboarding"
        role="dialog"
        aria-modal="true"
        aria-label="Bem-vindo ao THETERM"
      >
        <div className="onboarding__hero">
          <span className="onboarding__glyph">{'>_'}</span>
          <h1 className="onboarding__title">
            Bem-vindo ao <b>THETERM</b>
          </h1>
          <p className="onboarding__tagline">O terminal com o Claude por dentro.</p>
        </div>

        <ul className="onboarding__features">
          <li>
            <span className="onboarding__kbd">
              <kbd>{modKey}</kbd>
              <kbd>K</kbd>
            </span>
            <span>Descreva em português e o Claude vira comando</span>
          </li>
          <li>
            <span className="onboarding__feat-icon">✨</span>
            <span>Comando falhou? Corrige com um clique</span>
          </li>
          <li>
            <span className="onboarding__feat-icon">▦</span>
            <span>Cada execução vira um bloco navegável</span>
          </li>
        </ul>

        <div className="onboarding__key">
          <div className="onboarding__cli-tip">
            <span className="onboarding__feat-icon">⚡</span>
            <span>
              <b>Já usa o Claude CLI?</b> Então é só ter o <code>claude</code> instalado e
              logado — o THETERM usa seu login automaticamente, <b>sem chave nenhuma</b>.
              Instale/logue e reabra o app.
            </span>
          </div>

          <label className="field-label">Ou cole uma chave da API Anthropic</label>
          <input
            className="key-input"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <p className="onboarding__hint">
            Sem nada configurado o terminal funciona normalmente — só as funções de IA
            ficam inativas.
          </p>
          {error && <div className="error-banner">{error}</div>}
        </div>

        <div className="modal-actions onboarding__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={!key.trim() || saving}
          >
            {saving ? 'Salvando…' : 'Conectar e começar'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSkip}>
            Pular por agora
          </button>
        </div>
      </div>
    </div>
  );
}
