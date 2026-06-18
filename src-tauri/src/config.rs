use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const SUGGEST_MODEL_DEFAULT: &str = "claude-haiku-4-5-20251001";
const FIX_MODEL_DEFAULT: &str = "claude-sonnet-4-6";

/// Persisted AI configuration. Best-effort persistence to a JSON file in the
/// system temp directory; all IO errors are swallowed so the app never fails
/// to start because of a missing/locked config file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub api_key: Option<String>,
    pub suggest_model: String,
    pub fix_model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let suggest_model = std::env::var("THETERM_MODEL_SUGGEST")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| SUGGEST_MODEL_DEFAULT.to_string());
        let fix_model = std::env::var("THETERM_MODEL_FIX")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| FIX_MODEL_DEFAULT.to_string());

        AiConfig {
            api_key,
            suggest_model,
            fix_model,
        }
    }
}

impl AiConfig {
    /// Per-user config directory (NOT temp — temp is world-readable on Unix and
    /// would leak the API key). Maps to %APPDATA%, ~/Library/Application Support,
    /// or $XDG_CONFIG_HOME / ~/.config.
    pub(crate) fn config_dir() -> PathBuf {
        #[cfg(windows)]
        {
            if let Some(d) = std::env::var_os("APPDATA") {
                return PathBuf::from(d).join("THETERM");
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(h) = std::env::var_os("HOME") {
                return PathBuf::from(h).join("Library/Application Support/THETERM");
            }
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            if let Some(x) = std::env::var_os("XDG_CONFIG_HOME") {
                return PathBuf::from(x).join("theterm");
            }
            if let Some(h) = std::env::var_os("HOME") {
                return PathBuf::from(h).join(".config/theterm");
            }
        }
        std::env::temp_dir()
    }

    fn config_path() -> PathBuf {
        let dir = Self::config_dir();
        let _ = fs::create_dir_all(&dir);
        dir.join("config.json")
    }

    /// Load configuration, preferring a persisted file but always allowing the
    /// environment to provide an API key when the file lacks one.
    pub fn load() -> Self {
        let mut cfg = AiConfig::default();

        if let Ok(contents) = fs::read_to_string(Self::config_path()) {
            if let Ok(persisted) = serde_json::from_str::<AiConfig>(&contents) {
                // Persisted values win, but fall back to env-derived key when
                // the persisted key is missing.
                if persisted.api_key.is_some() {
                    cfg.api_key = persisted.api_key;
                }
                if !persisted.suggest_model.trim().is_empty() {
                    cfg.suggest_model = persisted.suggest_model;
                }
                if !persisted.fix_model.trim().is_empty() {
                    cfg.fix_model = persisted.fix_model;
                }
            }
        }

        cfg
    }

    /// Best-effort persist. Errors are intentionally ignored. The file is
    /// written with owner-only permissions on Unix (it can hold an API key).
    pub fn persist(&self) {
        let json = match serde_json::to_string_pretty(self) {
            Ok(j) => j,
            Err(_) => return,
        };
        let path = Self::config_path();

        // On Unix, write to a 0600 temp file and atomically rename over the
        // target so the API key is never momentarily world-readable.
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let tmp = path.with_extension("json.tmp");
            let written = (|| -> std::io::Result<()> {
                let mut f = fs::OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .mode(0o600)
                    .open(&tmp)?;
                f.write_all(json.as_bytes())?;
                f.sync_all()?;
                fs::rename(&tmp, &path)
            })();
            if written.is_err() {
                let _ = fs::remove_file(&tmp);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = fs::write(&path, json);
        }
    }
}
