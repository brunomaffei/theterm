import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as monaco from 'monaco-editor';
import { TerminalController } from './terminal/TerminalController';
import {
  aiStatus as fetchAiStatus,
  claudeVersion,
  claudeUpdate,
} from './ai/client';
import { pickFolder, readFile, writeFile } from './fs/client';
import type { AiStatus, ClaudeInfo } from './types';
import { applyTheme, getTheme, type Theme } from './theme';
import {
  isOnboarded,
  setOnboarded,
  getAutoUpdate,
  getLastClaudeCheck,
  setLastClaudeCheck,
  getAutoClaude,
  setAutoClaude,
  getLastWorkspace,
  setLastWorkspace,
  getExplorerWidth,
  setExplorerWidth,
  getExplorerCollapsed,
  setExplorerCollapsed,
  getThemeId,
  setThemeId,
  getNotifyOnDone,
  setNotifyOnDone,
  getAutoCheckpoint,
  getSavedLayout,
  setSavedLayout,
} from './storage';
import { notify, ensureNotifyPermission } from './notify/client';
import { checkpointCreate } from './diff/client';
import { worktreeCreate } from './worktrees/client';
import TitleBar from './ui/TitleBar';
import ResizeHandles from './ui/ResizeHandles';
import FileExplorer from './ui/FileExplorer';
import CenterArea, { type Session } from './ui/CenterArea';
import SessionsSidebar from './ui/SessionsSidebar';
import { languageForPath, type OpenFile } from './ui/EditorArea';
import StatusBar from './ui/StatusBar';
import CommandPalette from './ui/CommandPalette';
import Onboarding from './ui/Onboarding';
import ProfilePanel from './ui/ProfilePanel';
import VerifyPanel from './ui/VerifyPanel';
import DiffPanel from './ui/DiffPanel';
import WorktreesPanel from './ui/WorktreesPanel';
import FindBar from './ui/FindBar';
import type { AgentState } from './terminal/agents';
import {
  projectProfile,
  profileApplied,
  applyLoadout,
  aiSelectTeam,
  type Profile,
  type ProjectBrief,
} from './profile/client';

function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

interface BuiltLayout {
  sessions: Session[];
  activeSessionId: string;
  pendingPaneId: string | null;
  paneSeq: number;
  sessionSeq: number;
}

/** Highest numeric suffix among ids like "s3"/"t12" (so new ids never collide). */
function maxSuffix(ids: string[]): number {
  let m = 1;
  for (const id of ids) {
    const n = parseInt(id.slice(1), 10);
    if (Number.isFinite(n) && n > m) m = n;
  }
  return m;
}

/**
 * Build the initial sessions: restore the saved layout for this workspace when
 * present (the cmux "pick up where you left off"), else a single default
 * session. The active session's active pane is deferred when the Profiler will
 * show, so applying the loadout still boots claude once (no double-boot).
 */
function buildInitialSessions(workspace: string | null, defer: boolean): BuiltLayout {
  const autoClaude = getAutoClaude();
  try {
    const saved = getSavedLayout();
    if (
      saved &&
      saved.workspace === workspace &&
      Array.isArray(saved.sessions) &&
      saved.sessions.length > 0
    ) {
      const sessions: Session[] = saved.sessions
        .filter((s) => s && s.id && Array.isArray(s.panes) && s.panes.length > 0)
        .map((s) => ({
          id: s.id,
          title: s.title || s.id,
          cwd: s.cwd,
          branch: s.branch,
          worktreeDir: s.worktreeDir,
          panes: s.panes.map((p) => ({ id: p.id, cwd: p.cwd, boot: p.boot })),
          splitDir: s.splitDir === 'col' ? 'col' : 'row',
          activePaneId: s.panes.some((p) => p.id === s.activePaneId)
            ? s.activePaneId
            : s.panes[0].id,
        }));
      if (sessions.length > 0) {
        let activeSessionId = sessions.some((s) => s.id === saved.activeSessionId)
          ? saved.activeSessionId
          : sessions[0].id;
        const activeSession = sessions.find((s) => s.id === activeSessionId)!;
        let pendingPaneId: string | null = null;
        if (defer) {
          const ap = activeSession.panes.find((p) => p.id === activeSession.activePaneId)!;
          ap.boot = undefined;
          pendingPaneId = ap.id;
        }
        return {
          sessions,
          activeSessionId,
          pendingPaneId,
          paneSeq: maxSuffix(sessions.flatMap((s) => s.panes.map((p) => p.id))) + 1,
          sessionSeq: maxSuffix(sessions.map((s) => s.id)) + 1,
        };
      }
    }
  } catch {
    // fall through to the default layout
  }

  return {
    sessions: [
      {
        id: 's1',
        title: 'Sessão 1',
        cwd: workspace ?? undefined,
        panes: [
          { id: 't1', cwd: workspace ?? undefined, boot: autoClaude && !defer ? 'claude' : undefined },
        ],
        splitDir: 'row',
        activePaneId: 't1',
      },
    ],
    activeSessionId: 's1',
    pendingPaneId: defer ? 't1' : null,
    paneSeq: 2,
    sessionSeq: 2,
  };
}

export default function App(): JSX.Element {
  const initialWorkspaceRef = useRef<string | null>(getLastWorkspace());
  const initialWorkspace = initialWorkspaceRef.current;

  // When a workspace is open the Project Profiler will show, so DON'T auto-boot
  // claude up front — boot it once the loadout is applied (with agents) or the
  // card is dismissed. Avoids the "claude starts, then restarts" double-boot.
  const deferInitialClaude = !!initialWorkspace && getAutoClaude();

  const [autoClaude, setAutoClaudeState] = useState<boolean>(() => getAutoClaude());

  // Restore the saved session layout for this workspace (or a default session).
  const builtRef = useRef<BuiltLayout | null>(null);
  if (!builtRef.current) builtRef.current = buildInitialSessions(initialWorkspace, deferInitialClaude);
  const built = builtRef.current;

  const [sessions, setSessions] = useState<Session[]>(() => built.sessions);
  const [activeSessionId, setActiveSessionId] = useState(built.activeSessionId);
  const [attention, setAttention] = useState<Record<string, boolean>>({});
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<'term' | 'file'>('term');
  const [workspace, setWorkspace] = useState<string | null>(initialWorkspace);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [agentsByTerm, setAgentsByTerm] = useState<Record<string, AgentState>>({});

  const [explorerWidth, setExplorerWidthState] = useState<number>(() => getExplorerWidth());
  const [explorerCollapsed, setExplorerCollapsedState] = useState<boolean>(() =>
    getExplorerCollapsed(),
  );

  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const [notifyOnDone, setNotifyOnDoneState] = useState<boolean>(() => getNotifyOnDone());
  const [theme, setTheme] = useState<Theme>(() => getTheme(getThemeId()));
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => isOnboarded());

  const [claudeInfo, setClaudeInfo] = useState<ClaudeInfo | null>(null);
  const [updatingClaude, setUpdatingClaude] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Project Profiler: detected stack + recommended agent loadout for the open
  // workspace, shown as a card the user can apply with one click.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const [applyingLoadout, setApplyingLoadout] = useState(false);
  // AI team-selection state (the "✨ deixar a IA montar o time" flow).
  const [aiReasons, setAiReasons] = useState<Record<string, string> | null>(null);
  const [aiBrief, setAiBrief] = useState<ProjectBrief | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);

  // Derived: the active session and its focused pane (terminal) id.
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const activePaneId = activeSession?.activePaneId ?? null;

  const controllersRef = useRef<Map<string, TerminalController>>(new Map());
  const seqRef = useRef(built.paneSeq); // pane (terminal) id counter
  const sessionSeqRef = useRef(built.sessionSeq); // session id counter
  const workspaceRef = useRef<string | null>(null);
  workspaceRef.current = workspace;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const activePaneIdRef = useRef<string | null>(activePaneId);
  activePaneIdRef.current = activePaneId;
  const activeKindRef = useRef(activeKind);
  activeKindRef.current = activeKind;
  const activeFileRef = useRef<string | null>(null);
  activeFileRef.current = activeFilePath;
  const openFilesRef = useRef<OpenFile[]>(openFiles);
  openFilesRef.current = openFiles;
  const autoClaudeRef = useRef(autoClaude);
  autoClaudeRef.current = autoClaude;
  const sessionsRef = useRef<Session[]>(sessions);
  sessionsRef.current = sessions;

  // Notification + checkpoint plumbing (all refs so handleAgents stays stable).
  const windowFocusedRef = useRef(true);
  const runStateRef = useRef<
    Record<string, { working: boolean; startedAt: number; actions: number }>
  >({});
  const finishTimersRef = useRef<Record<string, number>>({});
  const lastAutoCpRef = useRef(0);
  const maybeAutoCheckpointRef = useRef<() => void>(() => {});

  // Deferred-claude-boot bookkeeping (see deferInitialClaude). pendingBootRef
  // holds the id of a terminal that should boot `claude` once the Profiler card
  // for its workspace is applied or dismissed.
  const pendingBootRef = useRef<string | null>(built.pendingPaneId);
  const safetyTimerRef = useRef<number | null>(null);

  const activeController = useCallback(
    (): TerminalController | null =>
      activePaneIdRef.current ? controllersRef.current.get(activePaneIdRef.current) ?? null : null,
    [],
  );

  const registerController = useCallback((id: string, c: TerminalController | null) => {
    if (c) controllersRef.current.set(id, c);
    else controllersRef.current.delete(id);
  }, []);

  // Forget a pane's per-run bookkeeping (agents state, finish timer, run state).
  const cleanupPane = useCallback((id: string) => {
    setAgentsByTerm((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const ft = finishTimersRef.current[id];
    if (ft) {
      window.clearTimeout(ft);
      delete finishTimersRef.current[id];
    }
    delete runStateRef.current[id];
  }, []);

  // Snapshot the workspace before a fresh Claude run (debounced, opt-out).
  const maybeAutoCheckpoint = useCallback(() => {
    const ws = workspaceRef.current;
    if (!ws || !getAutoCheckpoint()) return;
    const now = Date.now();
    if (now - lastAutoCpRef.current < 90_000) return;
    lastAutoCpRef.current = now;
    checkpointCreate(ws, 'auto: antes da rodada').catch(() => {});
  }, []);
  maybeAutoCheckpointRef.current = maybeAutoCheckpoint;

  // Track per-terminal Claude runs: auto-checkpoint on a fresh start, and ping a
  // desktop notification when a run finishes while THETERM is in the background.
  const handleAgents = useCallback((id: string, state: AgentState) => {
    setAgentsByTerm((prev) => ({ ...prev, [id]: state }));

    const rs = runStateRef.current;
    const prev = rs[id];
    const wasWorking = prev?.working ?? false;

    if (state.working) {
      // A new signal arrived — cancel any pending "finished" notification.
      const pending = finishTimersRef.current[id];
      if (pending) {
        window.clearTimeout(pending);
        delete finishTimersRef.current[id];
      }
      if (!wasWorking) {
        rs[id] = { working: true, startedAt: Date.now(), actions: state.actions };
        maybeAutoCheckpointRef.current();
      } else {
        rs[id] = { working: true, startedAt: prev.startedAt, actions: state.actions };
      }
      return;
    }

    // Idle emit: keep the latest action count.
    if (prev) rs[id] = { ...prev, working: false, actions: state.actions };
    if (!wasWorking) return;

    // working → idle transition: schedule a "finished" notification, but only
    // fire it if Claude stays idle (a >6s think-pause briefly flips idle too).
    const startedAt = prev?.startedAt ?? Date.now();
    const actions = state.actions;
    if (finishTimersRef.current[id]) window.clearTimeout(finishTimersRef.current[id]);
    finishTimersRef.current[id] = window.setTimeout(() => {
      delete finishTimersRef.current[id];
      const elapsed = Date.now() - startedAt;
      const meaningful = actions >= 2 || elapsed >= 12_000;
      if (!meaningful) return;
      // Which session owns this pane?
      const session = sessionsRef.current.find((s) => s.panes.some((p) => p.id === id));
      const isActive =
        !!session &&
        session.id === activeSessionIdRef.current &&
        activeKindRef.current === 'term';
      // Ring the sidebar when a background session finishes.
      if (session && !isActive) {
        setAttention((prevA) => (prevA[session.id] ? prevA : { ...prevA, [session.id]: true }));
      }
      // Desktop notification when THETERM is unfocused.
      if (getNotifyOnDone() && !windowFocusedRef.current) {
        void notify(
          'THETERM — Claude terminou',
          `${session?.title ?? 'Sessão'} · ${actions} ${actions === 1 ? 'ação' : 'ações'}`,
        );
      }
    }, 3500);
  }, []);

  // OSC 9/777 notifications from a pane: ring the sidebar if it's a background
  // session, and fire a desktop notification when THETERM is unfocused. Works
  // for any tool that emits the escape sequence (not just Claude's TUI).
  const handleNotify = useCallback((id: string, n: { title?: string; body: string }) => {
    const session = sessionsRef.current.find((s) => s.panes.some((p) => p.id === id));
    const isActive =
      !!session &&
      session.id === activeSessionIdRef.current &&
      activeKindRef.current === 'term';
    if (session && !isActive) {
      setAttention((prev) => (prev[session.id] ? prev : { ...prev, [session.id]: true }));
    }
    if (!windowFocusedRef.current) {
      void notify(n.title || `THETERM — ${session?.title ?? 'Sessão'}`, n.body || 'Notificação');
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    controllersRef.current.forEach((c) => c.setTheme(theme));
  }, [theme]);

  // Persist the session layout for the current workspace so the cockpit can be
  // restored on relaunch (lightly debounced).
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSavedLayout({ workspace, activeSessionId, sessions });
    }, 400);
    return () => window.clearTimeout(t);
  }, [sessions, activeSessionId, workspace]);

  const loadAiStatus = useCallback(() => {
    fetchAiStatus()
      .then(setAiStatus)
      .catch(() =>
        setAiStatus({ configured: false, provider: 'none', suggestModel: '', fixModel: '' }),
      );
  }, []);

  useEffect(() => {
    loadAiStatus();
  }, [loadAiStatus]);

  // Track window focus (so we only notify when THETERM is in the background) and
  // ask for notification permission once, up front.
  useEffect(() => {
    windowFocusedRef.current = document.hasFocus();
    const onFocus = (): void => {
      windowFocusedRef.current = true;
    };
    const onBlur = (): void => {
      windowFocusedRef.current = false;
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    if (getNotifyOnDone()) void ensureNotifyPermission();
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const toggleNotifyOnDone = useCallback(() => {
    setNotifyOnDoneState((cur) => {
      const next = !cur;
      setNotifyOnDone(next);
      if (next) void ensureNotifyPermission();
      return next;
    });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 5500);
  }, []);

  // --- Deferred claude boot ------------------------------------------------
  // Run `claude` in an already-open terminal (its shell sits at a prompt because
  // we didn't pass a boot command). Retries briefly until the controller mounts.
  const bootClaudeIn = useCallback((id: string, attempt = 0): void => {
    const c = controllersRef.current.get(id);
    if (c) {
      c.runCommand('claude');
      // Reflect the boot in state so a restored layout re-boots claude here.
      setSessions((prev) =>
        prev.map((s) => ({
          ...s,
          panes: s.panes.map((p) => (p.id === id ? { ...p, boot: 'claude' } : p)),
        })),
      );
      return;
    }
    if (attempt < 5) window.setTimeout(() => bootClaudeIn(id, attempt + 1), 300);
  }, []);

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current !== null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  // Boot claude in the pending terminal now (on apply/dismiss/scan-failure).
  const flushPendingBoot = useCallback(() => {
    clearSafetyTimer();
    const id = pendingBootRef.current;
    if (!id) return;
    pendingBootRef.current = null;
    bootClaudeIn(id);
  }, [bootClaudeIn, clearSafetyTimer]);

  // Mark a terminal as awaiting a claude boot, with a backstop so a hung profile
  // scan can never strand the user without claude.
  const armPendingBoot = useCallback(
    (id: string) => {
      const prev = pendingBootRef.current;
      if (prev && prev !== id) bootClaudeIn(prev);
      pendingBootRef.current = id;
      clearSafetyTimer();
      safetyTimerRef.current = window.setTimeout(() => {
        safetyTimerRef.current = null;
        flushPendingBoot();
      }, 30000);
    },
    [bootClaudeIn, clearSafetyTimer, flushPendingBoot],
  );

  // Backstop for the initial deferred boot: if the user never engages the
  // Profiler card, boot claude anyway so the terminal is never left idle.
  useEffect(() => {
    if (!pendingBootRef.current) return;
    safetyTimerRef.current = window.setTimeout(() => {
      safetyTimerRef.current = null;
      flushPendingBoot();
    }, 30000);
    return clearSafetyTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Project Profiler ----------------------------------------------------
  // Whenever a workspace is opened, scan it and surface the recommended agent
  // team. Cheap, best-effort: failures just leave the card hidden.
  useEffect(() => {
    // Fresh workspace → drop any prior AI refinement.
    setAiReasons(null);
    setAiBrief(null);
    setAiDone(false);
    if (!workspace) {
      setProfile(null);
      setProfileVisible(false);
      return;
    }
    let cancelled = false;
    projectProfile(workspace)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        // Only nag with the prep card until the loadout is applied. After that
        // the on-disk team (CLAUDE.md block) is enough — don't reopen it every
        // launch. The user can reopen it on demand from the sidebar.
        profileApplied(workspace)
          .then((applied) => {
            if (cancelled) return;
            if (applied) {
              setProfileVisible(false);
              flushPendingBoot(); // no card to gate the boot → start claude
            } else {
              setProfileVisible(true);
              // (card drives the boot via apply/dismiss; backstop stays armed)
            }
          })
          .catch(() => {
            if (!cancelled) setProfileVisible(true);
          });
      })
      .catch(() => {
        // No card will show → boot claude so the user isn't left without it.
        if (!cancelled) flushPendingBoot();
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, flushPendingBoot]);

  // Restart the active terminal into a FRESH `claude` (in `cwd`), so a newly
  // applied agent loadout is picked up without the user restarting it by hand.
  // Swapping the terminal's id forces React to remount it: the old PTY (and its
  // claude) is disposed and a new one boots `claude` from scratch.
  const rebootClaude = useCallback(
    (cwd?: string) => {
      const sid = activeSessionIdRef.current;
      const session = sessionsRef.current.find((s) => s.id === sid);
      if (!session) return;
      const targetPane = session.activePaneId;
      const dir = cwd ?? session.cwd ?? workspaceRef.current ?? undefined;
      // The replacement pane boots claude via its boot prop, so cancel any
      // pending deferred boot for the one we're replacing.
      if (pendingBootRef.current === targetPane) pendingBootRef.current = null;
      if (safetyTimerRef.current !== null) {
        window.clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      const n = seqRef.current;
      seqRef.current += 1;
      const newId = `t${n}`;
      setSessions((prev) =>
        prev.map((s) =>
          s.id !== sid
            ? s
            : {
                ...s,
                panes: s.panes.map((p) =>
                  p.id === targetPane ? { id: newId, cwd: dir, boot: 'claude' } : p,
                ),
                activePaneId: s.activePaneId === targetPane ? newId : s.activePaneId,
              },
        ),
      );
      setActiveKind('term');
      cleanupPane(targetPane);
    },
    [cleanupPane],
  );

  const handleApplyLoadout = useCallback(
    (agentIds: string[]) => {
      if (!profile) return;
      setApplyingLoadout(true);
      const path = profile.path;
      applyLoadout(path, agentIds, aiBrief)
        .then(() => {
          setProfileVisible(false);
          showToast('Time preparado! Iniciando o Claude com os agentes…');
          // Boot a fresh claude so it loads the just-written .claude/agents.
          rebootClaude(path);
        })
        .catch((err: unknown) => {
          showToast(`Falha ao preparar: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => setApplyingLoadout(false));
    },
    [profile, aiBrief, showToast, rebootClaude],
  );

  const handleAiSelect = useCallback(() => {
    if (!profile) return;
    setAiLoading(true);
    aiSelectTeam(profile.path)
      .then((sel) => {
        setProfile((p) =>
          p
            ? {
                ...p,
                agents: sel.agents.map((a) => ({
                  id: a.id,
                  title: a.title,
                  description: a.description,
                  icon: a.icon,
                  core: a.core,
                })),
              }
            : p,
        );
        setAiReasons(Object.fromEntries(sel.agents.map((a) => [a.id, a.reason])));
        setAiBrief(sel.brief);
        setAiDone(true);
      })
      .catch((err: unknown) => {
        showToast(
          `IA não montou o time: ${err instanceof Error ? err.message : String(err)}. Mantendo a seleção automática.`,
        );
      })
      .finally(() => setAiLoading(false));
  }, [profile, showToast]);

  // --- Claude version + auto-update ----------------------------------------
  const updateClaude = useCallback(() => {
    setUpdatingClaude(true);
    claudeUpdate()
      .then((out) => {
        setLastClaudeCheck(Date.now());
        const firstLine =
          out
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)[0] ?? 'Claude verificado';
        showToast(`Claude: ${firstLine.slice(0, 120)}`);
        claudeVersion()
          .then(setClaudeInfo)
          .catch(() => {});
      })
      .catch((err: unknown) => {
        showToast(`Falha ao atualizar o Claude: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setUpdatingClaude(false));
  }, [showToast]);

  const updateClaudeRef = useRef<() => void>(() => {});
  updateClaudeRef.current = updateClaude;

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;
    claudeVersion()
      .then((info) => {
        if (!mounted) return;
        setClaudeInfo(info);
        if (info.available && getAutoUpdate()) {
          const stale = Date.now() - getLastClaudeCheck() > 24 * 60 * 60 * 1000;
          if (stale) timer = window.setTimeout(() => updateClaudeRef.current(), 4000);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // When files change on disk (e.g. Claude edits them), reload any open file the
  // user hasn't modified so the editor reflects external changes live. Dirty
  // files are left untouched to avoid clobbering unsaved edits.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ paths: string[] }>('fs:change', (event) => {
      const paths = event.payload?.paths ?? [];
      if (!paths.length) return;
      for (const p of paths) {
        const f = openFilesRef.current.find((o) => o.path === p);
        if (f && !f.dirty) {
          readFile(p)
            .then((content) => {
              setOpenFiles((prev) =>
                prev.map((o) => (o.path === p && !o.dirty ? { ...o, content } : o)),
              );
            })
            .catch(() => {});
        }
      }
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // --- Sessions & panes ----------------------------------------------------
  // A session is one sidebar entry; it holds one or more terminal panes (a
  // single-direction split). Pane ids ARE terminal ids.
  const addSession = useCallback(
    (opts?: {
      cwd?: string;
      deferClaude?: boolean;
      forceClaude?: boolean;
      branch?: string;
      worktreeDir?: string;
    }) => {
      const sn = sessionSeqRef.current;
      sessionSeqRef.current += 1;
      const pn = seqRef.current;
      seqRef.current += 1;
      const sid = `s${sn}`;
      const pid = `t${pn}`;
      const dir = opts?.cwd ?? workspaceRef.current ?? undefined;
      const wantClaude = autoClaudeRef.current || !!opts?.forceClaude;
      const defer = wantClaude && !!opts?.deferClaude;
      const boot = wantClaude && !defer ? 'claude' : undefined;
      const title = opts?.branch ? `Agente ${sn}` : `Sessão ${sn}`;
      setSessions((prev) => [
        ...prev,
        {
          id: sid,
          title,
          cwd: dir,
          branch: opts?.branch,
          worktreeDir: opts?.worktreeDir,
          panes: [{ id: pid, cwd: dir, boot }],
          splitDir: 'row',
          activePaneId: pid,
        },
      ]);
      setActiveSessionId(sid);
      setActiveKind('term');
      if (defer) armPendingBoot(pid);
    },
    [armPendingBoot],
  );

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setActiveKind('term');
    setAttention((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
  }, []);

  const selectPane = useCallback((sessionId: string, paneId: string) => {
    // No-op when clicking the already-focused pane (avoids churn on every click).
    if (
      activeSessionIdRef.current === sessionId &&
      activeKindRef.current === 'term'
    ) {
      const s = sessionsRef.current.find((x) => x.id === sessionId);
      if (s && s.activePaneId === paneId) return;
    }
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, activePaneId: paneId } : s)),
    );
    setActiveSessionId(sessionId);
    setActiveKind('term');
  }, []);

  // Split the active session into another pane (a plain shell — handy for logs/
  // tests beside a running claude). Switches the layout direction to `dir`.
  const splitActive = useCallback((dir: 'row' | 'col') => {
    const pn = seqRef.current;
    seqRef.current += 1;
    const pid = `t${pn}`;
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== activeSessionIdRef.current
          ? s
          : {
              ...s,
              splitDir: dir,
              panes: [...s.panes, { id: pid, cwd: s.cwd, boot: undefined }],
              activePaneId: pid,
            },
      ),
    );
    setActiveKind('term');
  }, []);

  const closeSession = useCallback(
    (id: string) => {
      const s = sessionsRef.current.find((x) => x.id === id);
      setSessions((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((x) => x.id === id);
        const next = prev.filter((x) => x.id !== id);
        setActiveSessionId((cur) =>
          cur === id ? (next[Math.max(0, idx - 1)] ?? next[0]).id : cur,
        );
        return next;
      });
      if (s && sessionsRef.current.length > 1) s.panes.forEach((p) => cleanupPane(p.id));
      setAttention((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [cleanupPane],
  );

  const closePane = useCallback(
    (sessionId: string, paneId: string) => {
      const s = sessionsRef.current.find((x) => x.id === sessionId);
      if (!s) return;
      if (s.panes.length <= 1) {
        closeSession(sessionId);
        return;
      }
      const idx = s.panes.findIndex((p) => p.id === paneId);
      setSessions((prev) =>
        prev.map((x) => {
          if (x.id !== sessionId) return x;
          const panes = x.panes.filter((p) => p.id !== paneId);
          const activePaneId =
            x.activePaneId === paneId ? (panes[Math.max(0, idx - 1)] ?? panes[0]).id : x.activePaneId;
          return { ...x, panes, activePaneId };
        }),
      );
      cleanupPane(paneId);
    },
    [closeSession, cleanupPane],
  );

  // Spawn an isolated worktree agent: a fresh branch + directory tree where its
  // own claude can work in parallel without touching the main checkout.
  const newAgent = useCallback(
    (base: string) => {
      const ws = workspaceRef.current;
      if (!ws) {
        showToast('Abra um projeto git para criar um agente.');
        return;
      }
      // Empty branch → backend auto-names "agent/N"; forks from `base` (e.g. main).
      worktreeCreate(ws, '', base)
        .then((wt) => {
          addSession({ cwd: wt.dir, branch: wt.branch, worktreeDir: wt.dir, forceClaude: true });
          showToast(
            `Agente '${wt.branch}' criado${base ? ` (base: ${base})` : ''}. Claude iniciando…`,
          );
        })
        .catch((e: unknown) =>
          showToast(`Falha ao criar o agente: ${e instanceof Error ? e.message : String(e)}`),
        );
    },
    [addSession, showToast],
  );

  const toggleAutoClaude = useCallback(() => {
    setAutoClaudeState((cur) => {
      const next = !cur;
      setAutoClaude(next);
      return next;
    });
  }, []);

  const openFolder = useCallback(() => {
    pickFolder()
      .then((path) => {
        if (!path) return;
        setWorkspace(path);
        setLastWorkspace(path);
        // Defer the claude boot: the Profiler will show for the new workspace,
        // and applying it restarts claude with the agents (no double-boot).
        addSession({ cwd: path, deferClaude: true });
      })
      .catch(() => {});
  }, [addSession]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const onMove = (ev: MouseEvent) => {
        setExplorerWidthState(Math.min(520, Math.max(170, ev.clientX)));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        setExplorerWidthState((w) => {
          setExplorerWidth(w);
          return w;
        });
        activeController()?.fit();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
    },
    [activeController],
  );

  const toggleExplorerCollapsed = useCallback(() => {
    setExplorerCollapsedState((cur) => {
      const next = !cur;
      setExplorerCollapsed(next);
      return next;
    });
  }, []);

  // --- Files / editor ------------------------------------------------------
  const openFile = useCallback(
    (path: string) => {
      if (openFilesRef.current.some((f) => f.path === path)) {
        setActiveFilePath(path);
        setActiveKind('file');
        return;
      }
      readFile(path)
        .then((content) => {
          setOpenFiles((prev) =>
            prev.some((f) => f.path === path)
              ? prev
              : [
                  ...prev,
                  {
                    path,
                    name: baseName(path),
                    content,
                    dirty: false,
                    language: languageForPath(path),
                  },
                ],
          );
          setActiveFilePath(path);
          setActiveKind('file');
        })
        .catch((err: unknown) => {
          showToast(`Não consegui abrir o arquivo: ${err instanceof Error ? err.message : String(err)}`);
        });
    },
    [showToast],
  );

  const selectFile = useCallback((path: string) => {
    setActiveFilePath(path);
    setActiveKind('file');
  }, []);

  const editorChange = useCallback((path: string, value: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, content: value, dirty: true } : f)),
    );
  }, []);

  const saveFile = useCallback(
    (path: string) => {
      const file = openFilesRef.current.find((f) => f.path === path);
      if (!file) return;
      writeFile(path, file.content)
        .then(() => {
          setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, dirty: false } : f)));
        })
        .catch((err: unknown) => {
          showToast(`Falha ao salvar: ${err instanceof Error ? err.message : String(err)}`);
        });
    },
    [showToast],
  );

  const closeFile = useCallback((path: string) => {
    // Free the Monaco model for this file (models are created per path and
    // would otherwise accumulate for the whole session).
    try {
      monaco.editor.getModel(monaco.Uri.file(path))?.dispose();
    } catch {
      /* ignore */
    }
    setOpenFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === path);
      const next = prev.filter((f) => f.path !== path);
      setActiveFilePath((cur) => (cur === path ? next[Math.max(0, idx - 1)]?.path ?? null : cur));
      // If the closed file was showing and nothing else is open, fall back to the terminal.
      if (next.length === 0) setActiveKind('term');
      return next;
    });
  }, []);

  // --- Theme + shortcuts ---------------------------------------------------
  const selectTheme = useCallback((id: string) => {
    setThemeId(id);
    setTheme(getTheme(id));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        addSession();
        return;
      }
      // Ctrl/Cmd+Shift+D: split the active session into another pane.
      if (mod && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        if (activeKindRef.current === 'term') {
          e.preventDefault();
          splitActive('row');
        }
        return;
      }
      if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        if (activeKindRef.current === 'file' && activeFileRef.current) {
          e.preventDefault();
          saveFile(activeFileRef.current);
        }
        return;
      }
      if (mod && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        openFolder();
        return;
      }
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // Ctrl/Cmd+F: terminal find bar. When a file/editor is active, let Monaco
      // handle its own find instead of hijacking the shortcut.
      if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        if (activeKindRef.current === 'term') {
          e.preventDefault();
          setFindOpen(true);
        }
        return;
      }
      if (e.key === 'Escape' && paletteOpen) setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, addSession, splitActive, openFolder, saveFile]);

  // Live agent state for the active pane — feeds the status-bar token meter.
  // (The old right-side AgentsPanel was removed; the sessions sidebar shows
  // per-session working status now.)
  const activeAgents = activePaneId ? agentsByTerm[activePaneId] : undefined;

  // Pane sizing is automatic (the controller's ResizeObserver), so no manual
  // fit() wiring is needed on layout changes here.

  const handleConfigureKey = useCallback(() => setPaletteOpen(true), []);

  const runInTerminal = useCallback(
    (cmd: string) => {
      setActiveKind('term');
      const c = activeController();
      c?.runCommand(cmd);
      c?.focus();
    },
    [activeController],
  );

  const showOnboarding =
    aiStatus !== null && !aiStatus.configured && !onboardingDismissed;

  return (
    <div className="app">
      <ResizeHandles />
      <TitleBar themeId={theme.id} onSelectTheme={selectTheme} />

      <div className="workspace">
        {explorerCollapsed ? (
          <button
            type="button"
            className="explorer-rail"
            onClick={toggleExplorerCollapsed}
            title="Mostrar explorador"
            aria-label="Mostrar explorador"
          >
            <i className="ti ti-layout-sidebar-left-expand" aria-hidden="true" />
          </button>
        ) : (
          <>
            <FileExplorer
              workspace={workspace}
              selectedFile={activeFilePath}
              width={explorerWidth}
              onOpenFolder={openFolder}
              onSelectFile={openFile}
              onToggleCollapse={toggleExplorerCollapsed}
            />
            <div
              className="resize-divider"
              onMouseDown={startResize}
              title="Arraste para redimensionar"
            />
          </>
        )}

        <SessionsSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          activeKind={activeKind}
          agentsByPane={agentsByTerm}
          attention={attention}
          autoClaude={autoClaude}
          hasWorkspace={!!workspace}
          workspace={workspace}
          onSelectSession={selectSession}
          onCloseSession={closeSession}
          onNewTerminal={() => addSession()}
          onNewAgent={newAgent}
          onSplit={splitActive}
          onToggleAutoClaude={toggleAutoClaude}
          onManageWorktrees={() => setWorktreesOpen(true)}
          onOpenProfile={() => profile && setProfileVisible(true)}
          canOpenProfile={!!profile}
        />

        <CenterArea
          sessions={sessions}
          activeSessionId={activeSessionId}
          activeKind={activeKind}
          files={openFiles}
          activeFilePath={activeFilePath}
          theme={theme}
          onSelectFile={selectFile}
          onCloseFile={closeFile}
          onSelectPane={selectPane}
          onClosePane={closePane}
          registerController={registerController}
          onAgents={handleAgents}
          onNotify={handleNotify}
          onEditorChange={editorChange}
          onEditorSave={saveFile}
        />

      </div>

      <StatusBar
        aiStatus={aiStatus}
        workspace={workspace}
        claudeInfo={claudeInfo}
        updating={updatingClaude}
        tokens={activeAgents?.tokens ?? null}
        notifyOnDone={notifyOnDone}
        onConfigureKey={handleConfigureKey}
        onUpdateClaude={updateClaude}
        onToggleNotify={toggleNotifyOnDone}
        onDiff={() => {
          setProfileVisible(false);
          setDiffOpen(true);
        }}
        onVerify={() => {
          setProfileVisible(false);
          setVerifyOpen(true);
        }}
      />

      {profileVisible && profile && (
        <ProfilePanel
          profile={profile}
          applying={applyingLoadout}
          reasons={aiReasons}
          aiLoading={aiLoading}
          aiDone={aiDone}
          onAiSelect={handleAiSelect}
          onApply={handleApplyLoadout}
          onDismiss={() => {
            setProfileVisible(false);
            flushPendingBoot();
          }}
        />
      )}

      {verifyOpen && workspace && (
        <VerifyPanel path={workspace} onClose={() => setVerifyOpen(false)} />
      )}

      {diffOpen && workspace && (
        <DiffPanel
          path={workspace}
          theme={theme}
          showToast={showToast}
          onClose={() => setDiffOpen(false)}
        />
      )}

      {worktreesOpen && workspace && (
        <WorktreesPanel
          path={workspace}
          showToast={showToast}
          onClose={() => setWorktreesOpen(false)}
        />
      )}

      {findOpen && activeKind === 'term' && (
        <FindBar
          onSearch={(term, opts) => activeController()?.search(term, opts) ?? false}
          onClose={() => {
            setFindOpen(false);
            const c = activeController();
            c?.clearSearch();
            c?.focus();
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      {showOnboarding && (
        <Onboarding
          onSkip={() => {
            setOnboarded();
            setOnboardingDismissed(true);
            activeController()?.focus();
          }}
          onSaved={() => {
            setOnboarded();
            setOnboardingDismissed(true);
            loadAiStatus();
            activeController()?.focus();
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          onClose={() => {
            setPaletteOpen(false);
            loadAiStatus();
            activeController()?.focus();
          }}
          onInsert={(cmd) => {
            setActiveKind('term');
            const c = activeController();
            c?.insertCommand(cmd);
            c?.focus();
          }}
          onRun={runInTerminal}
        />
      )}
    </div>
  );
}
