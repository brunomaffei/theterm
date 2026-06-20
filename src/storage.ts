// Lightweight persisted UI state: AI command history + onboarding flag.

const HISTORY_KEY = 'theterm.history';
const ONBOARDED_KEY = 'theterm.onboarded';
const HISTORY_MAX = 12;

export interface HistoryItem {
  query: string;
  command: string;
}

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (x): x is HistoryItem =>
            !!x &&
            typeof (x as HistoryItem).query === 'string' &&
            typeof (x as HistoryItem).command === 'string',
        )
        .slice(0, HISTORY_MAX);
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function pushHistory(item: HistoryItem): HistoryItem[] {
  const existing = loadHistory().filter((h) => h.query !== item.query);
  const next = [item, ...existing].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* ignore */
  }
}

const AUTO_UPDATE_KEY = 'theterm.autoUpdate';
const LAST_CHECK_KEY = 'theterm.claudeLastCheck';

/** Auto-update the Claude CLI on startup (default ON). */
export function getAutoUpdate(): boolean {
  try {
    return localStorage.getItem(AUTO_UPDATE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoUpdate(on: boolean): void {
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const THEME_ID_KEY = 'theterm.themeId';

export function getThemeId(): string {
  try {
    return localStorage.getItem(THEME_ID_KEY) || 'cyber-lime';
  } catch {
    return 'cyber-lime';
  }
}

export function setThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

const AUTO_CLAUDE_KEY = 'theterm.autoClaude';

/** Auto-run `claude` when a terminal opens (default ON). */
export function getAutoClaude(): boolean {
  try {
    return localStorage.getItem(AUTO_CLAUDE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoClaude(on: boolean): void {
  try {
    localStorage.setItem(AUTO_CLAUDE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getLastClaudeCheck(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function setLastClaudeCheck(ts: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

const LAST_WORKSPACE_KEY = 'theterm.lastWorkspace';
const EXPLORER_WIDTH_KEY = 'theterm.explorerWidth';
const EXPLORER_COLLAPSED_KEY = 'theterm.explorerCollapsed';

export function getLastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY) || null;
  } catch {
    return null;
  }
}

export function setLastWorkspace(path: string | null): void {
  try {
    if (path) localStorage.setItem(LAST_WORKSPACE_KEY, path);
    else localStorage.removeItem(LAST_WORKSPACE_KEY);
  } catch {
    /* ignore */
  }
}

export function getExplorerWidth(): number {
  try {
    const n = Number(localStorage.getItem(EXPLORER_WIDTH_KEY));
    return n >= 170 && n <= 520 ? n : 240;
  } catch {
    return 240;
  }
}

export function setExplorerWidth(px: number): void {
  try {
    localStorage.setItem(EXPLORER_WIDTH_KEY, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

export function getExplorerCollapsed(): boolean {
  try {
    return localStorage.getItem(EXPLORER_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setExplorerCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(EXPLORER_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const NOTIFY_DONE_KEY = 'theterm.notifyOnDone';

/** Desktop-notify when Claude finishes a run while unfocused (default ON). */
export function getNotifyOnDone(): boolean {
  try {
    return localStorage.getItem(NOTIFY_DONE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setNotifyOnDone(on: boolean): void {
  try {
    localStorage.setItem(NOTIFY_DONE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// --- Session layout persistence (restore the cockpit on relaunch) ----------

const LAYOUT_KEY = 'theterm.layout';

export interface SavedPane {
  id: string;
  cwd?: string;
  boot?: string;
}
export interface SavedSession {
  id: string;
  title: string;
  cwd?: string;
  branch?: string;
  worktreeDir?: string;
  panes: SavedPane[];
  splitDir: 'row' | 'col';
  activePaneId: string;
}
export interface SavedLayout {
  workspace: string | null;
  activeSessionId: string;
  sessions: SavedSession[];
}

export function getSavedLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLayout;
    if (!parsed || !Array.isArray(parsed.sessions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSavedLayout(layout: SavedLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

const AUTO_CHECKPOINT_KEY = 'theterm.autoCheckpoint';

/** Auto-snapshot the workspace before a Claude run starts (default ON). */
export function getAutoCheckpoint(): boolean {
  try {
    return localStorage.getItem(AUTO_CHECKPOINT_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoCheckpoint(on: boolean): void {
  try {
    localStorage.setItem(AUTO_CHECKPOINT_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
