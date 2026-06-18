// Thin wrappers over the Rust filesystem commands + native folder picker.

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** Open the native folder picker. Returns the chosen path or null. */
export async function pickFolder(): Promise<string | null> {
  const sel = await open({
    directory: true,
    multiple: false,
    title: 'Abrir pasta do projeto',
  });
  return typeof sel === 'string' ? sel : null;
}

export async function listDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>('list_dir', { path });
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path });
}

export async function writeFile(path: string, contents: string): Promise<void> {
  await invoke('write_file', { path, contents });
}

export async function watchDir(path: string): Promise<void> {
  await invoke('watch_dir', { path });
}

export interface GitStatusEntry {
  path: string;
  status: string;
}

/** Git porcelain status for the workspace (empty if not a repo / no git). */
export async function gitStatus(path: string): Promise<GitStatusEntry[]> {
  return invoke<GitStatusEntry[]>('git_status', { path });
}
