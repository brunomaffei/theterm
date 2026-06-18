import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

export interface ChatViewProps {
  messages: ChatMessage[];
  loading: boolean;
  error: string;
  configured: boolean;
  onSend: (text: string) => void;
  onRun: (cmd: string) => void;
}

type Segment = { type: 'text' | 'code'; content: string };

/** Split an assistant message into prose and fenced code blocks. */
function parseSegments(text: string): Segment[] {
  const segs: Segment[] = [];
  const re = /```[^\n]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: 'text', content: text.slice(last, m.index) });
    segs.push({ type: 'code', content: m[1].trim() });
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ type: 'text', content: text.slice(last) });
  return segs.filter((s) => s.content.trim().length > 0);
}

function CodeBlock({ code, onRun }: { code: string; onRun: (c: string) => void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="chat-code">
      <code className="chat-code__text">{code}</code>
      <div className="chat-code__actions">
        <button
          type="button"
          className="chat-code__btn chat-code__btn--run"
          onClick={() => onRun(code)}
          title="Rodar no terminal ativo"
        >
          ▶ rodar
        </button>
        <button
          type="button"
          className="chat-code__btn"
          onClick={() => {
            navigator.clipboard
              .writeText(code)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              })
              .catch(() => {});
          }}
        >
          {copied ? '✓ copiado' : 'copiar'}
        </button>
      </div>
    </div>
  );
}

export default function ChatView({
  messages,
  loading,
  error,
  configured,
  onSend,
  onRun,
}: ChatViewProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  function send(): void {
    const t = draft.trim();
    if (!t || loading || !configured) return;
    onSend(t);
    setDraft('');
  }

  return (
    <div className="chat">
      <div className="chat__messages" ref={scrollRef}>
        {messages.length === 0 && !loading && (
          <div className="chat__empty">
            <p className="chat__empty-title">Converse com o Claude</p>
            <p className="chat__empty-hint">
              {configured
                ? 'Pergunte sobre um erro, peça um comando ou tire dúvidas. Ele vê os comandos recentes do terminal ativo, e os comandos sugeridos têm botão “rodar”.'
                : 'Conecte o Claude CLI (ou uma chave da API) pra ativar o chat.'}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg--${m.role}`}>
            {m.role === 'assistant' ? (
              parseSegments(m.text).map((seg, j) =>
                seg.type === 'code' ? (
                  <CodeBlock key={j} code={seg.content} onRun={onRun} />
                ) : (
                  <p key={j} className="chat-msg__text">
                    {seg.content.trim()}
                  </p>
                ),
              )
            ) : (
              <p className="chat-msg__text">{m.text}</p>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-msg chat-msg--assistant">
            <div className="chat__thinking">
              <span className="spinner" aria-hidden="true" /> pensando…
            </div>
          </div>
        )}

        {error && <div className="error-banner chat__error">{error}</div>}
      </div>

      <div className="chat__input">
        <textarea
          className="chat__textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            configured
              ? 'pergunte ao Claude…  (Enter envia · Shift+Enter quebra linha)'
              : 'IA não configurada'
          }
          rows={1}
          disabled={!configured}
          spellCheck={false}
        />
        <button
          type="button"
          className="chat__send"
          onClick={send}
          disabled={!draft.trim() || loading || !configured}
          aria-label="Enviar"
          title="Enviar (Enter)"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
