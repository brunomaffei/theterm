// Thin typed wrappers over the Rust AI Tauri commands.
// Used by the UI; keeps invoke() details out of components.

import { invoke } from '@tauri-apps/api/core';
import type { AiStatus, ChatReply, ClaudeInfo, Fix, Suggestion } from '../types';

// Re-export the shared types so callers can import everything from here.
export type { AiStatus, ChatReply, ClaudeInfo, Fix, Suggestion } from '../types';

/**
 * Query whether an Anthropic API key is configured and which models are in use.
 */
export async function aiStatus(): Promise<AiStatus> {
  return invoke<AiStatus>('ai_status');
}

/**
 * Store + persist the Anthropic API key in the Rust backend.
 */
export async function aiSetKey(key: string): Promise<void> {
  await invoke('ai_set_key', { key });
}

/**
 * Ask the AI to translate a natural-language query into a shell command.
 * @param query   The natural-language request.
 * @param context Optional extra context (e.g. recent output / cwd).
 */
export async function suggestCommand(
  query: string,
  context?: string,
): Promise<Suggestion> {
  return invoke<Suggestion>('ai_suggest_command', { query, context });
}

/**
 * Ask the AI to diagnose a failed command and propose a fix.
 * @param command  The command that failed.
 * @param output   The captured (plain-text) output of that command.
 * @param exitCode The integer exit code returned by the process.
 */
export async function fixError(
  command: string,
  output: string,
  exitCode: number,
): Promise<Fix> {
  return invoke<Fix>('ai_fix_error', { command, output, exitCode });
}

/**
 * Multi-turn chat with the AI about the terminal.
 * @param message   The user's message.
 * @param context   Optional terminal context (recent commands / errors).
 * @param sessionId Session id from a previous reply, to keep conversation memory.
 */
export async function chat(
  message: string,
  context?: string,
  sessionId?: string | null,
): Promise<ChatReply> {
  return invoke<ChatReply>('ai_chat', {
    message,
    context,
    sessionId: sessionId ?? null,
  });
}

/** Whether the local Claude CLI is installed, and its version. */
export async function claudeVersion(): Promise<ClaudeInfo> {
  return invoke<ClaudeInfo>('claude_version');
}

/** Run `claude update` (checks + installs latest). Returns its output text. */
export async function claudeUpdate(): Promise<string> {
  return invoke<string>('claude_update');
}
