// Wrappers over the verification-loop commands: diff, AI review, and the test
// runner. Produces the green/red verdict shown before commit.

import { invoke } from '@tauri-apps/api/core';

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
}

export interface DiffResult {
  files: DiffFile[];
  patch: string;
  hasChanges: boolean;
  truncated: boolean;
}

export type Severity = 'bug' | 'risk' | 'nit';
export type Verdict = 'green' | 'yellow' | 'red' | 'none';

export interface Finding {
  severity: Severity;
  file: string;
  line: string;
  issue: string;
  fix: string;
}

export interface ReviewResult {
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  changedFiles: number;
}

export interface CheckResult {
  passed: boolean;
  code: number;
  output: string;
  timedOut: boolean;
}

/** Current working-tree diff vs HEAD. */
export async function gitDiff(path: string): Promise<DiffResult> {
  return invoke<DiffResult>('git_diff', { path });
}

/** AI review of the current diff → findings + verdict. */
export async function aiReviewDiff(path: string): Promise<ReviewResult> {
  return invoke<ReviewResult>('ai_review_diff', { path });
}

/** Best-effort guess of the project's test command. */
export async function guessTestCommand(path: string): Promise<string> {
  return invoke<string>('guess_test_command', { path });
}

/** Run a check/test command in the project, capturing pass/fail + output tail. */
export async function runCheck(path: string, command: string): Promise<CheckResult> {
  return invoke<CheckResult>('run_check', { path, command });
}
