import React, { useCallback, useEffect, useRef, useState } from 'react';
import browser from 'webextension-polyfill';
import { sendMessage } from '../../shared/messages';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function Sidebar(): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const message = inputValue.trim();
    if (!message || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessage('CHAT', {
        message,
        conversationId,
      });

      if (response.ok) {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: response.value.reply,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setConversationId(response.value.conversationId);
      } else {
        setError(response.error.message);
        setMessages((prev) => prev.slice(0, -1));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [inputValue, isLoading, conversationId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleClear = useCallback(() => {
    if (messages.length === 0) return;
    if (confirm(browser.i18n.getMessage('chatClearConfirm'))) {
      setMessages([]);
      setConversationId(undefined);
      setError(null);
    }
  }, [messages.length]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="p-4 border-b bg-white shadow-sm flex items-center justify-between">
        <h1 className="font-semibold text-lg">
          {browser.i18n.getMessage('chatTitle')}
        </h1>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100"
            title={browser.i18n.getMessage('chatClear')}
          >
            {browser.i18n.getMessage('chatClear')}
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-center">
              {browser.i18n.getMessage('chatEmpty')}
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => (
              <div
                key={`${msg.timestamp}-${index}`}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white border border-gray-200 text-gray-800'
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                  <div
                    className={`text-xs mt-1 ${
                      msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'
                    }`}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-4 py-2 bg-white border border-gray-200">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </main>

      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <footer className="p-4 border-t bg-white">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={browser.i18n.getMessage('chatPlaceholder')}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {browser.i18n.getMessage('chatSend')}
          </button>
        </div>
      </footer>
    </div>
  );
}
