import React from 'react';
import type { AiStatus, ClaudeInfo } from '../types';
import { modKey } from '../platform';
import ClaudeMascot from './ClaudeMascot';

export interface StatusBarProps {
  aiStatus: AiStatus | null;
  workspace: string | null;
  claudeInfo: ClaudeInfo | null;
  updating: boolean;
  /** Live Claude context size for the active terminal (absolute tokens). */
  tokens: number | null;
  notifyOnDone: boolean;
  onConfigureKey: () => void;
  onUpdateClaude: () => void;
  onVerify: () => void;
  onDiff: () => void;
  onToggleNotify: () => void;
}

function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** "99.9k" / "1.2M" style compact token count. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export default function StatusBar({
  aiStatus,
  workspace,
  claudeInfo,
  updating,
  tokens,
  notifyOnDone,
  onConfigureKey,
  onUpdateClaude,
  onVerify,
  onDiff,
  onToggleNotify,
}: StatusBarProps): JSX.Element {
  const provider = aiStatus?.provider ?? 'none';
  const configured = aiStatus?.configured ?? false;

  let title = 'IA offline — clique para configurar (Claude CLI ou chave da API)';
  if (provider === 'claude-cli') {
    title = 'Claude online (Claude CLI) — clique para opções';
  } else if (provider === 'api-key') {
    title = 'Claude online (via ANTHROPIC_API_KEY) — clique para trocar a chave';
  }

  return (
    <footer className="statusbar">
      <div className="statusbar__left">
        <button
          type="button"
          className={`claude-status ${configured ? 'claude-status--on' : 'claude-status--off'}`}
          onClick={onConfigureKey}
          title={title}
          aria-label={configured ? 'Claude online' : 'Claude offline'}
        >
          <ClaudeMascot />
        </button>
        {workspace && (
          <span className="statusbar__ws" title={workspace}>
            <i className="ti ti-folder" aria-hidden="true" /> {baseName(workspace)}
          </span>
        )}
        {tokens != null && (
          <span
            className="statusbar__tokens"
            title="Tamanho de contexto da sessão Claude ativa (não é custo de cobrança)"
          >
            <i className="ti ti-clock-hour-4" aria-hidden="true" /> {fmtTokens(tokens)} tok
          </span>
        )}
      </div>

      <div className="statusbar__right">
        <button
          type="button"
          className={`notify-toggle ${notifyOnDone ? 'notify-toggle--on' : ''}`}
          onClick={onToggleNotify}
          title={
            notifyOnDone
              ? 'Notificar quando o Claude terminar (em segundo plano): ligado'
              : 'Notificar quando o Claude terminar: desligado'
          }
          aria-label="Alternar notificações"
        >
          <i className={`ti ${notifyOnDone ? 'ti-bell' : 'ti-bell-off'}`} aria-hidden="true" />
        </button>
        {workspace && (
          <button
            type="button"
            className="verify-trigger"
            onClick={onDiff}
            title="Ver o diff das mudanças + checkpoints (rollback)"
          >
            <i className="ti ti-git-compare" aria-hidden="true" /> Mudanças
          </button>
        )}
        {workspace && (
          <button
            type="button"
            className="verify-trigger"
            onClick={onVerify}
            title="Verificar mudanças: revisão de IA + testes → veredito antes do commit"
          >
            <i className="ti ti-shield-check" aria-hidden="true" /> Verificar
          </button>
        )}
        {claudeInfo?.available && (
          <button
            type="button"
            className="claude-pill"
            onClick={onUpdateClaude}
            disabled={updating}
            title="Clique para verificar/atualizar o Claude"
          >
            {updating ? (
              <>
                <span className="spinner spinner--xs" aria-hidden="true" /> atualizando…
              </>
            ) : (
              <>
                <i className="ti ti-sparkles" aria-hidden="true" />
                Claude {claudeInfo.version || '?'}
                <i className="ti ti-refresh claude-pill__refresh" aria-hidden="true" />
              </>
            )}
          </button>
        )}
        <span className="statusbar__hint">
          <kbd>{modKey}</kbd>
          <kbd>K</kbd> paleta
        </span>
      </div>
    </footer>
  );
}
