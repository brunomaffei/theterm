mod ai;
mod config;
mod fsx;
mod profile;
mod pty;

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
            profile::apply_loadout,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
