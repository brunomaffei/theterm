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
};

function iconFor(tool: string): string {
  return ICONS[tool] ?? 'ti-tool';
}

function labelFor(tool: string): string {
  return tool === 'Task' ? 'subagente' : tool;
}

export default function AgentsPanel({ state }: { state: AgentState }): JSX.Element {
  // Tick once a second while working so the elapsed time keeps counting even
  // when the detector emits no new events (long-running tools).
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!state.working) return;
    const id = window.setInterval(force, 1000);
    return () => window.clearInterval(id);
  }, [state.working]);

  const activeCount = state.workers.filter((w) => w.active).length;
  const elapsed = state.startedAt
    ? Math.max(0, Math.round((Date.now() - state.startedAt) / 1000))
    : 0;

  return (
    <aside className="agents">
      <div className="agents__header">
        <span
          className={`agents__pulse ${state.working ? 'agents__pulse--on' : ''}`}
          aria-hidden="true"
        />
        <span className="agents__title">
          agentes{state.working ? ' · trabalhando' : ''}
        </span>
        <span className="agents__count">
          {activeCount} ativo{activeCount === 1 ? '' : 's'}
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
        <i className="ti ti-bolt" aria-hidden="true" /> {state.actions}{' '}
        {state.actions === 1 ? 'ação' : 'ações'}
        {state.startedAt ? ` · ${elapsed}s` : ''}
      </div>
    </aside>
  );
}
