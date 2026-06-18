import React, { useEffect, useRef } from 'react';
import { TerminalController } from '../terminal/TerminalController';
import type { AgentState } from '../terminal/agents';
import type { Block } from '../types';
import type { Theme } from '../theme';

export interface TerminalViewProps {
  id: string;
  active: boolean;
  initialTheme: Theme;
  cwd?: string;
  boot?: string;
  onBlocks: (id: string, blocks: Block[]) => void;
  onAgents?: (id: string, state: AgentState) => void;
  registerController: (id: string, controller: TerminalController | null) => void;
}

/**
 * One xterm-backed terminal. Owns its TerminalController, registers it with the
 * parent (so the active one can be driven), and stays mounted but hidden when
 * inactive so its shell/scrollback survive tab switches.
 */
export default function TerminalView({
  id,
  active,
  initialTheme,
  cwd,
  boot,
  onBlocks,
  onAgents,
  registerController,
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

  useEffect(() => {
    if (!active) return;
    const c = ctrlRef.current;
    if (!c) return;
    // Let the now-visible layout settle, then size + focus.
    const raf = requestAnimationFrame(() => {
      c.fit();
      c.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div
      ref={hostRef}
      className="xterm-host"
      style={{ display: active ? 'block' : 'none' }}
    />
  );
}
