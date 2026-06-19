// Project Profiler: scans an opened workspace, infers its tech stack, and
// assembles a curated "agent loadout" — the subagents most useful for that kind
// of project. Applying a loadout writes the agent definitions into the
// project's own `.claude/agents/` and primes a `CLAUDE.md` profile block, both
// of which the `claude` CLI loads automatically. This keeps every project's
// team local and per-project, and never touches the user's global Claude config
// (so their login/session stays intact).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

/// One agent in the curated catalog.
struct CatalogEntry {
    id: &'static str,
    title: &'static str,
    description: &'static str,
    icon: &'static str,
    /// Always included regardless of stack.
    core: bool,
    /// Stack tags that activate this agent (empty for core).
    tags: &'static [&'static str],
    /// The agent definition (markdown with frontmatter), embedded at build time.
    body: &'static str,
}

/// The bundled catalog. Quality over quantity: a tight set beats hundreds of
/// skills that just bloat the model's context.
const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: "architect",
        title: "Arquiteto",
        description: "Planeja a abordagem e a arquitetura antes de codar",
        icon: "ti-blueprint",
        core: true,
        tags: &[],
        body: include_str!("../agents-catalog/architect.md"),
    },
    CatalogEntry {
        id: "code-reviewer",
        title: "Revisor de código",
        description: "Revisa o diff em busca de bugs e simplificações",
        icon: "ti-eye-check",
        core: true,
        tags: &[],
        body: include_str!("../agents-catalog/code-reviewer.md"),
    },
    CatalogEntry {
        id: "security-auditor",
        title: "Auditor de segurança",
        description: "Caça vulnerabilidades exploráveis antes do PR",
        icon: "ti-shield-lock",
        core: true,
        tags: &[],
        body: include_str!("../agents-catalog/security-auditor.md"),
    },
    CatalogEntry {
        id: "test-engineer",
        title: "Engenheiro de testes",
        description: "Escreve testes no estilo do projeto",
        icon: "ti-test-pipe",
        core: true,
        tags: &[],
        body: include_str!("../agents-catalog/test-engineer.md"),
    },
    CatalogEntry {
        id: "debugger",
        title: "Debugger",
        description: "Acha a causa-raiz de erros e testes falhando",
        icon: "ti-bug",
        core: true,
        tags: &[],
        body: include_str!("../agents-catalog/debugger.md"),
    },
    CatalogEntry {
        id: "typescript-pro",
        title: "TypeScript / Node",
        description: "Código TS/JS idiomático e APIs Node",
        icon: "ti-brand-typescript",
        core: false,
        tags: &["node", "typescript", "javascript"],
        body: include_str!("../agents-catalog/typescript-pro.md"),
    },
    CatalogEntry {
        id: "frontend-expert",
        title: "Frontend",
        description: "React, Next, Vue, Svelte, UI e acessibilidade",
        icon: "ti-brand-react",
        core: false,
        tags: &["react", "next", "vue", "svelte", "angular", "frontend"],
        body: include_str!("../agents-catalog/frontend-expert.md"),
    },
    CatalogEntry {
        id: "rust-pro",
        title: "Rust",
        description: "Rust idiomático, ownership e performance",
        icon: "ti-brand-rust",
        core: false,
        tags: &["rust"],
        body: include_str!("../agents-catalog/rust-pro.md"),
    },
    CatalogEntry {
        id: "python-pro",
        title: "Python",
        description: "Python idiomático, APIs e data/ML",
        icon: "ti-brand-python",
        core: false,
        tags: &["python"],
        body: include_str!("../agents-catalog/python-pro.md"),
    },
    CatalogEntry {
        id: "database-expert",
        title: "Banco de dados",
        description: "Schema, migrations e queries",
        icon: "ti-database",
        core: false,
        tags: &["sql", "postgres", "mysql", "prisma", "mongo"],
        body: include_str!("../agents-catalog/database-expert.md"),
    },
    CatalogEntry {
        id: "devops-engineer",
        title: "DevOps / Infra",
        description: "Docker, CI/CD, Terraform e Kubernetes",
        icon: "ti-server-cog",
        core: false,
        tags: &["docker", "ci", "terraform", "kubernetes"],
        body: include_str!("../agents-catalog/devops-engineer.md"),
    },
];

#[derive(Serialize, Clone)]
pub struct AgentInfo {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub core: bool,
}

#[derive(Serialize, Clone)]
pub struct Profile {
    /// Absolute path of the profiled project.
    pub path: String,
    /// Project folder name.
    pub name: String,
    /// Machine stack tags detected (e.g. "node", "typescript", "next").
    pub stacks: Vec<String>,
    /// Human-readable labels for the UI (e.g. "Next.js", "Postgres").
    pub labels: Vec<String>,
    /// The recommended agent loadout for this project.
    pub agents: Vec<AgentInfo>,
    /// Short human summary line.
    pub summary: String,
}

/// A short, AI-extracted brief about the project — woven into CLAUDE.md so
/// Claude knows this repo's conventions, test command, and architecture.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBrief {
    pub conventions: String,
    pub test_command: String,
    pub architecture: String,
    pub notes: String,
}

/// One agent the AI picked, with its justification for THIS project.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamPick {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub core: bool,
    pub reason: String,
}

/// Result of an AI team selection: the chosen agents + the project brief.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamSelection {
    pub agents: Vec<TeamPick>,
    pub brief: ProjectBrief,
}

/// Directories never worth descending into — heavy, generated, or vendored.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    "out",
    ".venv",
    "venv",
    "__pycache__",
    "vendor",
    ".cache",
    "coverage",
    ".turbo",
    ".svelte-kit",
    ".nuxt",
    ".angular",
    "bin",
    "obj",
    ".idea",
    ".vscode",
];

/// What a bounded walk of the project turned up.
#[derive(Default)]
struct Scan {
    /// Lowercased base filenames seen anywhere in the walk.
    files: BTreeSet<String>,
    /// Lowercased directory names seen.
    dirs: BTreeSet<String>,
    /// Lowercased file extensions seen.
    exts: BTreeSet<String>,
    /// Concatenated, lowercased contents of every package.json found.
    pkg: String,
}

/// Walk the project up to a few levels deep (skipping heavy dirs), gathering the
/// signals we need to infer the stack — including from nested packages, which a
/// shallow root-only check would miss (monorepos, apps/*, packages/*).
fn scan_tree(root: &Path) -> Scan {
    let mut scan = Scan::default();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut budget: i32 = 6000;

    while let Some((dir, depth)) = stack.pop() {
        if budget <= 0 {
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rd.flatten() {
            if budget <= 0 {
                break;
            }
            budget -= 1;
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                scan.dirs.insert(name.clone());
                // Descend unless it's a skip dir or a hidden dir (except .github,
                // which carries CI workflows).
                let skip = SKIP_DIRS.contains(&name.as_str())
                    || (name.starts_with('.') && name != ".github");
                if !skip && depth < 3 {
                    stack.push((entry.path(), depth + 1));
                }
            } else {
                scan.files.insert(name.clone());
                if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
                    scan.exts.insert(ext.to_lowercase());
                }
                if name == "package.json" {
                    if let Ok(s) = std::fs::read_to_string(entry.path()) {
                        scan.pkg.push_str(&s.to_lowercase());
                        scan.pkg.push('\n');
                    }
                }
            }
        }
    }
    scan
}

/// Inspect the directory tree and return detected stack tags + human labels.
fn detect(dir: &Path) -> (BTreeSet<String>, Vec<String>) {
    let s = scan_tree(dir);
    let mut stacks: BTreeSet<String> = BTreeSet::new();
    let mut labels: Vec<String> = Vec::new();

    let label = |labels: &mut Vec<String>, l: &str| {
        if !labels.iter().any(|x| x == l) {
            labels.push(l.to_string());
        }
    };
    let dep = |needle: &str| s.pkg.contains(needle);
    let file = |n: &str| s.files.contains(n);
    let ext = |e: &str| s.exts.contains(e);
    let file_prefix = |p: &str| s.files.iter().any(|f| f.starts_with(p));

    // --- Node / JS ecosystem ---
    let is_node = file("package.json");
    if is_node {
        stacks.insert("node".into());

        // TypeScript vs plain JS.
        if dep("\"typescript\"") || file_prefix("tsconfig") || ext("ts") || ext("tsx") {
            stacks.insert("typescript".into());
            label(&mut labels, "TypeScript");
        } else {
            stacks.insert("javascript".into());
            label(&mut labels, "Node");
        }

        // Frontend frameworks.
        let next = dep("\"next\"")
            || file("next.config.js")
            || file("next.config.ts")
            || file("next.config.mjs");
        if next {
            stacks.insert("next".into());
            stacks.insert("react".into());
            label(&mut labels, "Next.js");
        } else if dep("\"react\"") || ext("tsx") || ext("jsx") {
            stacks.insert("react".into());
            label(&mut labels, "React");
        }
        if dep("\"vue\"") || ext("vue") {
            stacks.insert("vue".into());
            label(&mut labels, "Vue");
        }
        if dep("\"svelte\"") || ext("svelte") || file("svelte.config.js") {
            stacks.insert("svelte".into());
            label(&mut labels, "Svelte");
        }
        if dep("\"@angular/core\"") {
            stacks.insert("angular".into());
            label(&mut labels, "Angular");
        }
        if dep("\"astro\"") {
            stacks.insert("frontend".into());
            label(&mut labels, "Astro");
        }
        if dep("\"nuxt\"") {
            stacks.insert("vue".into());
            label(&mut labels, "Nuxt");
        }
        if dep("\"expo\"") || dep("\"react-native\"") {
            stacks.insert("react".into());
            label(&mut labels, "React Native");
        }
        if dep("\"vite\"") {
            label(&mut labels, "Vite");
        }
        if dep("\"tailwindcss\"") {
            label(&mut labels, "Tailwind");
        }
        if dep("\"graphql\"") {
            label(&mut labels, "GraphQL");
        }
        // Node backend frameworks.
        if dep("\"express\"")
            || dep("\"@nestjs/core\"")
            || dep("\"fastify\"")
            || dep("\"koa\"")
            || dep("\"hono\"")
        {
            label(&mut labels, "API Node");
        }
        // Databases via node libs.
        if dep("\"prisma\"") || dep("\"@prisma/client\"") {
            stacks.insert("prisma".into());
            stacks.insert("sql".into());
            label(&mut labels, "Prisma");
        }
        if dep("\"drizzle-orm\"") {
            stacks.insert("sql".into());
            label(&mut labels, "Drizzle");
        }
        if dep("\"typeorm\"")
            || dep("\"sequelize\"")
            || dep("\"pg\"")
            || dep("\"mysql2\"")
            || dep("\"better-sqlite3\"")
            || dep("\"kysely\"")
        {
            stacks.insert("sql".into());
            label(&mut labels, "SQL");
        }
        if dep("\"mongoose\"") || dep("\"mongodb\"") {
            stacks.insert("mongo".into());
            label(&mut labels, "MongoDB");
        }
        if dep("\"@supabase/supabase-js\"") {
            stacks.insert("sql".into());
            label(&mut labels, "Supabase");
        }
        if dep("\"redis\"") || dep("\"ioredis\"") {
            label(&mut labels, "Redis");
        }
    } else if ext("ts") || ext("tsx") {
        // Loose TS without a package.json (rare, but cover it).
        stacks.insert("node".into());
        stacks.insert("typescript".into());
        label(&mut labels, "TypeScript");
    }

    // --- Other languages ---
    if file("cargo.toml") || ext("rs") {
        stacks.insert("rust".into());
        label(&mut labels, "Rust");
    }
    if file("requirements.txt")
        || file("pyproject.toml")
        || file("setup.py")
        || file("pipfile")
        || ext("py")
    {
        stacks.insert("python".into());
        label(&mut labels, "Python");
    }
    if file("go.mod") || ext("go") {
        stacks.insert("go".into());
        label(&mut labels, "Go");
    }
    if file("pom.xml")
        || file("build.gradle")
        || file("build.gradle.kts")
        || ext("java")
        || ext("kt")
    {
        stacks.insert("jvm".into());
        label(&mut labels, "JVM");
    }
    if file("gemfile") || ext("rb") {
        stacks.insert("ruby".into());
        label(&mut labels, "Ruby");
    }
    if file("composer.json") || ext("php") {
        stacks.insert("php".into());
        label(&mut labels, "PHP");
    }

    // --- Databases / infra by file presence ---
    if file("schema.prisma") {
        stacks.insert("prisma".into());
        stacks.insert("sql".into());
        label(&mut labels, "Prisma");
    }
    if file("dockerfile")
        || file("docker-compose.yml")
        || file("docker-compose.yaml")
        || file("compose.yaml")
        || file("compose.yml")
    {
        stacks.insert("docker".into());
        label(&mut labels, "Docker");
    }
    if ext("tf") {
        stacks.insert("terraform".into());
        label(&mut labels, "Terraform");
    }
    if file("kustomization.yaml") || file("kustomization.yml") || file("chart.yaml") {
        stacks.insert("kubernetes".into());
        label(&mut labels, "Kubernetes");
    }
    if s.dirs.contains(".github") || file(".gitlab-ci.yml") {
        stacks.insert("ci".into());
        label(&mut labels, "CI");
    }
    if file("turbo.json")
        || file("nx.json")
        || file("pnpm-workspace.yaml")
        || file("lerna.json")
    {
        label(&mut labels, "Monorepo");
    }

    (stacks, labels)
}

/// Select the agent loadout for a detected stack set: every core agent, plus
/// any stack-specific agent whose tags intersect what we found.
fn select_agents(stacks: &BTreeSet<String>) -> Vec<&'static CatalogEntry> {
    CATALOG
        .iter()
        .filter(|a| a.core || a.tags.iter().any(|t| stacks.contains(*t)))
        .collect()
}

/// Scan a workspace and return its profile + recommended loadout.
#[tauri::command]
pub fn project_profile(path: String) -> Result<Profile, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }

    let (stacks, labels) = detect(dir);
    let selected = select_agents(&stacks);

    let name = dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("projeto")
        .to_string();

    let summary = if labels.is_empty() {
        "Projeto genérico — time base de qualidade ativado.".to_string()
    } else {
        format!("Detectei {}.", labels.join(" · "))
    };

    let agents = selected
        .iter()
        .map(|a| AgentInfo {
            id: a.id.to_string(),
            title: a.title.to_string(),
            description: a.description.to_string(),
            icon: a.icon.to_string(),
            core: a.core,
        })
        .collect();

    Ok(Profile {
        path,
        name,
        stacks: stacks.into_iter().collect(),
        labels,
        agents,
        summary,
    })
}

/// Render the catalog as an id:description list for the AI prompt.
fn catalog_for_prompt() -> String {
    let mut s = String::new();
    for a in CATALOG {
        s.push_str(&format!("- {} : {}\n", a.id, a.description));
    }
    s
}

/// Build a small, token-cheap digest of the project for the AI: detected stack,
/// the root listing, a slice of package.json, and the top of the README.
fn build_digest(dir: &Path, profile: &Profile) -> String {
    let mut d = String::new();
    d.push_str(&format!("Projeto: {}\n", profile.name));
    let stack = if profile.labels.is_empty() {
        "genérico".to_string()
    } else {
        profile.labels.join(", ")
    };
    d.push_str(&format!("Stack detectada (heurística): {stack}\n\n"));

    if let Ok(rd) = std::fs::read_dir(dir) {
        let mut names: Vec<String> = rd
            .flatten()
            .map(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    format!("{n}/")
                } else {
                    n
                }
            })
            .collect();
        names.sort();
        names.truncate(60);
        d.push_str("Itens na raiz: ");
        d.push_str(&names.join(", "));
        d.push_str("\n\n");
    }

    if let Ok(pkg) = std::fs::read_to_string(dir.join("package.json")) {
        let snippet: String = pkg.chars().take(1500).collect();
        d.push_str("package.json (início):\n");
        d.push_str(&snippet);
        d.push_str("\n\n");
    }

    for readme in ["README.md", "readme.md", "Readme.md", "README.MD"] {
        if let Ok(text) = std::fs::read_to_string(dir.join(readme)) {
            let head: String = text.lines().take(25).collect::<Vec<_>>().join("\n");
            d.push_str("README (início):\n");
            d.push_str(&head);
            d.push_str("\n\n");
            break;
        }
    }

    if d.len() > 6000 {
        d.truncate(6000);
    }
    d
}

const TEAM_SCHEMA: &str = r#"{"type":"object","properties":{"agents":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"reason":{"type":"string"}},"required":["id","reason"],"additionalProperties":false}},"brief":{"type":"object","properties":{"conventions":{"type":"string"},"testCommand":{"type":"string"},"architecture":{"type":"string"},"notes":{"type":"string"}},"required":["conventions","testCommand","architecture","notes"],"additionalProperties":false}},"required":["agents","brief"],"additionalProperties":false}"#;

#[derive(Deserialize)]
struct AiPick {
    id: String,
    reason: String,
}

#[derive(Deserialize)]
struct AiResult {
    agents: Vec<AiPick>,
    brief: ProjectBrief,
}

/// AI-assisted team selection: ask Claude to pick the best agents for THIS
/// project (from our catalog) and extract a short project brief. Falls back to
/// a clear error so the UI can revert to the deterministic loadout.
#[tauri::command]
pub async fn ai_select_team(
    state: State<'_, AppState>,
    path: String,
) -> Result<TeamSelection, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }

    let profile = project_profile(path.clone())?;
    let digest = build_digest(dir, &profile);
    let catalog = catalog_for_prompt();

    let system = "Você é um arquiteto de software sênior. Dado o RESUMO de um projeto e um \
CATÁLOGO de agentes (subagentes do Claude Code), escolha o MELHOR time para ESTE projeto \
específico. Regras: escolha SOMENTE ids que existam no catálogo; escolha de 4 a 8 agentes; \
sempre inclua code-reviewer e security-auditor. Para cada agente, dê uma justificativa curta \
(1 frase) específica a este projeto. Depois preencha um brief com o que der para inferir: \
conventions (convenções de código), testCommand (como rodar os testes), architecture (visão \
geral) e notes (qualquer coisa importante). Responda em PT-BR, APENAS com JSON do schema.";

    let user = format!(
        "CATÁLOGO DE AGENTES (id : descrição):\n{catalog}\n\nRESUMO DO PROJETO:\n{digest}"
    );

    let cleaned = crate::ai::structured_call(&state, system, &user, TEAM_SCHEMA, 1300, true).await?;
    let parsed: AiResult = serde_json::from_str(&cleaned)
        .map_err(|e| format!("A IA retornou um JSON inválido: {e}. Resposta: {cleaned}"))?;

    let mut agents: Vec<TeamPick> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut push = |id: &str, reason: &str| {
        if seen.contains(id) {
            return;
        }
        if let Some(e) = CATALOG.iter().find(|c| c.id == id) {
            seen.insert(id.to_string());
            agents.push(TeamPick {
                id: e.id.to_string(),
                title: e.title.to_string(),
                description: e.description.to_string(),
                icon: e.icon.to_string(),
                core: e.core,
                reason: reason.to_string(),
            });
        }
    };

    for p in &parsed.agents {
        push(&p.id, &p.reason);
    }
    // Safety net: never ship a project without review + security agents.
    push("code-reviewer", "Incluído por padrão — revisão de qualidade.");
    push("security-auditor", "Incluído por padrão — checagem de segurança.");

    if agents.is_empty() {
        return Err("A IA não escolheu nenhum agente válido.".to_string());
    }

    Ok(TeamSelection {
        agents,
        brief: parsed.brief,
    })
}

const PROFILE_START: &str = "<!-- THETERM:profile:start -->";
const PROFILE_END: &str = "<!-- THETERM:profile:end -->";

/// Build the managed CLAUDE.md block that primes Claude with the project's
/// stack and its active team. Delimited so we can refresh it idempotently
/// without clobbering anything the user wrote in CLAUDE.md.
fn profile_block(profile: &Profile, brief: Option<&ProjectBrief>) -> String {
    let mut team = String::new();
    for a in &profile.agents {
        team.push_str(&format!("- **{}** — {}\n", a.id, a.description));
    }
    let stack_line = if profile.labels.is_empty() {
        "Projeto genérico.".to_string()
    } else {
        profile.labels.join(", ")
    };

    // AI-extracted brief, when available, primes Claude on this repo's specifics.
    let brief_section = match brief {
        Some(b) => {
            let mut s = String::from("\n### Sobre este repositório\n");
            if !b.architecture.trim().is_empty() {
                s.push_str(&format!("**Arquitetura:** {}\n\n", b.architecture.trim()));
            }
            if !b.conventions.trim().is_empty() {
                s.push_str(&format!("**Convenções:** {}\n\n", b.conventions.trim()));
            }
            if !b.test_command.trim().is_empty() {
                s.push_str(&format!("**Rodar testes:** `{}`\n\n", b.test_command.trim()));
            }
            if !b.notes.trim().is_empty() {
                s.push_str(&format!("**Notas:** {}\n\n", b.notes.trim()));
            }
            s
        }
        None => String::new(),
    };

    format!(
        "{PROFILE_START}\n\
## Perfil do projeto (gerado pelo THETERM)\n\n\
**Stack detectada:** {stack_line}\n\n\
**Time de agentes preparado para este projeto** (em `.claude/agents/`):\n\
{team}\n\
Use estes subagentes proativamente: planeje com `architect` antes de mudanças \
grandes, escreva testes com `test-engineer`, e antes de abrir um PR passe por \
`code-reviewer` e `security-auditor`. Siga as convenções já existentes no \
código deste repositório.\n\
{brief_section}\
{PROFILE_END}"
    )
}

/// Apply a loadout: write the selected agent definitions into the project's
/// `.claude/agents/` and refresh the managed block in CLAUDE.md.
#[tauri::command]
pub fn apply_loadout(
    path: String,
    agent_ids: Vec<String>,
    brief: Option<ProjectBrief>,
) -> Result<String, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("não é uma pasta: {path}"));
    }

    let agents_dir = dir.join(".claude").join("agents");
    std::fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;

    // Write each requested agent (that exists in the catalog).
    let mut written = 0usize;
    for entry in CATALOG.iter() {
        if agent_ids.iter().any(|id| id == entry.id) {
            let file = agents_dir.join(format!("{}.md", entry.id));
            std::fs::write(&file, entry.body).map_err(|e| e.to_string())?;
            written += 1;
        }
    }

    // Re-profile (cheap) so the CLAUDE.md block reflects the same loadout.
    let mut profile = project_profile(path.clone())?;
    profile.agents.retain(|a| agent_ids.iter().any(|id| id == &a.id));

    // Merge the managed block into CLAUDE.md (replace if present, else append).
    let claude_md = dir.join("CLAUDE.md");
    let block = profile_block(&profile, brief.as_ref());
    let new_contents = match std::fs::read_to_string(&claude_md) {
        Ok(existing) => merge_block(&existing, &block),
        Err(_) => format!("{block}\n"),
    };
    std::fs::write(&claude_md, new_contents).map_err(|e| e.to_string())?;

    Ok(format!(
        "{written} agentes gravados em .claude/agents e CLAUDE.md atualizado"
    ))
}

/// Replace an existing THETERM-managed block, or append a fresh one.
fn merge_block(existing: &str, block: &str) -> String {
    if let (Some(start), Some(end)) = (existing.find(PROFILE_START), existing.find(PROFILE_END)) {
        if end > start {
            let end_full = end + PROFILE_END.len();
            let mut out = String::new();
            out.push_str(&existing[..start]);
            out.push_str(block);
            out.push_str(&existing[end_full..]);
            return out;
        }
    }
    // No managed block yet: keep the user's content and append ours.
    let sep = if existing.ends_with('\n') { "\n" } else { "\n\n" };
    format!("{existing}{sep}{block}\n")
}
