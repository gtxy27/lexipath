import React, { useCallback, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import type { ChatResponse, Theme } from "@lexipath/core";
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

function t(key: string): string {
  return browser.i18n.getMessage(key) || key;
}

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
      } catch {
        // Ignore
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
    <div className="flex h-screen flex-col bg-white dark:bg-[#0d0e14] text-gray-900 dark:text-white overflow-hidden relative transition-colors duration-500">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-5%] left-[-5%] w-64 h-64 bg-indigo-600/5 dark:bg-indigo-600/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 -right-10 w-80 h-80 bg-purple-600/5 dark:bg-purple-600/10 rounded-full blur-[120px]" />
      </div>

      <header className="relative z-20 flex items-center justify-between px-5 py-4 bg-white/80 dark:bg-[#0d0e14]/50 backdrop-blur-xl border-b border-gray-100 dark:border-white/5 shadow-sm">
        <div className="flex items-center gap-3">
          {showSessions ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSessions(false)}
              className="h-9 w-9 rounded-lg"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : (
            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-premium p-[1px] shadow-lg shadow-indigo-500/10"
            >
              <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-white dark:bg-[#0d0e14]">
                <Sparkles className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
              </div>
            </motion.div>
          )}
          <div>
            <h1 className="font-black text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-white/70">
              {showSessions ? t("chatHistory") || "History" : t("chatTitle")}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNewChat}
            title={t("chatNew") || "New Chat"}
            className="h-9 w-9 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-white/5 rounded-lg transition-colors"
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
              "h-9 w-9 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-white/5 rounded-lg transition-colors",
              showSessions && "text-indigo-500 bg-indigo-50 dark:bg-white/5"
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
              className="h-9 w-9 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-white/5 rounded-lg transition-colors"
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
              <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("chatSearchPlaceholder") || "Search messages..."}
                    className="pl-10 h-10 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5 rounded-xl text-sm"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                  )}
                </div>
              </div>
              <ScrollArea className="flex-1 px-4">
                <div className="flex flex-col gap-2 py-4">
                  {searchQuery.trim() ? (
                    searchResults.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
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
                          className="flex flex-col gap-1 p-4 rounded-2xl text-left transition-all border bg-white dark:bg-white/5 border-gray-100 dark:border-white/5 hover:border-indigo-200 dark:hover:border-indigo-500/20"
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <Badge className="bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-500/20 text-[10px]">
                              {result.role === 'user' ? t('user') || 'User' : t('assistant') || 'AI'}
                            </Badge>
                            <span className="text-[10px] text-gray-400">
                              {new Date(result.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-sm line-clamp-2 text-gray-600 dark:text-gray-300">
                            {result.content}
                          </p>
                        </button>
                      ))
                    )
                  ) : (
                    sessions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
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
                            "flex flex-col gap-1 p-4 rounded-2xl text-left transition-all border",
                            conversationId === session.sessionId
                              ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/20"
                              : "bg-white dark:bg-white/5 border-gray-100 dark:border-white/5 hover:border-indigo-200 dark:hover:border-indigo-500/20"
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="font-bold text-sm truncate max-w-[180px]">
                              {session.keyword || "General Conversation"}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(session.lastAccessedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="text-[10px] uppercase tracking-widest font-black opacity-40">
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
                        className="flex h-[calc(100vh-250px)] flex-col items-center justify-center gap-6 text-center"
                      >
                        <div className="relative">
                           <div className="absolute -inset-4 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 blur-xl animate-pulse" />
                           <div className="relative p-6 rounded-3xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 glass-card shadow-inner">
                              <Bot className="h-16 w-16 text-indigo-500 dark:text-indigo-400" />
                           </div>
                        </div>
                        <div className="space-y-2 max-w-[240px]">
                          <p className="text-xl font-black text-gray-900 dark:text-white tracking-tight">
                            {t("chatEmptyTitle")}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                            {t("chatEmpty")}
                          </p>
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
                            "h-8 w-8 mt-1 rounded-lg flex items-center justify-center shrink-0 border shadow-sm transition-all",
                            msg.role === "user" 
                              ? "bg-indigo-600 border-indigo-500 text-white" 
                              : "bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10"
                          )}>
                            {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />}
                          </div>

                          <div
                            className={cn(
                              "relative rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg transition-all",
                              msg.role === "user"
                                ? "bg-indigo-600 text-white rounded-tr-none shadow-indigo-600/10"
                                : "bg-white dark:bg-white/5 glass-card text-gray-800 dark:text-gray-200 rounded-tl-none border border-gray-100 dark:border-white/5"
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
                                "text-[10px] mt-2 font-black uppercase tracking-widest opacity-40",
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
                  className="mx-4 mb-2 flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-red-500/10 text-rose-600 dark:text-red-400 text-xs border border-rose-100 dark:border-red-500/20 rounded-xl backdrop-blur-lg relative z-10 shadow-sm"
                >
                  <AlertCircle className="h-4 w-4" />
                  <p className="font-bold uppercase tracking-wider">{error}</p>
                </motion.div>
              )}

              <div className="p-5 border-t border-gray-100 dark:border-white/5 bg-white/80 dark:bg-[#0d0e14]/80 backdrop-blur-xl relative z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
                <div className="relative group">
                  <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 blur opacity-75 group-focus-within:opacity-100 transition duration-300 pointer-events-none" />
                  <div className="relative flex gap-2">
                    <Input
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t("chatPlaceholder")}
                      disabled={isLoading}
                      className="flex-1 h-12 bg-gray-50 dark:bg-[#1a1b23] border-gray-200 dark:border-white/5 focus-visible:ring-indigo-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 rounded-xl transition-all font-medium"
                    />
                    <Button
                      onClick={handleSend}
                      disabled={!inputValue.trim() || isLoading}
                      aria-label={t("chatSend")}
                      title={t("chatSend")}
                      className={cn(
                        "h-12 w-12 shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-600/10 transition-all",
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
