use std::fs;
use std::path::Path;

use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// List the immediate children of a directory, folders first then files,
/// each alphabetically.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let read = fs::read_dir(&path).map_err(|e| format!("Não consegui ler {path}: {e}"))?;
    let mut entries: Vec<FsEntry> = Vec::new();
    for ent in read.flatten() {
        let p = ent.path();
        let is_dir = p.is_dir();
        entries.push(FsEntry {
            name: ent.file_name().to_string_lossy().into_owned(),
            path: p.to_string_lossy().into_owned(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Não consegui ler {path}: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Não consegui salvar {path}: {e}"))
}

#[derive(Serialize, Clone)]
struct FsChangePayload {
    paths: Vec<String>,
}

/// Start (or replace) a recursive filesystem watcher on `path`. Emits
/// `fs:change` with the affected paths on create/modify/remove.
#[tauri::command]
pub fn watch_dir(state: State<'_, AppState>, app: AppHandle, path: String) -> Result<(), String> {
    let mut guard = state.fs_watcher.lock().map_err(|e| e.to_string())?;
    // Drop any previous watcher first.
    *guard = None;

    let app_handle = app.clone();
    let mut watcher =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                if matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    let paths: Vec<String> = event
                        .paths
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
                    if !paths.is_empty() {
                        let _ = app_handle.emit("fs:change", FsChangePayload { paths });
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    /// Absolute path (OS separators), matching list_dir output.
    path: String,
    /// Porcelain status code, e.g. "M", "??", "A", "D".
    status: String,
}

/// Git status for the workspace (porcelain). Returns an empty list if `path`
/// isn't a git repo or git isn't installed — never an error.
#[tauri::command]
pub fn git_status(path: String) -> Result<Vec<GitStatusEntry>, String> {
    let mut cmd = std::process::Command::new("git");
    // -z => NUL-separated, paths emitted verbatim (no C-quoting), so non-ASCII
    // names and names containing " -> " are handled correctly. For rename/copy
    // entries git emits the ORIGINAL path as a separate trailing NUL field.
    cmd.arg("-C")
        .arg(&path)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("-z")
        .arg("--untracked-files=all");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return Ok(Vec::new()), // git not installed
    };
    if !output.status.success() {
        return Ok(Vec::new()); // not a repo
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let root = Path::new(&path);
    let mut entries = Vec::new();
    let mut fields = stdout.split('\0');
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let bytes = entry.as_bytes();
        let code = entry[0..2].trim().to_string();
        let rel = &entry[3..];
        // Consume (discard) the original path that follows a rename/copy.
        if bytes[0] == b'R' || bytes[0] == b'C' || bytes[1] == b'R' || bytes[1] == b'C' {
            let _ = fields.next();
        }
        if rel.is_empty() {
            continue;
        }
        let abs = root.join(rel);
        let p = abs.to_string_lossy().into_owned();
        // Normalize to OS separators so it matches list_dir output (git uses '/').
        #[cfg(windows)]
        let p = p.replace('/', "\\");
        entries.push(GitStatusEntry { path: p, status: code });
    }
    Ok(entries)
}
