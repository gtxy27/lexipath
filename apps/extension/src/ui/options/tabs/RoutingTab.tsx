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
import { ChevronRight, SlidersHorizontal, Zap } from "lucide-react";
import { AiGate } from "../AiGate";
import { OptionsPageHeader } from "../components/OptionsPageHeader";
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
            ? "bg-transparent py-5 px-2 border-b border-border last:border-0"
            : "bg-card border border-border rounded-xl p-5",
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "h-12 w-12 rounded-lg flex items-center justify-center border transition-colors",
              isNested
                ? "bg-muted/40 border-border"
                : "bg-primary/10 border-border",
            )}
          >
            <Zap
              className={cn(
                "h-6 w-6",
                isNested
                  ? "text-muted-foreground"
                  : "text-primary",
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4
                className={cn(
                  "font-medium",
                  isNested ? "text-sm" : "text-base",
                )}
              >
                {behaviorLabel(key)}
              </h4>
              {followSupported && route.followTranslate && (
                <Badge className="border border-border bg-muted text-muted-foreground">
                  {t("optionsRouteFollowTranslate")}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
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
                className="w-40 h-10 rounded-lg text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
                <SelectTrigger className="w-48 h-10 rounded-lg text-xs">
                  <SelectValue placeholder={t("optionsRouteChannelPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
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
            <p className="text-xs text-destructive">
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
            <h3 className="text-sm font-medium">
              {t("optionsRoutingGroupCoreTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("optionsRoutingGroupCoreDesc")}
            </p>
          </div>
          <div className="grid gap-4">{coreRoutingKeys.map((key) => renderRoutingRow(key))}</div>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setRoutingLearningOpen(!routingLearningOpen)}
            className="w-full flex items-center justify-between bg-card border border-border rounded-xl px-5 py-4"
          >
            <div className="text-left space-y-1">
              <h3 className="text-sm font-medium">
                {t("optionsRoutingGroupLearningTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("optionsRoutingGroupLearningDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {routingLearningOpen
                  ? t("optionsRoutingGroupCollapse")
                  : t("optionsRoutingGroupExpand")}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
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
                className="overflow-hidden bg-muted/15 border border-border rounded-xl px-4"
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
            className="w-full flex items-center justify-between bg-card border border-border rounded-xl px-5 py-4"
          >
            <div className="text-left space-y-1">
              <h3 className="text-sm font-medium">
                {t("optionsRoutingGroupSubtitleTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("optionsRoutingGroupSubtitleDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {routingSubtitleOpen
                  ? t("optionsRoutingGroupCollapse")
                  : t("optionsRoutingGroupExpand")}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
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
                className="overflow-hidden bg-muted/15 border border-border rounded-xl px-4"
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
          className="h-10 px-4 rounded-lg text-xs font-medium"
        >
          {t("optionsTestGoogleTranslate")}
        </Button>
        <Button
          variant="outline"
          onClick={testBingTranslate}
          className="h-10 px-4 rounded-lg text-xs font-medium"
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
      <OptionsPageHeader
        title={t("optionsRoutingTitle")}
        description={t("optionsRoutingDesc")}
        icon={SlidersHorizontal}
      />

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        {body}
      </AiGate>
    </>
  );
}
