import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { monacoThemeName, type Theme } from '../theme';

export interface MonacoEditorProps {
  path: string;
  value: string;
  language: string;
  theme: Theme;
  onChange: (value: string) => void;
  onSave: () => void;
}

/**
 * Single persistent Monaco editor that swaps models per file path (so each
 * open file keeps its own undo stack / cursor). Content changes flow out via
 * onChange; Ctrl/Cmd+S triggers onSave.
 */
export default function MonacoEditor({
  path,
  value,
  language,
  theme,
  onChange,
  onSave,
}: MonacoEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Create the editor once.
  useEffect(() => {
    if (!hostRef.current) return;
    const editor = monaco.editor.create(hostRef.current, {
      theme: monacoThemeName(theme),
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.5,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      renderWhitespace: 'selection',
      tabSize: 2,
      padding: { top: 10 },
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current();
    });

    return () => {
      sub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap to the model for the active path; create it if needed.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const uri = monaco.Uri.file(path);
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(value, language, uri);
    } else if (model.getValue() !== value) {
      // External change (e.g. just (re)loaded from disk) — sync without
      // clobbering an in-progress edit (values already match in that case).
      model.setValue(value);
    }
    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
  }, [path, value, language]);

  // React to theme changes.
  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName(theme));
  }, [theme]);

  return <div ref={hostRef} className="monaco-host" />;
}
