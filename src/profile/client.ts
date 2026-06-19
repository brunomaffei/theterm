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

/** Scan a workspace folder and return its profile + recommended loadout. */
export async function projectProfile(path: string): Promise<Profile> {
  return invoke<Profile>('project_profile', { path });
}

/** Write the chosen agents + CLAUDE.md block into the project. */
export async function applyLoadout(path: string, agentIds: string[]): Promise<string> {
  return invoke<string>('apply_loadout', { path, agentIds });
}
