import React, { useEffect, useMemo, useState } from "react";
import { sendMessage } from "../../../shared/messages";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { t } from "../optionsI18n";
import {
  Activity,
  BookOpenText,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Flame,
  Loader2,
  Palette,
  RotateCw,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";

type UsageBucket = { events: number; apiEvents: number; words: number };
type DailyUsageSummary = {
  date: string;
  updatedAt: number;
  totals: UsageBucket;
  tasks: Record<string, UsageBucket>;
  providers: Record<string, UsageBucket>;
};
type UsageSummaryResponse = { today: DailyUsageSummary; recentDays: DailyUsageSummary[] };

type EnglishCorrectionOutcomeBucket = { requests: number; correct: number; incorrect: number };
type DailyEnglishCorrectionOutcomeSummary = {
  date: string;
  updatedAt: number;
  totals: EnglishCorrectionOutcomeBucket;
};
type EnglishCorrectionOutcomeSummaryResponse = {
  today: DailyEnglishCorrectionOutcomeSummary;
  recentDays: DailyEnglishCorrectionOutcomeSummary[];
};

const VISIBLE_TASK_KEYS = new Set([
  "exposure_valid",
  "word_card_opened",
  "english_correction",
  "chat",
]);

function minutesAgo(timestampMs: number): number {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 0;
  return Math.max(0, Math.round((Date.now() - timestampMs) / 60000));
}

function formatInt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.max(0, Math.floor(value)).toLocaleString();
}

function percent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

type DetailMetricKey = "words" | "events" | "apiEvents";
type EnglishCorrectionDetailMetricKey = "success" | "failure" | "operations";

function toShortDateLabel(date: string): string {
  // Expect YYYY-MM-DD; keep it resilient.
  if (typeof date !== "string") return "";
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return date;
  return `${match[1]}-${match[2]}`;
}

function safeMax(values: number[]): number {
  let max = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    max = Math.max(max, value);
  }
  return max;
}

function TrendChart(props: {
  series: Array<{ date: string; value: number }>;
  tone?: "primary" | "muted";
}): React.ReactElement {
  const series = props.series ?? [];
  const first = series[0];
  const last = series.length > 0 ? series[series.length - 1] : undefined;
  const maxValue = safeMax(series.map((d) => d.value));

  const width = 720;
  const height = 180;
  const paddingX = 18;
  const paddingY = 18;
  const innerWidth = Math.max(1, width - paddingX * 2);
  const innerHeight = Math.max(1, height - paddingY * 2);

  const points = series.map((d, index) => {
    const x =
      paddingX + (innerWidth * (series.length <= 1 ? 0 : index / (series.length - 1)));
    const ratio = maxValue > 0 ? clamp01(d.value / maxValue) : 0;
    const y = paddingY + (1 - ratio) * innerHeight;
    return { x, y, date: d.date, value: d.value };
  });

  const linePath = (() => {
    if (points.length === 0) return "";
    return points
      .map((p, index) => `${index === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
  })();

  const areaPath = (() => {
    if (points.length === 0) return "";
    const first = points[0]!;
    const last = points[points.length - 1]!;
    return `${linePath} L ${last.x.toFixed(1)} ${(paddingY + innerHeight).toFixed(1)} L ${first.x.toFixed(
      1,
    )} ${(paddingY + innerHeight).toFixed(1)} Z`;
  })();

  return (
    <div className="rounded-xl border border-border bg-muted/10 p-3 overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44"
        role="img"
        aria-label={t("summaryTrendTitle")}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="lx-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g opacity="0.55">
          {[0.25, 0.5, 0.75].map((t) => {
            const y = paddingY + innerHeight * t;
            return (
              <line
                key={t}
                x1={paddingX}
                x2={paddingX + innerWidth}
                y1={y}
                y2={y}
                stroke="hsl(var(--border))"
                strokeWidth="1"
              />
            );
          })}
        </g>

        {areaPath ? <path d={areaPath} fill="url(#lx-trend-fill)" /> : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2.25"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {points.map((p) => (
          <g key={p.date}>
            <circle cx={p.x} cy={p.y} r="3" fill="hsl(var(--primary))" opacity="0.9">
              <title>{`${p.date}: ${formatInt(p.value)}`}</title>
            </circle>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex items-center justify-between gap-4 text-[11px] text-muted-foreground tabular-nums">
        <span>{first?.date ? toShortDateLabel(first.date) : "--"}</span>
        <span>{last?.date ? toShortDateLabel(last.date) : "--"}</span>
      </div>
    </div>
  );
}

function StatCard(props: {
  title: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: "default" | "primary";
  onClick?: () => void;
}): React.ReactElement {
  const Icon = props.icon;
  const card = (
    <Card
      className={cn(
        "shadow-none overflow-hidden",
        props.onClick ? "transition-colors hover:bg-muted/15" : null,
      )}
    >
      <CardHeader className="p-4 pb-2 relative">
        <div
          className={cn(
            "pointer-events-none absolute inset-0 opacity-60",
            props.tone === "primary"
              ? "bg-gradient-to-br from-primary/12 dark:from-primary/6 via-transparent to-transparent"
              : "bg-gradient-to-br from-muted/50 via-transparent to-transparent",
          )}
        />
        <div className="flex items-center justify-between gap-4">
          <CardDescription className="text-xs">{props.title}</CardDescription>
          <div
            className={cn(
              "h-8 w-8 rounded-lg border flex items-center justify-center shadow-sm",
              props.tone === "primary"
                ? "bg-primary/10 border-primary/25"
                : "bg-muted/40 border-border",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4",
                props.tone === "primary" ? "text-primary" : "text-muted-foreground",
              )}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="text-[26px] leading-none font-semibold tracking-tight">
          {props.value}
        </div>
        {props.hint ? (
          <div className="mt-1 text-xs text-muted-foreground">{props.hint}</div>
        ) : null}
        {props.onClick ? (
          <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>{t("summaryDetailsOpen")}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  if (!props.onClick) return card;

  return (
    <button
      type="button"
      onClick={props.onClick}
      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl"
    >
      {card}
    </button>
  );
}

function providerLabel(key: string): string {
  switch (key) {
    case "openai":
      return "OpenAI";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    case "google":
      return "Google Translate";
    case "bing":
      return "Bing Translate";
    case "offline":
      return t("summaryProvider_offline");
    default:
      return key;
  }
}

function providerIcon(key: string): LucideIcon {
  switch (key) {
    case "openai":
    case "claude":
    case "gemini":
      return Sparkles;
    case "google":
    case "bing":
      return Palette;
    default:
      return Activity;
  }
}

function taskMeta(taskKey: string): { title: string; icon: LucideIcon } {
  switch (taskKey) {
    case "word_card_opened":
      return { title: t("summaryTask_wordCardOpened"), icon: Search };
    case "exposure_valid":
      return { title: t("summaryTask_exposureValid"), icon: Sparkles };
    case "english_correction":
      return { title: t("summaryTask_englishCorrection"), icon: CheckCheck };
    case "chat":
      return { title: t("summaryTask_chat"), icon: Sparkles };
    default:
      return { title: taskKey, icon: Sparkles };
  }
}

export function SummaryTab(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageSummaryResponse | null>(null);
  const [englishCorrectionOutcomes, setEnglishCorrectionOutcomes] =
    useState<EnglishCorrectionOutcomeSummaryResponse | null>(null);
  const [detailTaskKey, setDetailTaskKey] = useState<string | null>(null);
  const [detailMetric, setDetailMetric] = useState<DetailMetricKey>("words");
  const [englishCorrectionDetailMetric, setEnglishCorrectionDetailMetric] =
    useState<EnglishCorrectionDetailMetricKey>("operations");

  async function load() {
    setError(null);
    const [usageResponse, outcomeResponse] = await Promise.all([
      sendMessage("GET_USAGE_SUMMARY", undefined),
      sendMessage("GET_ENGLISH_CORRECTION_OUTCOME_SUMMARY", { days: 7 }),
    ]);

    if (!usageResponse.ok) {
      setError(usageResponse.error.message);
      return;
    }

    setData(usageResponse.value);

    if (outcomeResponse.ok) {
      setEnglishCorrectionOutcomes(outcomeResponse.value);
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = data?.today;
  const totals = today?.totals;

  const providerRows = useMemo(() => {
    const providers = today?.providers ?? {};
    const rows = Object.entries(providers)
      .map(([key, bucket]) => ({
        key,
        label: providerLabel(key),
        events: bucket.events ?? 0,
        apiEvents: bucket.apiEvents ?? 0,
        words: bucket.words ?? 0,
      }))
      .filter((row) => row.apiEvents > 0);

    rows.sort((a, b) => b.apiEvents - a.apiEvents);
    return rows;
  }, [today?.providers]);

  const recentSeries = useMemo(() => {
    const days = data?.recentDays ?? [];
    const series = days
      .slice()
      .reverse()
      .map((day) => {
        const exposure = day.tasks?.exposure_valid?.words ?? 0;
        const lookups = day.tasks?.word_card_opened?.events ?? 0;
        return {
          date: day.date,
          exposure,
          lookups,
        };
      });

    const maxExposure = series.reduce((m, d) => Math.max(m, d.exposure), 0);
    const maxLookups = series.reduce((m, d) => Math.max(m, d.lookups), 0);

    return {
      series,
      maxExposure,
      maxLookups,
    };
  }, [data?.recentDays]);

  const taskRows = useMemo(() => {
    const tasks = today?.tasks ?? {};
    const rows = Object.entries(tasks)
      .map(([key, bucket]) => ({
        key,
        meta: taskMeta(key),
        events: bucket.events ?? 0,
        apiEvents: bucket.apiEvents ?? 0,
        words: bucket.words ?? 0,
      }))
      .filter((row) => VISIBLE_TASK_KEYS.has(row.key))
      .filter((row) => row.events > 0 || row.apiEvents > 0 || row.words > 0);

    rows.sort((a, b) => Math.max(b.words, b.events) - Math.max(a.words, a.events));
    return rows;
  }, [today?.tasks]);

  const detailSeries = useMemo(() => {
    if (!detailTaskKey) return [];
    const days = data?.recentDays ?? [];
    return days
      .slice()
      .reverse()
      .map((day) => ({
        date: day.date,
        events: day.tasks?.[detailTaskKey]?.events ?? 0,
        apiEvents: day.tasks?.[detailTaskKey]?.apiEvents ?? 0,
        words: day.tasks?.[detailTaskKey]?.words ?? 0,
      }));
  }, [data?.recentDays, detailTaskKey]);

  const englishCorrectionDetailSeries = useMemo(() => {
    const days = englishCorrectionOutcomes?.recentDays ?? [];
    return days
      .slice()
      .reverse()
      .map((day) => ({
        date: day.date,
        operations: day.totals?.requests ?? 0,
        success: day.totals?.correct ?? 0,
        failure: day.totals?.incorrect ?? 0,
      }));
  }, [englishCorrectionOutcomes?.recentDays]);

  const detailMax = useMemo(() => {
    return detailSeries.reduce(
      (acc, row) => ({
        events: Math.max(acc.events, row.events),
        apiEvents: Math.max(acc.apiEvents, row.apiEvents),
        words: Math.max(acc.words, row.words),
      }),
      { events: 0, apiEvents: 0, words: 0 },
    );
  }, [detailSeries]);

  const englishCorrectionDetailMax = useMemo(() => {
    return englishCorrectionDetailSeries.reduce(
      (acc, row) => ({
        operations: Math.max(acc.operations, row.operations),
        success: Math.max(acc.success, row.success),
        failure: Math.max(acc.failure, row.failure),
      }),
      { operations: 0, success: 0, failure: 0 },
    );
  }, [englishCorrectionDetailSeries]);

  const detailMetricSeries = useMemo(() => {
    return detailSeries.map((row) => ({
      date: row.date,
      value: row[detailMetric] ?? 0,
    }));
  }, [detailMetric, detailSeries]);

  const englishCorrectionDetailMetricSeries = useMemo(() => {
    return englishCorrectionDetailSeries.map((row) => ({
      date: row.date,
      value: row[englishCorrectionDetailMetric] ?? 0,
    }));
  }, [englishCorrectionDetailMetric, englishCorrectionDetailSeries]);

  useEffect(() => {
    if (!detailTaskKey) return;
    if (detailTaskKey === "english_correction") {
      setEnglishCorrectionDetailMetric("operations");
      return;
    }
    // Defaults: exposure is "words"; most other tasks are "events".
    setDetailMetric(detailTaskKey === "exposure_valid" ? "words" : "events");
  }, [detailTaskKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalApiEvents = totals?.apiEvents ?? 0;

  const exposure = today?.tasks?.exposure_valid ?? { events: 0, apiEvents: 0, words: 0 };
  const lookups = today?.tasks?.word_card_opened ?? { events: 0, apiEvents: 0, words: 0 };
  const corrections = today?.tasks?.english_correction ?? { events: 0, apiEvents: 0, words: 0 };

  const providerDenominator = providerRows.reduce((sum, row) => sum + row.apiEvents, 0);
  const conversionRate = exposure.words > 0 ? clamp01(lookups.events / exposure.words) : 0;
  const updatedMinsAgo = minutesAgo(today?.updatedAt ?? 0);

  const detailOpen = detailTaskKey !== null;
  const detailMeta = detailTaskKey ? taskMeta(detailTaskKey) : null;
  const detailTodayBucket = detailTaskKey
    ? today?.tasks?.[detailTaskKey] ?? { events: 0, apiEvents: 0, words: 0 }
    : { events: 0, apiEvents: 0, words: 0 };
  const isEnglishCorrectionDetail = detailTaskKey === "english_correction";
  const englishCorrectionToday = englishCorrectionOutcomes?.today?.totals ?? {
    requests: 0,
    correct: 0,
    incorrect: 0,
  };

  const metricLabel = (metric: DetailMetricKey): string => {
    switch (metric) {
      case "words":
        return t("summaryDetailsMetric_words");
      case "events":
        return t("summaryDetailsMetric_events");
      case "apiEvents":
        return t("summaryDetailsMetric_apiEvents");
      default:
        return metric;
    }
  };

  const englishCorrectionMetricLabel = (metric: EnglishCorrectionDetailMetricKey): string => {
    switch (metric) {
      case "success":
        return t("summaryDetailsMetric_success");
      case "failure":
        return t("summaryDetailsMetric_failure");
      case "operations":
        return t("summaryDetailsMetric_operations");
      default:
        return metric;
    }
  };

  const metricValue = (bucket: UsageBucket, metric: DetailMetricKey): number => {
    if (metric === "events") return bucket.events ?? 0;
    if (metric === "apiEvents") return bucket.apiEvents ?? 0;
    return bucket.words ?? 0;
  };

  return (
    <div className="space-y-8">
      <Card className="shadow-none overflow-hidden">
        <div className="relative p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl border bg-background/70 dark:bg-card/60 shadow-sm flex items-center justify-center">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-base font-semibold tracking-tight">{t("summaryTitle")}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="tabular-nums">{today?.date ?? "--"}</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{t("summarySubtitle")}</span>
                    {today?.updatedAt ? (
                      <>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="tabular-nums">
                          {t("summaryUpdatedMinsAgo", formatInt(updatedMinsAgo))}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="text-sm text-foreground/90 leading-relaxed">
                {t("summaryInsight_conversion", [
                  `${Math.round(conversionRate * 100)}%`,
                  formatInt(exposure.words),
                  formatInt(lookups.events),
                ])}
              </div>

              {error ? <div className="text-xs text-destructive">{error}</div> : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-lg bg-background/70 hover:bg-background dark:bg-card/60 dark:hover:bg-card/80"
                disabled={refreshing}
                onClick={() => {
                  void (async () => {
                    setRefreshing(true);
                    try {
                      await load();
                    } finally {
                      setRefreshing(false);
                    }
                  })();
                }}
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RotateCw className="h-4 w-4 mr-2" />
                )}
                {t("summaryRefresh")}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 grid gap-4 sm:grid-cols-2">
          <StatCard
            title={t("summaryStat_exposures")}
            value={formatInt(exposure.words)}
            hint={t("summaryStat_exposuresHint")}
            icon={BookOpenText}
            tone="primary"
            onClick={() => setDetailTaskKey("exposure_valid")}
          />
          <StatCard
            title={t("summaryStat_lookups")}
            value={formatInt(lookups.events)}
            hint={t("summaryStat_lookupsHint")}
            icon={Search}
            onClick={() => setDetailTaskKey("word_card_opened")}
          />
          <StatCard
            title={t("summaryStat_corrections")}
            value={formatInt(corrections.events)}
            icon={CheckCheck}
            hint={t("summaryStat_correctionsHint")}
            onClick={() => setDetailTaskKey("english_correction")}
          />
          <StatCard
            title={t("summaryStat_apiEvents")}
            value={formatInt(totalApiEvents)}
            icon={Sparkles}
            hint={t("summaryStat_apiEventsHint")}
          />
        </div>

        <Card className="shadow-none lg:col-span-5 overflow-hidden">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-base">{t("summaryTrendTitle")}</CardTitle>
                <CardDescription className="text-xs">{t("summaryTrendDesc")}</CardDescription>
              </div>
              <div className="h-9 w-9 rounded-xl border bg-muted/40 flex items-center justify-center shadow-sm">
                <Flame className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            {recentSeries.series.length <= 1 ? (
              <div className="text-sm text-muted-foreground">{t("summaryTrendEmpty")}</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-7 gap-2 items-end">
                  {recentSeries.series.slice(-7).map((day) => {
                    const exposureHeight =
                      recentSeries.maxExposure > 0 ? Math.max(0.12, day.exposure / recentSeries.maxExposure) : 0;
                    const lookupHeight =
                      recentSeries.maxLookups > 0 ? Math.max(0.12, day.lookups / recentSeries.maxLookups) : 0;
                    return (
                      <div key={day.date} className="flex flex-col items-center gap-2">
                        <div className="w-full flex flex-col justify-end gap-1 h-20">
                          <div
                            className="w-full rounded-md bg-primary/20 border border-primary/15"
                            style={{ height: `${Math.round(exposureHeight * 100)}%` }}
                            title={`${day.date} · ${t("summaryTrendExposureLabel")}: ${day.exposure}`}
                          />
                          <div
                            className="w-full rounded-md bg-muted/60 border border-border"
                            style={{ height: `${Math.round(lookupHeight * 100)}%` }}
                            title={`${day.date} · ${t("summaryTrendLookupLabel")}: ${day.lookups}`}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {day.date.slice(-2)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <div className="text-xs text-muted-foreground">{t("summaryTrendExposureLabel")}</div>
                    <div className="text-sm font-semibold tabular-nums">{formatInt(exposure.words)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <div className="text-xs text-muted-foreground">{t("summaryTrendLookupLabel")}</div>
                    <div className="text-sm font-semibold tabular-nums">{formatInt(lookups.events)}</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-base">{t("summaryProvidersTitle")}</CardTitle>
                <CardDescription className="text-xs">{t("summaryProvidersDesc")}</CardDescription>
              </div>
              <div className="h-9 w-9 rounded-xl border bg-muted/40 flex items-center justify-center shadow-sm">
                <Palette className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            {providerRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("summaryNoApiCalls")}</div>
            ) : (
              providerRows.map((row) => {
                const weight = row.apiEvents;
                const Icon = providerIcon(row.key);
                return (
                  <div key={row.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-muted/40 border flex items-center justify-center shrink-0 shadow-sm">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{row.label}</div>
                          <div className="text-[11px] text-muted-foreground tabular-nums">
                            {t("summaryProviderCalls", formatInt(weight))}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {Math.round(percent(weight, providerDenominator))}%
                      </div>
                    </div>
                    <Progress value={percent(weight, providerDenominator)} className="h-2 bg-muted/50" />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-base">{t("summaryTasksTitle")}</CardTitle>
                <CardDescription className="text-xs">{t("summaryTasksDesc")}</CardDescription>
              </div>
              <div className="h-9 w-9 rounded-xl border bg-muted/40 flex items-center justify-center shadow-sm">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {taskRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("summaryEmpty")}</div>
            ) : (
              <div className="space-y-3">
                {taskRows.map((row) => {
                  const Icon = row.meta.icon;
                  return (
                    <button
                      type="button"
                      key={row.key}
                      onClick={() => setDetailTaskKey(row.key)}
                      className="w-full flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/15 px-3 py-2.5 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-muted/40 border flex items-center justify-center shrink-0 shadow-sm">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{row.meta.title}</div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {t("summaryRow_events", [formatInt(row.events), formatInt(row.apiEvents)])}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          {t("summaryRow_words", formatInt(row.words))}
                          <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) setDetailTaskKey(null);
        }}
      >
        <DialogContent className="max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {detailMeta ? detailMeta.title : t("summaryDetailsTitleFallback")}
            </DialogTitle>
            <DialogDescription>{t("summaryDetailsDesc")}</DialogDescription>
          </DialogHeader>

          {detailMeta ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="shadow-none">
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">
                    {isEnglishCorrectionDetail ? t("summaryDetailsStat_success") : t("summaryDetailsStat_words")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-xl font-semibold tracking-tight tabular-nums">
                    {isEnglishCorrectionDetail
                      ? formatInt(englishCorrectionToday.correct)
                      : formatInt(detailTodayBucket.words)}
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">
                    {isEnglishCorrectionDetail ? t("summaryDetailsStat_failure") : t("summaryDetailsStat_events")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-xl font-semibold tracking-tight tabular-nums">
                    {isEnglishCorrectionDetail
                      ? formatInt(englishCorrectionToday.incorrect)
                      : formatInt(detailTodayBucket.events)}
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">
                    {isEnglishCorrectionDetail ? t("summaryDetailsStat_operations") : t("summaryDetailsStat_apiEvents")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-xl font-semibold tracking-tight tabular-nums">
                    {isEnglishCorrectionDetail
                      ? formatInt(englishCorrectionOutcomes?.today ? englishCorrectionToday.requests : detailTodayBucket.events)
                      : formatInt(detailTodayBucket.apiEvents)}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t("summaryDetailsLast7Days")}</div>
                {isEnglishCorrectionDetail ? (
                  <ToggleGroup
                    type="single"
                    value={englishCorrectionDetailMetric}
                    onValueChange={(value) => {
                      if (value === "success" || value === "failure" || value === "operations") {
                        setEnglishCorrectionDetailMetric(value);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="justify-end"
                  >
                    <ToggleGroupItem value="success" className="h-9 px-3 rounded-lg text-xs">
                      {englishCorrectionMetricLabel("success")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="failure" className="h-9 px-3 rounded-lg text-xs">
                      {englishCorrectionMetricLabel("failure")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="operations" className="h-9 px-3 rounded-lg text-xs">
                      {englishCorrectionMetricLabel("operations")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                ) : (
                  <ToggleGroup
                    type="single"
                    value={detailMetric}
                    onValueChange={(value) => {
                      if (value === "words" || value === "events" || value === "apiEvents") {
                        setDetailMetric(value);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="justify-end"
                  >
                    <ToggleGroupItem value="words" className="h-9 px-3 rounded-lg text-xs">
                      {metricLabel("words")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="events" className="h-9 px-3 rounded-lg text-xs">
                      {metricLabel("events")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="apiEvents" className="h-9 px-3 rounded-lg text-xs">
                      {metricLabel("apiEvents")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
              </div>

            {(isEnglishCorrectionDetail ? englishCorrectionDetailSeries : detailSeries).length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("summaryTrendEmpty")}</div>
            ) : (
              <TrendChart
                series={isEnglishCorrectionDetail ? englishCorrectionDetailMetricSeries : detailMetricSeries}
                tone="primary"
              />
            )}

            <div className="space-y-2">
              {detailSeries.map((row) => {
                const dayBucket = { events: row.events, apiEvents: row.apiEvents, words: row.words };
                const dayValue = metricValue(dayBucket, detailMetric);
                const maxForMetric = Math.max(1, detailMax[detailMetric] ?? 0);
                return (
                  <div key={row.date} className="rounded-xl border border-border bg-muted/10 p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-sm font-medium tabular-nums">{row.date}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {metricLabel(detailMetric)}: {formatInt(dayValue)}
                      </div>
                    </div>
                    <div className="mt-2">
                      <Progress
                        value={percent(dayValue, maxForMetric)}
                        className="h-2 bg-muted/50"
                      />
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                      {t("summaryRow_events", [formatInt(row.events), formatInt(row.apiEvents)])} ·{" "}
                      {t("summaryRow_words", formatInt(row.words))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
