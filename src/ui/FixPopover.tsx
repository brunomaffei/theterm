import React, { useEffect, useState } from 'react';
import { fixError } from '../ai/client';
import type { Block, Fix } from '../types';

export interface FixPopoverProps {
  block: Block;
  onClose: () => void;
  onApply: (cmd: string) => void;
}

type Phase = 'loading' | 'result' | 'error';

const OUTPUT_LIMIT = 4000;

export default function FixPopover({
  block,
  onClose,
  onApply,
}: FixPopoverProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading');
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError('');
    fixError(block.command, block.output, block.exitCode ?? 1)
      .then((result) => {
        if (cancelled) return;
        setFix(result);
        setPhase('result');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [block]);

  const snippet =
    block.output.length > OUTPUT_LIMIT
      ? `…${block.output.slice(-OUTPUT_LIMIT)}`
      : block.output;

  async function copyFix(): Promise<void> {
    if (!fix) return;
    try {
      await navigator.clipboard.writeText(fix.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card fix-popover" role="dialog" aria-modal="true" aria-label="Corrigir erro">
        <div className="fix-popover__header">
          <span className="fix-popover__spark">✨</span>
          <h2 className="fix-popover__title">Corrigir com Claude</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="fix-popover__failed">
          <span className="fix-popover__label">Comando que falhou</span>
          <code className="fix-popover__cmd">
            {block.command.trim() || '(comando desconhecido)'}
          </code>
          <span className="exit-badge exit-badge--err">
            exit {block.exitCode ?? 1}
          </span>
        </div>

        <div className="fix-popover__output-wrap">
          <span className="fix-popover__label">Saída</span>
          <pre className="fix-popover__output">
            <code>{snippet || '(sem saída capturada)'}</code>
          </pre>
        </div>

        {phase === 'loading' && (
          <div className="palette__status">
            <span className="spinner" aria-hidden="true" />
            Analisando o erro…
          </div>
        )}

        {phase === 'result' && fix && (
          <div className="fix-popover__result">
            <p className="fix-popover__diagnosis">{fix.diagnosis}</p>
            <span className="fix-popover__label">Correção sugerida</span>
            <pre className="cmd-preview">
              <code>{fix.command}</code>
            </pre>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onApply(fix.command)}
              >
                Aplicar correção
              </button>
              <button type="button" className="btn" onClick={() => void copyFix()}>
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="fix-popover__result">
            <div className="error-banner">Falha ao analisar: {error}</div>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
