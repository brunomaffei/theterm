import React from 'react';
import type { AgentState } from '../terminal/agents';

const ICONS: Record<string, string> = {
  Task: 'ti-robot',
  Bash: 'ti-terminal-2',
  Read: 'ti-file',
  Edit: 'ti-pencil',
  MultiEdit: 'ti-pencil',
  Write: 'ti-file-plus',
  Grep: 'ti-search',
  Search: 'ti-search',
  Glob: 'ti-asterisk',
  WebFetch: 'ti-world',
  Fetch: 'ti-world',
  WebSearch: 'ti-world-search',
  NotebookEdit: 'ti-notebook',
  TodoWrite: 'ti-checklist',
  LS: 'ti-folder',
  Explore: 'ti-compass',
  Plan: 'ti-map-2',
  Agent: 'ti-robot',
  General: 'ti-robot',
  Research: 'ti-zoom-scan',
  Review: 'ti-eye',
  Build: 'ti-hammer',
  Debug: 'ti-bug',
  Subagent: 'ti-robot',
};

// A few agent types get a friendlier Portuguese label; everything else shows
// its own name.
const LABELS: Record<string, string> = {
  Task: 'subagente',
  Subagent: 'subagente',
  Explore: 'explorando',
  Plan: 'planejando',
  Search: 'buscando',
  Research: 'pesquisando',
  Review: 'revisando',
  Debug: 'depurando',
};

function iconFor(tool: string): string {
  return ICONS[tool] ?? 'ti-tool';
}

/** "99.9k" / "1.2M" style compact token count. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function labelFor(tool: string): string {
  return LABELS[tool] ?? tool;
}

export default function AgentsPanel({ state }: { state: AgentState }): JSX.Element {
  // Status word driven purely by `working` (a sticky flag, ~9s window) instead
  // of a live "N active" count. The count was structurally 0 or 1 — only the
  // newest tool ever spins — so it visibly flickered 1↔0 across Claude's
  // think/network pauses. A single steady label reads calmer and truer.
  // No live stopwatch on purpose: a per-second re-render that also reset on
  // pauses read as "buggy". The detector emits on real activity; we just render.
  const status = state.working
    ? 'trabalhando'
    : state.workers.length > 0
      ? 'concluído'
      : 'ocioso';

  return (
    <aside className="agents">
      <div className="agents__header">
        <span
          className={`agents__pulse ${state.working ? 'agents__pulse--on' : ''}`}
          aria-hidden="true"
        />
        <span className="agents__title">agentes</span>
        <span className={`agents__count ${state.working ? 'agents__count--on' : ''}`}>
          {status}
        </span>
      </div>

      <div className="agents__list">
        {state.workers.length === 0 ? (
          <div className="agents__empty">
            <i className="ti ti-sparkles" aria-hidden="true" />
            <p>Quando o Claude trabalhar, os agentes aparecem aqui.</p>
          </div>
        ) : (
          state.workers
            .slice()
            .reverse()
            .map((w) => (
              <div
                key={w.id}
                className={`agent-row ${w.active ? 'agent-row--active' : 'agent-row--done'}`}
              >
                <span className="agent-row__ic">
                  <i className={`ti ${iconFor(w.tool)}`} aria-hidden="true" />
                </span>
                <div className="agent-row__body">
                  <div className="agent-row__name">{labelFor(w.tool)}</div>
                  {w.detail && <div className="agent-row__detail">{w.detail}</div>}
                </div>
                {w.active ? (
                  <span className="agent-spin" aria-hidden="true" />
                ) : (
                  <i className="ti ti-check agent-row__check" aria-hidden="true" />
                )}
              </div>
            ))
        )}
      </div>

      <div className="agents__footer">
        <span>
          <i className="ti ti-bolt" aria-hidden="true" /> {state.actions}{' '}
          {state.actions === 1 ? 'ação' : 'ações'}
        </span>
        {state.tokens != null && (
          <span className="agents__tokens" title="Tamanho de contexto da sessão (não é custo)">
            <i className="ti ti-clock-hour-4" aria-hidden="true" /> {fmtTokens(state.tokens)} tok
          </span>
        )}
      </div>
    </aside>
  );
}
