import React from 'react';
import type { Block, ChatMessage } from '../types';
import BlocksPanel from './BlocksPanel';
import ChatView from './ChatView';

export type RightTab = 'chat' | 'blocks';

export interface SidePanelProps {
  tab: RightTab;
  onTab: (t: RightTab) => void;
  blocks: Block[];
  onFix: (b: Block) => void;
  onRerun: (b: Block) => void;
  messages: ChatMessage[];
  chatLoading: boolean;
  chatError: string;
  aiConfigured: boolean;
  onSend: (text: string) => void;
  onRun: (cmd: string) => void;
}

/** Right-hand workspace panel: switches between the Claude chat and the
 *  command blocks timeline for the active terminal. */
export default function SidePanel(props: SidePanelProps): JSX.Element {
  const { tab, onTab, blocks } = props;
  const errorCount = blocks.filter((b) => b.status === 'error').length;

  return (
    <aside className="side-panel">
      <div className="side-panel__tabs">
        <button
          type="button"
          className={`panel-tab ${tab === 'chat' ? 'panel-tab--on' : ''}`}
          onClick={() => onTab('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          className={`panel-tab ${tab === 'blocks' ? 'panel-tab--on' : ''}`}
          onClick={() => onTab('blocks')}
        >
          Blocos
          {blocks.length > 0 && <span className="panel-tab__count">{blocks.length}</span>}
          {errorCount > 0 && <span className="panel-tab__badge">{errorCount}</span>}
        </button>
      </div>

      <div className="side-panel__body">
        {tab === 'chat' ? (
          <ChatView
            messages={props.messages}
            loading={props.chatLoading}
            error={props.chatError}
            configured={props.aiConfigured}
            onSend={props.onSend}
            onRun={props.onRun}
          />
        ) : (
          <BlocksPanel blocks={blocks} onFix={props.onFix} onRerun={props.onRerun} />
        )}
      </div>
    </aside>
  );
}
