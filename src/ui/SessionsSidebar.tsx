import React, { useState } from 'react';
import type { Session } from './CenterArea';
import type { AgentState } from '../terminal/agents';

export interface SessionsSidebarProps {
  sessions: Session[];
  activeSessionId: string;
  activeKind: 'term' | 'file';
  /** Live agent state keyed by pane (terminal) id. */
  agentsByPane: Record<string, AgentState>;
  /** Sessions that finished while not focused — show an attention ring. */
  attention: Record<string, boolean>;
  autoClaude: boolean;
  hasWorkspace: boolean;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onNewTerminal: () => void;
  onNewAgent: (branch: string) => void;
  onSplit: (dir: 'row' | 'col') => void;
  onToggleAutoClaude: () => void;
  onManageWorktrees: () => void;
}

function sessionWorking(s: Session, agents: Record<string, AgentState>): boolean {
  return s.panes.some((p) => agents[p.id]?.working);
}

/**
 * Vertical sessions rail (cmux-style): every Claude/terminal session at a glance
 * with its branch, live working status and an attention ring when a background
 * session finishes. Spawns plain terminals or isolated worktree agents.
 */
export default function SessionsSidebar({
  sessions,
  activeSessionId,
  activeKind,
  agentsByPane,
  attention,
  autoClaude,
  hasWorkspace,
  onSelectSession,
  onCloseSession,
  onNewTerminal,
  onNewAgent,
  onSplit,
  onToggleAutoClaude,
  onManageWorktrees,
}: SessionsSidebarProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [branch, setBranch] = useState('');

  const submitAgent = (): void => {
    const b = branch.trim();
    if (!b) return;
    onNewAgent(b);
    setBranch('');
    setCreating(false);
  };

  return (
    <aside className="sessions">
      <div className="sessions__head">
        <span className="sessions__title">sessões</span>
        <button
          type="button"
          className="sessions__split"
          onClick={onManageWorktrees}
          disabled={!hasWorkspace}
          title="Gerenciar worktrees (mergear / remover agentes)"
          aria-label="Gerenciar worktrees"
        >
          <i className="ti ti-git-fork" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sessions__split"
          onClick={() => onSplit('row')}
          title="Dividir painel verticalmente (lado a lado)"
          aria-label="Dividir vertical"
        >
          <i className="ti ti-layout-columns" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sessions__split"
          onClick={() => onSplit('col')}
          title="Dividir painel horizontalmente (um sobre o outro)"
          aria-label="Dividir horizontal"
        >
          <i className="ti ti-layout-rows" aria-hidden="true" />
        </button>
      </div>

      <div className="sessions__list">
        {sessions.map((s) => {
          const active = activeKind === 'term' && s.id === activeSessionId;
          const working = sessionWorking(s, agentsByPane);
          const ring = !!attention[s.id] && !active;
          return (
            <div
              key={s.id}
              className={`session-row ${active ? 'session-row--active' : ''} ${
                ring ? 'session-row--attn' : ''
              }`}
              onClick={() => onSelectSession(s.id)}
              title={s.branch ? `${s.title} · ${s.branch}` : s.title}
            >
              <span
                className={`session-row__status ${working ? 'session-row__status--on' : ''}`}
                aria-hidden="true"
              />
              <div className="session-row__body">
                <div className="session-row__title">
                  {s.title}
                  {s.panes.length > 1 && (
                    <span className="session-row__panes">{s.panes.length}</span>
                  )}
                </div>
                {s.branch && (
                  <div className="session-row__branch">
                    <i className="ti ti-git-branch" aria-hidden="true" /> {s.branch}
                  </div>
                )}
              </div>
              {ring && <span className="session-row__dot" aria-hidden="true" />}
              {sessions.length > 1 && (
                <button
                  type="button"
                  className="session-row__close"
                  aria-label={`Fechar ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSession(s.id);
                  }}
                >
                  <svg width="9" height="9" viewBox="0 0 9 9" stroke="currentColor" strokeWidth="1.2">
                    <path d="M1 1 L8 8 M8 1 L1 8" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {creating && (
        <div className="sessions__newagent">
          <input
            autoFocus
            className="sessions__branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAgent();
              else if (e.key === 'Escape') {
                setCreating(false);
                setBranch('');
              }
            }}
            placeholder="branch (ex: feat/login)"
            spellCheck={false}
          />
          <button type="button" className="sessions__branch-go" onClick={submitAgent} title="Criar agente">
            <i className="ti ti-arrow-right" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="sessions__foot">
        <button type="button" className="sessions__new" onClick={onNewTerminal} title="Novo terminal">
          <i className="ti ti-plus" aria-hidden="true" /> Terminal
        </button>
        <button
          type="button"
          className="sessions__new sessions__new--agent"
          onClick={() => setCreating((c) => !c)}
          disabled={!hasWorkspace}
          title={
            hasWorkspace
              ? 'Novo agente em worktree isolado (branch próprio)'
              : 'Abra um projeto git para criar agentes em worktree'
          }
        >
          <i className="ti ti-git-branch" aria-hidden="true" /> Agente
        </button>
        <button
          type="button"
          className={`sessions__autoclaude ${autoClaude ? 'sessions__autoclaude--on' : ''}`}
          onClick={onToggleAutoClaude}
          title={
            autoClaude
              ? 'Auto-Claude ligado: novas sessões abrem no Claude.'
              : 'Auto-Claude desligado: novas sessões são shell.'
          }
          aria-label="Alternar auto-claude"
        >
          <i className="ti ti-sparkles" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
