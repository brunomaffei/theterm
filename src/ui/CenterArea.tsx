import React from 'react';
import TerminalView from './TerminalView';
import MonacoEditor from './MonacoEditor';
import type { OpenFile } from './EditorArea';
import type { Block } from '../types';
import type { Theme } from '../theme';
import type { TerminalController } from '../terminal/TerminalController';
import type { AgentState } from '../terminal/agents';

/** A terminal pane (leaf of a session's split). Its id is also its terminal id. */
export interface Pane {
  id: string;
  cwd?: string;
  boot?: string;
}

/** A session = one tab in the sidebar; may hold several panes split row/col. */
export interface Session {
  id: string;
  title: string;
  cwd?: string;
  branch?: string;
  worktreeDir?: string;
  panes: Pane[];
  splitDir: 'row' | 'col';
  activePaneId: string;
}

export type ActiveTab = { kind: 'term' } | { kind: 'file'; path: string };

export interface CenterAreaProps {
  sessions: Session[];
  activeSessionId: string;
  activeKind: 'term' | 'file';
  files: OpenFile[];
  activeFilePath: string | null;
  theme: Theme;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onSelectPane: (sessionId: string, paneId: string) => void;
  onClosePane: (sessionId: string, paneId: string) => void;
  registerController: (id: string, controller: TerminalController | null) => void;
  onAgents: (id: string, state: AgentState) => void;
  onNotify: (id: string, n: { title?: string; body: string }) => void;
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
 * Content workbench: renders each session's pane layout (the active one visible,
 * others mounted-but-hidden to keep scrollback) plus the Monaco editor when a
 * file tab is active. Session navigation lives in the sidebar; only open files
 * get a horizontal tab strip here.
 */
export default function CenterArea({
  sessions,
  activeSessionId,
  activeKind,
  files,
  activeFilePath,
  theme,
  onSelectFile,
  onCloseFile,
  onSelectPane,
  onClosePane,
  registerController,
  onAgents,
  onNotify,
  onEditorChange,
  onEditorSave,
}: CenterAreaProps): JSX.Element {
  // Keep the editor mounted whenever a file is open (toggle display) so its
  // cursor/scroll survive switching between the terminal and the editor.
  const activeFile = activeFilePath
    ? files.find((f) => f.path === activeFilePath) ?? null
    : null;

  return (
    <div className="center">
      {files.length > 0 && (
        <div className="wb-tabs">
          {files.map((f) => (
            <div
              key={f.path}
              className={`wb-tab wb-tab--file ${
                activeKind === 'file' && activeFilePath === f.path ? 'wb-tab--active' : ''
              }`}
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
        </div>
      )}

      <div className="wb-content">
        {sessions.map((s) => {
          const sessionVisible = activeKind === 'term' && s.id === activeSessionId;
          const closable = s.panes.length > 1;
          return (
            <div
              key={s.id}
              className={`panes panes--${s.splitDir} ${closable ? 'panes--split' : ''}`}
              style={{ display: sessionVisible ? 'flex' : 'none' }}
            >
              {s.panes.map((p) => (
                <TerminalView
                  key={p.id}
                  id={p.id}
                  visible={sessionVisible}
                  focused={sessionVisible && p.id === s.activePaneId}
                  closable={closable}
                  initialTheme={theme}
                  cwd={p.cwd}
                  boot={p.boot}
                  onBlocks={NOOP_BLOCKS}
                  onAgents={onAgents}
                  onNotify={onNotify}
                  registerController={registerController}
                  onFocusRequest={(pid) => onSelectPane(s.id, pid)}
                  onClose={() => onClosePane(s.id, p.id)}
                />
              ))}
            </div>
          );
        })}

        {activeFile && (
          <div className="wb-editor-wrap" style={{ display: activeKind === 'file' ? 'flex' : 'none' }}>
            <MonacoEditor
              key="wb-editor"
              path={activeFile.path}
              value={activeFile.content}
              language={activeFile.language}
              theme={theme}
              onChange={(v) => onEditorChange(activeFile.path, v)}
              onSave={() => onEditorSave(activeFile.path)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
