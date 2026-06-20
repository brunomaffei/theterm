// TerminalController: owns the xterm.js instance, the PTY bridge to Rust,
// and the shell-integration (OSC 133/633) -> Block state machine.
//
// Public API is the HARD CONTRACT relied on by the React UI:
//   constructor(opts), start(), dispose(), fit(), focus(),
//   runCommand(cmd), insertCommand(cmd), getBlocks()

import { Terminal } from '@xterm/xterm';
import type { IDisposable, IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

import type { Block, BlockStatus } from '../types';
import { xtermThemeFor, getTheme, DEFAULT_THEME_ID, type Theme } from '../theme';
import { ActivityDetector, type AgentState } from './agents';

export interface TerminalControllerOptions {
  container: HTMLElement;
  onBlocks: (blocks: Block[]) => void;
  initialTheme?: Theme;
  /** Working directory the shell should start in (e.g. the open project). */
  cwd?: string;
  /** Command auto-typed into the shell shortly after it opens (e.g. "claude"). */
  bootCommand?: string;
  /** Passive agent-activity callback (drives the "agents working" panel). */
  onAgents?: (state: AgentState) => void;
}

// Payload shapes emitted by the Rust backend.
interface PtyDataPayload {
  id: number;
  data: string; // base64 of raw pty bytes
}
interface PtyExitPayload {
  id: number;
  code: number;
}

// Terminal palettes live in ../theme.ts (XTERM_THEMES).

const ESC = '\x1b';
const BEL = '\x07';

/** Decode a base64 string into a Uint8Array of raw bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = bin.charCodeAt(i) & 0xff;
  }
  return out;
}

// UTF-8 decoding is per-instance (see TerminalController.textDecoder) so the
// streaming decoder state isn't corrupted across independent terminals.

/** Strip stray C0 control chars (keep \t and \n) for clean block output. */
function stripControlChars(s: string): string {
  // Remove ESC and other C0 controls except tab/newline; collapse \r.
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI sequences (defensive)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** Internal mutable view of a block while it is being assembled. */
interface PendingBlock {
  block: Block;
  startMarker: IMarker | null;
}

export class TerminalController {
  private readonly container: HTMLElement;
  private readonly onBlocks: (blocks: Block[]) => void;

  private term: Terminal;
  private fitAddon: FitAddon;
  private searchAddon: SearchAddon;
  private webLinksAddon: WebLinksAddon;

  private theme: Theme;
  private readonly cwd: string | null;
  private readonly bootCommand: string | null;
  private bootTimer: number | null = null;
  private readonly detector: ActivityDetector | null;
  private readonly textDecoder = new TextDecoder('utf-8', { fatal: false });
  private ptyId: number | null = null;
  private blocks: Block[] = [];
  private pending: PendingBlock | null = null;
  private blockSeq = 0;
  private closed = false;

  private disposables: IDisposable[] = [];
  private unlisteners: UnlistenFn[] = [];
  private onWindowResize = () => this.fit();

  constructor(opts: TerminalControllerOptions) {
    this.container = opts.container;
    this.onBlocks = opts.onBlocks;
    this.theme = opts.initialTheme ?? getTheme(DEFAULT_THEME_ID);
    this.cwd = opts.cwd ?? null;
    this.bootCommand = opts.bootCommand && opts.bootCommand.trim() ? opts.bootCommand.trim() : null;
    this.detector = opts.onAgents ? new ActivityDetector(opts.onAgents) : null;

    this.term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 5000,
      smoothScrollDuration: 90,
      theme: xtermThemeFor(this.theme),
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.webLinksAddon = new WebLinksAddon();
  }

  async start(): Promise<void> {
    // Make sure the web font is loaded before xterm measures glyph cells,
    // otherwise the grid is sized against the fallback font.
    await this.preloadFont();

    // Open + load addons.
    this.term.open(this.container);
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(this.webLinksAddon);
    this.safeFit();

    // Register OSC handlers BEFORE writing any pty data so markers fire.
    this.registerOscHandlers();

    // Spawn the pty sized to the current terminal.
    const cols = this.term.cols || 80;
    const rows = this.term.rows || 24;
    this.ptyId = await invoke<number>('pty_spawn', {
      cols,
      rows,
      shell: null,
      cwd: this.cwd,
    });

    // Stream pty output -> xterm (which drives OSC parsing/handlers).
    const unlistenData = await listen<PtyDataPayload>('pty:data', (event) => {
      const payload = event.payload;
      if (!payload || payload.id !== this.ptyId) return;
      const bytes = base64ToBytes(payload.data);
      this.term.write(bytes);
      if (this.detector) {
        try {
          this.detector.feed(this.textDecoder.decode(bytes, { stream: true }));
        } catch {
          // never break terminal flow
        }
      }
    });
    this.unlisteners.push(unlistenData);

    // Pty exit -> mark closed with a dim message.
    const unlistenExit = await listen<PtyExitPayload>('pty:exit', (event) => {
      const payload = event.payload;
      if (!payload || payload.id !== this.ptyId) return;
      this.closed = true;
      this.term.write(
        `\r\n${ESC}[2m[process exited with code ${payload.code}]${ESC}[0m\r\n`,
      );
    });
    this.unlisteners.push(unlistenExit);

    // Keystrokes -> pty (raw utf8).
    this.disposables.push(
      this.term.onData((d) => {
        if (this.ptyId === null || this.closed) return;
        void invoke('pty_write', { id: this.ptyId, data: d }).catch(() => {});
      }),
    );

    // Resize -> pty.
    this.disposables.push(
      this.term.onResize(({ cols: c, rows: r }) => {
        if (this.ptyId === null) return;
        void invoke('pty_resize', { id: this.ptyId, cols: c, rows: r }).catch(
          () => {},
        );
      }),
    );

    window.addEventListener('resize', this.onWindowResize);

    // Auto-run the boot command (e.g. "claude") once the shell has settled.
    if (this.bootCommand) {
      this.bootTimer = window.setTimeout(() => {
        if (this.ptyId !== null && !this.closed) {
          void invoke('pty_write', {
            id: this.ptyId,
            data: `${this.bootCommand}\r`,
          }).catch(() => {});
        }
      }, 600);
    }

    this.term.focus();
  }

  // --- OSC / block state machine -------------------------------------------

  private registerOscHandlers(): void {
    // OSC 133: prompt/command lifecycle. cb receives the payload AFTER "133;".
    // e.g. "A", "B", "C", "D;0".
    this.term.parser.registerOscHandler(133, (data: string) => {
      try {
        this.handleOsc133(data);
      } catch {
        // Defensive: never let a handler throw into xterm.
      }
      return true; // swallow so markers never render
    });

    // OSC 633: VS Code shell integration extension. We use 633;E;<urlencoded>.
    this.term.parser.registerOscHandler(633, (data: string) => {
      try {
        this.handleOsc633(data);
      } catch {
        // Defensive.
      }
      return true; // swallow
    });
  }

  private handleOsc133(data: string): void {
    // data is e.g. "A", "B", "C", "D;0", "D".
    const semi = data.indexOf(';');
    const kind = semi === -1 ? data : data.slice(0, semi);
    const rest = semi === -1 ? '' : data.slice(semi + 1);

    switch (kind) {
      case 'A': {
        // Prompt start: begin a fresh pending block.
        this.pending = {
          block: {
            id: String(++this.blockSeq),
            command: '',
            exitCode: null,
            status: 'running',
            startedAt: Date.now(),
            endedAt: null,
            output: '',
          },
          startMarker: null,
        };
        break;
      }
      case 'B': {
        // Command input start (end of prompt). Nothing to capture yet.
        break;
      }
      case 'C': {
        // Command output start: register a marker at the current line so we
        // know where this command's output begins.
        if (!this.pending) {
          // Output started without a prompt-start; synthesize a pending block.
          this.pending = {
            block: {
              id: String(++this.blockSeq),
              command: '',
              exitCode: null,
              status: 'running',
              startedAt: Date.now(),
              endedAt: null,
              output: '',
            },
            startMarker: null,
          };
        }
        let marker: IMarker | null = null;
        try {
          marker = this.term.registerMarker(0) ?? null;
        } catch {
          marker = null;
        }
        this.pending.startMarker = marker;
        this.pending.block.status = 'running';
        this.notify();
        break;
      }
      case 'D': {
        // Command finished. rest may be "<code>" or "" (unknown).
        if (!this.pending) {
          // No pending block to close; ignore.
          return;
        }
        const codeStr = rest.split(';')[0] ?? '';
        const parsed = parseInt(codeStr, 10);
        const exitCode = Number.isNaN(parsed) ? 0 : parsed;
        const status: BlockStatus = exitCode === 0 ? 'success' : 'error';

        const block = this.pending.block;
        block.exitCode = exitCode;
        block.status = status;
        block.endedAt = Date.now();
        block.output = this.captureOutput(this.pending.startMarker);

        this.blocks.push(block);
        this.pending = null;
        this.notify();
        break;
      }
      default:
        break;
    }
  }

  private handleOsc633(data: string): void {
    // We only care about "E;<urlencoded command>". Split once on ';'.
    const semi = data.indexOf(';');
    const kind = semi === -1 ? data : data.slice(0, semi);
    const value = semi === -1 ? '' : data.slice(semi + 1);

    if (kind === 'E') {
      if (!this.pending) {
        // Command line text arrived without a prompt-start; synthesize one.
        this.pending = {
          block: {
            id: String(++this.blockSeq),
            command: '',
            exitCode: null,
            status: 'running',
            startedAt: Date.now(),
            endedAt: null,
            output: '',
          },
          startMarker: null,
        };
      }
      let decoded = '';
      try {
        decoded = decodeURIComponent(value);
      } catch {
        decoded = value; // fall back to raw if malformed
      }
      this.pending.block.command = decoded;
    }
  }

  /**
   * Read the buffer text from just after the start marker up to (but not
   * including) the current command line, strip control chars, and trim.
   */
  private captureOutput(startMarker: IMarker | null): string {
    try {
      const buffer = this.term.buffer.active;
      const startLine =
        startMarker && startMarker.line >= 0 ? startMarker.line + 1 : buffer.baseY;
      const endLine = buffer.baseY + buffer.cursorY - 1; // line above the new prompt
      if (endLine < startLine) return '';

      const lines: string[] = [];
      for (let i = startLine; i <= endLine; i++) {
        const line = buffer.getLine(i);
        if (!line) continue;
        lines.push(line.translateToString(true));
      }
      return stripControlChars(lines.join('\n')).trim();
    } catch {
      return '';
    }
  }

  private notify(): void {
    try {
      this.onBlocks(this.getBlocks());
    } catch {
      // Never let UI callback errors break terminal flow.
    }
  }

  // --- Public API ----------------------------------------------------------

  getBlocks(): Block[] {
    // Shallow copy of the array (objects are treated as immutable downstream).
    return this.blocks.map((b) => ({ ...b }));
  }

  runCommand(cmd: string): void {
    if (this.ptyId === null || this.closed) return;
    void invoke('pty_write', { id: this.ptyId, data: cmd + '\r' }).catch(() => {});
  }

  insertCommand(cmd: string): void {
    if (this.ptyId === null || this.closed) return;
    void invoke('pty_write', { id: this.ptyId, data: cmd }).catch(() => {});
  }

  /**
   * Find `term` in the scrollback. Returns false when there is no match (so the
   * find bar can show a "no results" state). Pass `{ back: true }` to search
   * upwards. Highlights all matches using the active accent color.
   */
  search(term: string, opts?: { back?: boolean; caseSensitive?: boolean }): boolean {
    if (!term) {
      this.clearSearch();
      return false;
    }
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#c5f23a';
    const soft = css.getPropertyValue('--accent-line').trim() || 'rgba(197,242,58,0.3)';
    const options = {
      caseSensitive: !!opts?.caseSensitive,
      decorations: {
        matchBackground: soft,
        matchBorder: soft,
        matchOverviewRuler: accent,
        activeMatchBackground: accent,
        activeMatchBorder: accent,
        activeMatchColorOverviewRuler: accent,
      },
    };
    try {
      return opts?.back
        ? this.searchAddon.findPrevious(term, options)
        : this.searchAddon.findNext(term, options);
    } catch {
      return false;
    }
  }

  /** Clear any search highlight/decorations. */
  clearSearch(): void {
    try {
      this.searchAddon.clearDecorations();
    } catch {
      // ignore
    }
  }

  fit(): void {
    this.safeFit();
  }

  focus(): void {
    try {
      this.term.focus();
    } catch {
      // ignore
    }
  }

  /** Switch the live terminal palette. */
  setTheme(theme: Theme): void {
    this.theme = theme;
    try {
      this.term.options.theme = xtermThemeFor(theme);
    } catch {
      // ignore
    }
  }

  dispose(): void {
    if (this.bootTimer !== null) {
      window.clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    this.detector?.dispose();
    window.removeEventListener('resize', this.onWindowResize);

    for (const u of this.unlisteners) {
      try {
        u();
      } catch {
        // ignore
      }
    }
    this.unlisteners = [];

    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this.disposables = [];

    // Kill the pty.
    if (this.ptyId !== null) {
      const id = this.ptyId;
      this.ptyId = null;
      void invoke('pty_kill', { id }).catch(() => {});
    }

    // Dispose addons + terminal.
    try {
      this.searchAddon.dispose();
    } catch {
      // ignore
    }
    try {
      this.webLinksAddon.dispose();
    } catch {
      // ignore
    }
    try {
      this.fitAddon.dispose();
    } catch {
      // ignore
    }
    try {
      this.term.dispose();
    } catch {
      // ignore
    }
  }

  // --- Internals -----------------------------------------------------------

  private safeFit(): void {
    try {
      this.fitAddon.fit();
    } catch {
      // Container may not be laid out yet; ignore.
    }
  }

  /** Wait (briefly) for JetBrains Mono to be ready so glyph metrics are right. */
  private async preloadFont(): Promise<void> {
    try {
      const fonts = document.fonts;
      if (!fonts || typeof fonts.load !== 'function') return;
      await Promise.race([
        Promise.all([
          fonts.load('400 14px "JetBrains Mono"'),
          fonts.load('700 14px "JetBrains Mono"'),
        ]),
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
      ]);
    } catch {
      // Never block terminal startup on font loading.
    }
  }

}
