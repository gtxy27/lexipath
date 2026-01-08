import React, { useState } from "react";
import type { RouteKind } from "@lexipath/core";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useToast } from "../../components/ui/use-toast";
import { cn } from "../../lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Zap } from "lucide-react";
import { AiGate } from "../AiGate";
import {
  BEHAVIOR_KIND_ALLOWLIST,
  FOLLOW_TRANSLATE_BEHAVIOR_KEYS,
  behaviorDesc,
  behaviorLabel,
  routeKindLabel,
} from "../optionsLogic";
import { t } from "../optionsI18n";
import { sendMessage } from "../optionsMessages";
import type {
  BehaviorKey,
  FieldErrors,
  FormState,
  RouteFormState,
} from "../optionsTypes";

const coreRoutingKeys: readonly BehaviorKey[] = ["translate", "chat"];
const learningRoutingKeys: readonly BehaviorKey[] = [
  "select_keywords",
  "translate_keywords",
  "dictionary",
  "english_correction",
];
const subtitleRoutingKeys: readonly BehaviorKey[] = ["adapt_subtitle"];

export function RoutingTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  errors: FieldErrors;
  aiEnabled: boolean;
  onOpenChannels: () => void;
  embedded?: boolean;
}): React.ReactElement {
  const { toast } = useToast();
  const { form, setForm, errors, aiEnabled, onOpenChannels, embedded = false } =
    props;
  const [routingLearningOpen, setRoutingLearningOpen] = useState(false);
  const [routingSubtitleOpen, setRoutingSubtitleOpen] = useState(false);

  const routeKindOptions = (allowed: RouteKind[]) =>
    allowed.map((kind) => (
      <SelectItem key={String(kind)} value={String(kind)}>
        {routeKindLabel(kind)}
      </SelectItem>
    ));

  function isFollowTranslateBehavior(key: BehaviorKey): boolean {
    return FOLLOW_TRANSLATE_BEHAVIOR_KEYS.includes(key);
  }

  function applyTranslateFollowers(
    routes: Record<BehaviorKey, RouteFormState>,
    translateRoute: RouteFormState,
  ): Record<BehaviorKey, RouteFormState> {
    const next = { ...routes };
    for (const key of FOLLOW_TRANSLATE_BEHAVIOR_KEYS) {
      const route = next[key];
      if (!route.followTranslate) continue;
      next[key] = {
        ...route,
        kind: translateRoute.kind,
        channelId: translateRoute.kind === 1 ? translateRoute.channelId : null,
      };
    }
    return next;
  }

  function updateBehaviorRoute(key: BehaviorKey, nextRoute: RouteFormState) {
    setForm((current) => {
      const nextRoutes: Record<BehaviorKey, RouteFormState> = {
        ...current.behaviorRoutes,
        [key]: nextRoute,
      };

      if (key === "translate") {
        return {
          ...current,
          behaviorRoutes: applyTranslateFollowers(nextRoutes, nextRoute),
        };
      }

      return { ...current, behaviorRoutes: nextRoutes };
    });
  }

  function renderRoutingRow(key: BehaviorKey, isNested = false) {
    const route = form.behaviorRoutes[key];
    const allowedKinds = BEHAVIOR_KIND_ALLOWLIST[key];
    const routeError = errors.routes?.[key];

    const translateRoute = form.behaviorRoutes.translate;
    const followSupported = isFollowTranslateBehavior(key);

    const kindValue =
      followSupported && route.followTranslate ? "follow" : String(route.kind);

    return (
      <div
        key={key}
        className={cn(
          "relative flex flex-col md:flex-row md:items-center justify-between gap-5 transition-all",
          isNested
            ? "bg-transparent py-5 px-2 border-b border-gray-100 dark:border-white/5 last:border-0"
            : "bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-5 hover:shadow-md",
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "h-12 w-12 rounded-xl flex items-center justify-center shadow-sm transition-colors",
              isNested
                ? "bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5"
                : "bg-indigo-50 dark:bg-white/5 border border-indigo-100 dark:border-white/5",
            )}
          >
            <Zap
              className={cn(
                "h-6 w-6",
                isNested
                  ? "text-gray-400 dark:text-gray-500"
                  : "text-indigo-500 dark:text-indigo-400",
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4
                className={cn(
                  "font-bold text-gray-900 dark:text-white",
                  isNested ? "text-sm" : "text-base",
                )}
              >
                {behaviorLabel(key)}
              </h4>
              {followSupported && route.followTranslate && (
                <Badge className="bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20">
                  {t("optionsRouteFollowTranslate")}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {behaviorDesc(key)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Select
              value={kindValue}
              onValueChange={(v) => {
                if (followSupported && v === "follow") {
                  updateBehaviorRoute(key, {
                    ...route,
                    followTranslate: true,
                    kind: translateRoute.kind,
                    channelId:
                      translateRoute.kind === 1 ? translateRoute.channelId : null,
                  });
                  return;
                }

                const kind = Number(v) as RouteKind;
                updateBehaviorRoute(key, {
                  ...route,
                  followTranslate: false,
                  kind,
                  channelId:
                    kind === 1
                      ? (route.channelId ?? (form.channels[0]?.channelId ?? null))
                      : null,
                });
              }}
            >
              <SelectTrigger
                data-testid={`route-kind-${key}`}
                className="w-40 bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-10 font-bold text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                {followSupported && (
                  <SelectItem value="follow">
                    {t("optionsRouteFollowTranslate")}
                  </SelectItem>
                )}
                {routeKindOptions(allowedKinds)}
              </SelectContent>
            </Select>

            {route.kind === 1 && !(followSupported && route.followTranslate) && (
              <Select
                value={route.channelId === null ? "null" : String(route.channelId)}
                onValueChange={(v) =>
                  updateBehaviorRoute(key, {
                    ...route,
                    channelId: v === "null" ? null : Number(v),
                  })
                }
              >
                <SelectTrigger className="w-48 bg-indigo-50/50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl h-10 font-bold text-xs">
                  <SelectValue placeholder={t("optionsRouteChannelPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                  {form.channels.map((ch) => (
                    <SelectItem key={ch.channelId} value={String(ch.channelId)}>
                      {ch.name || `#${ch.channelId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {routeError && (
            <p className="text-[10px] text-rose-500 font-bold ml-1">
              {t(routeError)}
            </p>
          )}
        </div>
      </div>
    );
  }

  async function testGoogleTranslate() {
    const response = await sendMessage("TEST_PROVIDER_CONNECTION", {
      type: "google",
    });
    if (response.ok) {
      toast({ title: t("optionsTestSuccess") });
    } else {
      toast({
        title: t("optionsTestError", response.error.message),
        variant: "destructive",
      });
    }
  }

  async function testBingTranslate() {
    const response = await sendMessage("TEST_PROVIDER_CONNECTION", {
      type: "bing",
    });
    if (response.ok) {
      toast({ title: t("optionsTestSuccess") });
    } else {
      toast({
        title: t("optionsTestError", response.error.message),
        variant: "destructive",
      });
    }
  }

  const body = (
    <>
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
              {t("optionsRoutingGroupCoreTitle")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("optionsRoutingGroupCoreDesc")}
            </p>
          </div>
          <div className="grid gap-4">{coreRoutingKeys.map((key) => renderRoutingRow(key))}</div>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setRoutingLearningOpen(!routingLearningOpen)}
            className="w-full flex items-center justify-between bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl px-5 py-4 hover:shadow-sm transition-all"
          >
            <div className="text-left space-y-1">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                {t("optionsRoutingGroupLearningTitle")}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("optionsRoutingGroupLearningDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {routingLearningOpen
                  ? t("optionsRoutingGroupCollapse")
                  : t("optionsRoutingGroupExpand")}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-gray-400 transition-transform",
                  routingLearningOpen ? "rotate-90" : "rotate-0",
                )}
              />
            </div>
          </button>

          <AnimatePresence>
            {routingLearningOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden bg-gray-50/30 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 rounded-2xl px-4"
              >
                {learningRoutingKeys.map((key) => renderRoutingRow(key, true))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setRoutingSubtitleOpen(!routingSubtitleOpen)}
            className="w-full flex items-center justify-between bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl px-5 py-4 hover:shadow-sm transition-all"
          >
            <div className="text-left space-y-1">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                {t("optionsRoutingGroupSubtitleTitle")}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("optionsRoutingGroupSubtitleDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {routingSubtitleOpen
                  ? t("optionsRoutingGroupCollapse")
                  : t("optionsRoutingGroupExpand")}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-gray-400 transition-transform",
                  routingSubtitleOpen ? "rotate-90" : "rotate-0",
                )}
              />
            </div>
          </button>

          <AnimatePresence>
            {routingSubtitleOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden bg-gray-50/30 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 rounded-2xl px-4"
              >
                {subtitleRoutingKeys.map((key) => renderRoutingRow(key, true))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-6">
        <Button
          variant="outline"
          onClick={testGoogleTranslate}
          className="h-10 px-6 rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 font-bold text-[10px] uppercase tracking-widest transition-all shadow-sm"
        >
          {t("optionsTestGoogleTranslate")}
        </Button>
        <Button
          variant="outline"
          onClick={testBingTranslate}
          className="h-10 px-6 rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 font-bold text-[10px] uppercase tracking-widest transition-all shadow-sm"
        >
          {t("optionsTestBingTranslate")}
        </Button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        {body}
      </AiGate>
    );
  }

  return (
    <>
      <header className="space-y-3">
        <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
          {t("optionsRoutingTitle")}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">
          {t("optionsRoutingDesc")}
        </p>
      </header>

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        {body}
      </AiGate>
    </>
  );
}
