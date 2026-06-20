import React, { useEffect, useRef } from 'react';
import { TerminalController } from '../terminal/TerminalController';
import type { AgentState } from '../terminal/agents';
import type { Block } from '../types';
import type { Theme } from '../theme';

export interface TerminalViewProps {
  id: string;
  /** Whether this pane's session is the visible one (controls display). */
  visible: boolean;
  /** Whether this is the focused pane within the visible session. */
  focused: boolean;
  initialTheme: Theme;
  cwd?: string;
  boot?: string;
  onBlocks: (id: string, blocks: Block[]) => void;
  onAgents?: (id: string, state: AgentState) => void;
  onNotify?: (id: string, n: { title?: string; body: string }) => void;
  registerController: (id: string, controller: TerminalController | null) => void;
  /** Notify the parent that this pane was clicked (so it becomes the active pane). */
  onFocusRequest?: (id: string) => void;
  /** Show a close control (only when the session has more than one pane). */
  closable?: boolean;
  onClose?: () => void;
}

/**
 * One xterm-backed terminal pane. Owns its TerminalController, registers it with
 * the parent, and stays mounted but hidden when its session isn't visible so its
 * shell/scrollback survive session switches. Sizing is automatic (the controller
 * watches the host with a ResizeObserver), so splits just work.
 */
export default function TerminalView({
  id,
  visible,
  focused,
  initialTheme,
  cwd,
  boot,
  onBlocks,
  onAgents,
  onNotify,
  registerController,
  onFocusRequest,
  closable,
  onClose,
}: TerminalViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<TerminalController | null>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (inited.current || !hostRef.current) return;
    inited.current = true;

    const controller = new TerminalController({
      container: hostRef.current,
      onBlocks: (b) => onBlocks(id, b),
      onAgents: onAgents ? (s) => onAgents(id, s) : undefined,
      onNotify: onNotify ? (n) => onNotify(id, n) : undefined,
      initialTheme,
      cwd,
      bootCommand: boot,
    });
    ctrlRef.current = controller;
    registerController(id, controller);
    void controller.start();

    return () => {
      registerController(id, null);
      controller.dispose();
      ctrlRef.current = null;
      inited.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When this pane becomes visible/focused, fit + focus once the layout settles.
  useEffect(() => {
    if (!visible) return;
    const c = ctrlRef.current;
    if (!c) return;
    const raf = requestAnimationFrame(() => {
      c.fit();
      if (focused) c.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, focused]);

  return (
    <div
      className={`xterm-pane ${focused ? 'xterm-pane--focused' : ''}`}
      style={{ display: visible ? 'flex' : 'none' }}
      onMouseDown={() => onFocusRequest?.(id)}
    >
      {closable && (
        <button
          type="button"
          className="xterm-pane__close"
          title="Fechar painel"
          aria-label="Fechar painel"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 1 L8 8 M8 1 L1 8" />
          </svg>
        </button>
      )}
      <div ref={hostRef} className="xterm-host" />
    </div>
  );
}
