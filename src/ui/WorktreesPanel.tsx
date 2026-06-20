import React, { useCallback, useEffect, useState } from 'react';
import {
  worktreeList,
  worktreeMerge,
  worktreeRemove,
  type Worktree,
} from '../worktrees/client';

interface Props {
  path: string;
  onClose: () => void;
  showToast: (msg: string) => void;
}

function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * Worktrees manager: list the repo's worktrees and merge their branch back into
 * the main checkout or remove them. Closes the parallel-agent loop started by
 * the "+ Agente" button.
 */
export default function WorktreesPanel({ path, onClose, showToast }: Props): JSX.Element {
  const [list, setList] = useState<Worktree[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [mergeOut, setMergeOut] = useState<{ branch: string; ok: boolean; text: string } | null>(
    null,
  );

  const refresh = useCallback(() => {
    worktreeList(path)
      .then(setList)
      .catch(() => setList([]));
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const doMerge = (wt: Worktree): void => {
    setBusy(wt.dir);
    setMergeOut(null);
    worktreeMerge(path, wt.branch)
      .then((r) => {
        setMergeOut({ branch: wt.branch, ok: r.ok, text: r.output });
        if (r.ok) showToast(`Merge de '${wt.branch}' concluído.`);
      })
      .catch((e: unknown) =>
        showToast(`Falha no merge: ${e instanceof Error ? e.message : String(e)}`),
      )
      .finally(() => setBusy(null));
  };

  const doRemove = (wt: Worktree): void => {
    setBusy(wt.dir);
    worktreeRemove(path, wt.dir, force, deleteBranch ? wt.branch : undefined)
      .then(() => {
        showToast(`Worktree '${wt.branch}' removido.`);
        refresh();
      })
      .catch((e: unknown) =>
        showToast(
          `Falha ao remover (mudanças não commitadas? marque "forçar"): ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      )
      .finally(() => setBusy(null));
  };

  const others = (list ?? []).filter((w) => !w.isMain);

  return (
    <div className="wt-overlay" role="dialog" aria-label="Worktrees" onClick={onClose}>
      <div className="wt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wt-modal__head">
          <i className="ti ti-git-branch wt-modal__ic" aria-hidden="true" />
          <div className="wt-modal__title">Worktrees</div>
          <span className="wt-modal__sub">
            {others.length} agente{others.length === 1 ? '' : 's'} em paralelo
          </span>
          <div className="wt-modal__spacer" />
          <label className="wt-opt" title="Remover mesmo com mudanças não commitadas">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            forçar
          </label>
          <label className="wt-opt" title="Apagar o branch ao remover o worktree">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            apagar branch
          </label>
          <button type="button" className="wt-modal__x" onClick={onClose} aria-label="Fechar">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="wt-modal__body">
          {list === null ? (
            <div className="wt-empty">
              <i className="ti ti-loader-2 spin-ic" aria-hidden="true" /> Lendo worktrees…
            </div>
          ) : others.length === 0 ? (
            <div className="wt-empty">
              Nenhum worktree de agente ainda. Use o botão "+ Agente" na barra lateral.
            </div>
          ) : (
            others.map((wt) => (
              <div key={wt.dir} className="wt-row">
                <div className="wt-row__main">
                  <div className="wt-row__branch">
                    <i className="ti ti-git-branch" aria-hidden="true" /> {wt.branch}
                  </div>
                  <div className="wt-row__dir" title={wt.dir}>
                    {baseName(wt.dir)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost wt-row__btn"
                  onClick={() => doMerge(wt)}
                  disabled={busy === wt.dir}
                  title="Mergear este branch no checkout principal"
                >
                  <i className="ti ti-git-merge" aria-hidden="true" /> Mergear
                </button>
                <button
                  type="button"
                  className="wt-row__btn wt-row__btn--del"
                  onClick={() => doRemove(wt)}
                  disabled={busy === wt.dir}
                  title="Remover o worktree"
                >
                  <i className="ti ti-trash" aria-hidden="true" /> Remover
                </button>
              </div>
            ))
          )}

          {mergeOut && (
            <div className={`wt-merge ${mergeOut.ok ? 'ok' : 'fail'}`}>
              <div className="wt-merge__head">
                <i
                  className={`ti ${mergeOut.ok ? 'ti-circle-check' : 'ti-alert-triangle'}`}
                  aria-hidden="true"
                />
                {mergeOut.ok ? `Merge de '${mergeOut.branch}'` : `Conflito ao mergear '${mergeOut.branch}'`}
              </div>
              {mergeOut.text && <pre className="wt-merge__out">{mergeOut.text}</pre>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
