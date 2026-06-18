// Data-driven theme system. A Theme provides UI tokens + terminal ANSI colors;
// from those we derive the CSS variables, the xterm palette and the Monaco
// palette, so the whole app re-skins from one object.

import type { ITheme } from '@xterm/xterm';
import * as monaco from 'monaco-editor';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  bg: string;
  bgElev: string;
  bgPanel: string;
  bgCard: string;
  bgCardHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accent2: string;
  onAccent: string;
  green: string;
  amber: string;
  red: string;
  termGlow: string;
}

export interface ThemeAnsi {
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
}

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  ansi: ThemeAnsi;
}

export const DEFAULT_THEME_ID = 'cyber-lime';

const CYBER_LIME: Theme = {
  id: 'cyber-lime',
  name: 'Cyber Lime',
  mode: 'dark',
  colors: {
    bg: '#13130e',
    bgElev: '#191911',
    bgPanel: '#15150f',
    bgCard: '#1d1d15',
    bgCardHover: '#25251a',
    border: '#2b2b1f',
    borderStrong: '#3b3b2a',
    text: '#e8e9da',
    textDim: '#9a9c83',
    textFaint: '#62634f',
    accent: '#c5f23a',
    accent2: '#9be15d',
    onAccent: '#14140d',
    green: '#9be15d',
    amber: '#e0c64a',
    red: '#f7768e',
    termGlow: '#1a1a12',
  },
  ansi: {
    red: '#f7768e',
    green: '#9be15d',
    yellow: '#e0c64a',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
  },
};

// Themes designed via the theme workflow.
const DESIGNED: Theme[] = [
  {
    id: 'tokyo-night', name: 'Tokyo Night', mode: 'dark',
    colors: { bg: '#16161e', bgElev: '#1a1b26', bgPanel: '#1e2030', bgCard: '#222436', bgCardHover: '#2a2c42', border: '#2a2e42', borderStrong: '#3b4261', text: '#c0caf5', textDim: '#9aa5ce', textFaint: '#787c99', accent: '#7aa2f7', accent2: '#bb9af7', onAccent: '#16161e', green: '#9ece6a', amber: '#e0af68', red: '#f7768e', termGlow: '#222a44' },
    ansi: { red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff' },
  },
  {
    id: 'amber-crt', name: 'Amber CRT', mode: 'dark',
    colors: { bg: '#0d0805', bgElev: '#171009', bgPanel: '#120c07', bgCard: '#1d140b', bgCardHover: '#271a0e', border: '#352413', borderStrong: '#523719', text: '#ffd9a8', textDim: '#c79263', textFaint: '#8a6038', accent: '#ffa01f', accent2: '#ff7a2e', onAccent: '#1a0e03', green: '#9fc24f', amber: '#ffc24d', red: '#ff6a45', termGlow: '#1e1409' },
    ansi: { red: '#ff6a45', green: '#9fc24f', yellow: '#ffc24d', blue: '#d8983f', magenta: '#e08a5a', cyan: '#e8b878' },
  },
  {
    id: 'synthwave', name: 'Synthwave', mode: 'dark',
    colors: { bg: '#120b1f', bgElev: '#1a1130', bgPanel: '#170e2a', bgCard: '#21163b', bgCardHover: '#2c1d4d', border: '#2e2050', borderStrong: '#4a3578', text: '#f3ecff', textDim: '#b3a3d6', textFaint: '#7d6ca6', accent: '#ff3fa4', accent2: '#22e0ff', onAccent: '#1a0716', green: '#3ff0a8', amber: '#ffc24b', red: '#ff5577', termGlow: '#1e1336' },
    ansi: { red: '#ff5577', green: '#3ff0a8', yellow: '#ffc24b', blue: '#6e7bff', magenta: '#ff3fa4', cyan: '#22e0ff' },
  },
  {
    id: 'nord-ice', name: 'Nord Ice', mode: 'dark',
    colors: { bg: '#21262f', bgElev: '#272d38', bgPanel: '#252b35', bgCard: '#2d3440', bgCardHover: '#353d4b', border: '#39414f', borderStrong: '#4a5567', text: '#eceff4', textDim: '#aab4c6', textFaint: '#7c889c', accent: '#88c0d0', accent2: '#81a1c1', onAccent: '#1a1f27', green: '#a3be8c', amber: '#ebcb8b', red: '#bf616a', termGlow: '#2a313c' },
    ansi: { red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0' },
  },
  {
    id: 'matrix', name: 'Matrix', mode: 'dark',
    colors: { bg: '#050805', bgElev: '#0a0f0a', bgPanel: '#080c08', bgCard: '#0d130d', bgCardHover: '#121a12', border: '#16261a', borderStrong: '#264d33', text: '#c8f5d4', textDim: '#5fae74', textFaint: '#3c7a4d', accent: '#2bee78', accent2: '#0bbf5a', onAccent: '#021006', green: '#2bee78', amber: '#d6e64f', red: '#ff5a5f', termGlow: '#0c160d' },
    ansi: { red: '#ff5a5f', green: '#37ee82', yellow: '#cfe84a', blue: '#36c8a8', magenta: '#7ee0a0', cyan: '#46e8c9' },
  },
  {
    id: 'paper-light', name: 'Paper Light', mode: 'light',
    colors: { bg: '#f6f3ec', bgElev: '#efece3', bgPanel: '#eae6db', bgCard: '#fbf9f3', bgCardHover: '#f1ede3', border: '#ddd7c8', borderStrong: '#c7bfab', text: '#22201b', textDim: '#5a554a', textFaint: '#8a8475', accent: '#0f7a6e', accent2: '#13988a', onAccent: '#fbf9f3', green: '#2f7d44', amber: '#9a6b12', red: '#bf3b3b', termGlow: '#fbf8f1' },
    ansi: { red: '#bf3b3b', green: '#2f7d44', yellow: '#9a6b12', blue: '#2d5fa8', magenta: '#8a4296', cyan: '#0f7a6e' },
  },
];

export const THEMES: Theme[] = [CYBER_LIME, ...DESIGNED];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? CYBER_LIME;
}

/** "#rrggbb" -> "r, g, b" for rgba() composition. */
function rgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function cssVarsFor(t: Theme): Record<string, string> {
  const c = t.colors;
  const ar = rgb(c.accent);
  return {
    '--bg': c.bg,
    '--bg-elev': c.bgElev,
    '--bg-panel': c.bgPanel,
    '--bg-card': c.bgCard,
    '--bg-card-hover': c.bgCardHover,
    '--border': c.border,
    '--border-strong': c.borderStrong,
    '--text': c.text,
    '--text-dim': c.textDim,
    '--text-faint': c.textFaint,
    '--accent': c.accent,
    '--accent-2': c.accent2,
    '--accent-grad': `linear-gradient(135deg, ${c.accent} 0%, ${c.accent2} 100%)`,
    '--on-accent': c.onAccent,
    '--green': c.green,
    '--amber': c.amber,
    '--red': c.red,
    '--term-glow': c.termGlow,
    '--accent-glow': `rgba(${ar}, 0.5)`,
    '--accent-soft': `rgba(${ar}, 0.1)`,
    '--accent-line': `rgba(${ar}, 0.3)`,
  };
}

export function xtermThemeFor(t: Theme): ITheme {
  const c = t.colors;
  const a = t.ansi;
  return {
    background: c.bg,
    foreground: c.text,
    cursor: c.accent,
    cursorAccent: c.bg,
    selectionBackground: `rgba(${rgb(c.accent)}, 0.25)`,
    black: c.bgCard,
    red: a.red,
    green: a.green,
    yellow: a.yellow,
    blue: a.blue,
    magenta: a.magenta,
    cyan: a.cyan,
    white: c.textDim,
    brightBlack: c.textFaint,
    brightRed: a.red,
    brightGreen: a.green,
    brightYellow: a.yellow,
    brightBlue: a.blue,
    brightMagenta: a.magenta,
    brightCyan: a.cyan,
    brightWhite: c.text,
  };
}

const definedMonaco = new Set<string>();

export function monacoThemeName(t: Theme): string {
  const name = `theterm-${t.id}`;
  if (!definedMonaco.has(name)) {
    const c = t.colors;
    monaco.editor.defineTheme(name, {
      base: t.mode === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': c.bg,
        'editor.foreground': c.text,
        'editorCursor.foreground': c.accent,
        'editor.lineHighlightBackground': c.bgCard,
        'editorLineNumber.foreground': c.borderStrong,
        'editorLineNumber.activeForeground': c.accent,
        'editor.selectionBackground': c.bgCardHover,
        'editorIndentGuide.background1': c.border,
        'editorWidget.background': c.bgElev,
        'editorWidget.border': c.border,
        'editorGutter.background': c.bg,
      },
    });
    definedMonaco.add(name);
  }
  return name;
}

/** Apply a theme: CSS variables, mode attribute, and the Monaco editor theme. */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  const vars = cssVarsFor(t);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.themeMode = t.mode;
  try {
    monaco.editor.setTheme(monacoThemeName(t));
  } catch {
    /* monaco may not be ready; editors call monacoThemeName on mount too */
  }
}
