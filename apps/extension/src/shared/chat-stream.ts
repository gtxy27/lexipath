import browser from "webextension-polyfill";
import type { ChatPayload } from "@lexipath/core";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "./messages";

export type ChatStreamClientEvent =
  | { type: "CHUNK"; delta: string }
  | { type: "THINKING"; delta: string }
  | { type: "DONE"; reply: string; conversationId: string; thinking?: string }
  | { type: "ERROR"; error: { code: string; message: string } };

export type ChatStreamServerMessage = { type: "START"; payload: ChatPayload };

const CHAT_STREAM_PORT_NAME = "LEXIPATH_CHAT_STREAM";
const log = createLogger("shared:chat-stream");

export function chatStream(
  payload: ChatPayload,
  handlers: {
    onChunk: (delta: string) => void;
    onThinking?: (delta: string) => void;
    onDone: (result: { reply: string; conversationId: string; thinking?: string }) => void;
    onError: (error: { code: string; message: string }) => void;
  }
): { cancel: () => void } {
  const connect = browser.runtime?.connect;
  if (typeof connect !== "function") {
    let cancelled = false;
    void (async () => {
      try {
        const response = await sendMessage("CHAT", {
          message: payload.message,
          ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
          ...(payload.backgroundInfo ? { backgroundInfo: payload.backgroundInfo } : {}),
        });
        if (cancelled) return;
        if (!response.ok) {
          handlers.onError(response.error);
          return;
        }
        handlers.onDone({
          reply: response.value.reply,
          conversationId: response.value.conversationId,
          ...(typeof response.value.thinking === "string" ? { thinking: response.value.thinking } : {}),
        });
      } catch (error) {
        log.error("CHAT fallback request failed", { message: getErrorMessage(error) });
        if (cancelled) return;
        handlers.onError({
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "error_unknown",
        });
      }
    })();

    return { cancel: () => { cancelled = true; } };
  }

  const port = connect.call(browser.runtime, { name: CHAT_STREAM_PORT_NAME });
  let finished = false;
  let cancelled = false;

  const handleMessage = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as Record<string, unknown>;
    if (msg.type === "CHUNK" && typeof msg.delta === "string") {
      handlers.onChunk(msg.delta);
      return;
    }
    if (msg.type === "THINKING" && typeof msg.delta === "string") {
      handlers.onThinking?.(msg.delta);
      return;
    }
    if (
      msg.type === "DONE" &&
      typeof msg.reply === "string" &&
      typeof msg.conversationId === "string"
    ) {
      finished = true;
      handlers.onDone({
        reply: msg.reply,
        conversationId: msg.conversationId,
        ...(typeof msg.thinking === "string" ? { thinking: msg.thinking } : {}),
      });
      return;
    }
    if (
      msg.type === "ERROR" &&
      msg.error &&
      typeof msg.error === "object" &&
      typeof (msg.error as Record<string, unknown>).code === "string" &&
      typeof (msg.error as Record<string, unknown>).message === "string"
    ) {
      finished = true;
      const error = msg.error as Record<string, unknown>;
      handlers.onError({ code: String(error.code), message: String(error.message) });
      return;
    }
  };

  const handleDisconnect = () => {
    // If the background disconnects unexpectedly, treat it as an error unless DONE already fired.
    if (finished || cancelled) return;
    handlers.onError({ code: "DISCONNECTED", message: "Stream disconnected" });
  };

  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(handleDisconnect);

  port.postMessage({ type: "START", payload } satisfies ChatStreamServerMessage);

  return {
    cancel: () => {
      cancelled = true;
      try {
        port.onMessage.removeListener(handleMessage);
        port.onDisconnect.removeListener(handleDisconnect);
      } catch (error: unknown) {
        log.debug("Failed to remove chat stream listeners; ignoring", { message: getErrorMessage(error) });
      }
      try {
        port.disconnect();
      } catch (error: unknown) {
        log.debug("Failed to disconnect chat stream port; ignoring", { message: getErrorMessage(error) });
      }
    },
  };
}
