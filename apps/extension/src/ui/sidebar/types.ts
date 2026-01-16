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
};

export type SidebarContextInfo = SubtitleContextInfo;

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
