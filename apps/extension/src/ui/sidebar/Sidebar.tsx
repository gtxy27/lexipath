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
    <div className="flex h-screen flex-col bg-gradient-to-br from-background via-background to-muted/10">
      <header className="flex items-center justify-between border-b border-border/50 px-4 py-3.5 shadow-lg bg-gradient-to-r from-card/80 via-card/60 to-card/80 backdrop-blur-md supports-[backdrop-filter]:bg-card/60">
        <div className="flex items-center gap-2.5">
           <Avatar className="h-9 w-9 ring-2 ring-primary/20 shadow-md">
              <AvatarImage src="../../icons/icon.svg" />
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground font-bold">LP</AvatarFallback>
           </Avatar>
           <h1 className="font-bold text-base bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
             {browser.i18n.getMessage('chatTitle')}
           </h1>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            title={browser.i18n.getMessage('chatClear')}
            className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200 rounded-lg"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="flex h-[calc(100vh-140px)] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <div className="p-4 rounded-full bg-gradient-to-br from-primary/10 to-primary/5">
              <Bot className="h-16 w-16 opacity-30 text-primary" />
            </div>
            <p className="text-sm font-medium">
              {browser.i18n.getMessage('chatEmpty')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-4">
            {messages.map((msg, index) => (
              <div
                key={`${msg.timestamp}-${index}`}
                className={cn(
                  "flex gap-3 max-w-[85%] animate-in slide-in-from-bottom-2 duration-300",
                  msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                )}
              >
                 <Avatar className={cn(
                   "h-8 w-8 mt-1 border-2 shadow-md transition-all duration-200",
                   msg.role === 'user' ? "border-primary/30" : "border-muted/30"
                 )}>
                    <AvatarFallback className={msg.role === 'user'
                      ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground"
                      : "bg-gradient-to-br from-muted to-muted/80"
                    }>
                       {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </AvatarFallback>
                 </Avatar>

                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm shadow-lg transition-all duration-200 hover:shadow-xl",
                    msg.role === 'user'
                      ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground"
                      : "bg-gradient-to-br from-card to-card/90 text-foreground border border-border/50 backdrop-blur-sm"
                  )}
                >
                  <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.content}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] mt-1.5 opacity-60",
                      msg.role === 'user' ? "text-primary-foreground" : "text-muted-foreground"
                    )}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
               <div className="flex gap-3 mr-auto max-w-[85%] animate-in slide-in-from-bottom-2 duration-300">
                  <Avatar className="h-8 w-8 mt-1 border-2 border-muted/30 shadow-md">
                     <AvatarFallback className="bg-gradient-to-br from-muted to-muted/80">
                        <Bot className="h-4 w-4" />
                     </AvatarFallback>
                  </Avatar>
                  <div className="rounded-2xl px-4 py-3.5 bg-gradient-to-br from-card to-card/90 shadow-lg border border-border/50 backdrop-blur-sm flex items-center gap-1.5">
                     <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.3s]"></span>
                     <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.15s]"></span>
                     <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"></span>
                  </div>
               </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-destructive/10 to-destructive/5 text-destructive text-xs border-t border-destructive/20 backdrop-blur-sm">
          <AlertCircle className="h-4 w-4 animate-pulse" />
          <p>{error}</p>
        </div>
      )}

      <div className="p-4 border-t border-border/50 bg-gradient-to-br from-card/80 to-card/60 backdrop-blur-md shadow-2xl">
        <div className="flex gap-2.5">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={browser.i18n.getMessage('chatPlaceholder')}
            disabled={isLoading}
            className="flex-1 border-border/50 bg-background/50 backdrop-blur-sm shadow-sm focus-visible:ring-primary/50 transition-all duration-200"
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
            className={cn(
               "shrink-0 shadow-md transition-all duration-200 hover:shadow-lg",
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
