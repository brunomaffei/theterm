// Checkpoints: lightweight, non-intrusive snapshots of the working tree so a
// Claude run can be rolled back. Each checkpoint is a real commit object (built
// in a TEMPORARY index so the user's staging area is never touched) parked under
// `refs/theterm/checkpoints/<ts>`. It captures EVERYTHING — tracked changes plus
// untracked files — without modifying the working tree, index, or stash list.

use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const REF_PREFIX: &str = "refs/theterm/checkpoints/";

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let _ = cmd;
}

/// Run git in `path`, optionally with extra env (e.g. GIT_INDEX_FILE).
fn git_env(path: &str, args: &[&str], env: &[(&str, &str)]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path).args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    no_window(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("git não encontrado: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git(path: &str, args: &[&str]) -> Result<String, String> {
    git_env(path, args, &[])
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub sha: String,
    pub label: String,
    /// Unix seconds.
    pub created: i64,
    /// Files changed vs the checkpoint's parent.
    pub files: u32,
}

/// Count files that differ between `sha` and its first parent (or the whole tree
/// for a root commit). Best-effort: 0 on any error.
fn files_changed(path: &str, sha: &str) -> u32 {
    let parents = git(path, &["log", "-1", "--format=%P", sha]).unwrap_or_default();
    let first_parent = parents.split_whitespace().next().unwrap_or("");
    if first_parent.is_empty() {
        git(path, &["ls-tree", "-r", "--name-only", sha])
            .map(|s| s.lines().filter(|l| !l.is_empty()).count() as u32)
            .unwrap_or(0)
    } else {
        git(path, &["diff", "--name-only", first_parent, sha])
            .map(|s| s.lines().filter(|l| !l.is_empty()).count() as u32)
            .unwrap_or(0)
    }
}

/// Snapshot the entire working tree (tracked + untracked) without touching the
/// user's index or working tree. Returns the created checkpoint.
#[tauri::command]
pub fn checkpoint_create(path: String, label: String) -> Result<Checkpoint, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    git(&path, &["rev-parse", "--git-dir"])
        .map_err(|_| "Esta pasta não é um repositório git.".to_string())?;

    let label = if label.trim().is_empty() {
        "checkpoint".to_string()
    } else {
        label.trim().to_string()
    };

    let ts = now_ms();
    let tmp_index = std::env::temp_dir().join(format!("theterm-idx-{ts}"));
    let idx = tmp_index.to_string_lossy().into_owned();
    let env = [("GIT_INDEX_FILE", idx.as_str())];

    // Seed the temp index from HEAD (ignored for an empty repo), then stage
    // everything (including untracked) into it.
    let _ = git_env(&path, &["read-tree", "HEAD"], &env);
    let stage = git_env(&path, &["add", "-A"], &env);
    let tree = match stage.and_then(|_| git_env(&path, &["write-tree"], &env)) {
        Ok(t) => t,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_index);
            return Err(format!("Falha ao montar o snapshot: {e}"));
        }
    };

    let parent = git(&path, &["rev-parse", "HEAD"]).ok();
    let mut args: Vec<String> = vec!["commit-tree".into(), tree, "-m".into(), label.clone()];
    if let Some(p) = parent.as_ref() {
        args.push("-p".into());
        args.push(p.clone());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let sha = match git_env(&path, &arg_refs, &env) {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_index);
            return Err(format!("Falha ao gravar o snapshot: {e}"));
        }
    };
    let _ = std::fs::remove_file(&tmp_index);

    let id = ts.to_string();
    let refname = format!("{REF_PREFIX}{id}");
    git(&path, &["update-ref", &refname, &sha])?;

    let files = files_changed(&path, &sha);
    Ok(Checkpoint {
        id,
        sha,
        label,
        created: (ts / 1000) as i64,
        files,
    })
}

/// List checkpoints, newest first.
#[tauri::command]
pub fn checkpoint_list(path: String) -> Result<Vec<Checkpoint>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    // \x1f-separated fields per ref; tolerate a repo with no checkpoints yet.
    let fmt = "--format=%(refname)\x1f%(objectname)\x1f%(committerdate:unix)\x1f%(contents:subject)";
    let out = match git(&path, &["for-each-ref", fmt, REF_PREFIX]) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };

    let mut list = Vec::new();
    for line in out.lines() {
        let mut parts = line.split('\x1f');
        let refname = parts.next().unwrap_or("");
        let sha = parts.next().unwrap_or("").to_string();
        let created: i64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let label = parts.next().unwrap_or("checkpoint").to_string();
        let id = refname.strip_prefix(REF_PREFIX).unwrap_or(refname).to_string();
        if id.is_empty() || sha.is_empty() {
            continue;
        }
        let files = files_changed(&path, &sha);
        list.push(Checkpoint {
            id,
            sha,
            label,
            created,
            files,
        });
    }
    list.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(list)
}

/// Restore the working tree to a checkpoint. Files present in the snapshot are
/// reset to their snapshot content (the index is left untouched); files created
/// AFTER the snapshot are not removed. A safety checkpoint of the current state
/// is taken first and returned so the restore is itself undoable.
#[tauri::command]
pub fn checkpoint_restore(path: String, id: String) -> Result<Option<Checkpoint>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    let refname = format!("{REF_PREFIX}{id}");
    let sha = git(&path, &["rev-parse", &refname])
        .map_err(|_| "Checkpoint não encontrado.".to_string())?;

    // Safety net: snapshot the current state before overwriting it.
    let safety = checkpoint_create(path.clone(), "antes de restaurar".to_string()).ok();

    // Prefer `restore` (worktree only, index untouched); fall back to `checkout`
    // for older git.
    git(&path, &["restore", "--source", &sha, "--worktree", "--", "."])
        .or_else(|_| git(&path, &["checkout", &sha, "--", "."]))
        .map_err(|e| format!("Falha ao restaurar: {e}"))?;

    Ok(safety)
}

/// Drop a checkpoint ref.
#[tauri::command]
pub fn checkpoint_delete(path: String, id: String) -> Result<(), String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    git(&path, &["update-ref", "-d", &format!("{REF_PREFIX}{id}")])?;
    Ok(())
}
