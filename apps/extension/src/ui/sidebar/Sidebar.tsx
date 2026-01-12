import React, { useCallback, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import type { ChatResponse, Theme } from "@lexipath/core";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { chatStream } from "../../shared/chat-stream";
import { makeKeywordSessionId, normalizeChatKeyword } from "../../shared/chat-session-id";
import { MessageContent } from "./MessageContent";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Send, Trash2, Bot, User, Loader2, AlertCircle, Sparkles, PlusCircle, MessageSquare, History, ChevronLeft, Search } from "lucide-react";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useApplyTheme } from "../lib/theme";
import { t } from "../../shared/i18n";

const log = createLogger("ui:sidebar");

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatSession {
  sessionId: string;
  keyword: string;
  lastAccessedAt: number;
  createdAt: number;
}

export function Sidebar(): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
  
    useEffect(() => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
  
      const timer = setTimeout(async () => {
        setIsSearching(true);
        const response = await sendMessage("SEARCH_MESSAGES", { query: searchQuery });
        if (response.ok) {
          setSearchResults(response.value);
        }
        setIsSearching(false);
      }, 300);
  
      return () => clearTimeout(timer);
    }, [searchQuery]);
  
    const messagesEndRef = useRef<HTMLDivElement>(null);  const inputRef = useRef<HTMLInputElement>(null);
  const streamCancelRef = useRef<null | (() => void)>(null);

  useApplyTheme(theme);

  useEffect(() => {
    return () => {
      streamCancelRef.current?.();
    };
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await sendMessage("GET_CHAT_SESSIONS", {});
    if (response.ok) {
      setSessions(response.value as ChatSession[]);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    const response = await sendMessage("GET_CHAT_MESSAGES", { sessionId });
    if (response.ok) {
      const history = (response.value as any[]).map(m => ({
        id: String(m.id),
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }));
      setMessages(history);
      setConversationId(sessionId);
    }
  }, []);

  const loadLatestSession = useCallback(async () => {
    const response = await sendMessage("GET_CHAT_SESSIONS", {});
    if (response.ok) {
      const allSessions = response.value as ChatSession[];
      setSessions(allSessions);
      if (allSessions.length > 0) {
        // Sort by lastAccessedAt desc
        const sorted = [...allSessions].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
        const latest = sorted[0];
        if (latest) {
          await loadMessages(latest.sessionId);
        }
      }
    }
  }, [loadMessages]);

  useEffect(() => {
    async function init() {
      try {
        const response = await sendMessage("GET_SETTINGS", undefined);
        if (response.ok) {
          setTheme(response.value.theme);
        }
      } catch (error: unknown) {
        log.warn("Failed to load sidebar theme from settings; using default theme", { message: getErrorMessage(error) });
      }
      await loadLatestSession();
    }
    init();
  }, [loadLatestSession]);

  const handleNewChat = useCallback(() => {
    streamCancelRef.current?.();
    setMessages([]);
    setConversationId(undefined);
    setError(null);
    setIsLoading(false);
    setShowSessions(false);
    inputRef.current?.focus();
  }, []);

  const sendChatText = useCallback(
    async (
      text: string,
      options?: { conversationId?: string; allowWhileLoading?: boolean }
    ) => {
      const message = text.trim();
      if (!message) return;

      const allowWhileLoading = options?.allowWhileLoading ?? false;
      if (isLoading && !allowWhileLoading) return;

      const targetConvId = options?.conversationId || conversationId;

      // Detach the previous UI stream (if any). The background should keep running
      // and persist the final result to storage.
      streamCancelRef.current?.();
      setError(null);
      setIsLoading(true);

      const now = Date.now();
      const userId = `${now}-user-${Math.random().toString(16).slice(2)}`;
      const assistantId = `${now}-assistant-${Math.random().toString(16).slice(2)}`;

      const userMessage: ChatMessage = {
        id: userId,
        role: "user",
        content: message,
        timestamp: now,
      };

      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: now,
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInputValue("");

      let contentSoFar = "";
      let pending = "";
      let flushTimer: number | null = null;
      let finished = false;

      const flush = () => {
        if (!pending) return;
        contentSoFar += pending;
        pending = "";
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content: contentSoFar, isStreaming: true } : msg,
          ),
        );
      };

      const scheduleFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flush();
        }, 60);
      };

      const { cancel } = chatStream(
        { message, conversationId: targetConvId },
        {
          onChunk: (delta) => {
            if (finished) return;
            pending += delta;
            scheduleFlush();
          },
          onDone: ({ reply, conversationId: nextConversationId }) => {
            if (finished) return;
            finished = true;
            if (flushTimer !== null) {
              window.clearTimeout(flushTimer);
              flushTimer = null;
            }
            flush();
            const finalReply = reply || contentSoFar;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: finalReply, isStreaming: false } : msg,
              ),
            );
            setConversationId(nextConversationId);
            setIsLoading(false);
            inputRef.current?.focus();
            void loadSessions();
          },
          onError: (err) => {
            if (finished) return;
            finished = true;
            if (flushTimer !== null) {
              window.clearTimeout(flushTimer);
              flushTimer = null;
            }
            flush();
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: contentSoFar, isStreaming: false } : msg,
              ),
            );
            setError(err.message);
            setIsLoading(false);
            inputRef.current?.focus();
          },
        },
      );

      streamCancelRef.current = cancel;
    },
    [conversationId, isLoading, loadSessions],
  );

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, browser.Storage.StorageChange>) => {
      if (changes.lexipath_sidebar_pending_message?.newValue) {
        const pending = changes.lexipath_sidebar_pending_message.newValue;
        if (Date.now() - pending.timestamp < 10000) {
          void browser.storage.local.remove("lexipath_sidebar_pending_message");
          if (pending.isAutoSend) {
            const keywordRaw = typeof pending.keyword === "string" ? pending.keyword : "";
            const keyword = keywordRaw.trim();

            if (keyword) {
              void (async () => {
                // Immediate UI switch: stop streaming in the UI, but let the background
                // continue and persist the final assistant message to storage.
                streamCancelRef.current?.();
                setError(null);
                setIsLoading(false);
                setMessages([]);
                setShowSessions(false);

                const normalizedKeyword = normalizeChatKeyword(keyword);
                const sessionsResponse = await sendMessage("GET_CHAT_SESSIONS", { keyword: normalizedKeyword });
                const sessions = sessionsResponse.ok ? (sessionsResponse.value as ChatSession[]) : [];
                const sessionId =
                  sessions[0]?.sessionId ?? makeKeywordSessionId(normalizedKeyword, 1);

                setConversationId(sessionId);
                if (sessions.length > 0) {
                  await loadMessages(sessionId);
                }

                await sendChatText(pending.text, { conversationId: sessionId, allowWhileLoading: true });
              })();
            } else {
              void sendChatText(pending.text, { allowWhileLoading: true });
            }
          } else {
            setInputValue(pending.text);
          }
        }
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, [loadMessages, sendChatText]);

  useEffect(() => {
    async function checkPendingMessage() {
      const data = await browser.storage.local.get("lexipath_sidebar_pending_message");
      const pending = data.lexipath_sidebar_pending_message;
      
      if (pending && Date.now() - pending.timestamp < 10000) {
        await browser.storage.local.remove("lexipath_sidebar_pending_message");
        
        if (pending.isAutoSend) {
          const keywordRaw = typeof pending.keyword === "string" ? pending.keyword : "";
          const keyword = keywordRaw.trim();

          if (keyword) {
            // Same behavior as the storage change listener.
            streamCancelRef.current?.();
            setError(null);
            setIsLoading(false);
            setMessages([]);
            setShowSessions(false);

            const normalizedKeyword = normalizeChatKeyword(keyword);
            const sessionsResponse = await sendMessage("GET_CHAT_SESSIONS", { keyword: normalizedKeyword });
            const sessions = sessionsResponse.ok ? (sessionsResponse.value as ChatSession[]) : [];
            const sessionId =
              sessions[0]?.sessionId ?? makeKeywordSessionId(normalizedKeyword, 1);

            setConversationId(sessionId);
            if (sessions.length > 0) {
              await loadMessages(sessionId);
            }

            await sendChatText(pending.text, { conversationId: sessionId, allowWhileLoading: true });
          } else {
            await sendChatText(pending.text, { allowWhileLoading: true });
          }
        } else {
          setInputValue(pending.text);
        }
      }
    }
    checkPendingMessage();
  }, [loadMessages, sendChatText]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(() => {
    void sendChatText(inputValue);
  }, [inputValue, sendChatText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleClear = useCallback(() => {
    if (messages.length === 0) return;
    if (confirm(t("chatClearConfirm"))) {
      streamCancelRef.current?.();
      setMessages([]);
      setConversationId(undefined);
      setError(null);
      setIsLoading(false);
    }
  }, [messages.length]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <header className="relative flex items-center justify-between px-5 py-4 bg-background border-b border-border overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />
        <div className="flex items-center gap-3">
          {showSessions ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSessions(false)}
              className="h-9 w-9 rounded-xl hover:bg-muted/30"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : (
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 dark:from-primary/6 via-transparent to-transparent opacity-70 dark:opacity-50" />
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="relative">
            <h1 className="text-base font-semibold tracking-tight">
              {showSessions ? t("chatHistory") || "History" : t("chatTitle")}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1 relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNewChat}
            title={t("chatNew") || "New Chat"}
            className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            <PlusCircle className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void loadSessions();
              setShowSessions(!showSessions);
            }}
            title={t("chatHistory") || "History"}
            className={cn(
              "h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30",
              showSessions && "bg-muted/30 text-foreground"
            )}
          >
            <History className="h-4 w-4" />
          </Button>
          {messages.length > 0 && !showSessions && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              aria-label={t("chatClear")}
              title={t("chatClear")}
              className="h-9 w-9 rounded-xl text-muted-foreground hover:text-destructive hover:bg-muted/30"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 relative z-10 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">
          {showSessions ? (
            <motion.div
              key="sessions"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 overflow-hidden flex flex-col"
            >
              <div className="px-4 py-3 border-b border-border bg-muted/15">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("chatSearchPlaceholder") || "Search messages..."}
                    className="pl-10 h-10 rounded-xl text-sm bg-card shadow-sm"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
              <ScrollArea className="flex-1 px-4">
                <div className="flex flex-col gap-2 py-4">
                  {searchQuery.trim() ? (
                    searchResults.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Search className="h-12 w-12 opacity-20 mb-4" />
                        <p className="text-sm font-medium">{t("chatNoSearchResults") || "No results found"}</p>
                      </div>
                    ) : (
                      searchResults.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => {
                            void loadMessages(result.sessionId);
                            setShowSessions(false);
                            setSearchQuery("");
                          }}
                          className="flex flex-col gap-1 p-4 rounded-xl text-left transition-colors border border-border bg-card hover:bg-muted/30 shadow-sm"
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                              {result.role === 'user' ? t('user') || 'User' : t('assistant') || 'AI'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(result.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-sm line-clamp-2 text-muted-foreground">
                            {result.content}
                          </p>
                        </button>
                      ))
                    )
                  ) : (
                    sessions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <MessageSquare className="h-12 w-12 opacity-20 mb-4" />
                        <p className="text-sm font-medium">{t("chatNoHistory") || "No history yet"}</p>
                      </div>
                    ) : (
                      sessions.map((session) => (
                        <button
                          key={session.sessionId}
                          onClick={() => {
                            void loadMessages(session.sessionId);
                            setShowSessions(false);
                          }}
                          className={cn(
                            "flex flex-col gap-1 p-4 rounded-xl text-left transition-colors border border-border shadow-sm",
                            conversationId === session.sessionId
                              ? "bg-muted/30 text-foreground"
                              : "bg-card hover:bg-muted/30"
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="font-medium text-sm truncate max-w-[180px]">
                              {session.keyword || "General Conversation"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(session.lastAccessedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            {session.sessionId.split('-').slice(0, 2).join('-')}
                          </div>
                        </button>
                      ))
                    )
                  )}
                </div>
              </ScrollArea>
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 overflow-hidden flex flex-col"
            >
              <ScrollArea className="flex-1 px-4">
                <div className="flex flex-col gap-6 py-8">
                  <AnimatePresence initial={false}>
                    {messages.length === 0 ? (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex h-[calc(100vh-250px)] flex-col items-center justify-center gap-4 text-center"
                      >
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border bg-card shadow-sm overflow-hidden">
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 dark:from-primary/6 via-transparent to-transparent opacity-70 dark:opacity-50" />
                          <Bot className="h-7 w-7 text-primary" />
                        </div>
                        <div className="space-y-1 max-w-[260px]">
                          <p className="text-base font-semibold">{t("chatEmptyTitle")}</p>
                          <p className="text-sm text-muted-foreground leading-relaxed">{t("chatEmpty")}</p>
                        </div>
                      </motion.div>
                    ) : (
                      messages.map((msg, index) => (
                        <motion.div
                          key={`${msg.timestamp}-${index}`}
                          initial={{ opacity: 0, y: 20, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.3 }}
                          className={cn(
                            "flex gap-4 max-w-[90%]",
                            msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto",
                          )}
                        >
                          <div className={cn(
                            "h-9 w-9 mt-1 rounded-xl flex items-center justify-center shrink-0 border shadow-sm",
                            msg.role === "user" 
                              ? "bg-primary border-primary/50 text-primary-foreground" 
                              : "bg-card border-border"
                          )}>
                            {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 text-primary" />}
                          </div>

                          <div
                            className={cn(
                              "relative rounded-xl px-4 py-3 text-sm leading-relaxed border shadow-sm",
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground border-primary/50 rounded-tr-none"
                                : "bg-card text-foreground border-border rounded-tl-none"
                            )}
                          >
                            {msg.role === "assistant" ? (
                              <MessageContent content={msg.content} isStreaming={Boolean(msg.isStreaming)} />
                            ) : (
                              <div className="whitespace-pre-wrap break-words font-medium">
                                {msg.content}
                              </div>
                            )}
                            <div
                              className={cn(
                                "mt-2 text-xs text-muted-foreground/70",
                                msg.role === "user" ? "text-right" : "text-left",
                              )}
                            >
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mx-4 mb-2 flex items-center gap-2 px-4 py-3 bg-destructive/10 text-destructive text-sm border border-destructive/20 rounded-lg"
                >
                  <AlertCircle className="h-4 w-4" />
                  <p className="font-medium">{error}</p>
                </motion.div>
              )}

              <div className="p-4 border-t border-border bg-muted/15">
                <div className="flex gap-2 rounded-2xl border border-border bg-muted/15 p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/25 focus-within:ring-offset-2 focus-within:ring-offset-background">
                  <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t("chatPlaceholder")}
                    disabled={isLoading}
                    className="flex-1 h-11 rounded-xl border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isLoading}
                    aria-label={t("chatSend")}
                    title={t("chatSend")}
                    className={cn(
                      "h-11 w-11 shrink-0 rounded-xl shadow-sm",
                      !inputValue.trim() && !isLoading && "opacity-50 grayscale",
                    )}
                  >
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
