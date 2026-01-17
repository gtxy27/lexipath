import type { ChatMessageRecordWithId, ChatSessionRecord } from '@lexipath/storage';

export type ChatSession = ChatSessionRecord;
export type ChatHistoryMessage = ChatMessageRecordWithId;

export type ChatSessionMessagesSearchResult = ChatHistoryMessage;

export type SubtitleContextInfo = {
  kind: 'subtitle';
  platform?: string;
  title?: string;
  timestampSec?: number;
  lines?: string[];
  anchorId?: string;
  url?: string;
};

export type WebContextInfo = {
  kind: 'web';
  /**
   * How this context was created.
   * - selection: user selected text and asked for help (session stays `general`)
   * - study: user explicitly started a page study (session becomes `web`)
   */
  source?: 'selection' | 'study';
  title?: string;
  domain?: string;
  url?: string;
  selectedText?: string;
  beforeText?: string;
  afterText?: string;
};

export type SidebarContextInfo = SubtitleContextInfo | WebContextInfo;


export type SidebarContextSelection = {
  title: boolean;
  timestamp: boolean;
  snippet: boolean;
};

export const DEFAULT_CONTEXT_SELECTION: SidebarContextSelection = {
  title: true,
  timestamp: true,
  snippet: true,
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  thinking?: string;
  isThinkingStreaming?: boolean;
};
