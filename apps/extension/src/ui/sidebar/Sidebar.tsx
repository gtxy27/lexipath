import React, { useCallback, useEffect, useRef, useState } from 'react';
import browser from 'webextension-polyfill';
import { sendMessage } from '../../shared/messages';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Send, Trash2, Bot, User, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

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
      setError(
        err instanceof Error ? err.message : browser.i18n.getMessage('error_unknown') || 'error_unknown'
      );
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
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3 shadow-sm bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50">
        <div className="flex items-center gap-2">
           <Avatar className="h-8 w-8">
              <AvatarImage src="../../icons/icon.svg" />
              <AvatarFallback>LP</AvatarFallback>
           </Avatar>
           <h1 className="font-semibold text-sm">
             {browser.i18n.getMessage('chatTitle')}
           </h1>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            title={browser.i18n.getMessage('chatClear')}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="flex h-[calc(100vh-140px)] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Bot className="h-12 w-12 opacity-20" />
            <p className="text-sm">
              {browser.i18n.getMessage('chatEmpty')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-4">
            {messages.map((msg, index) => (
              <div
                key={`${msg.timestamp}-${index}`}
                className={cn(
                  "flex gap-3 max-w-[85%]",
                  msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                )}
              >
                 <Avatar className="h-8 w-8 mt-1 border">
                    <AvatarFallback className={msg.role === 'user' ? "bg-primary text-primary-foreground" : "bg-muted"}>
                       {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </AvatarFallback>
                 </Avatar>
                 
                <div
                  className={cn(
                    "rounded-lg px-4 py-2.5 text-sm shadow-sm",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.content}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] mt-1 opacity-70",
                      msg.role === 'user' ? "text-primary-foreground" : "text-muted-foreground"
                    )}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
               <div className="flex gap-3 mr-auto max-w-[85%]">
                  <Avatar className="h-8 w-8 mt-1 border">
                     <AvatarFallback className="bg-muted">
                        <Bot className="h-4 w-4" />
                     </AvatarFallback>
                  </Avatar>
                  <div className="rounded-lg px-4 py-3 bg-muted shadow-sm flex items-center gap-1">
                     <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.3s]"></span>
                     <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.15s]"></span>
                     <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce"></span>
                  </div>
               </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive text-xs border-t border-destructive/20">
          <AlertCircle className="h-4 w-4" />
          <p>{error}</p>
        </div>
      )}

      <div className="p-4 border-t bg-background">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={browser.i18n.getMessage('chatPlaceholder')}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
            className={cn(
               "shrink-0",
               !inputValue.trim() && !isLoading && "opacity-50"
            )}
          >
             {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
