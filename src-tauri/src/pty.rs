use std::io::{Read, Write};
use std::sync::atomic::Ordering;
use std::thread;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::AppState;

/// A live PTY session: the master side, a writer to feed it input, and the
/// spawned child process so we can resize/kill it.
pub struct PtyHandle {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

#[derive(Serialize, Clone)]
struct PtyDataPayload {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyExitPayload {
    id: u32,
    code: i32,
}

const SHELL_INTEGRATION_SCRIPT: &str = include_str!("../shell-integration/powershell.ps1");

/// Resolve a sensible home/working directory per OS.
fn default_cwd() -> std::path::PathBuf {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    home.map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
}

/// Pick the default shell for the current OS.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
    }
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, AppState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    // Choose the shell: provided arg, otherwise the OS default.
    let shell_path = shell
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(default_shell);
    let lower = shell_path.to_lowercase();
    let is_powershell = lower.contains("powershell") || lower.contains("pwsh");

    let mut cmd = CommandBuilder::new(&shell_path);

    if is_powershell {
        // Write the bundled shell-integration script to the per-user config dir
        // (not the shared world-writable temp dir) and dot-source it.
        let dir = crate::config::AiConfig::config_dir();
        let _ = std::fs::create_dir_all(&dir);
        let script_path = dir.join("theterm-shell-integration.ps1");
        // Best-effort write; if it fails we still launch a plain shell.
        let _ = std::fs::write(&script_path, SHELL_INTEGRATION_SCRIPT);
        let dot_source = format!(". '{}'", script_path.display());
        cmd.arg("-NoLogo");
        cmd.arg("-NoExit");
        cmd.arg("-Command");
        cmd.arg(dot_source);
    } else {
        // Spawn POSIX shells (zsh/bash/…) as LOGIN shells so they source the
        // user's profile (~/.zprofile, ~/.zshrc, /etc/profile) and inherit the
        // full PATH. A GUI app launched from Finder/Dock on macOS gets only a
        // minimal PATH, so a non-login shell wouldn't find tools the user has
        // (claude, brew, node, …). This matches Terminal.app's behavior.
        cmd.arg("-l");
    }

    // Use the requested workspace directory if it exists, else a sensible default.
    let workdir = cwd
        .filter(|p| !p.trim().is_empty())
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(default_cwd);
    cmd.cwd(workdir);

    // Advertise color support so the shell and TUIs (claude!) emit colors. A
    // Finder-launched GUI app inherits no TERM, so without this Unix CLIs fall
    // back to monochrome. xterm.js renders 256-color + truecolor fine.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);

    // Reader thread: pump PTY output to the frontend as base64 events.
    let app_for_reader = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let encoded = BASE64.encode(&buf[..n]);
                    let _ = app_for_reader.emit(
                        "pty:data",
                        PtyDataPayload {
                            id,
                            data: encoded,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Exit-watcher thread: wait for the child, then emit the exit event and
    // drop the session from the state map.
    let app_for_exit = app.clone();
    let handle = PtyHandle {
        master: pair.master,
        writer,
        child,
    };

    {
        let mut map = state.ptys.lock().map_err(|e| e.to_string())?;
        map.insert(id, handle);
    }

    // We can't move the child into a wait-thread (it lives in the map), so the
    // reader thread above already detects EOF. Emit exit when the reader ends
    // by spawning a lightweight waiter that polls the stored child's status.
    let app_handle = app_for_exit;
    let inner_state = app_handle.clone();
    thread::spawn(move || {
        use tauri::Manager;
        // Poll the child's exit status until it terminates.
        loop {
            let code_opt = {
                let state = inner_state.state::<AppState>();
                let mut map = match state.ptys.lock() {
                    Ok(m) => m,
                    Err(_) => return,
                };
                match map.get_mut(&id) {
                    Some(handle) => match handle.child.try_wait() {
                        Ok(Some(status)) => Some(status.exit_code() as i32),
                        Ok(None) => None,    // still running
                        Err(_) => Some(0),   // unknown -> report 0
                    },
                    None => return, // killed/removed elsewhere
                }
            };

            if let Some(code) = code_opt {
                let _ = app_handle.emit("pty:exit", PtyExitPayload { id, code });
                let state = app_handle.state::<AppState>();
                if let Ok(mut map) = state.ptys.lock() {
                    map.remove(&id);
                }
                return;
            }

            thread::sleep(std::time::Duration::from_millis(150));
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.ptys.lock().map_err(|e| e.to_string())?;
    let handle = map
        .get_mut(&id)
        .ok_or_else(|| format!("pty {id} not found"))?;
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.ptys.lock().map_err(|e| e.to_string())?;
    let handle = map.get(&id).ok_or_else(|| format!("pty {id} not found"))?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, id: u32) -> Result<(), String> {
    // Remove from the map first (releasing the lock), then kill + reap on a
    // detached thread so we never leave a zombie on Unix and don't block the
    // IPC call waiting for SIGHUP to take effect.
    let removed = {
        let mut map = state.ptys.lock().map_err(|e| e.to_string())?;
        map.remove(&id)
    };
    if let Some(mut handle) = removed {
        thread::spawn(move || {
            let _ = handle.child.kill();
            let _ = handle.child.wait(); // reap the zombie (no-op-ish on Windows)
            // master/writer/child are dropped here, after reaping.
        });
    }
    Ok(())
}
