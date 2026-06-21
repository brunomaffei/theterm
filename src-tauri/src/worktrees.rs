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

/// First free "agent/N" name (branch + worktree dir both unused).
fn next_agent_branch(repo: &str) -> String {
    for n in 1..=9999 {
        let b = format!("agent/{n}");
        let dir = worktrees_root(repo).join(sanitize(&b));
        if !branch_exists(repo, &b) && !dir.exists() {
            return b;
        }
    }
    "agent/x".to_string()
}

/// Create (or attach) a worktree and return it. An empty `branch` auto-names it
/// "agent/N". A new branch forks from `base` (e.g. "main") when given, else from
/// the current HEAD.
#[tauri::command]
pub fn worktree_create(
    path: String,
    branch: String,
    base: Option<String>,
) -> Result<Worktree, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    git(&path, &["rev-parse", "--git-dir"])
        .map_err(|_| "Esta pasta não é um repositório git.".to_string())?;

    let trimmed = branch.trim();
    let branch = if trimmed.is_empty() {
        next_agent_branch(&path)
    } else {
        trimmed.to_string()
    };

    let wt_dir = worktrees_root(&path).join(sanitize(&branch));
    let wt_str = wt_dir.to_string_lossy().into_owned();
    if wt_dir.exists() {
        return Err(format!("Já existe um worktree em {wt_str}."));
    }

    let base = base.as_deref().map(str::trim).filter(|s| !s.is_empty());

    if branch_exists(&path, &branch) {
        // Existing branch: attach it (base is irrelevant).
        git(&path, &["worktree", "add", &wt_str, &branch])
            .map_err(|e| format!("Falha ao criar o worktree: {e}"))?;
    } else {
        // New branch forked from `base` (or HEAD when base is None).
        let mut args: Vec<&str> = vec!["worktree", "add", "-b", &branch, &wt_str];
        if let Some(b) = base {
            args.push(b);
        }
        git(&path, &args).map_err(|e| format!("Falha ao criar o worktree: {e}"))?;
    }

    Ok(Worktree {
        branch,
        dir: wt_str,
        is_main: false,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoBranches {
    /// The branch the main checkout is currently on.
    pub current: String,
    /// Best guess of the repo's default branch (origin HEAD, else main/master).
    pub default_branch: String,
    /// Local branch names.
    pub branches: Vec<String>,
}

/// Branch info for the "base" picker when spawning an agent worktree.
#[tauri::command]
pub fn repo_branches(path: String) -> Result<RepoBranches, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    let current = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

    let default_branch = git(&path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .ok()
        .map(|s| s.trim().trim_start_matches("origin/").to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if branch_exists(&path, "main") {
                "main".to_string()
            } else if branch_exists(&path, "master") {
                "master".to_string()
            } else {
                current.clone()
            }
        });

    let branches = git(&path, &["branch", "--format=%(refname:short)"])
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with("agent/"))
        .collect();

    Ok(RepoBranches {
        current,
        default_branch,
        branches,
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
