// Wrappers over the Rust Project Profiler commands. The profiler scans an open
// workspace, infers its stack, and recommends a curated agent loadout; applying
// it writes the agents into the project's `.claude/agents/` + a CLAUDE.md block.

import { invoke } from '@tauri-apps/api/core';

export interface AgentInfo {
  id: string;
  title: string;
  description: string;
  icon: string;
  core: boolean;
}

export interface Profile {
  path: string;
  name: string;
  stacks: string[];
  labels: string[];
  agents: AgentInfo[];
  summary: string;
}

/** AI-extracted project brief, woven into CLAUDE.md. */
export interface ProjectBrief {
  conventions: string;
  testCommand: string;
  architecture: string;
  notes: string;
}

/** An agent the AI picked, with its per-project justification. */
export interface TeamPick extends AgentInfo {
  reason: string;
}

export interface TeamSelection {
  agents: TeamPick[];
  brief: ProjectBrief;
}

/** Scan a workspace folder and return its profile + recommended loadout. */
export async function projectProfile(path: string): Promise<Profile> {
  return invoke<Profile>('project_profile', { path });
}

/** Whether a loadout was already applied (managed CLAUDE.md block present). */
export async function profileApplied(path: string): Promise<boolean> {
  return invoke<boolean>('profile_applied', { path });
}

/** Ask Claude to pick the best team for this project + extract a brief. */
export async function aiSelectTeam(path: string): Promise<TeamSelection> {
  return invoke<TeamSelection>('ai_select_team', { path });
}

/** Write the chosen agents + CLAUDE.md block (optionally with an AI brief). */
export async function applyLoadout(
  path: string,
  agentIds: string[],
  brief: ProjectBrief | null = null,
): Promise<string> {
  return invoke<string>('apply_loadout', { path, agentIds, brief });
}
