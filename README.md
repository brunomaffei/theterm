# THETERM — terminal nativo de IA

Um emulador de terminal moderno, com Claude embutido. Pense num terminal estilo
[Warp](https://www.warp.dev/), nativo e rápido, em que a IA é cidadã de primeira
classe: você descreve o que quer em linguagem natural e o THETERM gera o comando.

---

## O que é

THETERM é um terminal moderno e elegante com a inteligência da Anthropic embutida.
Os principais recursos:

- **Linguagem natural → comando.** Descreva a tarefa (ex.: "listar os 10 maiores
  arquivos desta pasta") e o Claude sugere o comando pronto, com explicação e um
  aviso de segurança quando a operação for destrutiva.
- **Auto-correção de erros.** Quando um comando falha, o THETERM analisa a saída e
  o código de saída e propõe um diagnóstico e um comando corrigido.
- **Blocos de comando.** Cada comando executado vira um *bloco* visual, com seu
  status (em execução / sucesso / erro), código de saída e saída capturada —
  facilitando navegar, reexecutar e entender o histórico da sessão. Top

---

## Stack

- **[Tauri v2](https://tauri.app/)** — shell nativo leve (backend em Rust).
- **[React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)** — interface.
- **[xterm.js](https://xtermjs.org/)** — emulação de terminal no frontend.
- **[Vite](https://vitejs.dev/)** — bundler e dev server.
- **Rust** — PTY (pseudo-terminal), integração de shell e ponte com a API da Anthropic.

---

## Pré-requisitos

- **[Node.js](https://nodejs.org/)** (LTS recomendado) e **[pnpm](https://pnpm.io/)**.
- **[Rust](https://www.rust-lang.org/tools/install)** (toolchain estável via `rustup`).
- **MSVC Build Tools** — no Windows, instale o *Microsoft C++ Build Tools*
  (componente "Desktop development with C++"), necessário para compilar o backend Rust.
- **WebView2** — runtime da Microsoft (já incluso no Windows 11; no Windows 10 pode
  ser necessário instalar o *Evergreen WebView2 Runtime*).

---

## Como rodar

1. Instale as dependências:

   ```bash
   pnpm install
   ```

2. Configure a chave da Anthropic. Você tem duas opções:

   - **Variável de ambiente** — defina `ANTHROPIC_API_KEY` antes de iniciar:

     ```bash
     # PowerShell
     $env:ANTHROPIC_API_KEY = "sk-ant-..."

     # bash / zsh
     export ANTHROPIC_API_KEY="sk-ant-..."
     ```

   - **Pela UI** — abra o app e informe a chave no painel de configuração da IA.
     A chave é persistida localmente.

3. Rode em modo desenvolvimento (frontend + backend Tauri, com hot-reload):

   ```bash
   pnpm tauri dev
   ```

4. Gere o build de produção (binário nativo + instalador):

   ```bash
   pnpm tauri build
   ```

---

## Atalhos

| Atalho     | Ação                                                       |
| ---------- | ---------------------------------------------------------- |
| `Ctrl + K` | Abre a **paleta de comando IA** (linguagem natural → comando) |

---

## Estrutura de pastas

```
THETERM/
├── src/                  # Frontend (React + TypeScript)
│   ├── ai/               # Cliente da IA (wrappers sobre os comandos Tauri)
│   ├── terminal/         # TerminalController (xterm.js + PTY + blocos)
│   └── types.ts          # Tipos compartilhados (Block, Suggestion, Fix, ...)
├── src-tauri/            # Backend nativo (Rust)
│   └── src/              # PTY, integração de shell e ponte com a API Anthropic
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## Roadmap

**v2:**

- Painel lateral com contexto da sessão (variáveis, diretório, histórico de IA).
- Blocos de comando com render próprio (saída rica, não só texto plano).
- Abas e splits (múltiplos terminais lado a lado).
- Temas customizáveis.
