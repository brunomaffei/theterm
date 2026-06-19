import React from 'react';
import type { AiStatus, ClaudeInfo } from '../types';
import { modKey } from '../platform';
import ClaudeMascot from './ClaudeMascot';

export interface StatusBarProps {
  aiStatus: AiStatus | null;
  workspace: string | null;
  claudeInfo: ClaudeInfo | null;
  updating: boolean;
  onConfigureKey: () => void;
  onUpdateClaude: () => void;
  onVerify: () => void;
}

function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export default function StatusBar({
  aiStatus,
  workspace,
  claudeInfo,
  updating,
  onConfigureKey,
  onUpdateClaude,
  onVerify,
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
      </div>

      <div className="statusbar__right">
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
