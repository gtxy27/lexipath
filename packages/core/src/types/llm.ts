export type ThinkingMode = 'disabled' | 'auto' | 'enabled';

export type LLMChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LLMChatCompletionMessage = LLMChatMessage & {
  thinking?: string;
};

export type LLMChatCompletionResponse = {
  id: string;
  choices: Array<{
    message: LLMChatCompletionMessage;
    finish_reason: string;
  }>;
};

export type LLMChatOptions = {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  thinking?: ThinkingMode;
};

export type LLMChatWithThinkingResult = {
  response: LLMChatCompletionResponse;
  content: string;
  thinking?: string;
  finishReason?: string;
};

export type LLMStreamChatHandlers = {
  onDelta: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
};

export type LLMStreamChatOptions = {
  temperature: number;
  maxTokens: number;
  timeout?: number;
  signal?: AbortSignal;
} & LLMStreamChatHandlers;

export type LLMStreamChatResult = {
  content: string;
  thinking?: string;
  finishReason?: string;
};

// Owned by core; providers implement it, apps consume it.
export interface LLMChatProvider {
  chat(messages: LLMChatMessage[], options?: LLMChatOptions): Promise<LLMChatCompletionResponse>;
  chatWithThinking(messages: LLMChatMessage[], options?: LLMChatOptions): Promise<LLMChatWithThinkingResult>;
  streamChat(messages: LLMChatMessage[], options: LLMStreamChatOptions): Promise<LLMStreamChatResult>;
}
