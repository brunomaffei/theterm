import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { listDir, watchDir, gitStatus, type FsEntry } from '../fs/client';

export interface FileExplorerProps {
  workspace: string | null;
  selectedFile: string | null;
  width: number;
  onOpenFolder: () => void;
  onSelectFile: (path: string) => void;
  onToggleCollapse: () => void;
}

interface FsChangePayload {
  paths: string[];
}

function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : p;
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'ti-file-code';
  if (['json', 'lock', 'toml', 'yml', 'yaml'].includes(ext)) return 'ti-file-settings';
  if (['md', 'txt'].includes(ext)) return 'ti-file-text';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext)) return 'ti-photo';
  if (['css', 'scss', 'less'].includes(ext)) return 'ti-brush';
  if (['rs'].includes(ext)) return 'ti-brand-rust';
  return 'ti-file';
}

function gitBadge(code: string | undefined): { ch: string; cls: string } | null {
  if (!code) return null;
  const c = code.trim();
  if (c === '??') return { ch: 'U', cls: 'git-untracked' };
  if (c.includes('A')) return { ch: 'A', cls: 'git-added' };
  if (c.includes('D')) return { ch: 'D', cls: 'git-deleted' };
  if (c.includes('R')) return { ch: 'R', cls: 'git-renamed' };
  if (c.includes('M')) return { ch: 'M', cls: 'git-modified' };
  return { ch: c[0] ?? '•', cls: 'git-modified' };
}

export default function FileExplorer({
  workspace,
  selectedFile,
  width,
  onOpenFolder,
  onSelectFile,
  onToggleCollapse,
}: FileExplorerProps): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<Record<string, string>>({});

  const childrenRef = useRef(children);
  childrenRef.current = children;
  const gitTimerRef = useRef<number | null>(null);

  const load = useCallback(async (path: string) => {
    try {
      const items = await listDir(path);
      setChildren((prev) => ({ ...prev, [path]: items }));
    } catch {
      /* ignore */
    }
  }, []);

  const refreshGit = useCallback((root: string) => {
    gitStatus(root)
      .then((entries) => {
        const map: Record<string, string> = {};
        for (const e of entries) map[e.path] = e.status;
        setGit(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setExpanded(new Set());
    setChildren({});
    setChanged(new Set());
    setGit({});
    if (workspace) {
      void load(workspace);
      void watchDir(workspace).catch(() => {});
      refreshGit(workspace);
    }
  }, [workspace, load, refreshGit]);

  useEffect(() => {
    if (!workspace) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<FsChangePayload>('fs:change', (event) => {
      const paths = event.payload?.paths ?? [];
      if (!paths.length) return;

      setChanged((prev) => {
        const next = new Set(prev);
        paths.forEach((p) => next.add(p));
        return next;
      });
      window.setTimeout(() => {
        setChanged((prev) => {
          const next = new Set(prev);
          paths.forEach((p) => next.delete(p));
          return next;
        });
      }, 2600);

      const dirs = new Set(paths.map(parentDir));
      dirs.forEach((d) => {
        if (d === workspace || childrenRef.current[d]) void load(d);
      });

      // Debounce git status: a burst of fs changes triggers a single git call.
      if (gitTimerRef.current !== null) window.clearTimeout(gitTimerRef.current);
      gitTimerRef.current = window.setTimeout(() => {
        gitTimerRef.current = null;
        refreshGit(workspace);
      }, 350);
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
      if (gitTimerRef.current !== null) {
        window.clearTimeout(gitTimerRef.current);
        gitTimerRef.current = null;
      }
    };
  }, [workspace, load, refreshGit]);

  const onRow = useCallback(
    (item: FsEntry) => {
      if (item.isDir) {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(item.path)) next.delete(item.path);
          else {
            next.add(item.path);
            if (!childrenRef.current[item.path]) void load(item.path);
          }
          return next;
        });
      } else {
        onSelectFile(item.path);
      }
    },
    [load, onSelectFile],
  );

  const renderNodes = (dir: string, depth: number): JSX.Element[] => {
    const items = children[dir] ?? [];
    return items.flatMap((item) => {
      const isOpen = expanded.has(item.path);
      const isChanged = changed.has(item.path);
      const isSelected = selectedFile === item.path;
      const badge = item.isDir ? null : gitBadge(git[item.path]);
      const row = (
        <div
          key={item.path}
          className={`tree-row ${isSelected ? 'tree-row--selected' : ''} ${isChanged ? 'tree-row--changed' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onRow(item)}
          title={item.name}
        >
          {item.isDir ? (
            <i
              className={`ti ti-chevron-right tree-chevron ${isOpen ? 'tree-chevron--open' : ''}`}
              aria-hidden="true"
            />
          ) : (
            <span className="tree-chevron-spacer" />
          )}
          <i
            className={`ti ${item.isDir ? (isOpen ? 'ti-folder-open' : 'ti-folder') : fileIcon(item.name)} tree-icon ${item.isDir ? 'tree-icon--dir' : ''}`}
            aria-hidden="true"
          />
          <span className={`tree-name ${badge ? `tree-name--${badge.cls}` : ''}`}>
            {item.name}
          </span>
          {badge ? (
            <span className={`git-badge ${badge.cls}`} title={`git: ${git[item.path]}`}>
              {badge.ch}
            </span>
          ) : (
            isChanged && <span className="tree-dot" aria-hidden="true" />
          )}
        </div>
      );
      return item.isDir && isOpen ? [row, ...renderNodes(item.path, depth + 1)] : [row];
    });
  };

  return (
    <aside className="explorer" style={{ flex: `0 0 ${width}px`, width }}>
      <div className="explorer__header">
        <span className="explorer__title">{workspace ? baseName(workspace) : 'explorador'}</span>
        <div className="explorer__actions">
          <button
            type="button"
            className="explorer__btn"
            onClick={onOpenFolder}
            title="Abrir pasta do projeto"
            aria-label="Abrir pasta"
          >
            <i className="ti ti-folder-plus" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="explorer__btn"
            onClick={onToggleCollapse}
            title="Recolher o explorador"
            aria-label="Recolher"
          >
            <i className="ti ti-layout-sidebar-left-collapse" aria-hidden="true" />
          </button>
        </div>
      </div>

      {!workspace ? (
        <div className="explorer__empty">
          <i className="ti ti-folder-open explorer__empty-icon" aria-hidden="true" />
          <p className="explorer__empty-text">Nenhuma pasta aberta</p>
          <button type="button" className="btn btn--primary explorer__open" onClick={onOpenFolder}>
            Abrir pasta
          </button>
        </div>
      ) : (
        <div className="explorer__tree">{renderNodes(workspace, 0)}</div>
      )}
    </aside>
  );
}
