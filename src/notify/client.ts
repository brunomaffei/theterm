// Thin wrapper over the Tauri notification plugin, called directly through
// `invoke` (no extra JS dependency). Used to ping the user when Claude finishes
// a run while THETERM is in the background.

import { invoke } from '@tauri-apps/api/core';

let granted: boolean | null = null;

/** Ensure OS notification permission, requesting it once if needed. */
export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    if (granted === null) {
      granted = await invoke<boolean>('plugin:notification|is_permission_granted');
    }
    if (!granted) {
      const res = await invoke<string>('plugin:notification|request_permission');
      granted = res === 'granted';
    }
    return granted;
  } catch {
    return false;
  }
}

/** Fire a desktop notification (best-effort; silently no-ops if denied). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!(await ensureNotifyPermission())) return;
    await invoke('plugin:notification|notify', { options: { title, body } });
  } catch {
    /* ignore */
  }
}
