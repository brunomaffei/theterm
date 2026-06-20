// Wrappers over the worktree-per-agent commands. Each worktree is an isolated
// branch + directory so parallel Claude sessions never collide.

import { invoke } from '@tauri-apps/api/core';

export interface Worktree {
  branch: string;
  dir: string;
  isMain: boolean;
}

export interface MergeResult {
  ok: boolean;
  output: string;
}

/** Create (or attach) a worktree for `branch`; new branches fork from HEAD. */
export async function worktreeCreate(path: string, branch: string): Promise<Worktree> {
  return invoke<Worktree>('worktree_create', { path, branch });
}

/** List the repo's worktrees (main checkout first). */
export async function worktreeList(path: string): Promise<Worktree[]> {
  return invoke<Worktree[]>('worktree_list', { path });
}

export async function worktreeRemove(
  path: string,
  dir: string,
  force: boolean,
  deleteBranch?: string,
): Promise<void> {
  return invoke<void>('worktree_remove', { path, dir, force, deleteBranch: deleteBranch ?? null });
}

/** Merge a worktree's branch back into the main repo's current branch. */
export async function worktreeMerge(path: string, branch: string): Promise<MergeResult> {
  return invoke<MergeResult>('worktree_merge', { path, branch });
}
