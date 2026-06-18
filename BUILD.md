# Build multiplataforma — THETERM

THETERM é Tauri v2, então **um código → Windows, macOS e Linux**. O ponto-chave: **cada sistema se compila no próprio sistema** (não dá pra gerar/assinar um app de Mac no Windows). Os caminhos abaixo cobrem build local e o pipeline automático.

## Caminho recomendado: GitHub Actions (os 3 de uma vez)

Já existe o workflow [`.github/workflows/release.yml`](.github/workflows/release.yml). Ele compila Windows + macOS (universal Apple Silicon/Intel) + Linux em runners nativos e anexa os instaladores num release rascunho.

1. Suba o projeto pro GitHub (se ainda não): `git init && git add . && git commit -m "init" && git remote add origin <repo> && git push -u origin main`
2. Crie uma tag de versão: `git tag v0.1.0 && git push --tags`
3. O Actions builda os 3 e cria um **Release (draft)** com os assets: `.msi`/`.exe` (Windows), `.dmg` (macOS), `.deb`/`.rpm`/`.AppImage` (Linux).

Também dá pra rodar manualmente em **Actions → release → Run workflow**.

## Build local por sistema

Pré-requisitos comuns: Node 20+, pnpm 10+, Rust (stable). Depois `pnpm install` e `pnpm tauri build`.

### Windows (já configurado nesta máquina)
- Rust (toolchain `stable-x86_64-pc-windows-msvc`) + **VS Build Tools (C++)** + WebView2 (vem no Win11).
- `pnpm tauri build` → `.msi` e `.exe` (NSIS).

### macOS
- **Xcode Command Line Tools**: `xcode-select --install`
- Targets universais: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- `pnpm tauri build --target universal-apple-darwin` → `.app` + `.dmg`
- Distribuição: precisa de **assinatura + notarização** (conta Apple Developer). Sem isso, o usuário vê o aviso do Gatekeeper. Variáveis de assinatura estão comentadas no `release.yml`.
- Obs: a janela usa `macOSPrivateApi: true` (necessário pra transparência) — isso **impede publicação na Mac App Store**, mas é ok pra distribuição direta via `.dmg`.

### Linux
- Dependências de build (Ubuntu/Debian):
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  ```
- `pnpm tauri build` → `.deb`, `.rpm`, `.AppImage`
- Runtime: o usuário final precisa do **webkit2gtk-4.1** instalado (declarado nas deps do `.deb`/`.rpm`).
- Transparência da janela depende de um **compositor** ativo; sem ele os cantos podem aparecer opacos (o app continua funcional).

## Notas de portabilidade já tratadas no código
- **Shell por OS**: PowerShell no Windows, `$SHELL`/zsh/bash no macOS/Linux (`src-tauri/src/pty.rs`).
- **Detecção do Claude CLI**: além do PATH, procura em `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `~/.bun/bin` etc. — importante no macOS, onde apps abertos pelo Finder não herdam o PATH do shell.
- **Prompts da IA** se adaptam ao shell do sistema.
- **Chave da API** é salva no diretório de config do usuário com permissão `0600` (não mais em `/tmp`).
- **Atalhos** mostram `⌘` no macOS e `Ctrl` nos demais.

## Pendências conhecidas (cosméticas, multiplataforma)
- Controles da janela ficam à direita (estilo Windows); no macOS o ideal seria os "semáforos" à esquerda.
- `backdrop-filter` (blur dos modais) não é suportado no WebKitGTK (Linux) — degrada para um fundo sólido, sem quebrar.
