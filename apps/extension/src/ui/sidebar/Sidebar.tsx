import React, { useCallback, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { sendMessage } from "../../shared/messages";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Send, Trash2, Bot, User, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";

function t(key: string): string {
  return browser.i18n.getMessage(key) || key;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function Sidebar(): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const message = inputValue.trim();
    if (!message || isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: message,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessage("CHAT", {
        message,
        conversationId,
      });

      if (response.ok) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: response.value.reply,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setConversationId(response.value.conversationId);
      } else {
        setError(response.error.message);
        // We don't remove user message here to allow retry or reference
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : browser.i18n.getMessage("error_unknown") || "error_unknown",
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [inputValue, isLoading, conversationId]);

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
    if (confirm(browser.i18n.getMessage("chatClearConfirm"))) {
      setMessages([]);
      setConversationId(undefined);
      setError(null);
    }
  }, [messages.length]);

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-[#0d0e14] text-gray-900 dark:text-white overflow-hidden relative transition-colors duration-500">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-5%] left-[-5%] w-64 h-64 bg-indigo-600/5 dark:bg-indigo-600/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 -right-10 w-80 h-80 bg-purple-600/5 dark:bg-purple-600/10 rounded-full blur-[120px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 py-4 bg-white/80 dark:bg-[#0d0e14]/50 backdrop-blur-xl border-b border-gray-100 dark:border-white/5 shadow-sm">
        <div className="flex items-center gap-3">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-premium p-[1px] shadow-lg shadow-indigo-500/10"
          >
            <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-white dark:bg-[#0d0e14]">
              <Sparkles className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
            </div>
          </motion.div>
          <div>
            <h1 className="font-black text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-white/70">
              {browser.i18n.getMessage("chatTitle") || "Lexi Assistant"}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Online</span>
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="h-9 w-9 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-white/5 rounded-lg transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1 px-4 relative z-10">
        <div className="flex flex-col gap-6 py-8">
          <AnimatePresence initial={false}>
            {messages.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex h-[calc(100vh-200px)] flex-col items-center justify-center gap-6 text-center"
              >
                <div className="relative">
                   <div className="absolute -inset-4 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 blur-xl animate-pulse" />
                   <div className="relative p-6 rounded-3xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 glass-card shadow-inner">
                      <Bot className="h-16 w-16 text-indigo-500 dark:text-indigo-400" />
                   </div>
                </div>
                <div className="space-y-2 max-w-[240px]">
                  <p className="text-xl font-black text-gray-900 dark:text-white tracking-tight">How can I help you learn?</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest leading-relaxed">{browser.i18n.getMessage("chatEmpty") || "Ask me anything about the content you're reading."}</p>
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
                    <div className="whitespace-pre-wrap break-words font-medium">
                      {msg.content}
                    </div>
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
            {isLoading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4 mr-auto max-w-[90%]"
              >
                <div className="h-8 w-8 mt-1 rounded-lg flex items-center justify-center shrink-0 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 shadow-sm">
                   <Bot className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                </div>
                <div className="bg-white dark:bg-white/5 glass-card rounded-2xl rounded-tl-none border border-gray-100 dark:border-white/5 px-4 py-4 flex items-center gap-1.5 shadow-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"></span>
                </div>
              </motion.div>
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
              placeholder={browser.i18n.getMessage("chatPlaceholder") || "Type a message..."}
              disabled={isLoading}
              className="flex-1 h-12 bg-gray-50 dark:bg-[#1a1b23] border-gray-200 dark:border-white/5 focus-visible:ring-indigo-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 rounded-xl transition-all font-medium"
            />
            <Button
              onClick={handleSend}
              disabled={!inputValue.trim() || isLoading}
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
    </div>
  );
}
