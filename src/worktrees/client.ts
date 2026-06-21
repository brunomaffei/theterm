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

export interface RepoBranches {
  current: string;
  defaultBranch: string;
  branches: string[];
}

/**
 * Create (or attach) a worktree. Empty `branch` → auto-named "agent/N". A new
 * branch forks from `base` (e.g. "main") when given, else from HEAD.
 */
export async function worktreeCreate(
  path: string,
  branch: string,
  base?: string,
): Promise<Worktree> {
  return invoke<Worktree>('worktree_create', { path, branch, base: base ?? null });
}

/** Branch info for the agent base-branch picker. */
export async function repoBranches(path: string): Promise<RepoBranches> {
  return invoke<RepoBranches>('repo_branches', { path });
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
