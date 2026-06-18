import React, { useState } from 'react';
import type { Block } from '../types';

export interface BlocksPanelProps {
  blocks: Block[];
  onFix: (block: Block) => void;
  onRerun: (block: Block) => void;
}

function formatDuration(block: Block): string {
  if (block.endedAt == null) return '—';
  const ms = Math.max(0, block.endedAt - block.startedAt);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

function StatusDot({ status }: { status: Block['status'] }): JSX.Element {
  return <span className={`status-dot status-dot--${status}`} aria-hidden="true" />;
}

function ExitBadge({ block }: { block: Block }): JSX.Element | null {
  if (block.status === 'running') {
    return <span className="exit-badge exit-badge--running">running</span>;
  }
  if (block.exitCode == null) return null;
  const ok = block.exitCode === 0;
  return (
    <span className={`exit-badge ${ok ? 'exit-badge--ok' : 'exit-badge--err'}`}>
      exit {block.exitCode}
    </span>
  );
}

function IconRerun(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M11.5 7a4.5 4.5 0 1 1-1.32-3.18" />
      <path d="M11.5 1.5V4H9" />
    </svg>
  );
}

function IconCopy(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.3" />
      <path d="M2.5 9.5H2a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v.5" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className={`chevron ${open ? 'chevron--open' : ''}`}
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`icon-btn ${copied ? 'icon-btn--ok' : ''}`}
      title={copied ? 'copiado!' : 'copiar saída'}
      aria-label="copiar saída"
      disabled={!text}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => {});
      }}
    >
      {copied ? '✓' : <IconCopy />}
    </button>
  );
}

function BlockCard({
  block,
  onFix,
  onRerun,
}: {
  block: Block;
  onFix: (b: Block) => void;
  onRerun: (b: Block) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const label = block.command.trim() || '(comando desconhecido)';
  const hasOutput = block.output.trim().length > 0;

  return (
    <li className={`block-card block-card--${block.status}`}>
      <div
        className="block-card__head"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <StatusDot status={block.status} />
        <code className="block-card__cmd" title={label}>
          {label}
        </code>
        <CopyButton text={block.output} />
        <button
          type="button"
          className="icon-btn"
          title="rodar de novo"
          aria-label="rodar de novo"
          onClick={(e) => {
            e.stopPropagation();
            onRerun(block);
          }}
          disabled={!block.command.trim()}
        >
          <IconRerun />
        </button>
        <Chevron open={open} />
      </div>

      <div className="block-card__meta">
        <ExitBadge block={block} />
        <span className="block-card__dur">{formatDuration(block)}</span>
      </div>

      {open && (
        <pre className="block-card__output">
          <code>{hasOutput ? block.output : '(sem saída capturada)'}</code>
        </pre>
      )}

      {block.status === 'error' && (
        <button type="button" className="fix-btn" onClick={() => onFix(block)}>
          ✨ Corrigir com Claude
        </button>
      )}
    </li>
  );
}

export default function BlocksPanel({
  blocks,
  onFix,
  onRerun,
}: BlocksPanelProps): JSX.Element {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const errorCount = blocks.filter((b) => b.status === 'error').length;

  const ordered = [...blocks]
    .reverse()
    .filter((b) => (onlyErrors ? b.status === 'error' : true));

  return (
    <div className="blocks-pane">
      <div className="blocks-pane__toolbar">
        <span className="blocks-pane__hint">histórico de comandos</span>
        <button
          type="button"
          className={`filter-toggle ${onlyErrors ? 'filter-toggle--on' : ''}`}
          onClick={() => setOnlyErrors((v) => !v)}
          title="Mostrar só os comandos que falharam"
          disabled={errorCount === 0 && !onlyErrors}
        >
          só erros{errorCount > 0 ? ` (${errorCount})` : ''}
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="blocks-empty">
          <div className="blocks-empty__icon">
            {onlyErrors ? '✓' : '▦'}
          </div>
          <p className="blocks-empty__title">
            {onlyErrors ? 'Nenhum erro' : 'Nenhum comando ainda'}
          </p>
          <p className="blocks-empty__hint">
            {onlyErrors
              ? 'Tudo rodou com sucesso até agora.'
              : 'Rode um comando no terminal e cada execução vira um bloco aqui — com status, saída e correção por IA.'}
          </p>
        </div>
      ) : (
        <ul className="blocks-list">
          {ordered.map((block) => (
            <BlockCard key={block.id} block={block} onFix={onFix} onRerun={onRerun} />
          ))}
        </ul>
      )}
    </div>
  );
}
