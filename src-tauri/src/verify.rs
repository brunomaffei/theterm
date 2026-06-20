// Verification loop: the trust layer. After changes are made (by Claude or the
// user), THETERM can produce a green/red verdict BEFORE commit — an AI review of
// the diff plus the project's test command. This turns "I think it's better"
// into a measurable verdict and catches mistakes early.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::AppState;

/// Apply CREATE_NO_WINDOW on Windows so spawning never flashes a console.
fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd;
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub added: u32,
    pub removed: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub files: Vec<DiffFile>,
    pub patch: String,
    pub has_changes: bool,
    pub truncated: bool,
}

/// Cap the patch we feed the model so a huge diff can't blow the context.
const MAX_PATCH: usize = 14000;

fn run_git(path: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path).args(args);
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Compute the working-tree diff vs HEAD (tracked changes). Returns file stats
/// and a (possibly truncated) unified patch.
fn compute_diff(path: &str) -> DiffResult {
    // numstat → "added\tremoved\tpath" per file.
    let numstat = run_git(path, &["diff", "HEAD", "--numstat"])
        .or_else(|| run_git(path, &["diff", "--numstat"]))
        .unwrap_or_default();

    let mut files = Vec::new();
    for line in numstat.lines() {
        let mut parts = line.split('\t');
        let added = parts.next().unwrap_or("0");
        let removed = parts.next().unwrap_or("0");
        let file = parts.next().unwrap_or("").trim();
        if file.is_empty() {
            continue;
        }
        files.push(DiffFile {
            path: file.to_string(),
            added: added.parse().unwrap_or(0),
            removed: removed.parse().unwrap_or(0),
        });
    }

    let mut patch = run_git(path, &["diff", "HEAD"])
        .or_else(|| run_git(path, &["diff"]))
        .unwrap_or_default();

    let truncated = patch.len() > MAX_PATCH;
    if truncated {
        patch.truncate(MAX_PATCH);
        patch.push_str("\n… (diff truncado)");
    }

    DiffResult {
        has_changes: !files.is_empty(),
        files,
        patch,
        truncated,
    }
}

/// The current diff for the workspace (for the verify panel summary).
#[tauri::command]
pub fn git_diff(path: String) -> Result<DiffResult, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    Ok(compute_diff(&path))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// Path relative to the workspace, '/'-separated.
    pub file: String,
    /// Simplified status: "M" | "A" | "D" | "R" | "?".
    pub status: String,
}

/// Collapse a two-char porcelain code into a single visible status.
fn simplify_status(code: &str) -> String {
    if code.contains('?') {
        "?".into()
    } else if code.contains('D') {
        "D".into()
    } else if code.contains('R') || code.contains('C') {
        "R".into()
    } else if code.contains('A') {
        "A".into()
    } else {
        "M".into()
    }
}

/// Files changed in the workspace vs HEAD, including untracked. Returns relative
/// ('/'-separated) paths so they pair with `file_diff`. Empty if not a repo.
#[tauri::command]
pub fn changed_files(path: String) -> Result<Vec<ChangedFile>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    let out = run_git(
        &path,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ],
    )
    .unwrap_or_default();

    let mut files = Vec::new();
    let mut fields = out.split('\0');
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let bytes = entry.as_bytes();
        let code = &entry[0..2];
        let rel = entry[3..].to_string();
        // Rename/copy entries carry the original path as a trailing field.
        if bytes[0] == b'R' || bytes[0] == b'C' || bytes[1] == b'R' || bytes[1] == b'C' {
            let _ = fields.next();
        }
        if rel.is_empty() {
            continue;
        }
        files.push(ChangedFile {
            file: rel,
            status: simplify_status(code),
        });
    }
    Ok(files)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub original: String,
    pub modified: String,
    pub binary: bool,
}

/// Largest file we feed the diff editor (protects Monaco from huge blobs).
const MAX_FILE: usize = 400_000;

/// HEAD vs working-tree content for one file. `file` is relative to `path`.
/// Original is empty for a new file; modified is empty for a deleted file.
#[tauri::command]
pub fn file_diff(path: String, file: String) -> Result<FileDiff, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    let rel = file.replace('\\', "/");

    // HEAD version (None when the file is new/untracked).
    let original = run_git(&path, &["show", &format!("HEAD:{rel}")]).unwrap_or_default();

    // Working-tree version (read as bytes so we can detect binary).
    let modified_bytes = std::fs::read(dir.join(&rel)).unwrap_or_default();
    let binary = modified_bytes.contains(&0) || original.as_bytes().contains(&0);

    let mut original = if binary { String::new() } else { original };
    let mut modified = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&modified_bytes).into_owned()
    };
    if original.len() > MAX_FILE {
        original.truncate(MAX_FILE);
        original.push_str("\n… (truncado)");
    }
    if modified.len() > MAX_FILE {
        modified.truncate(MAX_FILE);
        modified.push_str("\n… (truncado)");
    }

    Ok(FileDiff {
        original,
        modified,
        binary,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// "bug" | "risk" | "nit"
    pub severity: String,
    pub file: String,
    pub line: String,
    pub issue: String,
    pub fix: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResult {
    /// "green" | "yellow" | "red" | "none"
    pub verdict: String,
    pub summary: String,
    pub findings: Vec<Finding>,
    pub changed_files: usize,
}

const REVIEW_SCHEMA: &str = r#"{"type":"object","properties":{"findings":{"type":"array","items":{"type":"object","properties":{"severity":{"type":"string","enum":["bug","risk","nit"]},"file":{"type":"string"},"line":{"type":"string"},"issue":{"type":"string"},"fix":{"type":"string"}},"required":["severity","file","line","issue","fix"],"additionalProperties":false}},"summary":{"type":"string"}},"required":["findings","summary"],"additionalProperties":false}"#;

#[derive(serde::Deserialize)]
struct AiReview {
    findings: Vec<AiFinding>,
    summary: String,
}

#[derive(serde::Deserialize)]
struct AiFinding {
    severity: String,
    file: String,
    line: String,
    issue: String,
    fix: String,
}

/// AI review of the current diff: returns findings + a green/yellow/red verdict.
#[tauri::command]
pub async fn ai_review_diff(
    state: State<'_, AppState>,
    path: String,
) -> Result<ReviewResult, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }

    let diff = compute_diff(&path);
    if !diff.has_changes {
        return Ok(ReviewResult {
            verdict: "none".to_string(),
            summary: "Nenhuma mudança para revisar (vs último commit).".to_string(),
            findings: Vec::new(),
            changed_files: 0,
        });
    }

    let system = "Você é um revisor de código sênior, rigoroso e direto. Revise APENAS o diff \
fornecido. Procure: bugs de correção, casos de borda não tratados, regressões, erros \
silenciados, vazamento de recurso e problemas de concorrência. Classifique cada achado como \
'bug' (precisa corrigir), 'risk' (risco/caso de borda) ou 'nit' (melhoria opcional). Para cada \
um, informe file, line (aproximada, como string), issue (1 frase) e fix (correção sugerida). \
NÃO invente problema para preencher lista — só aponte o que tem confiança. Responda em PT-BR, \
APENAS com JSON do schema.";

    let user = format!("Revise este diff:\n\n{}", diff.patch);

    let cleaned = crate::ai::structured_call(&state, system, &user, REVIEW_SCHEMA, 1500, true).await?;
    let parsed: AiReview = serde_json::from_str(&cleaned)
        .map_err(|e| format!("A IA retornou um JSON inválido: {e}. Resposta: {cleaned}"))?;

    let findings: Vec<Finding> = parsed
        .findings
        .into_iter()
        .map(|f| Finding {
            severity: f.severity,
            file: f.file,
            line: f.line,
            issue: f.issue,
            fix: f.fix,
        })
        .collect();

    // Verdict: red if any bug, yellow if any risk, else green.
    let has_bug = findings.iter().any(|f| f.severity == "bug");
    let has_risk = findings.iter().any(|f| f.severity == "risk");
    let verdict = if has_bug {
        "red"
    } else if has_risk {
        "yellow"
    } else {
        "green"
    };

    Ok(ReviewResult {
        verdict: verdict.to_string(),
        summary: parsed.summary,
        findings,
        changed_files: diff.files.len(),
    })
}

/// Guess the project's test command from its manifests (best-effort).
#[tauri::command]
pub fn guess_test_command(path: String) -> Result<String, String> {
    let dir = Path::new(&path);
    let has = |f: &str| dir.join(f).exists();

    if has("package.json") {
        let mgr = if has("pnpm-lock.yaml") {
            "pnpm"
        } else if has("yarn.lock") {
            "yarn"
        } else if has("bun.lockb") {
            "bun"
        } else {
            "npm"
        };
        // Only suggest if a test script seems to exist.
        if let Ok(pkg) = std::fs::read_to_string(dir.join("package.json")) {
            if pkg.contains("\"test\"") {
                return Ok(if mgr == "npm" {
                    "npm test".to_string()
                } else {
                    format!("{mgr} test")
                });
            }
        }
    }
    if has("Cargo.toml") {
        return Ok("cargo test".to_string());
    }
    if has("pyproject.toml") || has("pytest.ini") || has("setup.cfg") || has("tox.ini") {
        return Ok("pytest".to_string());
    }
    if has("go.mod") {
        return Ok("go test ./...".to_string());
    }
    Ok(String::new())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub passed: bool,
    pub code: i32,
    pub output: String,
    pub timed_out: bool,
}

const MAX_OUTPUT_TAIL: usize = 6000;

/// Run a check command (e.g. the test command) in the project dir, with a hard
/// timeout, capturing the exit code and the tail of its output. Read-only intent
/// but it DOES execute the given command — the UI gates this behind an explicit
/// user action with an editable command.
#[tauri::command]
pub async fn run_check(path: String, command: String) -> Result<CheckResult, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }
    if command.trim().is_empty() {
        return Err("Comando vazio.".to_string());
    }

    let mut std_cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    std_cmd.current_dir(dir);
    std_cmd.stdin(std::process::Stdio::null());
    std_cmd.stdout(std::process::Stdio::piped());
    std_cmd.stderr(std::process::Stdio::piped());
    no_window(&mut std_cmd);

    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Não consegui rodar o comando: {e}"))?;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        child.wait_with_output(),
    )
    .await;

    let output = match result {
        Err(_) => {
            return Ok(CheckResult {
                passed: false,
                code: -1,
                output: "Tempo esgotado (300s).".to_string(),
                timed_out: true,
            });
        }
        Ok(Err(e)) => return Err(format!("Erro ao executar: {e}")),
        Ok(Ok(o)) => o,
    };

    let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
    let err = String::from_utf8_lossy(&output.stderr);
    if !err.trim().is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&err);
    }
    // Keep only the tail (test failures are at the end).
    if combined.len() > MAX_OUTPUT_TAIL {
        let start = combined.len() - MAX_OUTPUT_TAIL;
        combined = format!("… (truncado)\n{}", &combined[start..]);
    }

    let code = output.status.code().unwrap_or(-1);
    Ok(CheckResult {
        passed: output.status.success(),
        code,
        output: combined,
        timed_out: false,
    })
}
