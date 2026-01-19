import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import type { ChatResponse, ChatSessionKind, Theme, WordbookEntry } from "@lexipath/core";
import {
  makeWordbookEntryId,
  normalizeWordbookLanguage,
  normalizeWordbookTerm,
} from "@lexipath/core";

import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { chatStream } from "../../shared/chat-stream";
import { makeKeywordSessionId, normalizeChatKeyword } from "../../shared/chat-session-id";
import { MessageContent } from "./MessageContent";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../components/ui/popover";

import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import {
  Archive,
  ArrowDown,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  Eye,
  EyeOff,
  History,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  SquareStop,
  Trash2,
  User,
  Bot,
  AlertCircle,
  BookmarkPlus,
  PlusCircle,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useApplyTheme } from "../lib/theme";
import { useToast } from "../components/ui/use-toast";
import { t } from "../../shared/i18n";



import type {
  ChatMessage,
  ChatSession,
  ChatSessionMessagesSearchResult,
  SidebarContextInfo,
  SidebarContextSelection,
  WebContextInfo,
} from "./types";
import { DEFAULT_CONTEXT_SELECTION } from "./types";
import { buildChatBackgroundInfo, formatTimestampLabel } from "./context";
import { parsePendingSidebarMessage } from "./pending";

import { useAutoResizeTextarea } from "./hooks/useAutoResizeTextarea";
import { useScrollAtBottom } from "./hooks/useScrollAtBottom";
import { useDebouncedSearch } from "./hooks/useDebouncedSearch";

const log = createLogger("ui:sidebar");

const SAVED_TERMS_STORAGE_KEY = "lexipath_saved_terms";

function normalizeSavedTerm(term: string): string {
  return term.trim().toLowerCase();
}

function makeRandomChatSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}


export function Sidebar(): React.ReactElement {
  const { toast } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [inputValue, setInputValue] = useState("");
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activePanel, setActivePanel] = useState<"chat" | "history" | "wordbook">("chat");
  const [historyTab, setHistoryTab] = useState<"sessions" | "terms">("sessions");
  const [wordbookQuery, setWordbookQuery] = useState("");
  const [wordbookStateFilter, setWordbookStateFilter] = useState<"all" | "active" | "archived" | "ignored">("all");
  const [wordbookSort, setWordbookSort] = useState<"updated_desc" | "term_asc">("updated_desc");
  const [wordbookEntries, setWordbookEntries] = useState<WordbookEntry[]>([]);
  const [wordbookSelectedId, setWordbookSelectedId] = useState<string | null>(null);
  const [wordbookSelectedIds, setWordbookSelectedIds] = useState<Set<string>>(() => new Set());

  type WordbookExplainState = {
    status: "idle" | "loading" | "loaded" | "error";
    data?: {
      word: string;
      phonetic?: string;
      definition: string;
      targets?: string[];
      difficulty?: string;
    };
  };
  const [wordbookExplainById, setWordbookExplainById] = useState<Record<string, WordbookExplainState>>(
    {},
  );
  const wordbookExplainByIdRef = useRef<Record<string, WordbookExplainState>>({});
  useEffect(() => {
    wordbookExplainByIdRef.current = wordbookExplainById;
  }, [wordbookExplainById]);

  const [wordbookDraftNote, setWordbookDraftNote] = useState("");
  const [wordbookBulkMode, setWordbookBulkMode] = useState(false);
  const [wordbookDraftTags, setWordbookDraftTags] = useState<string[]>([]);
  const [wordbookDraftTagInput, setWordbookDraftTagInput] = useState("");
  const [wordbookDraftState, setWordbookDraftState] = useState<WordbookEntry["state"]>("active");

  const [wordbookAddOpen, setWordbookAddOpen] = useState(false);
  const [wordbookAddTerm, setWordbookAddTerm] = useState("");
  const [wordbookAddLanguage, setWordbookAddLanguage] = useState("en");
  const [wordbookAddStatus, setWordbookAddStatus] = useState<"idle" | "saving">(
    "idle",
  );

  const [wordbookLastSavedAt, setWordbookLastSavedAt] = useState<number | null>(null);
  const [wordbookSaveStatus, setWordbookSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">(
    "idle",
  );
  const wordbookSaveErrorRef = useRef<string>("");

  const [isWordbookLoading, setIsWordbookLoading] = useState(false);

  const fetchWordbookDefinition = useCallback(
    async (entry: Pick<WordbookEntry, "id" | "term" | "language">, options?: { force?: boolean }) => {
      const term = String(entry.term ?? "").trim();
      if (!term) return;

      const cached = wordbookExplainByIdRef.current[entry.id];
      if (!options?.force && (cached?.status === "loading" || cached?.status === "loaded")) return;

      setWordbookExplainById((prev) => ({
        ...prev,
        [entry.id]: { status: "loading", ...(prev[entry.id]?.data ? { data: prev[entry.id]!.data } : {}) },
      }));

      try {
        const response = await sendMessage("EXPLAIN_WORD", { word: term, sourceLang: entry.language });
        if (!response.ok) {
          setWordbookExplainById((prev) => ({
            ...prev,
            [entry.id]: { status: "error", data: { word: term, definition: t("wordCard_definitionFailed") } },
          }));
          return;
        }

        const value = response.value as unknown;
        if (!value || typeof value !== 'object') {
          throw new Error('EXPLAIN_WORD returned non-object value');
        }
        const v = value as Record<string, unknown>;

        const rawDefinition = typeof v.definition === 'string' ? v.definition : '';
        const targets = Array.isArray(v.targets)
          ? v.targets.filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
          : [];
        const definition = rawDefinition.trim()
          ? rawDefinition.trim()
          : targets.length > 0
            ? targets[0]!
            : t('wordCard_definitionUnavailable');
        const word = typeof v.word === 'string' && v.word.trim() ? v.word : term;

        setWordbookExplainById((prev) => ({
          ...prev,
          [entry.id]: {
            status: 'loaded',
            data: {
              word,
              ...(typeof v.phonetic === 'string' && v.phonetic.trim() ? { phonetic: v.phonetic } : {}),
              definition,
              ...(targets.length > 0 ? { targets } : {}),
              ...(typeof v.difficulty === 'string' && v.difficulty.trim() ? { difficulty: v.difficulty } : {}),
            },
          },
        }));

      } catch {
        setWordbookExplainById((prev) => ({
          ...prev,
          [entry.id]: { status: "error", data: { word: term, definition: t("wordCard_definitionError") } },
        }));
      }
    },
    [],
  );


  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const checkNarrow = () => {
      try {
        setIsNarrow(window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768);
      } catch {
        setIsNarrow(false);
      }
    };
    checkNarrow();
    window.addEventListener("resize", checkNarrow);
    return () => window.removeEventListener("resize", checkNarrow);
  }, []);

  useEffect(() => {
    if (activePanel !== "wordbook") return;
    if (!wordbookSelectedId) return;
    const entry = wordbookEntries.find((e) => e.id === wordbookSelectedId) ?? null;
    if (!entry) return;
    void fetchWordbookDefinition(entry);
  }, [activePanel, fetchWordbookDefinition, wordbookEntries, wordbookSelectedId]);

  const [sessionKindFilter, setSessionKindFilter] = useState<"all" | ChatSession["kind"]>("all");
  // Selected keyword filter (normalized). Keeps matching stable across casing/whitespace.
  const [keywordFilterKey, setKeywordFilterKey] = useState<string | null>(null);
  const [keywordFilterQuery, setKeywordFilterQuery] = useState("");
  const [isKeywordPickerOpen, setIsKeywordPickerOpen] = useState(false);
  const keywordPickerAnchorRef = useRef<HTMLDivElement | null>(null);


  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSessionMessagesSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [savedTerms, setSavedTerms] = useState<string[]>([]);


  const [expandedThinkingById, setExpandedThinkingById] = useState<Record<string, boolean>>({});

  const [contextBySessionId, setContextBySessionId] = useState<Record<string, SidebarContextInfo | null>>({});
  const [contextSelectionBySessionId, setContextSelectionBySessionId] = useState<Record<string, SidebarContextSelection>>({});
  const [draftContextInfo, setDraftContextInfo] = useState<SidebarContextInfo | null>(null);
  const [draftContextSelection, setDraftContextSelection] = useState<SidebarContextSelection>(DEFAULT_CONTEXT_SELECTION);

  // While switching sessions (or before contextBySessionId is populated), fall back to the draft
  // context so the chips don't flicker/disappear.
  const activeContextInfo = conversationId ? (contextBySessionId[conversationId] ?? draftContextInfo) : draftContextInfo;
  const getDefaultSelectionForContext = useCallback(
    (context: SidebarContextInfo | null): SidebarContextSelection => {
      if (context?.kind === "web") {
        return { title: true, timestamp: false, snippet: true };
      }
      return DEFAULT_CONTEXT_SELECTION;
    },
    [],
  );

  const hydrateContextFromSession = useCallback(
    (session: ChatSession) => {
      const sessionId = session.sessionId;
      if (!sessionId) return;

      const label = typeof session.label === "string" ? session.label.trim() : "";
      if (!label) return;

      if (session.kind === "web") {
        const parts = label.split(" · ").map((p) => p.trim()).filter(Boolean);
        const domain = parts.length >= 2 ? parts[parts.length - 1] : "";
        const title = parts.length >= 2 ? parts.slice(0, -1).join(" · ") : label;
        const context: SidebarContextInfo = {
          kind: "web",
          source: "study",
          ...(title ? { title } : {}),
          ...(domain ? { domain } : {}),
        };

        setContextBySessionId((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: context }));
        setContextSelectionBySessionId((prev) =>
          prev[sessionId] ? prev : { ...prev, [sessionId]: getDefaultSelectionForContext(context) },
        );
        return;
      }

      if (session.kind === "subtitle") {
        const parts = label.split(" · ").map((p) => p.trim()).filter(Boolean);
        const platform = parts.length >= 2 ? parts[parts.length - 1] : "";
        const title = parts.length >= 2 ? parts.slice(0, -1).join(" · ") : label;
        const context: SidebarContextInfo = {
          kind: "subtitle",
          ...(title ? { title } : {}),
          ...(platform ? { platform } : {}),
        };

        setContextBySessionId((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: context }));
        setContextSelectionBySessionId((prev) =>
          prev[sessionId] ? prev : { ...prev, [sessionId]: getDefaultSelectionForContext(context) },
        );
      }
    },
    [getDefaultSelectionForContext],
  );

  const activeContextSelection = conversationId
    ? (contextSelectionBySessionId[conversationId] ?? getDefaultSelectionForContext(activeContextInfo ?? null))
    : draftContextSelection;
  // Keep UI simple and stable: any active UI stream counts as "loading".
  // Session switching explicitly detaches the stream, so this won't leak across sessions.
  const isLoading = Boolean(loadingSessionId);
  
  useDebouncedSearch({
    query: activePanel === "history" && historyTab === "terms" ? searchQuery : "",
    delayMs: 300,
    search: async (query) => {
      const response = await sendMessage("SEARCH_MESSAGES", { query });
      return response.ok ? response.value : [];
    },
    onStart: () => setIsSearching(true),
    onResult: (result) => setSearchResults(result),
    onDone: () => setIsSearching(false),
  });

  useDebouncedSearch({
    query: activePanel === "wordbook" ? wordbookQuery : "",
    delayMs: 250,
    search: async (query) => {
      const response = await sendMessage("WORDBOOK_LIST", {
        query,
        state: wordbookStateFilter,
        sort: wordbookSort,
        limit: 500,
      });
      return response.ok ? (response.value as WordbookEntry[]) : [];
    },
    onStart: () => setIsWordbookLoading(true),
    onResult: (result) => setWordbookEntries(result),
    onDone: () => setIsWordbookLoading(false),
  });


  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const isAtBottom = useScrollAtBottom({ viewportRef: scrollViewportRef, disabled: activePanel !== "chat" });

  const inputRef = useRef<HTMLTextAreaElement>(null);



  const streamCancelRef = useRef<null | (() => void)>(null);
  const forceNewSessionNextSendRef = useRef(false);

  // Tracks whether the UI currently has an active stream attached.
  // We use a ref (not state) to avoid async race conditions where history loads
  // can clobber in-flight stream UI before React state updates apply.
  const uiStreamActiveRef = useRef(false);
  const historyLoadTokenRef = useRef(0);
  const pendingProcessTokenRef = useRef(0);
  const pendingHandledKeyRef = useRef("");

  useApplyTheme(theme);

  useEffect(() => {
    void (async () => {
      try {
        const data = await browser.storage.local.get(SAVED_TERMS_STORAGE_KEY);
        const raw = (data as Record<string, unknown>)[SAVED_TERMS_STORAGE_KEY];
        const terms = Array.isArray(raw)
          ? raw
              .filter((t) => typeof t === "string")
              .map((t) => normalizeSavedTerm(t))
              .filter(Boolean)
          : [];
        setSavedTerms(Array.from(new Set(terms)));
      } catch {
        setSavedTerms([]);
      }
    })();
  }, []);

  const persistSavedTerms = useCallback(async (next: string[]) => {
    const normalized = next.map((t) => normalizeSavedTerm(t)).filter(Boolean);
    const unique = Array.from(new Set(normalized));
    setSavedTerms(unique);
    try {
      await browser.storage.local.set({ [SAVED_TERMS_STORAGE_KEY]: unique });
    } catch {
      // ignore
    }
  }, []);

  const addSavedTerm = useCallback(
    async (term: string) => {
      const normalized = normalizeSavedTerm(term);
      if (!normalized) return;
      if (savedTerms.includes(normalized)) return;
      await persistSavedTerms([normalized, ...savedTerms]);
    },
    [persistSavedTerms, savedTerms],
  );

  const normalizeWordbookTag = (tag: string) => tag.trim().toLowerCase();

  const applyWordbookTag = useCallback(() => {
    const raw = wordbookDraftTagInput.trim();
    if (!raw) return;
    const clipped = raw.length > 30 ? raw.slice(0, 30) : raw;
    const normalized = normalizeWordbookTag(clipped);
    const existing = new Set(wordbookDraftTags.map((t) => normalizeWordbookTag(t)));
    if (existing.has(normalized)) {
      setWordbookDraftTagInput("");
      return;
    }
    setWordbookDraftTags((prev) => [...prev, clipped]);
    setWordbookDraftTagInput("");
    setWordbookSaveStatus("dirty");
  }, [wordbookDraftTagInput, wordbookDraftTags]);


  const removeSavedTerm = useCallback(
    async (term: string) => {
      const normalized = normalizeSavedTerm(term);
      if (!normalized) return;
      await persistSavedTerms(savedTerms.filter((t) => t !== normalized));
    },
    [persistSavedTerms, savedTerms],
  );

  useEffect(() => {
    return () => {
      streamCancelRef.current?.();
    };
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await sendMessage("GET_CHAT_SESSIONS", {});
    if (response.ok) {
      setSessions(response.value);
    }
  }, []);

  const loadWordbook = useCallback(
    async (options?: { allowWhileLoading?: boolean }) => {
      const allowWhileLoading = options?.allowWhileLoading ?? false;
      if (isWordbookLoading && !allowWhileLoading) return;

      setIsWordbookLoading(true);
      try {
        const response = await sendMessage("WORDBOOK_LIST", {
          query: wordbookQuery,
          state: wordbookStateFilter,
          sort: wordbookSort,
          limit: 500,
        });
        if (response.ok) {
          const next = response.value as WordbookEntry[];
          setWordbookEntries(next);
          // Drop any selected ids that no longer exist after reload/filter.
          setWordbookSelectedIds((prev) => {
            if (prev.size === 0) return prev;
            const allowed = new Set(next.map((e) => e.id));
            const filtered = new Set<string>();
            prev.forEach((id) => {
              if (allowed.has(id)) filtered.add(id);
            });
            return filtered;
          });
        } else {
          setWordbookEntries([]);
          setWordbookSelectedIds(new Set());
        }
      } finally {
        setIsWordbookLoading(false);
      }
    },
    [isWordbookLoading, wordbookQuery, wordbookSort, wordbookStateFilter],
  );

  const selectWordbookEntry = useCallback((entry: WordbookEntry) => {
    setWordbookSelectedId(entry.id);
    setWordbookDraftNote(entry.note ?? "");
    setWordbookDraftTags(Array.isArray(entry.tags) ? entry.tags : []);
    setWordbookDraftTagInput("");
    setWordbookDraftState(entry.state);
    setWordbookSaveStatus("idle");
    setWordbookLastSavedAt(entry.updatedAt ?? null);
  }, []);

  const wordbookStateLabel = useCallback((state: WordbookEntry["state"]) => {
    switch (state) {
      case "active":
        return t("wordbookStateActive");
      case "archived":
        return t("wordbookStateArchived");
      case "ignored":
        return t("wordbookStateIgnored");
      default:
        return String(state);
    }
  }, []);

  const wordbookStateBadgeClassName = useCallback(
    (state: WordbookEntry["state"]) => {
      switch (state) {
        case "active":
          return "border-emerald-200/60 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300";
        case "archived":
          return "border-slate-200/60 bg-slate-50/60 text-slate-700 dark:border-slate-800/60 dark:bg-slate-950/20 dark:text-slate-300";
        case "ignored":
          return "border-amber-200/60 bg-amber-50/60 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300";
        default:
          return "border-border bg-muted text-muted-foreground";
      }
    },
    [],
  );

  const handleWordbookAdd = useCallback(async () => {
    if (wordbookAddStatus !== "idle") return;

    const normalizedTerm = normalizeWordbookTerm(wordbookAddTerm);
    if (!normalizedTerm) {
      toast({ title: t("wordbookAddMissing"), variant: "destructive" });
      return;
    }

    const language = normalizeWordbookLanguage(wordbookAddLanguage);
    const id = makeWordbookEntryId(language as any, normalizedTerm);

    setWordbookAddStatus("saving");
    try {
      const existing = await sendMessage("WORDBOOK_GET", { id } as any);
      if (existing.ok && existing.value) {
        const entry = existing.value as unknown as WordbookEntry;
        selectWordbookEntry(entry);
        toast({ title: t("wordbookAddExists") });
        setWordbookAddOpen(false);
        setWordbookAddTerm("");
        return;
      }

      const now = Date.now();
      const entry = {
        id,
        language,
        term: wordbookAddTerm.trim(),
        normalizedTerm,
        state: "active",
        tags: [],
        note: "",
        sources: [],
        createdAt: now,
        updatedAt: now,
      };

      const upserted = await sendMessage("WORDBOOK_UPSERT", { entry } as any);
      if (!upserted.ok) {
        toast({
          title: t("wordbookAddError", upserted.error.message),
          variant: "destructive",
        });
        return;
      }

      const saved = upserted.value as unknown as WordbookEntry;
      selectWordbookEntry(saved);
      toast({ title: t("wordbookAddSuccess") });
      setWordbookAddOpen(false);
      setWordbookAddTerm("");

      void loadWordbook({ allowWhileLoading: true });
    } finally {
      setWordbookAddStatus("idle");
    }
  }, [
    loadWordbook,
    selectWordbookEntry,
    toast,
    wordbookAddLanguage,
    wordbookAddStatus,
    wordbookAddTerm,
  ]);

  const handleWordbookBulkState = useCallback(
    async (state: "archived" | "ignored") => {
      if (wordbookSelectedIds.size === 0) return;

      const ids = Array.from(wordbookSelectedIds);
      const response = await sendMessage("WORDBOOK_BULK_SET_STATE", { ids, state } as any);
      if (!response.ok) {
        toast({ title: response.error.message, variant: "destructive" });
        return;
      }

      toast({ title: t("wordbookBulkDone") });
      setWordbookSelectedIds(new Set());
      void loadWordbook({ allowWhileLoading: true });
    },
    [loadWordbook, toast, wordbookSelectedIds],
  );

  const handleWordbookBulkRemove = useCallback(
    async () => {
      if (wordbookSelectedIds.size === 0) return;

      const ids = Array.from(wordbookSelectedIds);
      const ok = window.confirm(t("wordbookConfirmRemove", [String(ids.length)]));
      if (!ok) return;

      // No dedicated bulk-delete message; do a conservative sequential delete.
      for (const id of ids) {
        const resp = await sendMessage("WORDBOOK_DELETE", { id } as any);
        if (!resp.ok) {
          toast({ title: resp.error.message, variant: "destructive" });
          return;
        }
      }

      toast({ title: t("wordbookBulkDone") });
      setWordbookSelectedIds(new Set());
      void loadWordbook({ allowWhileLoading: true });
    },
    [loadWordbook, toast, wordbookSelectedIds],
  );

  const saveWordbookEdits = useCallback(
    async (options?: { source?: "manual" | "autosave" }) => {
      const source = options?.source ?? "manual";

      if (wordbookDraftTagInput.trim()) {
        applyWordbookTag();
        return;
      }

      const entry = wordbookEntries.find((e) => e.id === wordbookSelectedId) ?? null;
      if (!entry) return;

      const nextTags = Array.from(
        new Map(
          wordbookDraftTags
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => [normalizeWordbookTag(t), t.length > 30 ? t.slice(0, 30) : t] as const),
        ).values(),
      );

      const nextNote = (wordbookDraftNote ?? "").slice(0, 2000);
      const nextState = wordbookDraftState;

      const isDirty =
        nextNote !== (entry.note ?? "") ||
        nextState !== entry.state ||
        JSON.stringify(nextTags) !== JSON.stringify(entry.tags ?? []);

      if (!isDirty && source !== "manual") return;

      setWordbookSaveStatus("saving");
      wordbookSaveErrorRef.current = "";

      const updated: WordbookEntry = {
        ...entry,
        note: nextNote,
        tags: nextTags,
        state: nextState,
        updatedAt: Date.now(),
      };

      const resp = await sendMessage("WORDBOOK_UPSERT", { entry: updated });
      if (!resp.ok) {
        wordbookSaveErrorRef.current = resp.error.message;
        setWordbookSaveStatus("error");
        return;
      }

      setWordbookEntries((prev) => prev.map((e) => (e.id === resp.value.id ? resp.value : e)));
      setWordbookLastSavedAt(resp.value.updatedAt);
      setWordbookSaveStatus("saved");

      // Refresh ordering (e.g., updated_desc) while keeping the UI responsive.
      void loadWordbook({ allowWhileLoading: true });

      window.setTimeout(() => {
        setWordbookSaveStatus((current) => (current === "saved" ? "idle" : current));
      }, 1500);
    },
    [
      applyWordbookTag,
      loadWordbook,
      wordbookDraftNote,
      wordbookDraftState,
      wordbookDraftTagInput,
      wordbookDraftTags,
      wordbookEntries,
      wordbookSelectedId,
    ],
  );

  useEffect(() => {
    if (activePanel !== "wordbook") return;

    // Ensure we have something to show when query is empty (debounced search no-ops).
    if (!wordbookQuery.trim()) {
      void loadWordbook({ allowWhileLoading: true });
    }
  }, [activePanel, loadWordbook, wordbookQuery, wordbookSort, wordbookStateFilter]);


  useEffect(() => {
    const entry = wordbookEntries.find((e) => e.id === wordbookSelectedId) ?? null;
    if (!entry) return;

    // Only initialize drafts when selection changes.
    setWordbookDraftNote(entry.note ?? "");
    setWordbookDraftTags(Array.isArray(entry.tags) ? entry.tags : []);
    setWordbookDraftTagInput("");
    setWordbookDraftState(entry.state);
    setWordbookSaveStatus("idle");
    setWordbookLastSavedAt(entry.updatedAt ?? null);
  }, [wordbookEntries, wordbookSelectedId]);

  useEffect(() => {
    const entry = wordbookEntries.find((e) => e.id === wordbookSelectedId) ?? null;
    if (!entry) return;

    const nextNote = (wordbookDraftNote ?? "").slice(0, 2000);
    const nextTags = wordbookDraftTags.map((t) => t.trim()).filter(Boolean);
    const isDirty =
      nextNote !== (entry.note ?? "") ||
      wordbookDraftState !== entry.state ||
      JSON.stringify(nextTags) !== JSON.stringify(entry.tags ?? []);

    setWordbookSaveStatus((prev) => (prev === "saving" ? prev : isDirty ? "dirty" : "idle"));
  }, [wordbookDraftNote, wordbookDraftState, wordbookDraftTags, wordbookEntries, wordbookSelectedId]);

  useEffect(() => {
    const entry = wordbookEntries.find((e) => e.id === wordbookSelectedId) ?? null;
    if (!entry) return;
    if (wordbookSaveStatus !== "dirty") return;

    const timer = window.setTimeout(() => {
      void saveWordbookEdits({ source: "autosave" });
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [saveWordbookEdits, wordbookDraftNote, wordbookDraftState, wordbookDraftTags, wordbookEntries, wordbookSaveStatus, wordbookSelectedId]);


  const fetchChatMessages = useCallback(async (sessionId: string, limit = 80): Promise<ChatMessage[] | null> => {
    // Loading an unbounded history can be slow with large sessions; keep UI responsive.
    const response = await sendMessage("GET_CHAT_MESSAGES", { sessionId, limit });
    if (!response.ok) return null;
    return response.value.map((m) => ({
      id: String(m.id),
      role: m.role,
      content: m.content,
      ...(typeof m.thinking === "string" ? { thinking: m.thinking } : {}),
      timestamp: m.timestamp,
    }));
  }, []);

  const applySessionHistory = useCallback((sessionId: string, history: ChatMessage[]) => {
    setMessages(history);
    setConversationId(sessionId);
    setExpandedThinkingById({});
    setError(null);
  }, []);

  const loadMessages = useCallback(
    async (sessionId: string) => {
      const startedWhileStreaming = uiStreamActiveRef.current;
      const token = ++historyLoadTokenRef.current;
      const history = await fetchChatMessages(sessionId, 80);
      if (historyLoadTokenRef.current !== token) return;
      // If a UI stream was active when this load started (or became active later),
      // do not apply history - it can overwrite the in-flight bubbles and make it
      // look like "no request was sent" even though the worker is running.
      if (startedWhileStreaming || uiStreamActiveRef.current) return;
      if (history) {
        applySessionHistory(sessionId, history);
      }
    },
    [applySessionHistory, fetchChatMessages],
  );

  const refreshWebStudyContextForSession = useCallback(
    async (session: ChatSession) => {
      if (session.kind !== "web") return;
      const sessionId = session.sessionId;
      if (!sessionId) return;

      const response = await sendMessage("GET_ACTIVE_WEB_STUDY_CONTEXT", undefined);
      if (!response.ok) return;

      const raw = response.value;
      if (!raw || typeof raw !== "object") return;
      if ((raw as Record<string, unknown>).kind !== "web") return;

      const context = raw as SidebarContextInfo;
      setContextBySessionId((prev) => ({ ...prev, [sessionId]: context }));

      setContextSelectionBySessionId((prev) =>
        prev[sessionId] ? prev : { ...prev, [sessionId]: getDefaultSelectionForContext(context) },
      );
    },
    [getDefaultSelectionForContext],
  );

  const loadLatestSession = useCallback(
    async (options?: { skipMessages?: boolean; refreshWebContext?: boolean }) => {
      const startedWhileStreaming = uiStreamActiveRef.current;
      const response = await sendMessage("GET_CHAT_SESSIONS", {});
      if (response.ok) {
        const allSessions = response.value;
        setSessions(allSessions);
        if (allSessions.length > 0) {
          // Sort by lastAccessedAt desc
          const sorted = [...allSessions].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
          const latest = sorted[0];
          if (latest) hydrateContextFromSession(latest);
          if (
            latest &&
            latest.kind === "web" &&
            (options?.refreshWebContext ?? true) &&
            !startedWhileStreaming &&
            !uiStreamActiveRef.current
          ) {
            await refreshWebStudyContextForSession(latest);
          }
          if (latest && !options?.skipMessages && !startedWhileStreaming && !uiStreamActiveRef.current) {
            await loadMessages(latest.sessionId);
          }
        }
      }
    },
    [hydrateContextFromSession, loadMessages, refreshWebStudyContextForSession],
  );

  useEffect(() => {
    async function init() {
      try {
        const response = await sendMessage("GET_SETTINGS", undefined);
        if (response.ok) {
          setTheme(response.value.theme);
          setWordbookAddLanguage(
            normalizeWordbookLanguage((response.value as any)?.targetLanguage),
          );
        }
      } catch (error: unknown) {
        log.warn("Failed to load sidebar theme from settings; using default theme", { message: getErrorMessage(error) });
      }

      const readPending = async () => {
        const pendingData = await browser.storage.local.get("lexipath_sidebar_pending_message");
        const parsed = parsePendingSidebarMessage(pendingData.lexipath_sidebar_pending_message);
        const pendingTimestamp = parsed?.timestamp ?? 0;
        return { pendingTimestamp, hasRecentPendingMessage: pendingTimestamp > 0 && Date.now() - pendingTimestamp < 10000 };
      };

      // The side panel may open before the background finished writing the pending message.
      // Give storage a short moment to catch up to avoid loading history that will immediately be replaced.
      let { hasRecentPendingMessage } = await readPending();
      if (!hasRecentPendingMessage) {
        await new Promise((r) => setTimeout(r, 150));
        ({ hasRecentPendingMessage } = await readPending());
      }

      await loadLatestSession({ skipMessages: hasRecentPendingMessage, refreshWebContext: !hasRecentPendingMessage });
    }
    init();
  }, [loadLatestSession]);

  const handleNewChat = useCallback(() => {
    forceNewSessionNextSendRef.current = false;
    streamCancelRef.current?.();
    uiStreamActiveRef.current = false;
    historyLoadTokenRef.current += 1;
    setMessages([]);
    setConversationId(undefined);
    setError(null);
    setLoadingSessionId(null);
    setActivePanel("chat");
    setExpandedThinkingById({});
    setDraftContextSelection(DEFAULT_CONTEXT_SELECTION);
    setDraftContextInfo(null);
    inputRef.current?.focus();
  }, []);

  const detachUiStream = useCallback(() => {
    streamCancelRef.current?.();
    uiStreamActiveRef.current = false;
    setLoadingSessionId(null);
  }, []);

  const sendChatText = useCallback(
    async (
      text: string,
      options?: { conversationId?: string; allowWhileLoading?: boolean; contextInfo?: SidebarContextInfo }
    ) => {
      const message = text.trim();
      if (!message) return;

      const allowWhileLoading = options?.allowWhileLoading ?? false;
      if (loadingSessionId && !allowWhileLoading) return;

      const desiredConversationId = options?.conversationId ?? conversationId;
      const sessionId =
        desiredConversationId && desiredConversationId.trim()
          ? desiredConversationId
          : makeRandomChatSessionId();

      const isNewSession = !(desiredConversationId && desiredConversationId.trim());
      const contextInfoFromOptions = options?.contextInfo ?? null;
      const existingContextForSession = contextBySessionId[sessionId] ?? null;
      const contextInfoForSession =
        contextInfoFromOptions ?? existingContextForSession ?? (isNewSession ? draftContextInfo : null);

      if (contextInfoFromOptions) {
        setDraftContextInfo(contextInfoFromOptions);
        setContextBySessionId((prev) => ({ ...prev, [sessionId]: contextInfoFromOptions }));
      } else if (isNewSession && draftContextInfo) {
        setContextBySessionId((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: draftContextInfo }));
      }

      const defaultSelectionForContext = getDefaultSelectionForContext(contextInfoForSession);
      const selectionForSession =
        contextSelectionBySessionId[sessionId] ?? (isNewSession ? draftContextSelection : defaultSelectionForContext);

      if (!contextSelectionBySessionId[sessionId]) {
        if (isNewSession) {
          setContextSelectionBySessionId((prev) => ({ ...prev, [sessionId]: draftContextSelection }));
        } else if (contextInfoFromOptions) {
          setContextSelectionBySessionId((prev) => ({ ...prev, [sessionId]: defaultSelectionForContext }));
        }
      }

      if (sessionId !== conversationId) {
        setConversationId(sessionId);
      }

      // Detach the previous UI stream (if any). The background should keep running
      // and persist the final result to storage.
      historyLoadTokenRef.current += 1;
      streamCancelRef.current?.();
      setError(null);
      setLoadingSessionId(sessionId);

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
      // Always bring the latest messages into view when sending; otherwise the request can be running
      // (and even complete) while the user is reading older history and thinks nothing happened.
      window.requestAnimationFrame(() => {
        try {
          messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
        } catch {
          // ignore
        }
      });

      let contentSoFar = "";
      let thinkingSoFar = "";
      let pendingContent = "";
      let pendingThinking = "";
      let sawThinking = false;
      let flushTimer: number | null = null;
      let finished = false;

      const flush = () => {
        const hasPendingContent = Boolean(pendingContent);
        const hasPendingThinking = Boolean(pendingThinking);
        if (!hasPendingContent && !hasPendingThinking) return;

        if (hasPendingContent) {
          contentSoFar += pendingContent;
          pendingContent = "";
        }

        if (hasPendingThinking) {
          thinkingSoFar += pendingThinking;
          pendingThinking = "";
          sawThinking = true;
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: contentSoFar,
                  isStreaming: true,
                  ...(sawThinking ? { thinking: thinkingSoFar, isThinkingStreaming: true } : {}),
                }
              : msg,
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

      const backgroundInfo = buildChatBackgroundInfo(contextInfoForSession, selectionForSession);

      const sessionMeta = await (async () => {
        if (!contextInfoForSession) return undefined;

        const isWebOrSubtitle = contextInfoForSession.kind === "web" || contextInfoForSession.kind === "subtitle";
        if (!isWebOrSubtitle) return undefined;

        const isWebStudy = contextInfoForSession.kind === "web" && contextInfoForSession.source === "study";

        // Spec: only explicit "study" web sessions and subtitle sessions are anchored.
        // The background computes and stores anchorKey from meta.url/meta.anchorId.
        const shouldPersistAnchorKey = isNewSession && (contextInfoForSession.kind === "subtitle" || isWebStudy);


        const meta: {
          kind?: ChatSessionKind;
          label?: string;
          anchorKey?: string;
          forceNewSession?: boolean;
          url?: string;
          anchorId?: string;
        } = {};

        if (contextInfoForSession.kind === "web") {
          // Spec: selection-based web assistance keeps the session `general`.
          // Only explicit "study" turns create/label a `web` session and anchorKey.
          const isStudy = contextInfoForSession.source === "study";


          if (isStudy) {
            meta.kind = "web";
            const label = [contextInfoForSession.title, contextInfoForSession.domain].filter(Boolean).join(" · ");
            if (label.trim()) meta.label = label;

            const url = typeof contextInfoForSession.url === "string" ? contextInfoForSession.url.trim() : "";
            if (url) meta.url = url;
          }
        }

        if (contextInfoForSession.kind === "subtitle") {
          meta.kind = "subtitle";
          const label = [contextInfoForSession.title, contextInfoForSession.platform].filter(Boolean).join(" · ");
          if (label.trim()) meta.label = label;

          const anchorId = typeof contextInfoForSession.anchorId === "string" ? contextInfoForSession.anchorId.trim() : "";
          if (anchorId) meta.anchorId = anchorId;
        }

        // anchorKey is computed in the background from meta.url/meta.anchorId.
        // We only include these fields for new sessions, to keep requests small.
        if (shouldPersistAnchorKey) {
          meta.forceNewSession = false;
        }

        const hasAny = Boolean(meta.kind || meta.label || meta.url || meta.anchorId || meta.forceNewSession === false);
        return hasAny ? meta : undefined;
      })();

      uiStreamActiveRef.current = true;
      const { cancel } = chatStream(
        {
          message,
          conversationId: sessionId,
          ...(backgroundInfo ? { backgroundInfo } : {}),
          ...(sessionMeta
            ? {
                sessionMeta: {
                  ...(sessionMeta.kind ? { kind: sessionMeta.kind } : {}),
                  ...(sessionMeta.label ? { label: sessionMeta.label } : {}),
                  ...(sessionMeta.anchorKey ? { anchorKey: sessionMeta.anchorKey } : {}),
                  ...(typeof sessionMeta.url === "string" ? { url: sessionMeta.url } : {}),
                  ...(typeof sessionMeta.anchorId === "string" ? { anchorId: sessionMeta.anchorId } : {}),
                  ...(typeof sessionMeta.forceNewSession === "boolean" ? { forceNewSession: sessionMeta.forceNewSession } : {}),

                },
              }
            : {}),
        },
        {
          onChunk: (delta) => {
            if (finished) return;
            pendingContent += delta;
            scheduleFlush();
          },
          onThinking: (delta) => {
            if (finished) return;
            pendingThinking += delta;
            scheduleFlush();
          },
           onDone: ({ reply, conversationId: nextConversationId, thinking }) => {
             if (finished) return;
             finished = true;
             uiStreamActiveRef.current = false;
             if (flushTimer !== null) {
               window.clearTimeout(flushTimer);
               flushTimer = null;
             }
            flush();
            const finalReply = reply || contentSoFar;
            const finalThinking =
              typeof thinking === "string" && thinking.trim()
                ? thinking
                : thinkingSoFar.trim()
                  ? thinkingSoFar
                  : undefined;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId
                  ? {
                      ...msg,
                      content: finalReply,
                      isStreaming: false,
                      ...(finalThinking ? { thinking: finalThinking } : {}),
                      ...(sawThinking || finalThinking ? { isThinkingStreaming: false } : {}),
                    }
                  : msg,
              ),
            );
             setConversationId(nextConversationId);
             setLoadingSessionId(null);
             streamCancelRef.current = null;
             inputRef.current?.focus();
             void loadSessions();
           },
           onError: (err) => {
             if (finished) return;
             finished = true;
             uiStreamActiveRef.current = false;
             if (flushTimer !== null) {
               window.clearTimeout(flushTimer);
               flushTimer = null;
             }
            flush();
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, content: contentSoFar, isStreaming: false, ...(sawThinking ? { isThinkingStreaming: false } : {}) }
                  : msg,
              ),
            );
             setError(err.message);
             setLoadingSessionId(null);
             streamCancelRef.current = null;
             inputRef.current?.focus();
           },
         },
      );

      streamCancelRef.current = () => {
        if (finished) return;
        finished = true;
        uiStreamActiveRef.current = false;

        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
        flush();

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: contentSoFar, isStreaming: false, ...(sawThinking ? { isThinkingStreaming: false } : {}) }
              : msg,
          ),
        );

        setLoadingSessionId(null);
        inputRef.current?.focus();
        void loadSessions();

        try {
          cancel();
        } finally {
          streamCancelRef.current = null;
        }
      };
    },
    [
      contextBySessionId,
      contextSelectionBySessionId,
      conversationId,
      draftContextInfo,
      draftContextSelection,
      loadingSessionId,
      loadSessions,
    ],
  );

  const normalizePromptForDedup = useCallback((text: string) => text.trim().replace(/\s+/g, " "), []);

  const normalizeDomain = useCallback((domain: string) => {
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) return "";
    return trimmed.startsWith("www.") ? trimmed.slice(4) : trimmed;
  }, []);


  const hasAnsweredLastPrompt = useCallback((history: ChatMessage[], prompt: string) => {
    const normalizedPrompt = normalizePromptForDedup(prompt);
    if (!normalizedPrompt) return false;

    // Only consider the most recent user turn. If the same prompt was asked earlier (not the last),
    // we still allow auto-send so the user can ask again in a later context.
    let lastUserIndex = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (!msg) continue;
      if (msg.role !== "user") continue;
      lastUserIndex = i;
      break;
    }
    if (lastUserIndex < 0) return false;

    const lastUser = history[lastUserIndex];
    if (!lastUser) return false;
    if (normalizePromptForDedup(lastUser.content) !== normalizedPrompt) return false;

    for (let j = lastUserIndex + 1; j < history.length; j++) {
      const next = history[j];
      if (!next) continue;
      if (next.role === "assistant" && next.content.trim()) return true;
    }

    return false;
  }, [normalizePromptForDedup]);

  const consumePendingMessage = useCallback(
    async (pending: unknown) => {
      const parsed = parsePendingSidebarMessage(pending);
      if (!parsed) return;
      if (Date.now() - parsed.timestamp >= 10000) return;



      const pendingKeyRaw =
        typeof parsed.nonce === "string" && parsed.nonce.trim()
          ? parsed.nonce.trim()
          : `${parsed.timestamp}:${parsed.text}:${parsed.keyword ?? ""}`;

      if (pendingKeyRaw === pendingHandledKeyRef.current) return;
      pendingHandledKeyRef.current = pendingKeyRaw;

      // Only bump the process token after we've accepted this pending message as "new".
      // This prevents duplicate consumers (storage listener + initial check) from canceling each other.
      const processToken = ++pendingProcessTokenRef.current;

      await browser.storage.local.remove("lexipath_sidebar_pending_message").catch(() => {});
      if (pendingProcessTokenRef.current !== processToken) return;

      const pendingText = typeof parsed.text === "string" ? parsed.text : "";
      const pendingContextInfo = parsed.contextInfo ?? null;

      // Whole-page study opt-in: the content script attaches a bounded excerpt (when available)
      // via contextInfo.selectedText. The sidebar shows a preview before sending.
      if (pendingContextInfo?.kind === "web" && pendingContextInfo.source === "study") {
        // Treat "Study this page" as a fresh entry point.
        // We intentionally clear the active session so the background can either:
        // - reuse the most recent session for the same anchorKey, or
        // - create a new session when the page differs.
        detachUiStream();
        historyLoadTokenRef.current += 1;
        setMessages([]);
        setConversationId(undefined);
        setExpandedThinkingById({});
        setError(null);
        setLoadingSessionId(null);
        setActivePanel("chat");

        forceNewSessionNextSendRef.current = true;

        setDraftContextInfo(pendingContextInfo);
        setDraftContextSelection({ title: true, timestamp: false, snippet: true });
        setInputValue(pendingText);
        inputRef.current?.focus();
        return;
      }


      if (pendingContextInfo) {
        setDraftContextInfo(pendingContextInfo);
        setDraftContextSelection(getDefaultSelectionForContext(pendingContextInfo));
      }

       if (!parsed.isAutoSend) {
         // UI-only open (e.g. open wordbook/history) should not clobber the chat input.
         if (pendingText.trim()) {
           setInputValue(pendingText);
           inputRef.current?.focus();
         }

          const ui = parsed.ui;
          if (ui?.panel === "history") {
            void loadSessions();
            setActivePanel("history");
            setHistoryTab(ui.historyTab === "terms" ? "terms" : "sessions");
            setSessionKindFilter("all");
            setKeywordFilterKey(null);
            setKeywordFilterQuery("");
            setIsKeywordPickerOpen(false);
            setSearchQuery("");
            setIsSearching(false);
            setSearchResults([]);
          } else if (ui?.panel === "wordbook") {
            setActivePanel("wordbook");
            void loadWordbook({ allowWhileLoading: true });
          } else if (ui?.panel === "chat") {
            setActivePanel("chat");
          }



         return;
       }

       const keyword = (parsed.keyword ?? "").trim();

       // Detach any existing UI stream to avoid leaking "loading" across sessions.
       detachUiStream();
       setError(null);
       setActivePanel("chat");
       setExpandedThinkingById({});

       if (keyword) {
         // Cancel any in-flight history loads from initial mount so they can't overwrite the chat UI.
         historyLoadTokenRef.current += 1;

         const normalizedKeyword = normalizeChatKeyword(keyword);
         const sessionsResponse = await sendMessage("GET_CHAT_SESSIONS", { keyword: normalizedKeyword });
         if (pendingProcessTokenRef.current !== processToken) return;
         const keywordSessions = sessionsResponse.ok ? (sessionsResponse.value as ChatSession[]) : [];
         const sessionId = keywordSessions[0]?.sessionId ?? makeKeywordSessionId(normalizedKeyword, 1);

         // IMPORTANT: keep `sessions` as the full history list.
         // Selecting a word should not shrink the "all words" dropdown to a single keyword.

         const history = await fetchChatMessages(sessionId, 80);
         if (pendingProcessTokenRef.current !== processToken) return;

         if (history) {
           applySessionHistory(sessionId, history);
           // If the same prompt has already been answered in this session, don't auto-send again.
           if (pendingText && hasAnsweredLastPrompt(history, pendingText)) {
             void loadSessions();
             inputRef.current?.focus();
             return;
           }
         } else {
           // If history can't be loaded, still switch session for consistency.
           setConversationId(sessionId);
         }

         await sendChatText(pendingText, {
           conversationId: sessionId,
           allowWhileLoading: true,
           ...(pendingContextInfo ? { contextInfo: pendingContextInfo } : {}),
         });
         return;
       }

      await sendChatText(pendingText, {
        allowWhileLoading: true,
        ...(pendingContextInfo ? { contextInfo: pendingContextInfo } : {}),
      });
    },
     [applySessionHistory, detachUiStream, fetchChatMessages, hasAnsweredLastPrompt, loadSessions, loadWordbook, sendChatText],
  );

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, browser.Storage.StorageChange>) => {
      const pending = changes.lexipath_sidebar_pending_message?.newValue;
      if (!pending) return;
      void consumePendingMessage(pending);
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, [consumePendingMessage]);

  useEffect(() => {
    async function checkPendingMessage() {
      const data = await browser.storage.local.get("lexipath_sidebar_pending_message");
      const pending = data.lexipath_sidebar_pending_message;
      if (!pending) return;
      await consumePendingMessage(pending);
    }
    checkPendingMessage();
  }, [consumePendingMessage]);



  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const end = messagesEndRef.current;
    if (!end) return;

    try {
      end.scrollIntoView({ behavior, block: "end" });
    } catch (_err) {
      try {
        end.scrollIntoView();
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (activePanel !== "chat") return;
    if (!isAtBottom) return;

    const isStreaming = messages.some((msg) => Boolean(msg.isStreaming));
    scrollToBottom(isStreaming ? "auto" : "smooth");
  }, [activePanel, isAtBottom, messages, scrollToBottom]);

  const handleSend = useCallback(() => {
    const isWebStudy =
      activeContextInfo?.kind === "web" && activeContextInfo.source === "study";

    // No modal preview: study context is controlled via chips.
    // For "study" entrypoints, ensure we don't accidentally continue an unrelated session.
    if (isWebStudy && forceNewSessionNextSendRef.current) {
      forceNewSessionNextSendRef.current = false;
      void sendChatText(inputValue, { conversationId: "" });
      return;
    }

    void sendChatText(inputValue);
  }, [activeContextInfo, inputValue, sendChatText]);


  const handleStop = useCallback(() => {
    if (!isLoading) return;
    streamCancelRef.current?.();
  }, [isLoading]);

  const toggleThinking = useCallback((messageId: string) => {
    setExpandedThinkingById((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  }, []);

  const clearDraftContext = useCallback(() => {
    setDraftContextInfo(null);
    setDraftContextSelection(DEFAULT_CONTEXT_SELECTION);
  }, []);



  const toggleContextPart = useCallback(
    (part: keyof SidebarContextSelection) => {
      if (conversationId) {
        setContextSelectionBySessionId((prev) => {
          const current = prev[conversationId] ?? DEFAULT_CONTEXT_SELECTION;
          return { ...prev, [conversationId]: { ...current, [part]: !current[part] } };
        });
        return;
      }
      setDraftContextSelection((prev) => ({ ...prev, [part]: !prev[part] }));
    },
    [conversationId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  useAutoResizeTextarea({
    textareaRef: inputRef,
    value: inputValue,
    dependencies: [activePanel],
    minHeightPx: 44,
    maxHeightPx: 176,
  });

  const handleClear = useCallback(() => {
    if (messages.length === 0) return;
    if (!confirm(t("chatClearConfirm"))) return;

    streamCancelRef.current?.();
    uiStreamActiveRef.current = false;
    historyLoadTokenRef.current += 1;
    setMessages([]);
    setConversationId(undefined);
    setError(null);
    setLoadingSessionId(null);
    setExpandedThinkingById({});
    setDraftContextInfo(null);
  }, [messages.length]);

  const sortedSessions = React.useMemo(() => {
    return [...sessions].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }, [sessions]);

  type KeywordOption = { key: string; label: string; lastAccessedAt: number };

  const keywordOptions = React.useMemo((): KeywordOption[] => {
    const byKey = new Map<string, KeywordOption>();

    for (const session of sortedSessions) {
      if (session.kind !== "keyword") continue;

      const raw = typeof session.keyword === "string" ? session.keyword.trim() : "";
      if (!raw) continue;

      const key = normalizeChatKeyword(raw);
      if (!key) continue;

      const prev = byKey.get(key);
      const lastAccessedAt = Math.max(prev?.lastAccessedAt ?? 0, session.lastAccessedAt);

      // Keep the first-seen label stable; key is normalized for matching.
      const label = prev?.label ?? raw;

      byKey.set(key, { key, label, lastAccessedAt });
    }

    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [sortedSessions]);

  const recentKeywordOptions = React.useMemo((): KeywordOption[] => {
    return [...keywordOptions].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt).slice(0, 20);
  }, [keywordOptions]);


  const sessionsForCurrentFilter = React.useMemo(() => {
    let filtered = [...sortedSessions];

    if (sessionKindFilter !== "all") {
      filtered = filtered.filter((s) => s.kind === sessionKindFilter);
    }

    // Keyword filtering only applies inside the "Words" view.
    // IMPORTANT: typing in the keyword box should not filter sessions until a keyword is selected.
    if (sessionKindFilter === "keyword" && keywordFilterKey) {
      filtered = filtered.filter((s) => {
        if (s.kind !== "keyword") return false;
        const raw = typeof s.keyword === "string" ? s.keyword.trim() : "";
        return raw ? normalizeChatKeyword(raw) === keywordFilterKey : false;
      });
    }

    return filtered;
  }, [keywordFilterKey, sessionKindFilter, sortedSessions]);

  const filteredKeywordOptions = React.useMemo((): KeywordOption[] => {
    const query = keywordFilterQuery.trim().toLowerCase();
    if (!query) return keywordOptions;
    return keywordOptions.filter((opt) => opt.label.toLowerCase().includes(query));
  }, [keywordFilterQuery, keywordOptions]);

  const keywordPickerOptions = React.useMemo((): KeywordOption[] => {
    if (keywordFilterQuery.trim()) return filteredKeywordOptions;

    // Default list: recent keywords, but always include the current selection
    // so the user can see what is active.
    if (keywordFilterKey && !recentKeywordOptions.some((opt) => opt.key === keywordFilterKey)) {
      const selected = keywordOptions.find((opt) => opt.key === keywordFilterKey);
      return selected ? [selected, ...recentKeywordOptions] : recentKeywordOptions;
    }

    return recentKeywordOptions;
  }, [filteredKeywordOptions, keywordFilterKey, keywordFilterQuery, keywordOptions, recentKeywordOptions]);



  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <header className="relative flex items-center justify-between px-5 py-4 bg-background border-b border-border overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />
        <div className="flex items-center gap-3">
          {activePanel !== "chat" ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setActivePanel("chat")}
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
              {activePanel === "history"
                ? t("chatHistory") || "History"
                : activePanel === "wordbook"
                  ? t("wordbookTitle")
                  : t("chatTitle")}
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
              const opening = activePanel !== "wordbook";
              setActivePanel(opening ? "wordbook" : "chat");
              if (opening) {
                void loadWordbook({ allowWhileLoading: true });
              }
            }}
            title={t("wordbookTitle")}
            className={cn(
              "h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30",
              activePanel === "wordbook" && "bg-muted/30 text-foreground",
            )}
          >
            <BookOpen className="h-4 w-4" />
          </Button>
           <Button
             variant="ghost"
             size="icon"
             onClick={() => {
               const opening = activePanel !== "history";
               void loadSessions();
               setActivePanel(opening ? "history" : "chat");
               if (opening) {
                 setHistoryTab("sessions");
                 setSessionKindFilter("all");
                 setKeywordFilterKey(null);
                 setKeywordFilterQuery("");
                 setIsKeywordPickerOpen(false);
 
                 setSearchQuery("");
                 setIsSearching(false);
                 setSearchResults([]);
               }
             }}
             title={t("chatHistory") || "History"}
             className={cn(
               "h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30",
               activePanel === "history" && "bg-muted/30 text-foreground"
             )}
           >
             <History className="h-4 w-4" />
           </Button>

          {messages.length > 0 && activePanel === "chat" && (
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
          {activePanel !== "chat" ? (
            <motion.div
              key="sessions"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 overflow-hidden flex flex-col"
            >
               <div className="px-4 py-3 border-b border-border bg-muted/15">
                 {activePanel === "history" ? (
                   <>
                     <div className="flex items-center gap-2">
                       <Button
                         type="button"
                         variant={historyTab === "sessions" ? "secondary" : "ghost"}
                         size="sm"
                         onClick={() => {
                           setHistoryTab("sessions");
                           setSearchQuery("");
                           setIsSearching(false);
                           setSearchResults([]);
                         }}
                         className="rounded-xl"
                       >
                         {t("chatHistory")}
                       </Button>
                       <Button
                         type="button"
                         variant={historyTab === "terms" ? "secondary" : "ghost"}
                         size="sm"
                         onClick={() => {
                           setHistoryTab("terms");
                           setKeywordFilterKey(null);
                         }}
                         className="rounded-xl"
                       >
                         {t("chatSearch")}
                       </Button>
                     </div>
 
                     {historyTab === "sessions" && (
                       <div className="mt-3 flex items-center gap-2">
                         <Select
                           value={sessionKindFilter}
                           onValueChange={(value) => {
                             const next = value as "all" | ChatSession["kind"];
                             setSessionKindFilter(next);
 
                             if (next !== "keyword") {
                               setKeywordFilterKey(null);
                               setKeywordFilterQuery("");
                               setIsKeywordPickerOpen(false);
                             }
                           }}
                         >
                           <SelectTrigger className="h-10 rounded-xl bg-card shadow-sm flex-1">
                             <SelectValue placeholder={t("chatHistoryAllTypes")} />
                           </SelectTrigger>
                           <SelectContent>
                             <SelectItem value="all">{t("chatHistoryAllTypes")}</SelectItem>
                             <SelectItem value="keyword">{t("chatHistoryKindWords")}</SelectItem>
                             <SelectItem value="web">{t("chatHistoryKindWeb")}</SelectItem>
                             <SelectItem value="subtitle">{t("chatHistoryKindVideo")}</SelectItem>
                             <SelectItem value="general">{t("chatHistoryKindGeneral")}</SelectItem>
                           </SelectContent>
                         </Select>
 
                         {sessionKindFilter === "keyword" && keywordOptions.length > 0 && (
                           <Popover open={isKeywordPickerOpen} onOpenChange={setIsKeywordPickerOpen}>
                             <PopoverAnchor asChild>
                               <div ref={keywordPickerAnchorRef} className="relative flex-1">
                                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                 <Input
                                   value={keywordFilterQuery}
                                   onChange={(e) => {
                                     const next = e.target.value;
                                     setKeywordFilterQuery(next);
 
                                     const normalized = normalizeChatKeyword(next);
                                     if (!normalized) {
                                       setKeywordFilterKey(null);
                                       return;
                                     }
 
                                     const exact = keywordOptions.find((opt) => opt.key === normalized);
                                     if (exact) {
                                       setKeywordFilterKey(exact.key);
                                       return;
                                     }
 
                                     if (keywordFilterKey) setKeywordFilterKey(null);
                                   }}
                                   onFocus={() => setIsKeywordPickerOpen(true)}
                                   onKeyDown={(e) => {
                                     if (e.key === "Escape") setIsKeywordPickerOpen(false);
                                   }}
                                   placeholder={t("chatHistoryAllKeywords")}
                                   className="pl-10 pr-10 h-10 rounded-xl text-sm bg-card shadow-sm"
                                 />
                                 {(keywordFilterKey || keywordFilterQuery.trim()) && (
                                   <button
                                     type="button"
                                     onClick={(e) => {
                                       e.preventDefault();
                                       e.stopPropagation();
                                       setKeywordFilterKey(null);
                                       setKeywordFilterQuery("");
                                       setIsKeywordPickerOpen(false);
                                     }}
                                     title={t("chatClearKeywordFilter")}
                                     className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 flex items-center justify-center"
                                   >
                                     <X className="h-4 w-4" />
                                   </button>
                                 )}
                               </div>
                             </PopoverAnchor>
                             <PopoverContent
                               align="start"
                               className="p-2 w-[var(--radix-popover-trigger-width)]"
                               onOpenAutoFocus={(event) => event.preventDefault()}
                               onInteractOutside={(event) => {
                                 const target = event.target as Node | null;
                                 if (target && keywordPickerAnchorRef.current?.contains(target)) {
                                   event.preventDefault();
                                 }
                               }}
                             >
                               <div className="flex flex-col">
                                 <div className="px-2 py-1 text-xs text-muted-foreground">
                                   {t("chatHistoryKeywordSearchPlaceholder")}
                                 </div>
                                 <div className="max-h-56 overflow-auto">
                                   {!keywordFilterQuery.trim() && (
                                     <button
                                       type="button"
                                       onClick={() => {
                                         setKeywordFilterKey(null);
                                         setKeywordFilterQuery("");
                                         setIsKeywordPickerOpen(false);
                                       }}
                                       className={cn(
                                         "w-full px-3 py-2 text-left text-sm rounded-lg hover:bg-muted/30",
                                         !keywordFilterKey && "bg-muted/30",
                                       )}
                                     >
                                       {t("chatHistoryAllKeywords")}
                                     </button>
                                   )}
 
                                   {keywordPickerOptions.slice(0, 50).map((opt) => (
                                     <button
                                       key={opt.key}
                                       type="button"
                                       onClick={() => {
                                         setSessionKindFilter("keyword");
                                         setKeywordFilterKey(opt.key);
                                         setKeywordFilterQuery(opt.label);
                                         setIsKeywordPickerOpen(false);
                                       }}
                                       className={cn(
                                         "w-full px-3 py-2 text-left text-sm rounded-lg hover:bg-muted/30",
                                         keywordFilterKey === opt.key && "bg-muted/30",
                                       )}
                                     >
                                       {opt.label}
                                     </button>
                                   ))}
                                 </div>
                               </div>
                             </PopoverContent>
                           </Popover>
                         )}
                       </div>
                     )}
 
                     {historyTab === "terms" && (
                       <>
                         <div className="mt-3 relative">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                           <Input
                             value={searchQuery}
                             onChange={(e) => {
                               const next = e.target.value;
                               setSearchQuery(next);
                               if (!next.trim()) {
                                 setIsSearching(false);
                                 setSearchResults([]);
                               }
                             }}
                             placeholder={t("chatSearchPlaceholder") || "Search terms..."}
                             className="pl-10 pr-12 h-10 rounded-xl text-sm bg-card shadow-sm"
                           />
                           {isSearching ? (
                             <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                           ) : (
                             <Button
                               type="button"
                               variant="ghost"
                               size="icon"
                               onClick={() => void addSavedTerm(searchQuery)}
                               disabled={!searchQuery.trim()}
                               title={t("chatSaveTerm")}
                               className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30"
                             >
                               <BookmarkPlus className="h-4 w-4" />
                             </Button>
                           )}
                         </div>
 
                         {savedTerms.length > 0 && (
                           <div className="mt-3 flex flex-wrap items-center gap-2">
                             {savedTerms.map((term) => (
                               <div
                                 key={term}
                                 className="flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-xs shadow-sm"
                               >
                                 <button
                                   type="button"
                                   onClick={() => setSearchQuery(term)}
                                   className="max-w-[180px] truncate font-medium"
                                   title={term}
                                 >
                                   {term}
                                 </button>
                                 <button
                                   type="button"
                                   onClick={() => void removeSavedTerm(term)}
                                   className="text-muted-foreground hover:text-foreground"
                                   aria-label={t("chatRemoveSavedTerm")}
                                   title={t("chatRemove")}
                                 >
                                   <X className="h-3 w-3" />
                                 </button>
                               </div>
                             ))}
                           </div>
                         )}
                       </>
                     )}
                  </>
                 ) : (
                    <>
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant={wordbookBulkMode ? "secondary" : "ghost"}
                            className="h-10 rounded-xl px-3"
                            onClick={() => {
                              setWordbookBulkMode((v) => {
                                const next = !v;
                                if (!next) setWordbookSelectedIds(new Set());
                                return next;
                              });
                            }}
                          >
                            {t("wordbookBulk")}
                          </Button>

                          {wordbookBulkMode && (
                            <>
                              <Badge
                                variant="outline"
                                className="h-10 px-3 border-border bg-muted text-muted-foreground rounded-xl"
                              >
                                {t("wordbookSelectedCount", [String(wordbookSelectedIds.size)])}
                              </Badge>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-xl"
                                disabled={wordbookSelectedIds.size === 0}
                                title={t("wordbookBulkArchive")}
                                onClick={() => void handleWordbookBulkState("archived")}
                              >
                                <Archive className="h-4 w-4" />
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-xl"
                                disabled={wordbookSelectedIds.size === 0}
                                title={t("wordbookBulkIgnore")}
                                onClick={() => void handleWordbookBulkState("ignored")}
                              >
                                <EyeOff className="h-4 w-4" />
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-xl text-muted-foreground hover:text-destructive"
                                disabled={wordbookSelectedIds.size === 0}
                                title={t("wordbookBulkRemove")}
                                onClick={() => void handleWordbookBulkRemove()}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}

                          <div className="flex-1" />

                          <Popover open={wordbookAddOpen} onOpenChange={setWordbookAddOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="secondary"
                                className="h-10 rounded-xl px-3 gap-2 whitespace-nowrap"
                                title={t("wordbookAddButton")}
                              >
                                <PlusCircle className="h-4 w-4" />
                                <span>{t("wordbookAddButton")}</span>
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-[320px] rounded-xl p-4">
                              <div className="text-sm font-semibold">{t("wordbookAddTitle")}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {t("wordbookAddHint")}
                              </div>
                              <div className="mt-3 flex items-center gap-2">
                                <Input
                                  value={wordbookAddTerm}
                                  onChange={(e) => setWordbookAddTerm(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void handleWordbookAdd();
                                    }
                                  }}
                                  placeholder={t("wordbookAddPlaceholder")}
                                  className="h-10 rounded-xl bg-background shadow-sm"
                                />
                                <Button
                                  type="button"
                                  className="h-10 rounded-xl"
                                  disabled={wordbookAddStatus !== "idle"}
                                  onClick={() => void handleWordbookAdd()}
                                >
                                  {wordbookAddStatus === "saving" ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <PlusCircle className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              value={wordbookQuery}
                              onChange={(e) => {
                                const next = e.target.value;
                                setWordbookQuery(next);
                                if (!next.trim()) {
                                  void loadWordbook({ allowWhileLoading: true });
                                }
                              }}
                              placeholder={t("wordbookTitleDesc")}
                              className="pl-10 h-10 rounded-xl text-sm bg-card shadow-sm"
                            />
                            {isWordbookLoading && (
                              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                          </div>

                          <Select
                            value={wordbookStateFilter}
                            onValueChange={(v) => {
                              setWordbookStateFilter(v as any);
                              void loadWordbook({ allowWhileLoading: true });
                            }}
                          >
                            <SelectTrigger className="h-10 rounded-xl bg-card shadow-sm w-full sm:w-[140px]">
                              <SelectValue placeholder={t("wordbookStateAll")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("wordbookStateAll")}</SelectItem>
                              <SelectItem value="active">{t("wordbookStateActive")}</SelectItem>
                              <SelectItem value="archived">{t("wordbookStateArchived")}</SelectItem>
                              <SelectItem value="ignored">{t("wordbookStateIgnored")}</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select
                            value={wordbookSort}
                            onValueChange={(v) => {
                              setWordbookSort(v as any);
                              void loadWordbook({ allowWhileLoading: true });
                            }}
                          >
                            <SelectTrigger className="h-10 rounded-xl bg-card shadow-sm w-full sm:w-[140px]">
                              <SelectValue placeholder={t("wordbookSortUpdated")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="updated_desc">{t("wordbookSortUpdated")}</SelectItem>
                              <SelectItem value="term_asc">{t("wordbookSortAZ")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                )}
              </div>
              <ScrollArea className="flex-1 px-4">
                <div className="flex flex-col gap-2 py-4">
                  {activePanel === "history" && historyTab === "terms" ? (

                    searchQuery.trim() ? (
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
                              detachUiStream();
                              const session = sessions.find((s) => s.sessionId === result.sessionId);
                              if (session) hydrateContextFromSession(session);
                              void loadMessages(result.sessionId);
                              setActivePanel("chat");
                              setHistoryTab("sessions");

                            }}
                            className="flex flex-col gap-1 p-4 rounded-xl text-left transition-colors border border-border bg-card hover:bg-muted/30 shadow-sm"
                          >
                            <div className="flex items-center justify-between w-full mb-1">
                              <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                                {result.role === 'user' ? t('user') || 'User' : t('assistant') || 'AI'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{new Date(result.timestamp).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm line-clamp-2 text-muted-foreground">{result.content}</p>
                            <div className="text-xs text-muted-foreground/70">{result.sessionId.split('-').slice(0, 2).join('-')}</div>
                          </button>
                        ))
                      )
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Search className="h-12 w-12 opacity-20 mb-4" />
                        <p className="text-sm font-medium">{t("chatSearchPlaceholder") || "Search terms..."}</p>
                      </div>
                    )
                  ) : activePanel === "wordbook" ? (

                    isNarrow ? (
                      // Mobile: list OR detail.
                      wordbookSelectedId ? (
                        (() => {
                          const entry = wordbookEntries.find((e) => e.id === wordbookSelectedId) ?? null;
                          if (!entry) {
                            return (
                              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                <BookOpen className="h-12 w-12 opacity-20 mb-4" />
                                <p className="text-sm font-medium">{t("wordbookTitle")}</p>
                                  <p className="text-xs text-muted-foreground mt-1">{t("wordbookNoEntrySelected")}</p>
                              </div>
                            );
                          }

                          return (
                            <div className="flex flex-col gap-3">
                              <div className="flex items-center justify-between">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setWordbookSelectedId(null)}
                                  className="h-9 w-9 rounded-xl hover:bg-muted/30"
                                  title={t("wordbookBack")}
                                >
                                  <ChevronLeft className="h-5 w-5" />
                                </Button>

                                <div className="flex items-center gap-2">
                                  {(() => {
                                    const label =
                                      wordbookSaveStatus === "saving"
                                        ? t("optionsSaving")
                                        : wordbookSaveStatus === "saved"
                                          ? t("optionsSaveSuccess")
                                          : wordbookSaveStatus === "error"
                                            ? t("optionsSaveError", wordbookSaveErrorRef.current || "Error")
                                            : wordbookSaveStatus === "dirty"
                                              ? t("wordbookUnsaved")
                                              : "";

                                    return label ? (
                                      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                                        {label}
                                      </Badge>
                                    ) : null;
                                  })()}
                                </div>
                              </div>

                              <div className="rounded-xl border border-border bg-card shadow-sm p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-base font-semibold truncate">{entry.term}</div>
                                    <div className="text-xs text-muted-foreground mt-1">{entry.language}</div>
                                  </div>
                                  <Select
                                    value={wordbookDraftState}
                                    onValueChange={(v) => {
                                      setWordbookDraftState(v as any);
                                      setWordbookSaveStatus("dirty");
                                    }}
                                  >
                                    <SelectTrigger className="h-9 rounded-xl bg-background shadow-sm w-[120px]">
                                      <SelectValue placeholder={t("wordbookStateLabel")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="active">{t("wordbookStateActive")}</SelectItem>
                                      <SelectItem value="archived">{t("wordbookStateArchived")}</SelectItem>
                                      <SelectItem value="ignored">{t("wordbookStateIgnored")}</SelectItem>
                                  </SelectContent>
                                  </Select>
                                </div>

                                <div className="mt-4">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      {t("wordCard_sectionDefinition")}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
                                      disabled={wordbookExplainById[entry.id]?.status === "loading"}
                                      onClick={() => void fetchWordbookDefinition(entry, { force: true })}
                                    >
                                      {t("summaryRefresh")}
                                    </Button>
                                  </div>

                                  <div className="mt-2 rounded-xl border border-border bg-background/60 px-3 py-2">
                                    {wordbookExplainById[entry.id]?.status === "loading" ? (
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>{t("wordCard_loading")}</span>
                                      </div>
                                    ) : wordbookExplainById[entry.id]?.data ? (
                                      <div>
                                        {wordbookExplainById[entry.id]?.data?.phonetic ||
                                        wordbookExplainById[entry.id]?.data?.difficulty ? (
                                          <div className="mb-2 flex flex-wrap items-center gap-2">
                                            {wordbookExplainById[entry.id]?.data?.phonetic ? (
                                              <span className="text-xs text-muted-foreground">
                                                {wordbookExplainById[entry.id]?.data?.phonetic}
                                              </span>
                                            ) : null}
                                            {wordbookExplainById[entry.id]?.data?.difficulty ? (
                                              <Badge
                                                variant="outline"
                                                className="border-border bg-background text-muted-foreground text-[11px] px-2 py-0.5 rounded-full"
                                              >
                                                {wordbookExplainById[entry.id]?.data?.difficulty}
                                              </Badge>
                                            ) : null}
                                          </div>
                                        ) : null}
                                        {wordbookExplainById[entry.id]?.data?.targets &&
                                        wordbookExplainById[entry.id]?.data?.targets?.length &&
                                        wordbookExplainById[entry.id]?.data?.targets?.[0] !==
                                          wordbookExplainById[entry.id]?.data?.definition?.trim() ? (
                                          <div className="mb-2 text-xs text-muted-foreground whitespace-pre-wrap">
                                            {wordbookExplainById[entry.id]?.data?.targets?.[0]}
                                          </div>
                                        ) : null}
                                        <div className="text-sm leading-relaxed whitespace-pre-wrap">
                                          {wordbookExplainById[entry.id]?.data?.definition}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-muted-foreground">
                                        {t("wordCard_definitionUnavailable")}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-4">
                                  <div className="text-xs font-medium text-muted-foreground">{t("wordbookTagsLabel")}</div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {wordbookDraftTags.map((tag) => (
                                      <span key={tag} className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-xs">
                                        <span className="max-w-[220px] truncate">{tag}</span>
                                        <button
                                          type="button"
                                          className="text-muted-foreground hover:text-foreground"
                                          onClick={() => {
                                            setWordbookDraftTags((prev) => prev.filter((t) => t !== tag));
                                            setWordbookSaveStatus("dirty");
                                          }}
                                          title={t("chatRemove")}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                  <Input
                                    value={wordbookDraftTagInput}
                                    onChange={(e) => setWordbookDraftTagInput(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        applyWordbookTag();
                                      }
                                    }}
                                    placeholder={t("wordbookTagPlaceholder")}
                                    className="mt-2 h-10 rounded-xl bg-background shadow-sm"
                                  />
                                </div>

                                <div className="mt-4">
                                  <div className="text-xs font-medium text-muted-foreground">{t("wordbookNoteLabel")}</div>
                                  <Textarea
                                    value={wordbookDraftNote}
                                    onChange={(e) => {
                                      setWordbookDraftNote(e.target.value);
                                      setWordbookSaveStatus("dirty");
                                    }}
                                    placeholder={t("wordbookNotePlaceholder")}
                                    className="mt-2 min-h-[120px] rounded-xl bg-background shadow-sm"
                                  />
                                </div>

                                {Array.isArray(entry.sources) && entry.sources.length > 0 && (
                                  <div className="mt-4">
                                    <div className="text-xs font-medium text-muted-foreground">{t("wordbookSourcesLabel")}</div>
                                    <div className="mt-2 flex flex-col gap-2">
                                      {entry.sources.slice(0, 3).map((s, idx) => (
                                        <div key={`${s.anchorKey}:${idx}`} className="rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                                          <div>{s.kind} · {new Date(s.capturedAt).toLocaleDateString()}</div>
                                          {s.domain ? <div className="truncate">{s.domain}</div> : null}
                                          {s.title ? <div className="truncate">{s.title}</div> : null}
                                          {s.platform ? <div className="truncate">{s.platform}</div> : null}
                                          {typeof s.timestampSec === "number" ? <div>t={s.timestampSec}s</div> : null}
                                          {s.snippet ? <div className="mt-1 text-foreground/70 line-clamp-2">{s.snippet}</div> : null}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        wordbookEntries.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                            <BookOpen className="h-12 w-12 opacity-20 mb-4" />
                            <p className="text-sm font-medium">{t("wordbookTitle")}</p>
                            <p className="text-xs text-muted-foreground mt-1">{isWordbookLoading ? t("wordbookLoading") : t("wordbookEmpty")}</p>
                            <Button
                              type="button"
                              variant="outline"
                              className="mt-4 rounded-xl"
                              onClick={() => setWordbookAddOpen(true)}
                            >
                              <PlusCircle className="h-4 w-4 mr-2" />
                              {t("wordbookAddButton")}
                            </Button>
                          </div>
                        ) : (
                          wordbookEntries.map((entry) => (
                            <div
                              key={entry.id}
                              className={cn(
                                "flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-muted/30",
                                wordbookSelectedId === entry.id ? "ring-2 ring-primary/30" : "",
                              )}
                            >
                              {wordbookBulkMode && (
                                <div className="pt-1">
                                  <Checkbox
                                    checked={wordbookSelectedIds.has(entry.id)}
                                    onCheckedChange={(checked) => {
                                      setWordbookSelectedIds((prev) => {
                                        const next = new Set(prev);
                                        if (checked) next.add(entry.id);
                                        else next.delete(entry.id);
                                        return next;
                                      });
                                    }}
                                    aria-label={t("wordbookSelectedCount", [String(wordbookSelectedIds.size)])}
                                  />
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  if (wordbookBulkMode) {
                                    setWordbookSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(entry.id)) next.delete(entry.id);
                                      else next.add(entry.id);
                                      return next;
                                    });
                                    return;
                                  }

                                  selectWordbookEntry(entry);
                                }}
                                className={cn(
                                  "flex-1 min-w-0 flex items-start justify-between gap-3 text-left",
                                  wordbookBulkMode && "cursor-pointer",
                                )}
                                >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm truncate">{entry.term}</span>
                                    <Badge
                                      variant="outline"
                                      className={cn("shrink-0", wordbookStateBadgeClassName(entry.state))}
                                    >
                                      {wordbookStateLabel(entry.state)}
                                    </Badge>
                                  </div>
                                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{entry.language}</span>
                                    {typeof entry.updatedAt === "number" ? (
                                      <>
                                        <span className="opacity-40">•</span>
                                        <span>{formatTimestampLabel(entry.updatedAt)}</span>
                                      </>
                                    ) : null}
                                  </div>
                                  {Array.isArray(entry.tags) && entry.tags.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      {entry.tags.slice(0, 2).map((tag) => (
                                        <Badge
                                          key={tag}
                                          variant="outline"
                                          className="border-border bg-background/70 text-muted-foreground text-[11px] px-2 py-0.5 rounded-full"
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                      {entry.tags.length > 2 ? (
                                        <span className="text-xs text-muted-foreground">
                                          +{entry.tags.length - 2}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {entry.note ? <div className="text-xs text-muted-foreground mt-2 line-clamp-2">{entry.note}</div> : null}
                                </div>
                              </button>
                            </div>
                          ))
                        )
                      )
                    ) : (
                      // Desktop: split view (list + detail)
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-2">
                          {wordbookEntries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                              <BookOpen className="h-12 w-12 opacity-20 mb-4" />
                              <p className="text-sm font-medium">{t("wordbookTitle")}</p>
                              <p className="text-xs text-muted-foreground mt-1">{isWordbookLoading ? t("wordbookLoading") : t("wordbookEmpty")}</p>
                              <Button
                                type="button"
                                variant="outline"
                                className="mt-4 rounded-xl"
                                onClick={() => setWordbookAddOpen(true)}
                              >
                                <PlusCircle className="h-4 w-4 mr-2" />
                                {t("wordbookAddButton")}
                              </Button>
                            </div>
                          ) : (
                            wordbookEntries.map((entry) => (
                              <div
                                key={entry.id}
                                className={cn(
                                  "flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-muted/30",
                                  wordbookSelectedId === entry.id ? "ring-2 ring-primary/30" : "",
                                )}
                              >
                                {wordbookBulkMode && (
                                  <div className="pt-1">
                                    <Checkbox
                                      checked={wordbookSelectedIds.has(entry.id)}
                                      onCheckedChange={(checked) => {
                                        setWordbookSelectedIds((prev) => {
                                          const next = new Set(prev);
                                          if (checked) next.add(entry.id);
                                          else next.delete(entry.id);
                                          return next;
                                        });
                                      }}
                                      aria-label={t("wordbookSelectedCount", [String(wordbookSelectedIds.size)])}
                                    />
                                  </div>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (wordbookBulkMode) {
                                      setWordbookSelectedIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(entry.id)) next.delete(entry.id);
                                        else next.add(entry.id);
                                        return next;
                                      });
                                      return;
                                    }

                                    selectWordbookEntry(entry);
                                  }}
                                  className={cn(
                                    "flex-1 min-w-0 flex items-start justify-between gap-3 text-left",
                                    wordbookBulkMode && "cursor-pointer",
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm truncate">{entry.term}</span>
                                      <Badge
                                        variant="outline"
                                        className={cn("shrink-0", wordbookStateBadgeClassName(entry.state))}
                                      >
                                        {wordbookStateLabel(entry.state)}
                                      </Badge>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                      <span>{entry.language}</span>
                                      {typeof entry.updatedAt === "number" ? (
                                        <>
                                          <span className="opacity-40">•</span>
                                          <span>{formatTimestampLabel(entry.updatedAt)}</span>
                                        </>
                                      ) : null}
                                    </div>
                                    {Array.isArray(entry.tags) && entry.tags.length > 0 ? (
                                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                        {entry.tags.slice(0, 2).map((tag) => (
                                          <Badge
                                            key={tag}
                                            variant="outline"
                                            className="border-border bg-background/70 text-muted-foreground text-[11px] px-2 py-0.5 rounded-full"
                                          >
                                            {tag}
                                          </Badge>
                                        ))}
                                        {entry.tags.length > 2 ? (
                                          <span className="text-xs text-muted-foreground">
                                            +{entry.tags.length - 2}
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {entry.note ? <div className="text-xs text-muted-foreground mt-2 line-clamp-2">{entry.note}</div> : null}
                                  </div>
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="rounded-xl border border-border bg-card shadow-sm p-4">
                          {(() => {
                            const entry = wordbookEntries.find((e) => e.id === wordbookSelectedId) ?? null;
                            if (!entry) {
                              return (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                  <BookOpen className="h-10 w-10 opacity-20 mb-3" />
                                  <div className="text-sm font-medium">{t("wordbookSelectEntry")}</div>
                                  <div className="text-xs mt-1">{t("wordbookDetailHint")}</div>
                                </div>
                              );
                            }

                            return (
                              <div className="flex flex-col gap-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-lg font-semibold truncate">{entry.term}</div>
                                    <div className="text-xs text-muted-foreground mt-1">{entry.language}</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {(() => {
                                      const label =
                                        wordbookSaveStatus === "saving"
                                          ? t("optionsSaving")
                                          : wordbookSaveStatus === "saved"
                                            ? t("optionsSaveSuccess")
                                            : wordbookSaveStatus === "error"
                                              ? t("optionsSaveError", wordbookSaveErrorRef.current || "Error")
                                              : wordbookSaveStatus === "dirty"
                                                ? t("wordbookUnsaved")
                                                : "";

                                      return label ? (
                                        <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                                          {label}
                                        </Badge>
                                      ) : null;
                                    })()}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs font-medium text-muted-foreground">{t("wordbookStateLabel")}</div>
                                  <Select
                                    value={wordbookDraftState}
                                    onValueChange={(v) => {
                                      setWordbookDraftState(v as any);
                                      setWordbookSaveStatus("dirty");
                                    }}
                                  >
                                    <SelectTrigger className="h-9 rounded-xl bg-background shadow-sm w-[140px]">
                                      <SelectValue placeholder={t("wordbookStateLabel")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="active">{t("wordbookStateActive")}</SelectItem>
                                      <SelectItem value="archived">{t("wordbookStateArchived")}</SelectItem>
                                      <SelectItem value="ignored">{t("wordbookStateIgnored")}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div>
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      {t("wordCard_sectionDefinition")}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
                                      disabled={wordbookExplainById[entry.id]?.status === "loading"}
                                      onClick={() => void fetchWordbookDefinition(entry, { force: true })}
                                    >
                                      {t("summaryRefresh")}
                                    </Button>
                                  </div>

                                  <div className="mt-2 rounded-xl border border-border bg-background/60 px-3 py-2">
                                    {wordbookExplainById[entry.id]?.status === "loading" ? (
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>{t("wordCard_loading")}</span>
                                      </div>
                                    ) : wordbookExplainById[entry.id]?.data ? (
                                      <div>
                                        {wordbookExplainById[entry.id]?.data?.phonetic ||
                                        wordbookExplainById[entry.id]?.data?.difficulty ? (
                                          <div className="mb-2 flex flex-wrap items-center gap-2">
                                            {wordbookExplainById[entry.id]?.data?.phonetic ? (
                                              <span className="text-xs text-muted-foreground">
                                                {wordbookExplainById[entry.id]?.data?.phonetic}
                                              </span>
                                            ) : null}
                                            {wordbookExplainById[entry.id]?.data?.difficulty ? (
                                              <Badge
                                                variant="outline"
                                                className="border-border bg-background text-muted-foreground text-[11px] px-2 py-0.5 rounded-full"
                                              >
                                                {wordbookExplainById[entry.id]?.data?.difficulty}
                                              </Badge>
                                            ) : null}
                                          </div>
                                        ) : null}
                                        {wordbookExplainById[entry.id]?.data?.targets &&
                                        wordbookExplainById[entry.id]?.data?.targets?.length &&
                                        wordbookExplainById[entry.id]?.data?.targets?.[0] !==
                                          wordbookExplainById[entry.id]?.data?.definition?.trim() ? (
                                          <div className="mb-2 text-xs text-muted-foreground whitespace-pre-wrap">
                                            {wordbookExplainById[entry.id]?.data?.targets?.[0]}
                                          </div>
                                        ) : null}
                                        <div className="text-sm leading-relaxed whitespace-pre-wrap">
                                          {wordbookExplainById[entry.id]?.data?.definition}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-muted-foreground">
                                        {t("wordCard_definitionUnavailable")}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div>
                                  <div className="text-xs font-medium text-muted-foreground">{t("wordbookTagsLabel")}</div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {wordbookDraftTags.map((tag) => (
                                      <span key={tag} className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-xs">
                                        <span className="max-w-[220px] truncate">{tag}</span>
                                        <button
                                          type="button"
                                          className="text-muted-foreground hover:text-foreground"
                                          onClick={() => {
                                            setWordbookDraftTags((prev) => prev.filter((t) => t !== tag));
                                            setWordbookSaveStatus("dirty");
                                          }}
                                          title={t("chatRemove")}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                  <Input
                                    value={wordbookDraftTagInput}
                                    onChange={(e) => setWordbookDraftTagInput(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        applyWordbookTag();
                                      }
                                    }}
                                    placeholder={t("wordbookTagPlaceholder")}
                                    className="mt-2 h-10 rounded-xl bg-background shadow-sm"
                                  />
                                </div>

                                <div>
                                  <div className="text-xs font-medium text-muted-foreground">{t("wordbookNoteLabel")}</div>
                                  <Textarea
                                    value={wordbookDraftNote}
                                    onChange={(e) => {
                                      setWordbookDraftNote(e.target.value);
                                      setWordbookSaveStatus("dirty");
                                    }}
                                    placeholder={t("wordbookNotePlaceholder")}
                                    className="mt-2 min-h-[140px] rounded-xl bg-background shadow-sm"
                                  />
                                </div>

                                {Array.isArray(entry.sources) && entry.sources.length > 0 && (
                                  <div>
                                    <div className="text-xs font-medium text-muted-foreground">{t("wordbookSourcesLabel")}</div>
                                    <div className="mt-2 flex flex-col gap-2">
                                      {entry.sources.slice(0, 3).map((s, idx) => (
                                        <div key={`${s.anchorKey}:${idx}`} className="rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                                          <div>{s.kind} · {new Date(s.capturedAt).toLocaleDateString()}</div>
                                          {s.domain ? <div className="truncate">{s.domain}</div> : null}
                                          {s.title ? <div className="truncate">{s.title}</div> : null}
                                          {s.platform ? <div className="truncate">{s.platform}</div> : null}
                                          {typeof s.timestampSec === "number" ? <div>t={s.timestampSec}s</div> : null}
                                          {s.snippet ? <div className="mt-1 text-foreground/70 line-clamp-2">{s.snippet}</div> : null}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )
                  ) : (

                    sessionsForCurrentFilter.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <MessageSquare className="h-12 w-12 opacity-20 mb-4" />
                        <p className="text-sm font-medium">{t("chatNoHistory") || "No history yet"}</p>
                      </div>
                    ) : (
                      sessionsForCurrentFilter.map((session) => (
                        <button
                          key={session.sessionId}
                          onClick={() => {
                            detachUiStream();
                            hydrateContextFromSession(session);
                            void loadMessages(session.sessionId);
                            setActivePanel("chat");
                          }}
                          className={cn(
                            "flex flex-col gap-1 p-4 rounded-xl text-left transition-colors border border-border shadow-sm",
                            conversationId === session.sessionId
                              ? "bg-muted/30 text-foreground"
                              : "bg-card hover:bg-muted/30"
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="font-medium text-sm truncate max-w-[180px]">
                                {(() => {
                                  const label = typeof session.label === "string" ? session.label.trim() : "";
                                  const keyword = typeof session.keyword === "string" ? session.keyword.trim() : "";

                                  if (session.kind === "general") {
                                    if (!label || label.toLowerCase() === "general") return t("chatGeneralConversation");
                                    return label;
                                  }

                                  return label || keyword || t("chatGeneralConversation");
                                })()}
                              </span>
                                  <Badge variant="outline" className="border-border bg-muted text-muted-foreground shrink-0">
                                    {session.kind === "keyword"
                                      ? t("chatHistoryKindWords")
                                      : session.kind === "web"
                                        ? t("chatHistoryKindWeb")
                                        : session.kind === "subtitle"
                                          ? t("chatHistoryKindVideo")
                                          : session.kind === "general"
                                            ? t("chatHistoryKindGeneral")
                                            : session.kind}
                                  </Badge>
                            </div>
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
              <div className="relative flex-1 overflow-hidden">
                <ScrollArea viewportRef={scrollViewportRef} className="h-full px-4">
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
                            <div
                              className={cn(
                                "h-9 w-9 mt-1 rounded-xl flex items-center justify-center shrink-0 border shadow-sm",
                                msg.role === "user"
                                  ? "bg-primary border-primary/50 text-primary-foreground"
                                  : "bg-card border-border",
                              )}
                            >
                              {msg.role === "user" ? (
                                <User className="h-4 w-4" />
                              ) : (
                                <Bot className="h-4 w-4 text-primary" />
                              )}
                            </div>

                            <div
                              className={cn(
                                "relative rounded-xl px-4 py-3 text-sm leading-relaxed border shadow-sm",
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground border-primary/50 rounded-tr-none"
                                  : "bg-card text-foreground border-border rounded-tl-none",
                              )}
                            >
                              {msg.role === "assistant" ? (
                                <>
                                  {(msg.thinking?.trim() || msg.isThinkingStreaming) && (
                                    <div className="mb-3">
                                      <button
                                        type="button"
                                        onClick={() => toggleThinking(msg.id)}
                                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        <ChevronDown
                                          className={cn(
                                            "h-4 w-4 transition-transform",
                                            expandedThinkingById[msg.id] && "rotate-180",
                                          )}
                                        />
                                        <span>
                                          {expandedThinkingById[msg.id]
                                            ? t("chatHideThinking")
                                            : t("chatShowThinking")}
                                        </span>
                                        {msg.isThinkingStreaming && (
                                          <Loader2 className="h-3 w-3 animate-spin opacity-70" />
                                        )}
                                      </button>

                                      {expandedThinkingById[msg.id] && (
                                        <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-muted/20 p-3">
                                          <MessageContent
                                            content={msg.thinking ?? ""}
                                            isStreaming={Boolean(msg.isThinkingStreaming)}
                                            showCursor={false}
                                            className="text-xs text-muted-foreground leading-relaxed"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <MessageContent content={msg.content} isStreaming={Boolean(msg.isStreaming)} />
                                </>
                              ) : (
                                <div className="whitespace-pre-wrap break-words font-medium">{msg.content}</div>
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

                {activePanel === "chat" && messages.length > 0 && !isAtBottom && (
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => scrollToBottom("smooth")}
                    aria-label={t("chatScrollToBottom")}
                    title={t("chatScrollToBottom")}
                    className="absolute bottom-5 right-5 h-10 w-10 rounded-full border border-border bg-background/90 shadow-md backdrop-blur hover:bg-muted/40"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                )}
              </div>

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

                {(activeContextInfo?.kind === "subtitle" || activeContextInfo?.kind === "web") && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    {activeContextInfo.kind === "subtitle" && typeof activeContextInfo.title === "string" && activeContextInfo.title.trim() && (
                      activeContextSelection.title ? (
                        <button
                          type="button"
                          onClick={() => toggleContextPart("title")}
                          aria-pressed="true"
                          className={cn(
                            "flex max-w-full items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                            "border-border bg-background/80 text-foreground",
                          )}
                           title={t("chatToggleContextTitle")}
                        >
                          <span className="shrink-0">Title</span>
                          <span className="max-w-[240px] truncate">{activeContextInfo.title.trim()}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleContextPart("title")}
                          aria-pressed="false"
                          className={cn(
                            "flex max-w-full items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                            "border-border/60 bg-background/40 text-muted-foreground line-through decoration-muted-foreground/60",
                          )}
                           title={t("chatToggleContextTitle")}
                        >
                          <span className="shrink-0">Title</span>
                          <span className="max-w-[240px] truncate">{activeContextInfo.title.trim()}</span>
                        </button>
                      )
                    )}

                    {activeContextInfo.kind === "subtitle" && typeof activeContextInfo.timestampSec === "number" &&
                      Number.isFinite(activeContextInfo.timestampSec) && (
                        activeContextSelection.timestamp ? (
                          <button
                            type="button"
                            onClick={() => toggleContextPart("timestamp")}
                            aria-pressed="true"
                            className={cn(
                              "flex items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                              "border-border bg-background/80 text-foreground",
                            )}
                             title={t("chatToggleContextTime")}
                          >
                            <span className="shrink-0">Time</span>
                            <span className="tabular-nums">
                              {formatTimestampLabel(activeContextInfo.timestampSec)}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleContextPart("timestamp")}
                            aria-pressed="false"
                            className={cn(
                              "flex items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                              "border-border/60 bg-background/40 text-muted-foreground line-through decoration-muted-foreground/60",
                            )}
                             title={t("chatToggleContextTime")}
                          >
                            <span className="shrink-0">Time</span>
                            <span className="tabular-nums">
                              {formatTimestampLabel(activeContextInfo.timestampSec)}
                            </span>
                          </button>
                        )
                      )}

                    {activeContextInfo.kind === "subtitle" && Array.isArray(activeContextInfo.lines) && activeContextInfo.lines.length > 0 && (
                      activeContextSelection.snippet ? (
                        <button
                          type="button"
                          onClick={() => toggleContextPart("snippet")}
                          aria-pressed="true"
                          className={cn(
                            "flex items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                            "border-border bg-background/80 text-foreground",
                          )}
                           title={t("chatToggleContextSnippet")}
                        >
                          <span className="shrink-0">Snippet</span>
                          <span className="tabular-nums">{activeContextInfo.lines.length} lines</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleContextPart("snippet")}
                          aria-pressed="false"
                          className={cn(
                            "flex items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                            "border-border/60 bg-background/40 text-muted-foreground line-through decoration-muted-foreground/60",
                          )}
                           title={t("chatToggleContextSnippet")}
                        >
                          <span className="shrink-0">Snippet</span>
                          <span className="tabular-nums">{activeContextInfo.lines.length} lines</span>
                        </button>
                      )
                    )}

                    {activeContextInfo.kind === "web" && (
                      <>
                        {(typeof activeContextInfo.title === "string" && activeContextInfo.title.trim()) ||
                        (typeof activeContextInfo.domain === "string" && activeContextInfo.domain.trim()) ? (
                          activeContextSelection.title ? (
                            <button
                              type="button"
                              onClick={() => toggleContextPart("title")}
                              aria-pressed="true"
                              className={cn(
                                "flex max-w-full items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                                "border-border bg-background/80 text-foreground",
                              )}
                               title={t("chatToggleContextPage")}
                            >
                              <span className="shrink-0">Page</span>
                              <span className="max-w-[240px] truncate">
                                {(activeContextInfo.title ?? activeContextInfo.domain ?? "").trim()}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleContextPart("title")}
                              aria-pressed="false"
                              className={cn(
                                "flex max-w-full items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                                "border-border/60 bg-background/40 text-muted-foreground line-through decoration-muted-foreground/60",
                              )}
                               title={t("chatToggleContextPage")}
                            >
                              <span className="shrink-0">Page</span>
                              <span className="max-w-[240px] truncate">
                                {(activeContextInfo.title ?? activeContextInfo.domain ?? "").trim()}
                              </span>
                            </button>
                          )
                        ) : null}

                        {(() => {
                          const text =
                            typeof activeContextInfo.selectedText === "string"
                              ? activeContextInfo.selectedText.trim()
                              : "";

                          // Always show the Text chip (even when empty) so the UX stays consistent.
                          const count = text.length;

                          return activeContextSelection.snippet ? (
                            <button
                              type="button"
                              onClick={() => toggleContextPart("snippet")}
                              aria-pressed="true"
                              className={cn(
                                "flex items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                                "border-border bg-background/80 text-foreground",
                              )}
                              title={t("chatToggleContextText")}
                            >
                              <span className="shrink-0">Text</span>
                              <span className="tabular-nums">{count} chars</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleContextPart("snippet")}
                              aria-pressed="false"
                              className={cn(
                                "flex items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                                "border-border/60 bg-background/40 text-muted-foreground line-through decoration-muted-foreground/60",
                              )}
                              title={t("chatToggleContextText")}
                            >
                              <span className="shrink-0">Text</span>
                              <span className="tabular-nums">{count} chars</span>
                            </button>
                          );
                        })()}
                      </>
                    )}
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-3xl border border-border bg-background/80 p-2 shadow-sm backdrop-blur focus-within:ring-2 focus-within:ring-ring/25 focus-within:ring-offset-2 focus-within:ring-offset-background">
                  <Textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t("chatPlaceholder")}
                    disabled={isLoading}
                    rows={1}
                    style={{ minHeight: 44 }}
                    className="flex-1 !min-h-[44px] max-h-[176px] resize-none rounded-xl border-0 bg-transparent px-3 py-3 leading-5 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Button
                    onClick={isLoading ? handleStop : handleSend}
                    disabled={isLoading ? false : !inputValue.trim()}
                    variant={isLoading ? "destructive" : "default"}
                    aria-label={isLoading ? t("chatStop") : t("chatSend")}
                    title={isLoading ? t("chatStop") : t("chatSend")}
                    className={cn(
                      "h-11 w-11 shrink-0 rounded-full shadow-sm",
                      !isLoading && !inputValue.trim() && "opacity-50 grayscale",
                    )}
                  >
                    {isLoading ? <SquareStop className="h-5 w-5" /> : <Send className="h-5 w-5" />}
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
