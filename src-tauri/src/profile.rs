// Project Profiler: scans an opened workspace, infers its tech stack, and
// assembles a curated "agent loadout" — the subagents most useful for that kind
// of project. Applying a loadout writes the agent definitions into the
// project's own `.claude/agents/` and primes a `CLAUDE.md` profile block, both
// of which the `claude` CLI loads automatically. This keeps every project's
// team local and per-project, and never touches the user's global Claude config
// (so their login/session stays intact).

use std::collections::BTreeSet;
use std::path::Path;

use serde::Serialize;

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
        tags: &["react", "next", "vue", "svelte", "frontend"],
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

/// Read a top-level file (small, best-effort) into a lowercased string.
fn read_lower(dir: &Path, name: &str) -> Option<String> {
    let p = dir.join(name);
    std::fs::read_to_string(p).ok().map(|s| s.to_lowercase())
}

fn exists(dir: &Path, rel: &str) -> bool {
    dir.join(rel).exists()
}

/// Inspect the directory and return the set of detected stack tags + labels.
fn detect(dir: &Path) -> (BTreeSet<String>, Vec<String>) {
    let mut stacks: BTreeSet<String> = BTreeSet::new();
    let mut labels: Vec<String> = Vec::new();
    let add_label = |labels: &mut Vec<String>, l: &str| {
        if !labels.iter().any(|x| x == l) {
            labels.push(l.to_string());
        }
    };

    // Node / JS ecosystem via package.json (+ its dependency names).
    if let Some(pkg) = read_lower(dir, "package.json") {
        stacks.insert("node".into());
        add_label(&mut labels, "Node");
        let has = |needle: &str| pkg.contains(needle);
        if has("\"typescript\"") || exists(dir, "tsconfig.json") {
            stacks.insert("typescript".into());
            add_label(&mut labels, "TypeScript");
        } else {
            stacks.insert("javascript".into());
        }
        if has("\"next\"") {
            stacks.insert("next".into());
            stacks.insert("react".into());
            add_label(&mut labels, "Next.js");
        } else if has("\"react\"") {
            stacks.insert("react".into());
            add_label(&mut labels, "React");
        }
        if has("\"vue\"") {
            stacks.insert("vue".into());
            add_label(&mut labels, "Vue");
        }
        if has("\"svelte\"") {
            stacks.insert("svelte".into());
            add_label(&mut labels, "Svelte");
        }
        if has("\"express\"") || has("\"@nestjs/core\"") || has("\"fastify\"") {
            add_label(&mut labels, "API Node");
        }
        if has("\"prisma\"") || has("\"@prisma/client\"") {
            stacks.insert("prisma".into());
            add_label(&mut labels, "Prisma");
        }
        if has("\"tailwindcss\"") {
            add_label(&mut labels, "Tailwind");
        }
    }

    // Rust
    if exists(dir, "Cargo.toml") {
        stacks.insert("rust".into());
        add_label(&mut labels, "Rust");
    }
    // Python
    if exists(dir, "requirements.txt")
        || exists(dir, "pyproject.toml")
        || exists(dir, "setup.py")
        || exists(dir, "Pipfile")
    {
        stacks.insert("python".into());
        add_label(&mut labels, "Python");
    }
    // Go
    if exists(dir, "go.mod") {
        stacks.insert("go".into());
        add_label(&mut labels, "Go");
    }
    // Java / Kotlin
    if exists(dir, "pom.xml") || exists(dir, "build.gradle") || exists(dir, "build.gradle.kts") {
        stacks.insert("jvm".into());
        add_label(&mut labels, "JVM");
    }
    // Ruby
    if exists(dir, "Gemfile") {
        stacks.insert("ruby".into());
        add_label(&mut labels, "Ruby");
    }
    // PHP
    if exists(dir, "composer.json") {
        stacks.insert("php".into());
        add_label(&mut labels, "PHP");
    }

    // Databases / infra by config presence.
    if exists(dir, "prisma/schema.prisma") {
        stacks.insert("prisma".into());
        stacks.insert("sql".into());
        add_label(&mut labels, "Prisma");
    }
    if exists(dir, "docker-compose.yml")
        || exists(dir, "docker-compose.yaml")
        || exists(dir, "Dockerfile")
    {
        stacks.insert("docker".into());
        add_label(&mut labels, "Docker");
    }
    if exists(dir, ".github/workflows") {
        stacks.insert("ci".into());
        add_label(&mut labels, "CI");
    }
    if has_ext(dir, "tf") {
        stacks.insert("terraform".into());
        add_label(&mut labels, "Terraform");
    }

    (stacks, labels)
}

/// Shallow check for any top-level file with the given extension.
fn has_ext(dir: &Path, ext: &str) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in rd.flatten() {
        if let Some(e) = entry.path().extension() {
            if e.eq_ignore_ascii_case(ext) {
                return true;
            }
        }
    }
    false
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

const PROFILE_START: &str = "<!-- THETERM:profile:start -->";
const PROFILE_END: &str = "<!-- THETERM:profile:end -->";

/// Build the managed CLAUDE.md block that primes Claude with the project's
/// stack and its active team. Delimited so we can refresh it idempotently
/// without clobbering anything the user wrote in CLAUDE.md.
fn profile_block(profile: &Profile) -> String {
    let mut team = String::new();
    for a in &profile.agents {
        team.push_str(&format!("- **{}** — {}\n", a.id, a.description));
    }
    let stack_line = if profile.labels.is_empty() {
        "Projeto genérico.".to_string()
    } else {
        profile.labels.join(", ")
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
{PROFILE_END}"
    )
}

/// Apply a loadout: write the selected agent definitions into the project's
/// `.claude/agents/` and refresh the managed block in CLAUDE.md.
#[tauri::command]
pub fn apply_loadout(path: String, agent_ids: Vec<String>) -> Result<String, String> {
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
    let block = profile_block(&profile);
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
