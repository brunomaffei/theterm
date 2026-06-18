import React from 'react';
import TerminalView from './TerminalView';
import MonacoEditor from './MonacoEditor';
import type { OpenFile } from './EditorArea';
import type { Block } from '../types';
import type { Theme } from '../theme';
import type { TerminalController } from '../terminal/TerminalController';
import type { AgentState } from '../terminal/agents';

export interface TermItem {
  id: string;
  title: string;
  cwd?: string;
  boot?: string;
}

export type ActiveTab = { kind: 'term'; id: string } | { kind: 'file'; path: string };

export interface CenterAreaProps {
  terminals: TermItem[];
  files: OpenFile[];
  active: ActiveTab;
  theme: Theme;
  autoClaude: boolean;
  onSelectTerm: (id: string) => void;
  onNewTerm: () => void;
  onCloseTerm: (id: string) => void;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onToggleAutoClaude: () => void;
  registerController: (id: string, controller: TerminalController | null) => void;
  onAgents: (id: string, state: AgentState) => void;
  onEditorChange: (path: string, value: string) => void;
  onEditorSave: (path: string) => void;
}

const NOOP_BLOCKS = (_id: string, _blocks: Block[]): void => {};

function CloseX({ label, onClick }: { label: string; onClick: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <button type="button" className="wb-tab__close" aria-label={label} onClick={onClick}>
      <svg width="9" height="9" viewBox="0 0 9 9" stroke="currentColor" strokeWidth="1">
        <path d="M1 1 L8 8 M8 1 L1 8" />
      </svg>
    </button>
  );
}

/**
 * Terminal-first workbench: ONE big content area. Terminals and open files are
 * tabs in a single strip; the terminal fills the whole area (never cramped).
 * Clicking a file opens an editor tab alongside the terminal tab.
 */
export default function CenterArea({
  terminals,
  files,
  active,
  theme,
  autoClaude,
  onSelectTerm,
  onNewTerm,
  onCloseTerm,
  onSelectFile,
  onCloseFile,
  onToggleAutoClaude,
  registerController,
  onAgents,
  onEditorChange,
  onEditorSave,
}: CenterAreaProps): JSX.Element {
  const activeFile =
    active.kind === 'file' ? files.find((f) => f.path === active.path) ?? null : null;

  return (
    <div className="center">
      <div className="wb-tabs">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`wb-tab wb-tab--term ${active.kind === 'term' && active.id === t.id ? 'wb-tab--active' : ''}`}
            onClick={() => onSelectTerm(t.id)}
            title={t.title}
          >
            <i className="ti ti-terminal-2 wb-tab__icon" aria-hidden="true" />
            <span className="wb-tab__label">{t.title}</span>
            {terminals.length > 1 && (
              <CloseX
                label={`Fechar ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTerm(t.id);
                }}
              />
            )}
          </div>
        ))}

        <button
          type="button"
          className="wb-newterm"
          onClick={onNewTerm}
          title={autoClaude ? 'Novo terminal (abre no Claude)' : 'Novo terminal'}
          aria-label="Novo terminal"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" stroke="currentColor" strokeWidth="1.3">
            <path d="M6.5 2 V11 M2 6.5 H11" />
          </svg>
        </button>

        {files.length > 0 && <span className="wb-tabs__sep" aria-hidden="true" />}

        {files.map((f) => (
          <div
            key={f.path}
            className={`wb-tab wb-tab--file ${active.kind === 'file' && active.path === f.path ? 'wb-tab--active' : ''}`}
            onClick={() => onSelectFile(f.path)}
            title={f.path}
          >
            {f.dirty ? (
              <span className="wb-tab__dirty" aria-hidden="true" />
            ) : (
              <i className="ti ti-file wb-tab__icon" aria-hidden="true" />
            )}
            <span className="wb-tab__label">{f.name}</span>
            <CloseX
              label={`Fechar ${f.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(f.path);
              }}
            />
          </div>
        ))}

        <button
          type="button"
          className={`wb-autoclaude ${autoClaude ? 'wb-autoclaude--on' : ''}`}
          onClick={onToggleAutoClaude}
          title={
            autoClaude
              ? 'Auto-Claude ligado: novas abas abrem no Claude. Clique para desligar.'
              : 'Auto-Claude desligado: novas abas são shell. Clique para ligar.'
          }
        >
          <i className="ti ti-sparkles" aria-hidden="true" />
          auto-claude {autoClaude ? 'on' : 'off'}
        </button>
      </div>

      <div className="wb-content">
        {terminals.map((t) => (
          <TerminalView
            key={t.id}
            id={t.id}
            active={active.kind === 'term' && active.id === t.id}
            initialTheme={theme}
            cwd={t.cwd}
            boot={t.boot}
            onBlocks={NOOP_BLOCKS}
            onAgents={onAgents}
            registerController={registerController}
          />
        ))}

        {activeFile && (
          <MonacoEditor
            key="wb-editor"
            path={activeFile.path}
            value={activeFile.content}
            language={activeFile.language}
            theme={theme}
            onChange={(v) => onEditorChange(activeFile.path, v)}
            onSave={() => onEditorSave(activeFile.path)}
          />
        )}
      </div>
    </div>
  );
}
