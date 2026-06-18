// Shared TypeScript types for THETERM.
// These mirror the Rust serde structs (camelCase) and the frontend contract.

export type BlockStatus = 'running' | 'success' | 'error';

export interface Block {
  /** Unique per command. */
  id: string;
  /** Command line text from OSC 633;E (or '' if unknown). */
  command: string;
  /** Process exit code, or null while running / unknown. */
  exitCode: number | null;
  /** Lifecycle status of the command block. */
  status: BlockStatus;
  /** Start timestamp (ms epoch). */
  startedAt: number;
  /** End timestamp (ms epoch), or null while running. */
  endedAt: number | null;
  /** Plain-text output captured for this command (ANSI stripped). */
  output: string;
}

export interface Suggestion {
  command: string;
  explanation: string;
  danger: boolean;
}

export interface Fix {
  diagnosis: string;
  command: string;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  text: string;
}

export interface ChatReply {
  reply: string;
  sessionId: string | null;
}

export type AiProvider = 'claude-cli' | 'api-key' | 'none';

export interface AiStatus {
  configured: boolean;
  /** Where AI requests are routed: local Claude CLI, the API, or nowhere. */
  provider: AiProvider;
  suggestModel: string;
  fixModel: string;
}

export interface ClaudeInfo {
  available: boolean;
  version: string;
  path: string;
}
