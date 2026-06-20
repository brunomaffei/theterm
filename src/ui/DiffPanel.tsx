import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { monacoThemeName, type Theme } from '../theme';
import { languageForPath } from './EditorArea';
import {
  changedFiles,
  fileDiff,
  checkpointCreate,
  checkpointList,
  checkpointRestore,
  checkpointDelete,
  type ChangedFile,
  type FileDiff,
  type Checkpoint,
} from '../diff/client';
import { getAutoCheckpoint, setAutoCheckpoint } from '../storage';

interface Props {
  path: string;
  theme: Theme;
  onClose: () => void;
  showToast: (msg: string) => void;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'st-mod' },
  A: { label: 'A', cls: 'st-add' },
  D: { label: 'D', cls: 'st-del' },
  R: { label: 'R', cls: 'st-ren' },
  '?': { label: '?', cls: 'st-new' },
};

function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function timeAgo(unixSec: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (sec < 60) return 'agora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

/** Monaco side-by-side diff editor with disposable throwaway models. */
function DiffView({
  original,
  modified,
  language,
  theme,
}: {
  original: string;
  modified: string;
  language: string;
  theme: Theme;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<{ o: monaco.editor.ITextModel; m: monaco.editor.ITextModel } | null>(
    null,
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const ed = monaco.editor.createDiffEditor(hostRef.current, {
      theme: monacoThemeName(theme),
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      fontFamily: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.5,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    editorRef.current = ed;
    return () => {
      ed.dispose();
      editorRef.current = null;
      modelsRef.current?.o.dispose();
      modelsRef.current?.m.dispose();
      modelsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    modelsRef.current?.o.dispose();
    modelsRef.current?.m.dispose();
    const o = monaco.editor.createModel(original, language);
    const m = monaco.editor.createModel(modified, language);
    modelsRef.current = { o, m };
    ed.setModel({ original: o, modified: m });
  }, [original, modified, language]);

  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName(theme));
  }, [theme]);

  return <div ref={hostRef} className="diff-view" />;
}

/**
 * Changes panel: what changed in the workspace (e.g. Claude's edits) shown as a
 * side-by-side diff, plus checkpoint snapshots you can roll back to.
 */
export default function DiffPanel({ path, theme, onClose, showToast }: Props): JSX.Element {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [snapping, setSnapping] = useState(false);
  const [busyCp, setBusyCp] = useState<string | null>(null);
  const [autoCp, setAutoCp] = useState<boolean>(() => getAutoCheckpoint());

  const refreshFiles = useCallback(() => {
    changedFiles(path)
      .then((f) => {
        setFiles(f);
        setSelected((cur) => cur ?? (f[0]?.file ?? null));
      })
      .catch(() => setFiles([]));
  }, [path]);

  const refreshCheckpoints = useCallback(() => {
    checkpointList(path)
      .then(setCheckpoints)
      .catch(() => setCheckpoints([]));
  }, [path]);

  useEffect(() => {
    refreshFiles();
    refreshCheckpoints();
  }, [refreshFiles, refreshCheckpoints]);

  // Load the diff whenever the selected file changes.
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    fileDiff(path, selected)
      .then((d) => !cancelled && setDiff(d))
      .catch(() => !cancelled && setDiff(null))
      .finally(() => !cancelled && setLoadingDiff(false));
    return () => {
      cancelled = true;
    };
  }, [path, selected]);

  const doSnapshot = (): void => {
    setSnapping(true);
    checkpointCreate(path, 'snapshot manual')
      .then(() => {
        refreshCheckpoints();
        showToast('Checkpoint criado.');
      })
      .catch((e: unknown) =>
        showToast(`Falha no checkpoint: ${e instanceof Error ? e.message : String(e)}`),
      )
      .finally(() => setSnapping(false));
  };

  const doRestore = (cp: Checkpoint): void => {
    setBusyCp(cp.id);
    checkpointRestore(path, cp.id)
      .then(() => {
        refreshFiles();
        refreshCheckpoints();
        setSelected(null);
        showToast('Restaurado. Um checkpoint de segurança foi criado antes.');
      })
      .catch((e: unknown) =>
        showToast(`Falha ao restaurar: ${e instanceof Error ? e.message : String(e)}`),
      )
      .finally(() => setBusyCp(null));
  };

  const doDelete = (cp: Checkpoint): void => {
    setBusyCp(cp.id);
    checkpointDelete(path, cp.id)
      .then(() => refreshCheckpoints())
      .catch(() => {})
      .finally(() => setBusyCp(null));
  };

  const toggleAuto = (): void => {
    setAutoCp((cur) => {
      const next = !cur;
      setAutoCheckpoint(next);
      return next;
    });
  };

  const language = selected ? languageForPath(selected) : 'plaintext';

  return (
    <div className="diff-overlay" role="dialog" aria-label="Mudanças" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal__head">
          <i className="ti ti-git-compare diff-modal__ic" aria-hidden="true" />
          <div className="diff-modal__title">Mudanças</div>
          <span className="diff-modal__sub">
            {files.length} arquivo{files.length === 1 ? '' : 's'}
          </span>
          <div className="diff-modal__spacer" />
          <button
            type="button"
            className="btn-ghost diff-snap"
            onClick={doSnapshot}
            disabled={snapping}
            title="Criar um checkpoint do estado atual"
          >
            {snapping ? (
              <i className="ti ti-loader-2 spin-ic" aria-hidden="true" />
            ) : (
              <i className="ti ti-camera" aria-hidden="true" />
            )}
            Snapshot
          </button>
          <button
            type="button"
            className="diff-modal__x"
            onClick={onClose}
            aria-label="Fechar"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="diff-modal__body">
          <div className="diff-side">
            <div className="diff-side__label">Arquivos</div>
            <div className="diff-files">
              {files.length === 0 ? (
                <div className="diff-empty">Nenhuma mudança vs último commit.</div>
              ) : (
                files.map((f) => {
                  const meta = STATUS_META[f.status] ?? STATUS_META.M;
                  return (
                    <button
                      key={f.file}
                      type="button"
                      className={`diff-file ${selected === f.file ? 'diff-file--active' : ''}`}
                      onClick={() => setSelected(f.file)}
                      title={f.file}
                    >
                      <span className={`diff-file__st ${meta.cls}`}>{meta.label}</span>
                      <span className="diff-file__name">{baseName(f.file)}</span>
                      <span className="diff-file__dir">{f.file}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="diff-side__label diff-side__label--cp">
              Checkpoints
              <label className="diff-auto" title="Snapshot automático antes de cada rodada do Claude">
                <input type="checkbox" checked={autoCp} onChange={toggleAuto} />
                auto
              </label>
            </div>
            <div className="diff-cps">
              {checkpoints.length === 0 ? (
                <div className="diff-empty">Nenhum checkpoint ainda.</div>
              ) : (
                checkpoints.map((cp) => (
                  <div key={cp.id} className="diff-cp">
                    <div className="diff-cp__main">
                      <div className="diff-cp__label">{cp.label}</div>
                      <div className="diff-cp__meta">
                        {timeAgo(cp.created)} · {cp.files} arq.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="diff-cp__btn"
                      onClick={() => doRestore(cp)}
                      disabled={busyCp === cp.id}
                      title="Restaurar o estado deste checkpoint"
                    >
                      <i className="ti ti-history" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="diff-cp__btn diff-cp__btn--del"
                      onClick={() => doDelete(cp)}
                      disabled={busyCp === cp.id}
                      title="Apagar checkpoint"
                    >
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="diff-main">
            {!selected ? (
              <div className="diff-placeholder">
                <i className="ti ti-git-compare" aria-hidden="true" />
                <p>Selecione um arquivo para ver o diff.</p>
              </div>
            ) : loadingDiff ? (
              <div className="diff-placeholder">
                <i className="ti ti-loader-2 spin-ic" aria-hidden="true" />
                <p>Carregando diff…</p>
              </div>
            ) : diff?.binary ? (
              <div className="diff-placeholder">
                <i className="ti ti-file-unknown" aria-hidden="true" />
                <p>Arquivo binário — diff não disponível.</p>
              </div>
            ) : diff ? (
              <DiffView
                original={diff.original}
                modified={diff.modified}
                language={language}
                theme={theme}
              />
            ) : (
              <div className="diff-placeholder">
                <i className="ti ti-alert-triangle" aria-hidden="true" />
                <p>Não consegui carregar o diff deste arquivo.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
