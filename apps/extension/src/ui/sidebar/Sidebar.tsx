import React, { useCallback, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { sendMessage } from "../../shared/messages";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Send, Trash2, Bot, User, Loader2, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";

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
        setMessages((prev) => prev.slice(0, -1));
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : browser.i18n.getMessage("error_unknown") || "error_unknown",
      );
      setMessages((prev) => prev.slice(0, -1));
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
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3.5 bg-white">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-9 w-9">
            <AvatarImage src="../../icons/icon.svg" />
            <AvatarFallback className="bg-indigo-600 text-white font-bold">
              LP
            </AvatarFallback>
          </Avatar>
          <h1 className="font-bold text-base text-gray-900">
            {browser.i18n.getMessage("chatTitle")}
          </h1>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            title={browser.i18n.getMessage("chatClear")}
            className="h-9 w-9 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="flex h-[calc(100vh-140px)] flex-col items-center justify-center gap-3 text-center text-gray-500">
            <div className="p-4 rounded-full bg-gray-100">
              <Bot className="h-12 w-12 text-gray-400" />
            </div>
            <p className="text-sm">{browser.i18n.getMessage("chatEmpty")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-4">
            {messages.map((msg, index) => (
              <div
                key={`${msg.timestamp}-${index}`}
                className={cn(
                  "flex gap-3 max-w-[85%]",
                  msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto",
                )}
              >
                <Avatar
                  className={cn(
                    "h-8 w-8 mt-1 flex-shrink-0",
                    msg.role === "user" ? "bg-indigo-600" : "bg-gray-200",
                  )}
                >
                  <AvatarFallback
                    className={
                      msg.role === "user"
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-200 text-gray-600"
                    }
                  >
                    {msg.role === "user" ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </AvatarFallback>
                </Avatar>

                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm",
                    msg.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-800 border border-gray-200",
                  )}
                >
                  <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.content}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] mt-1.5",
                      msg.role === "user" ? "text-white/70" : "text-gray-400",
                    )}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3 mr-auto max-w-[85%]">
                <Avatar className="h-8 w-8 mt-1 bg-gray-200">
                  <AvatarFallback className="bg-gray-200 text-gray-600">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="rounded-2xl px-4 py-3.5 bg-white border border-gray-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-xs border-t border-red-200">
          <AlertCircle className="h-4 w-4" />
          <p>{error}</p>
        </div>
      )}

      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={browser.i18n.getMessage("chatPlaceholder")}
            disabled={isLoading}
            className="flex-1 border-gray-300 focus-visible:ring-gray-400"
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
            className={cn(
              "shrink-0 bg-indigo-600 hover:bg-indigo-700",
              !inputValue.trim() && !isLoading && "opacity-50",
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
