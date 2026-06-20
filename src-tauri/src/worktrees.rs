// Worktree-per-agent: spin up isolated git worktrees so several Claude sessions
// can run in parallel without stepping on each other. Each agent gets its own
// branch + directory tree (sharing the repo's .git), so dirty state and builds
// never collide. Worktrees live in a sibling `<repo>.worktrees/` folder.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let _ = cmd;
}

/// Run git in `repo`. Returns Ok(stdout) on success, Err(stderr) otherwise.
fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    no_window(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("git não encontrado: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub branch: String,
    pub dir: String,
    pub is_main: bool,
}

/// Replace path-hostile characters in a branch name for the directory name
/// (the real branch name keeps its slashes).
fn sanitize(branch: &str) -> String {
    branch
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | ' ' => '-',
            other => other,
        })
        .collect()
}

/// Where this repo's worktrees live: a sibling `<repo-name>.worktrees/` folder.
fn worktrees_root(repo: &str) -> PathBuf {
    let p = Path::new(repo);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repo".to_string());
    let parent = p.parent().map(|x| x.to_path_buf()).unwrap_or_else(|| p.to_path_buf());
    parent.join(format!("{name}.worktrees"))
}

fn branch_exists(repo: &str, branch: &str) -> bool {
    git(repo, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok()
}

/// Create (or attach) a worktree for `branch` and return it. If the branch is
/// new it's created from the current HEAD.
#[tauri::command]
pub fn worktree_create(path: String, branch: String) -> Result<Worktree, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    git(&path, &["rev-parse", "--git-dir"])
        .map_err(|_| "Esta pasta não é um repositório git.".to_string())?;

    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Informe um nome de branch.".to_string());
    }

    let wt_dir = worktrees_root(&path).join(sanitize(branch));
    let wt_str = wt_dir.to_string_lossy().into_owned();

    if wt_dir.exists() {
        return Err(format!("Já existe um worktree em {wt_str}."));
    }

    if branch_exists(&path, branch) {
        git(&path, &["worktree", "add", &wt_str, branch])
            .map_err(|e| format!("Falha ao criar o worktree: {e}"))?;
    } else {
        git(&path, &["worktree", "add", "-b", branch, &wt_str])
            .map_err(|e| format!("Falha ao criar o worktree: {e}"))?;
    }

    Ok(Worktree {
        branch: branch.to_string(),
        dir: wt_str,
        is_main: false,
    })
}

/// List the repo's worktrees (the main checkout first).
#[tauri::command]
pub fn worktree_list(path: String) -> Result<Vec<Worktree>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    let out = match git(&path, &["worktree", "list", "--porcelain"]) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };

    // Resolve the main worktree's path so we can flag it.
    let main = git(&path, &["rev-parse", "--show-toplevel"]).unwrap_or_default();

    let mut list = Vec::new();
    let mut cur_dir: Option<String> = None;
    let mut cur_branch = String::new();
    let mut detached = false;

    let mut flush = |dir: &mut Option<String>, branch: &mut String, detached: &mut bool| {
        if let Some(d) = dir.take() {
            let is_main = !main.is_empty() && same_path(&d, &main);
            let label = if *detached {
                "(detached)".to_string()
            } else if branch.is_empty() {
                "(sem branch)".to_string()
            } else {
                std::mem::take(branch)
            };
            list.push(Worktree {
                branch: label,
                dir: d,
                is_main,
            });
        }
        branch.clear();
        *detached = false;
    };

    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            flush(&mut cur_dir, &mut cur_branch, &mut detached);
            cur_dir = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            cur_branch = rest.trim().trim_start_matches("refs/heads/").to_string();
        } else if line.trim() == "detached" {
            detached = true;
        }
    }
    flush(&mut cur_dir, &mut cur_branch, &mut detached);

    // Main checkout first, then the rest.
    list.sort_by(|a, b| b.is_main.cmp(&a.is_main));
    Ok(list)
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

/// Remove a worktree (and optionally delete its branch).
#[tauri::command]
pub fn worktree_remove(
    path: String,
    dir: String,
    force: bool,
    delete_branch: Option<String>,
) -> Result<(), String> {
    let repo = Path::new(&path);
    if !repo.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&dir);
    git(&path, &args).map_err(|e| format!("Falha ao remover o worktree: {e}"))?;

    if let Some(b) = delete_branch {
        let b = b.trim();
        if !b.is_empty() {
            // Best-effort: don't fail the whole op if the branch can't be deleted.
            let _ = git(&path, &["branch", "-D", b]);
        }
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub ok: bool,
    pub output: String,
}

/// Merge `branch` into the main repo's current branch (no auto-resolution; on a
/// conflict the output explains and the user resolves in the terminal).
#[tauri::command]
pub fn worktree_merge(path: String, branch: String) -> Result<MergeResult, String> {
    let repo = Path::new(&path);
    if !repo.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Branch vazio.".to_string());
    }
    match git(&path, &["merge", "--no-edit", branch]) {
        Ok(out) => Ok(MergeResult {
            ok: true,
            output: if out.is_empty() { "Merge concluído.".to_string() } else { out },
        }),
        Err(err) => Ok(MergeResult { ok: false, output: err }),
    }
}
