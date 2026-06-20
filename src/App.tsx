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
} from './storage';
import { notify, ensureNotifyPermission } from './notify/client';
import { checkpointCreate } from './diff/client';
import TitleBar from './ui/TitleBar';
import ResizeHandles from './ui/ResizeHandles';
import FileExplorer from './ui/FileExplorer';
import CenterArea, { type ActiveTab, type TermItem } from './ui/CenterArea';
import { languageForPath, type OpenFile } from './ui/EditorArea';
import StatusBar from './ui/StatusBar';
import CommandPalette from './ui/CommandPalette';
import Onboarding from './ui/Onboarding';
import AgentsPanel from './ui/AgentsPanel';
import ProfilePanel from './ui/ProfilePanel';
import VerifyPanel from './ui/VerifyPanel';
import DiffPanel from './ui/DiffPanel';
import FindBar from './ui/FindBar';
import type { AgentState } from './terminal/agents';
import {
  projectProfile,
  applyLoadout,
  aiSelectTeam,
  type Profile,
  type ProjectBrief,
} from './profile/client';

function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export default function App(): JSX.Element {
  const initialWorkspaceRef = useRef<string | null>(getLastWorkspace());
  const initialWorkspace = initialWorkspaceRef.current;

  const [autoClaude, setAutoClaudeState] = useState<boolean>(() => getAutoClaude());

  const [terminals, setTerminals] = useState<TermItem[]>(() => [
    {
      id: 't1',
      title: 'Terminal 1',
      cwd: initialWorkspace ?? undefined,
      boot: getAutoClaude() ? 'claude' : undefined,
    },
  ]);
  const [activeTermId, setActiveTermId] = useState('t1');
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

  const controllersRef = useRef<Map<string, TerminalController>>(new Map());
  const seqRef = useRef(2);
  const workspaceRef = useRef<string | null>(null);
  workspaceRef.current = workspace;
  const activeTermIdRef = useRef(activeTermId);
  activeTermIdRef.current = activeTermId;
  const activeKindRef = useRef(activeKind);
  activeKindRef.current = activeKind;
  const activeFileRef = useRef<string | null>(null);
  activeFileRef.current = activeFilePath;
  const openFilesRef = useRef<OpenFile[]>(openFiles);
  openFilesRef.current = openFiles;
  const autoClaudeRef = useRef(autoClaude);
  autoClaudeRef.current = autoClaude;
  const terminalsRef = useRef<TermItem[]>(terminals);
  terminalsRef.current = terminals;

  // Notification + checkpoint plumbing (all refs so handleAgents stays stable).
  const windowFocusedRef = useRef(true);
  const runStateRef = useRef<
    Record<string, { working: boolean; startedAt: number; actions: number }>
  >({});
  const finishTimersRef = useRef<Record<string, number>>({});
  const lastAutoCpRef = useRef(0);
  const maybeAutoCheckpointRef = useRef<() => void>(() => {});

  const activeController = useCallback(
    (): TerminalController | null => controllersRef.current.get(activeTermIdRef.current) ?? null,
    [],
  );

  const registerController = useCallback((id: string, c: TerminalController | null) => {
    if (c) controllersRef.current.set(id, c);
    else controllersRef.current.delete(id);
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
      if (getNotifyOnDone() && !windowFocusedRef.current && meaningful) {
        const term = terminalsRef.current.find((t) => t.id === id);
        void notify(
          'THETERM — Claude terminou',
          `${term?.title ?? 'Terminal'} · ${actions} ${actions === 1 ? 'ação' : 'ações'}`,
        );
      }
    }, 3500);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    controllersRef.current.forEach((c) => c.setTheme(theme));
  }, [theme]);

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
        setProfileVisible(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const handleApplyLoadout = useCallback(
    (agentIds: string[]) => {
      if (!profile) return;
      setApplyingLoadout(true);
      applyLoadout(profile.path, agentIds, aiBrief)
        .then(() => {
          setProfileVisible(false);
          showToast(
            'Time preparado! Reinicie o claude (ou abra um novo terminal) para carregar os agentes.',
          );
        })
        .catch((err: unknown) => {
          showToast(`Falha ao preparar: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => setApplyingLoadout(false));
    },
    [profile, aiBrief, showToast],
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

  // --- Terminals -----------------------------------------------------------
  const addTerminal = useCallback((cwd?: string) => {
    const n = seqRef.current;
    seqRef.current += 1;
    const id = `t${n}`;
    const dir = cwd ?? workspaceRef.current ?? undefined;
    const boot = autoClaudeRef.current ? 'claude' : undefined;
    setTerminals((prev) => [...prev, { id, title: `Terminal ${n}`, cwd: dir, boot }]);
    setActiveTermId(id);
    setActiveKind('term');
  }, []);

  const selectTerm = useCallback((id: string) => {
    setActiveTermId(id);
    setActiveKind('term');
  }, []);

  const closeTerminal = useCallback((id: string) => {
    setTerminals((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveTermId((cur) => (cur === id ? (next[Math.max(0, idx - 1)] ?? next[0]).id : cur));
      return next;
    });
    setAgentsByTerm((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Drop any per-terminal run bookkeeping.
    if (finishTimersRef.current[id]) {
      window.clearTimeout(finishTimersRef.current[id]);
      delete finishTimersRef.current[id];
    }
    delete runStateRef.current[id];
  }, []);

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
        addTerminal(path);
      })
      .catch(() => {});
  }, [addTerminal]);

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
        addTerminal();
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
  }, [paletteOpen, addTerminal, openFolder, saveFile]);

  const activeAgents = agentsByTerm[activeTermId];
  const showAgents =
    !!activeAgents && (activeAgents.working || activeAgents.workers.length > 0);

  useEffect(() => {
    activeController()?.fit();
  }, [
    paletteOpen,
    workspace,
    activeKind,
    activeTermId,
    explorerWidth,
    explorerCollapsed,
    showAgents,
    activeController,
  ]);

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

  const active: ActiveTab =
    activeKind === 'file' && activeFilePath
      ? { kind: 'file', path: activeFilePath }
      : { kind: 'term', id: activeTermId };

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

        <CenterArea
          terminals={terminals}
          files={openFiles}
          active={active}
          theme={theme}
          autoClaude={autoClaude}
          onSelectTerm={selectTerm}
          onNewTerm={() => addTerminal()}
          onCloseTerm={closeTerminal}
          onSelectFile={selectFile}
          onCloseFile={closeFile}
          onToggleAutoClaude={toggleAutoClaude}
          registerController={registerController}
          onAgents={handleAgents}
          onEditorChange={editorChange}
          onEditorSave={saveFile}
        />

        {showAgents && activeAgents && <AgentsPanel state={activeAgents} />}
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
          onDismiss={() => setProfileVisible(false)}
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
