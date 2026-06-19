use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub command: String,
    pub explanation: String,
    pub danger: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    pub diagnosis: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub reply: String,
    /// Claude CLI session id to thread the next turn (None when using the API).
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub configured: bool,
    /// "claude-cli" | "api-key" | "none"
    pub provider: String,
    pub suggest_model: String,
    pub fix_model: String,
}

const ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";

const SUGGEST_SCHEMA: &str = r#"{"type":"object","properties":{"command":{"type":"string"},"explanation":{"type":"string"},"danger":{"type":"boolean"}},"required":["command","explanation","danger"],"additionalProperties":false}"#;
const FIX_SCHEMA: &str = r#"{"type":"object","properties":{"diagnosis":{"type":"string"},"command":{"type":"string"}},"required":["diagnosis","command"],"additionalProperties":false}"#;

// --- Provider detection --------------------------------------------------

/// Locate the local `claude` CLI (Claude Code). Checks an explicit override,
/// then PATH, then the common ~/.local/bin install location.
fn find_claude() -> Option<String> {
    if let Ok(p) = std::env::var("THETERM_CLAUDE_PATH") {
        if !p.trim().is_empty() && std::path::Path::new(&p).is_file() {
            return Some(p);
        }
    }

    let names: &[&str] = if cfg!(windows) {
        &["claude.exe", "claude.cmd", "claude"]
    } else {
        &["claude"]
    };

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for n in names {
                let cand = dir.join(n);
                if cand.is_file() {
                    return Some(cand.to_string_lossy().into_owned());
                }
            }
        }
    }

    // Common absolute install locations. Crucial on macOS/Linux where a GUI app
    // launched from Finder/the dock does NOT inherit the shell PATH, so the PATH
    // scan above misses a perfectly-working `claude`.
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(home) = home_dir() {
        for sub in [
            ".local/bin",
            ".npm-global/bin",
            ".bun/bin",
            ".deno/bin",
            ".cargo/bin",
            "bin",
        ] {
            dirs.push(home.join(sub));
        }
    }
    #[cfg(not(windows))]
    {
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            dirs.push(std::path::PathBuf::from(d));
        }
    }
    for dir in dirs {
        for n in names {
            let cand = dir.join(n);
            if cand.is_file() {
                return Some(cand.to_string_lossy().into_owned());
            }
        }
    }

    None
}

/// Map a full model id to a CLI-friendly alias (the CLI accepts both, but
/// aliases are always valid for the user's current plan).
fn cli_model_alias(model: &str) -> String {
    let m = model.to_lowercase();
    if m.contains("haiku") {
        "haiku".to_string()
    } else if m.contains("sonnet") {
        "sonnet".to_string()
    } else if m.contains("opus") {
        "opus".to_string()
    } else {
        model.to_string()
    }
}

/// Describe the target shell so AI command suggestions use the right syntax.
fn shell_hint() -> &'static str {
    #[cfg(windows)]
    {
        "o Windows PowerShell"
    }
    #[cfg(target_os = "macos")]
    {
        "o terminal do macOS (zsh/bash, sintaxe POSIX)"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "o terminal do Linux (bash/sh, sintaxe POSIX)"
    }
}

/// User home dir, OS-appropriate.
fn home_dir() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    let h = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    #[cfg(not(windows))]
    let h = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    h.map(std::path::PathBuf::from)
}

#[tauri::command]
pub fn ai_status(state: State<'_, AppState>) -> Result<AiStatus, String> {
    let ai = state.ai.lock().map_err(|e| e.to_string())?;
    let has_cli = find_claude().is_some();
    let has_key = ai
        .api_key
        .as_ref()
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    let provider = if has_cli {
        "claude-cli"
    } else if has_key {
        "api-key"
    } else {
        "none"
    };
    Ok(AiStatus {
        configured: has_cli || has_key,
        provider: provider.to_string(),
        suggest_model: ai.suggest_model.clone(),
        fix_model: ai.fix_model.clone(),
    })
}

#[tauri::command]
pub fn ai_set_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let mut ai = state.ai.lock().map_err(|e| e.to_string())?;
    let trimmed = key.trim().to_string();
    ai.api_key = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    };
    ai.persist();
    Ok(())
}

/// Provider inputs snapshotted out of the mutex before any await.
struct CallInputs {
    cli_path: Option<String>,
    api_key: Option<String>,
    model: String,
}

fn snapshot(state: &State<'_, AppState>, use_fix_model: bool) -> Result<CallInputs, String> {
    let ai = state.ai.lock().map_err(|e| e.to_string())?;
    let model = if use_fix_model {
        ai.fix_model.clone()
    } else {
        ai.suggest_model.clone()
    };
    let api_key = ai.api_key.clone().filter(|k| !k.trim().is_empty());
    Ok(CallInputs {
        cli_path: find_claude(),
        api_key,
        model,
    })
}

/// Get raw model text, preferring the local Claude CLI and falling back to the
/// Anthropic API (if a key is configured) when the CLI is missing or errors.
async fn obtain_raw(
    inputs: &CallInputs,
    system: &str,
    user: &str,
    schema: &str,
    max_tokens: u32,
) -> Result<String, String> {
    if let Some(path) = &inputs.cli_path {
        match call_claude_cli(path, &cli_model_alias(&inputs.model), system, user, schema).await {
            Ok(raw) => return Ok(raw),
            Err(cli_err) => {
                if let Some(key) = &inputs.api_key {
                    return call_anthropic(key, &inputs.model, system, user, max_tokens).await;
                }
                return Err(cli_err);
            }
        }
    }

    if let Some(key) = &inputs.api_key {
        return call_anthropic(key, &inputs.model, system, user, max_tokens).await;
    }

    Err("Nenhum provedor de IA disponível. Instale o Claude CLI (`claude`) e faça login, \
ou configure uma ANTHROPIC_API_KEY."
        .to_string())
}

/// Strip optional markdown code fences (```json ... ```).
fn strip_code_fences(text: &str) -> String {
    let trimmed = text.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        let after_lang = match rest.find('\n') {
            Some(idx) => &rest[idx + 1..],
            None => rest,
        };
        let body = after_lang.trim_end();
        let body = body.strip_suffix("```").unwrap_or(body);
        return body.trim().to_string();
    }
    trimmed.to_string()
}

/// Extract the outermost {...} JSON object from a string (defensive against
/// stray prose around the object).
fn extract_json(text: &str) -> String {
    let t = text.trim();
    if let (Some(a), Some(b)) = (t.find('{'), t.rfind('}')) {
        if b >= a {
            return t[a..=b].to_string();
        }
    }
    t.to_string()
}

/// Reusable structured call for other modules (e.g. the Project Profiler's
/// AI team selection): snapshots the provider, asks the model for JSON matching
/// `schema`, and returns the cleaned JSON text (fences/prose stripped). Prefers
/// the Claude CLI, falls back to the API key. `use_fix_model` picks the stronger
/// model for reasoning-heavy tasks.
pub(crate) async fn structured_call(
    state: &State<'_, AppState>,
    system: &str,
    user: &str,
    schema: &str,
    max_tokens: u32,
    use_fix_model: bool,
) -> Result<String, String> {
    let inputs = snapshot(state, use_fix_model)?;
    let raw = obtain_raw(&inputs, system, user, schema, max_tokens).await?;
    Ok(extract_json(&strip_code_fences(&raw)))
}

/// Invoke the local `claude` CLI in non-interactive mode and return the result
/// text from its JSON envelope. Tools are disabled (text only), runs in a
/// neutral cwd, has a hard timeout, and never pops a console window on Windows.
async fn call_claude_cli(
    path: &str,
    model: &str,
    system: &str,
    user: &str,
    schema: &str,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let mut std_cmd = std::process::Command::new(path);
    std_cmd
        .arg("-p")
        .arg("--output-format")
        .arg("json")
        .arg("--json-schema")
        .arg(schema)
        .arg("--tools")
        .arg("")
        .arg("--model")
        .arg(model)
        .arg("--system-prompt")
        .arg(system)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Não consegui iniciar o Claude CLI: {e}"))?;

    // Feed the prompt via stdin so arbitrary content (leading dashes, etc.)
    // is never parsed as CLI flags.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(user.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(90),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| "Tempo esgotado ao chamar o Claude CLI (90s).".to_string())?
    .map_err(|e| format!("Erro ao executar o Claude CLI: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let err = err.trim();
        let msg = if err.is_empty() {
            "código de saída não-zero".to_string()
        } else {
            err.to_string()
        };
        return Err(format!("Claude CLI falhou: {msg}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Saída do Claude CLI não é JSON válido: {e}"))?;

    if envelope
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let msg = envelope
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or("erro desconhecido");
        return Err(format!("Claude CLI retornou erro: {msg}"));
    }

    // With --json-schema the `result` may arrive as a JSON string OR as an
    // already-parsed object. Accept both: re-serialize objects back to text so
    // the downstream JSON parser handles them uniformly.
    let result = match envelope.get("result") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => return Err("Resposta do Claude CLI sem campo 'result'.".to_string()),
    };

    Ok(result)
}

/// Call the Anthropic Messages API and return the first text content block.
async fn call_anthropic(
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [
            { "role": "user", "content": user }
        ]
    });

    let resp = client
        .post(ANTHROPIC_ENDPOINT)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Falha na requisição: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Falha ao ler resposta: {e}"))?;

    if !status.is_success() {
        return Err(format!("API Anthropic retornou {status}: {text}"));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("JSON inválido da API: {e}"))?;

    let content_text = json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|b| b.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Resposta da API sem conteúdo de texto".to_string())?;

    Ok(content_text.to_string())
}

#[tauri::command]
pub async fn ai_suggest_command(
    state: State<'_, AppState>,
    query: String,
    context: Option<String>,
) -> Result<Suggestion, String> {
    let inputs = snapshot(&state, false)?;

    let system = String::from("Você é um gerador de comandos de terminal para ")
        + shell_hint()
        + ". Dada uma solicitação em linguagem natural, responda APENAS com um objeto JSON \
no formato {\"command\": \"...\", \"explanation\": \"...\", \"danger\": true|false}. \
- \"command\": o comando de terminal que resolve a solicitação, na sintaxe do shell indicado. \
- \"explanation\": explicação curta em PT-BR do que o comando faz. \
- \"danger\": true se o comando for destrutivo (apagar arquivos, formatar disco, \
remover recursivamente, sobrescrever dados, etc), caso contrário false. \
Não inclua texto fora do JSON, não use blocos de código markdown.";

    let user = match context {
        Some(ctx) if !ctx.trim().is_empty() => {
            format!("Solicitação: {query}\n\nContexto do terminal:\n{ctx}")
        }
        _ => format!("Solicitação: {query}"),
    };

    let raw = obtain_raw(&inputs, &system, &user, SUGGEST_SCHEMA, 512).await?;
    let cleaned = extract_json(&strip_code_fences(&raw));

    serde_json::from_str::<Suggestion>(&cleaned).map_err(|e| {
        format!("Não foi possível interpretar a sugestão da IA: {e}. Resposta: {cleaned}")
    })
}

#[tauri::command]
pub async fn ai_fix_error(
    state: State<'_, AppState>,
    command: String,
    output: String,
    exit_code: i32,
) -> Result<Fix, String> {
    let inputs = snapshot(&state, true)?;

    let system = String::from("Você é um assistente de depuração de terminal para ")
        + shell_hint()
        + ". Dado um comando que falhou, sua saída e o código de saída, faça um diagnóstico breve \
em PT-BR e proponha um comando corrigido. Responda APENAS com um objeto JSON no formato \
{\"diagnosis\": \"...\", \"command\": \"...\"}. \
- \"diagnosis\": explicação curta em PT-BR do que deu errado. \
- \"command\": o comando de terminal corrigido, na sintaxe do shell indicado. \
Não inclua texto fora do JSON, não use blocos de código markdown.";

    let user = format!(
        "Comando executado:\n{command}\n\nCódigo de saída: {exit_code}\n\nSaída:\n{output}"
    );

    let raw = obtain_raw(&inputs, &system, &user, FIX_SCHEMA, 700).await?;
    let cleaned = extract_json(&strip_code_fences(&raw));

    serde_json::from_str::<Fix>(&cleaned).map_err(|e| {
        format!("Não foi possível interpretar a correção da IA: {e}. Resposta: {cleaned}")
    })
}

/// Multi-turn chat with the local Claude CLI. The first turn starts a fresh
/// session (we capture its id from the envelope); later turns pass that id via
/// `--resume` so the conversation has memory. Tools are disabled (it suggests,
/// the user runs).
async fn call_claude_cli_chat(
    path: &str,
    model: &str,
    system: &str,
    user: &str,
    session_id: Option<&str>,
) -> Result<(String, Option<String>), String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let mut std_cmd = std::process::Command::new(path);
    std_cmd
        .arg("-p")
        .arg("--output-format")
        .arg("json")
        .arg("--tools")
        .arg("")
        .arg("--model")
        .arg(model)
        .arg("--system-prompt")
        .arg(system);
    if let Some(id) = session_id {
        std_cmd.arg("--resume").arg(id);
    }
    std_cmd
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Não consegui iniciar o Claude CLI: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(user.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| "Tempo esgotado ao chamar o Claude CLI.".to_string())?
    .map_err(|e| format!("Erro ao executar o Claude CLI: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let err = err.trim();
        let msg = if err.is_empty() {
            "código de saída não-zero".to_string()
        } else {
            err.to_string()
        };
        return Err(format!("Claude CLI falhou: {msg}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Saída do Claude CLI não é JSON válido: {e}"))?;

    if envelope
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let msg = envelope
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or("erro desconhecido");
        return Err(format!("Claude CLI retornou erro: {msg}"));
    }

    let reply = match envelope.get("result") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => return Err("Resposta do Claude CLI sem campo 'result'.".to_string()),
    };
    let sid = envelope
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok((reply, sid))
}

#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    message: String,
    context: Option<String>,
    session_id: Option<String>,
) -> Result<ChatReply, String> {
    // Use the stronger (fix) model for chat reasoning.
    let inputs = snapshot(&state, true)?;

    let system = String::from("Você é o assistente de IA embutido no THETERM, um terminal moderno usando ")
        + shell_hint()
        + ". Ajude o usuário com comandos, erros e dúvidas do dia a dia no \
terminal. Seja conciso e direto, responda em PT-BR. Quando sugerir um comando para o \
usuário executar, coloque-o sozinho em um bloco de código cercado por três crases (```) \
para que ele possa rodar com um clique.";

    let user = match &context {
        Some(ctx) if !ctx.trim().is_empty() => {
            format!("{ctx}\n\n---\nPergunta do usuário: {message}")
        }
        _ => message.clone(),
    };

    if let Some(path) = &inputs.cli_path {
        match call_claude_cli_chat(
            path,
            &cli_model_alias(&inputs.model),
            &system,
            &user,
            session_id.as_deref(),
        )
        .await
        {
            Ok((reply, sid)) => return Ok(ChatReply { reply, session_id: sid }),
            Err(cli_err) => {
                if let Some(key) = &inputs.api_key {
                    let reply = call_anthropic(key, &inputs.model, &system, &user, 1024).await?;
                    return Ok(ChatReply { reply, session_id: None });
                }
                return Err(cli_err);
            }
        }
    }

    if let Some(key) = &inputs.api_key {
        let reply = call_anthropic(key, &inputs.model, &system, &user, 1024).await?;
        return Ok(ChatReply { reply, session_id: None });
    }

    Err("Nenhum provedor de IA disponível. Instale o Claude CLI (`claude`) e faça login, \
ou configure uma ANTHROPIC_API_KEY."
        .to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInfo {
    pub available: bool,
    pub version: String,
    pub path: String,
}

/// Run the claude CLI with simple args (no stdin), capturing combined output.
async fn run_claude_simple(path: &str, args: &[&str], timeout_s: u64) -> Result<String, String> {
    use std::process::Stdio;

    let mut std_cmd = std::process::Command::new(path);
    std_cmd
        .args(args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Não consegui iniciar o Claude CLI: {e}"))?;

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_s),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| "Tempo esgotado no Claude CLI.".to_string())?
    .map_err(|e| format!("Erro ao executar o Claude CLI: {e}"))?;

    let mut out = String::from_utf8_lossy(&output.stdout).to_string();
    let err = String::from_utf8_lossy(&output.stderr);
    if !err.trim().is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&err);
    }
    if !output.status.success() && out.trim().is_empty() {
        return Err("O Claude CLI retornou um erro sem saída.".to_string());
    }
    Ok(out)
}

/// Report whether the Claude CLI is installed, and its version.
#[tauri::command]
pub async fn claude_version() -> Result<ClaudeInfo, String> {
    let path = match find_claude() {
        Some(p) => p,
        None => {
            return Ok(ClaudeInfo {
                available: false,
                version: String::new(),
                path: String::new(),
            })
        }
    };
    let out = run_claude_simple(&path, &["--version"], 20).await?;
    let version = out.split_whitespace().next().unwrap_or("").to_string();
    Ok(ClaudeInfo {
        available: true,
        version,
        path,
    })
}

/// Run `claude update` (checks for and installs the latest version if any).
/// Returns the command's output text.
#[tauri::command]
pub async fn claude_update() -> Result<String, String> {
    let path = find_claude().ok_or_else(|| "Claude CLI não encontrado no sistema.".to_string())?;
    let out = run_claude_simple(&path, &["update"], 180).await?;
    Ok(out.trim().to_string())
}
