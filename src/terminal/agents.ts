// Passive activity detector: watches the (decoded) terminal output stream for
// signs of Claude working — tool calls, subagents, the thinking spinner — and
// emits an ambient "agents working" state. Heuristic by nature (the CLI's TUI
// is not a formal API), tuned to be lenient.

export interface AgentWorker {
  id: number;
  tool: string;
  detail: string;
  active: boolean;
}

export interface AgentState {
  working: boolean;
  workers: AgentWorker[];
  actions: number;
  startedAt: number | null;
}

interface IW extends AgentWorker {
  ts: number;
}

const KNOWN = new Set([
  'Task',
  'Bash',
  'Read',
  'Edit',
  'MultiEdit',
  'Write',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'TodoWrite',
  'LS',
  'Search',
  'Fetch',
]);

// Subagent / agent-type names the newer Claude Code shows in its live
// "background agents" view (e.g. "○ Explore  Searching …"). These are NOT tool
// calls, so they live outside KNOWN and are matched on their own line shape.
const AGENT_TYPES = new Set([
  'Explore',
  'Plan',
  'Agent',
  'General',
  'Search',
  'Research',
  'Review',
  'Build',
  'Debug',
  'Subagent',
]);

const SPINNER = /[✻✶✳✢✽✺✷✸✹✦✱✲⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠛⠟⠿⣷⣯⣟⡿⢿⣻⣽⣾]/;
const TOOL_PAREN = /\b([A-Z][A-Za-z0-9]+)\(([^)\n]{0,80})/g;
const TOOL_BULLET = /[●⏺•◆]\s*([A-Z][A-Za-z0-9]+)\b[ \t]*([^\n]{0,60})/g;
// Newer Claude Code agent-status lines: a status glyph, the agent name, then
// the live action — e.g. "○ Explore  Reading foo.ts        1m 1s · ↓ 99.9k tokens".
const AGENT_LINE = /[●○◌◍◯⊙]\s+([A-Za-z][A-Za-z-]{1,20})\s{2,}([^\n]{1,90})/g;
// Strong "Claude is working" cues independent of any tool call: the background
// agents banner, the per-agent token counter, and the interrupt hint.
const BG_SIGNAL = /background agents?\b|[↑↓]\s*[\d.]+\s*k?\s*tokens|esc to interrupt/i;
// Task lines under "N background agents launched": "├ Find TO legend code".
const TREE_ITEM = /[├└]\s*([A-Za-z][^\n]{2,60})/g;

// Drop the trailing metrics column ("  1m 13s · ↓ 78.7k tokens") that Claude
// right-aligns after the action text, leaving just the human-readable action.
function cleanDetail(s: string): string {
  return s
    .replace(/\s+[↑↓]\s*[\d.]+\s*k?\s*tokens?\b/gi, '')
    .replace(/\s+\d+m(\s*\d+s)?\b/g, '')
    .replace(/\s+\d+s\b/g, '')
    .replace(/\s*·\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// The "· trabalhando" pulse/label turns off this long after the last signal,
// at which point every row settles into a checkmark. Generous on purpose:
// Claude pauses (thinking, network) between tool calls, and a short window
// made the state flip working->idle->working — read as a flickering count.
const WORKING_OFF_MS = 9000;
// The panel stays MOUNTED (showing the finished run) until this long after the
// last signal, so the routine pauses between Claude's steps don't unmount and
// remount it — which is what made the side panel look like it kept restarting.
const PANEL_LINGER_MS = 15000;
// Coalesce emits on the hot path: the spinner animates ~10fps and each frame is
// a fresh pty chunk, which would otherwise re-render the tree on every frame.
const EMIT_THROTTLE_MS = 180;

function stripAnsi(s: string): string {
  return (
    s
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  );
}

export class ActivityDetector {
  private workers: IW[] = [];
  private seq = 0;
  private working = false;
  private actions = 0;
  private startedAt: number | null = null;
  private lastSignal = 0;
  private timer: number | null = null;
  private emitTimer: number | null = null;
  private lastEmit = 0;
  private readonly onChange: (s: AgentState) => void;

  constructor(onChange: (s: AgentState) => void) {
    this.onChange = onChange;
  }

  feed(raw: string): void {
    const text = stripAnsi(raw);
    let sawSignal = false;

    if (SPINNER.test(text) || BG_SIGNAL.test(text)) {
      sawSignal = true;
    }

    const seen = new Set<string>();
    const push = (tool: string, detail: string): void => {
      const key = `${tool}:${detail}`.slice(0, 80);
      if (seen.has(key)) return;
      seen.add(key);
      sawSignal = true;
      this.addWorker(tool, detail.trim());
    };
    const add = (tool: string, detail: string): void => {
      if (!KNOWN.has(tool)) return;
      push(tool, detail);
    };

    let m: RegExpExecArray | null;
    TOOL_PAREN.lastIndex = 0;
    while ((m = TOOL_PAREN.exec(text))) add(m[1], m[2]);
    TOOL_BULLET.lastIndex = 0;
    while ((m = TOOL_BULLET.exec(text))) add(m[1], m[2]);

    // Newer Claude Code "background agents" view: "○ Explore  Reading foo.ts".
    AGENT_LINE.lastIndex = 0;
    while ((m = AGENT_LINE.exec(text))) {
      const name = m[1];
      if (name === 'main' || name === 'master') continue; // the branch row
      // Accept a known agent/tool name, or any row that carries a token counter
      // (an unmistakable Claude agent line) so future agent types still show.
      const isAgent =
        AGENT_TYPES.has(name) ||
        KNOWN.has(name) ||
        /[↑↓]\s*[\d.]+\s*k?\s*tokens/i.test(m[2]);
      if (!isAgent) continue;
      const detail = cleanDetail(m[2]);
      if (detail) push(name, detail);
    }

    // Subagent task list under "N background agents launched".
    if (/background agents?/i.test(text)) {
      TREE_ITEM.lastIndex = 0;
      while ((m = TREE_ITEM.exec(text))) {
        const task = m[1].trim();
        if (task) push('Task', task);
      }
    }

    if (sawSignal) {
      this.lastSignal = Date.now();
      if (!this.working) {
        this.working = true;
        this.startedAt = Date.now();
        this.actions = 0;
      }
      this.ensureTimer();
      this.scheduleEmit();
    }
  }

  private addWorker(tool: string, detail: string): void {
    this.actions += 1;
    const now = Date.now();
    const existing = this.workers.find(
      (w) => w.tool === tool && w.active && now - w.ts < 1500,
    );
    if (existing) {
      if (detail) existing.detail = detail;
      existing.ts = now;
      return;
    }
    // A new action started, so the previous ones are effectively finished:
    // settle them into checkmarks and let only the newest one spin.
    for (const w of this.workers) w.active = false;
    this.workers.push({ id: ++this.seq, tool, detail, active: true, ts: now });
    while (this.workers.length > 6) this.workers.shift();
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 900);
  }

  private tick(): void {
    const now = Date.now();
    let changed = false;

    // The pulse + the spinning row reflect recent activity. We deliberately do
    // NOT expire individual workers on a short per-worker timer: a long-running
    // tool (Bash, a subagent) emits no repeat hit, so that made the active
    // count flicker 1 -> 0 -> 1. Instead, once Claude has been quiet for
    // WORKING_OFF_MS the whole run is done — drop the pulse and settle every
    // row into a checkmark at once.
    if (this.working && now - this.lastSignal > WORKING_OFF_MS) {
      this.working = false;
      this.startedAt = null;
      for (const w of this.workers) w.active = false;
      changed = true;
    }

    // Keep the panel mounted (showing the finished run) across short pauses;
    // only wipe + stop ticking once Claude has been idle for a good while.
    if (!this.working && now - this.lastSignal > PANEL_LINGER_MS) {
      if (this.workers.length > 0) {
        this.workers = [];
        changed = true;
      }
      if (this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    }

    if (changed) this.emit();
  }

  // Trailing-edge throttle: emit at most once per EMIT_THROTTLE_MS so a burst
  // of spinner frames collapses into a single re-render, while the final state
  // of any burst is always delivered.
  private scheduleEmit(): void {
    const now = Date.now();
    const since = now - this.lastEmit;
    if (since >= EMIT_THROTTLE_MS) {
      this.lastEmit = now;
      this.emit();
    } else if (this.emitTimer === null) {
      this.emitTimer = window.setTimeout(() => {
        this.emitTimer = null;
        this.lastEmit = Date.now();
        this.emit();
      }, EMIT_THROTTLE_MS - since);
    }
  }

  private emit(): void {
    try {
      this.onChange({
        working: this.working,
        workers: this.workers.map((w) => ({
          id: w.id,
          tool: w.tool,
          detail: w.detail,
          active: w.active,
        })),
        actions: this.actions,
        startedAt: this.startedAt,
      });
    } catch {
      /* never break terminal flow */
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.emitTimer !== null) {
      window.clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
  }
}
