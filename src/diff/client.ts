// Wrappers over the diff-viewer + checkpoint commands. The diff panel shows
// what changed in the workspace (e.g. Claude's edits); checkpoints are git-ref
// snapshots you can roll back to.

import { invoke } from '@tauri-apps/api/core';

export interface ChangedFile {
  /** Path relative to the workspace, '/'-separated. */
  file: string;
  /** Simplified status: "M" | "A" | "D" | "R" | "?". */
  status: string;
}

export interface FileDiff {
  /** Content at HEAD (empty for a new/untracked file). */
  original: string;
  /** Current working-tree content (empty for a deleted file). */
  modified: string;
  binary: boolean;
}

export interface Checkpoint {
  /** Stable id (the snapshot timestamp). */
  id: string;
  sha: string;
  label: string;
  /** Unix seconds. */
  created: number;
  /** Files changed vs the checkpoint's parent. */
  files: number;
}

/** Files changed in the workspace vs HEAD (tracked + untracked). */
export async function changedFiles(path: string): Promise<ChangedFile[]> {
  return invoke<ChangedFile[]>('changed_files', { path });
}

/** HEAD vs working-tree content for one file (for the diff editor). */
export async function fileDiff(path: string, file: string): Promise<FileDiff> {
  return invoke<FileDiff>('file_diff', { path, file });
}

/** Snapshot the whole working tree (tracked + untracked) into a git ref. */
export async function checkpointCreate(path: string, label: string): Promise<Checkpoint> {
  return invoke<Checkpoint>('checkpoint_create', { path, label });
}

/** List existing checkpoints, newest first. */
export async function checkpointList(path: string): Promise<Checkpoint[]> {
  return invoke<Checkpoint[]>('checkpoint_list', { path });
}

/**
 * Restore the working tree to a checkpoint. Files that existed at snapshot time
 * are reset to their snapshot content; files created afterwards are left alone.
 * A safety checkpoint of the current state is taken first and returned.
 */
export async function checkpointRestore(path: string, id: string): Promise<Checkpoint | null> {
  return invoke<Checkpoint | null>('checkpoint_restore', { path, id });
}

export async function checkpointDelete(path: string, id: string): Promise<void> {
  return invoke<void>('checkpoint_delete', { path, id });
}
