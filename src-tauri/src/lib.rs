mod ai;
mod checkpoints;
mod config;
mod fsx;
mod profile;
mod pty;
mod verify;
mod worktrees;

use std::collections::HashMap;
use std::sync::atomic::AtomicU32;
use std::sync::Mutex;

use pty::PtyHandle;

/// Global application state managed by Tauri.
pub struct AppState {
    /// Live PTY sessions keyed by their assigned id.
    pub ptys: Mutex<HashMap<u32, PtyHandle>>,
    /// Monotonic id generator for PTY sessions.
    pub next_id: AtomicU32,
    /// AI configuration (API key + model selection).
    pub ai: Mutex<config::AiConfig>,
    /// Active filesystem watcher for the open workspace (if any).
    pub fs_watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            ptys: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
            ai: Mutex::new(config::AiConfig::load()),
            fs_watcher: Mutex::new(None),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            ai::ai_status,
            ai::ai_set_key,
            ai::ai_suggest_command,
            ai::ai_fix_error,
            ai::ai_chat,
            ai::claude_version,
            ai::claude_update,
            fsx::list_dir,
            fsx::read_file,
            fsx::write_file,
            fsx::watch_dir,
            fsx::git_status,
            profile::project_profile,
            profile::profile_applied,
            profile::apply_loadout,
            profile::ai_select_team,
            verify::git_diff,
            verify::changed_files,
            verify::file_diff,
            verify::ai_review_diff,
            verify::guess_test_command,
            verify::run_check,
            checkpoints::checkpoint_create,
            checkpoints::checkpoint_list,
            checkpoints::checkpoint_restore,
            checkpoints::checkpoint_delete,
            worktrees::worktree_create,
            worktrees::worktree_list,
            worktrees::worktree_remove,
            worktrees::worktree_merge,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
