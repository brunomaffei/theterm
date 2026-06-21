import React, { useState } from 'react';
import type { Session } from './CenterArea';
import type { AgentState } from '../terminal/agents';
import { repoBranches, type RepoBranches } from '../worktrees/client';

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
  /** Open workspace path (for the agent base-branch picker). */
  workspace: string | null;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onNewTerminal: () => void;
  /** Spawn an agent worktree forked from `base` (auto-named branch). */
  onNewAgent: (base: string) => void;
  onSplit: (dir: 'row' | 'col') => void;
  onToggleAutoClaude: () => void;
  onManageWorktrees: () => void;
  onOpenProfile: () => void;
  canOpenProfile: boolean;
}

function sessionWorking(s: Session, agents: Record<string, AgentState>): boolean {
  return s.panes.some((p) => agents[p.id]?.working);
}

/** Order the base options: default branch first, then current, then the rest. */
function orderedBases(b: RepoBranches): { name: string; tag?: string }[] {
  const seen = new Set<string>();
  const out: { name: string; tag?: string }[] = [];
  const add = (name: string, tag?: string): void => {
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push({ name, tag });
    }
  };
  add(b.defaultBranch, 'padrão');
  add(b.current, b.current === b.defaultBranch ? undefined : 'atual');
  for (const br of b.branches) add(br);
  return out.slice(0, 8);
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
  workspace,
  onSelectSession,
  onCloseSession,
  onNewTerminal,
  onNewAgent,
  onSplit,
  onToggleAutoClaude,
  onManageWorktrees,
  onOpenProfile,
  canOpenProfile,
}: SessionsSidebarProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [branches, setBranches] = useState<RepoBranches | null>(null);
  const [loadingBr, setLoadingBr] = useState(false);

  const toggleCreating = (): void => {
    setCreating((c) => {
      const next = !c;
      if (next && workspace) {
        setLoadingBr(true);
        setBranches(null);
        repoBranches(workspace)
          .then(setBranches)
          .catch(() => setBranches({ current: '', defaultBranch: '', branches: [] }))
          .finally(() => setLoadingBr(false));
      }
      return next;
    });
  };

  const pickBase = (base: string): void => {
    onNewAgent(base);
    setCreating(false);
  };

  return (
    <aside className="sessions">
      <div className="sessions__head">
        <span className="sessions__title">sessões</span>
        <button
          type="button"
          className="sessions__split"
          onClick={onOpenProfile}
          disabled={!canOpenProfile}
          title="Preparar agentes do projeto (equipe)"
          aria-label="Preparar agentes do projeto"
        >
          <i className="ti ti-users" aria-hidden="true" />
        </button>
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
          <div className="sessions__newagent-head">
            <span>Novo agente — base</span>
            <button
              type="button"
              className="sessions__newagent-x"
              onClick={() => setCreating(false)}
              aria-label="Cancelar"
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
          {loadingBr ? (
            <div className="sessions__br-empty">
              <i className="ti ti-loader-2 spin-ic" aria-hidden="true" /> lendo branches…
            </div>
          ) : branches && (branches.defaultBranch || branches.current || branches.branches.length) ? (
            orderedBases(branches).map((b) => (
              <button
                key={b.name}
                type="button"
                className="sessions__base"
                onClick={() => pickBase(b.name)}
                title={`Criar agente (worktree) a partir de ${b.name}`}
              >
                <i className="ti ti-git-branch" aria-hidden="true" />
                <span className="sessions__base-name">{b.name}</span>
                {b.tag && <span className="sessions__base-tag">{b.tag}</span>}
              </button>
            ))
          ) : (
            <button type="button" className="sessions__base" onClick={() => pickBase('')}>
              <i className="ti ti-git-branch" aria-hidden="true" />
              <span className="sessions__base-name">da branch atual</span>
            </button>
          )}
        </div>
      )}

      <div className="sessions__foot">
        <button type="button" className="sessions__new" onClick={onNewTerminal} title="Novo terminal">
          <i className="ti ti-plus" aria-hidden="true" /> Terminal
        </button>
        <button
          type="button"
          className={`sessions__new sessions__new--agent ${creating ? 'sessions__new--on' : ''}`}
          onClick={toggleCreating}
          disabled={!hasWorkspace}
          title={
            hasWorkspace
              ? 'Novo agente em worktree isolado (escolha a base; nome automático)'
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
