import React, { useEffect, useState } from "react";
import { ChannelTypeIdSchema, type ChannelTypeId } from "@lexipath/core";
import { createLogger } from "@lexipath/core/log";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useToast } from "../../components/ui/use-toast";
import { cn } from "../../lib/utils";
import {
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import {
  buildTestPayload,
  channelTypeLabel,
  defaultChannelName,
  nextChannelId,
  repairRoutes,
} from "../optionsLogic";
import { t } from "../optionsI18n";
import { sendMessage } from "../optionsMessages";
import type { ChannelFormState, FieldErrors, FormState } from "../optionsTypes";

const log = createLogger("ui:Options:ChannelsTab");

export function ChannelsTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  errors: FieldErrors;
}): React.ReactElement {
  const { toast } = useToast();
  const { form, setForm, errors } = props;
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null);
  const [expandedChannels, setExpandedChannels] = useState<Record<number, boolean>>(
    {},
  );

  useEffect(() => {
    if (Object.keys(expandedChannels).length > 0) return;
    const sortedChannels = form.channels
      .slice()
      .sort((a, b) => a.channelId - b.channelId);
    if (sortedChannels.length > 0 && sortedChannels[0]) {
      setExpandedChannels({ [sortedChannels[0].channelId]: true });
    }
  }, [expandedChannels, form.channels]);

  async function testProvider(channel: ChannelFormState) {
    const payload = buildTestPayload(channel);
    if (!payload) {
      toast({
        title: t("optionsTestInvalidConfig"),
        variant: "destructive",
      });
      return;
    }

    setTestingChannelId(channel.channelId);
    try {
      const response = await sendMessage("TEST_PROVIDER_CONNECTION", payload);
      if (response.ok) {
        toast({
          title: t("optionsTestSuccess"),
        });
      } else {
        toast({
          title: t("optionsTestError", response.error.message),
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      log.error("TEST_PROVIDER_CONNECTION failed", { error });
      toast({
        title: t("optionsTestError", t("error_unknown")),
        variant: "destructive",
      });
    } finally {
      setTestingChannelId(null);
    }
  }

  return (
    <>
      <header className="space-y-3">
        <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
          {t("optionsChannelsTitle")}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">
          {t("optionsChannelsDesc")}
        </p>
      </header>

      <div className="flex items-center justify-between py-4 border-b border-gray-100 dark:border-white/5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
          {t("optionsTab_channels")}
        </h3>
        <Button
          className="bg-indigo-600/10 hover:bg-indigo-600 text-indigo-600 hover:text-white border border-indigo-200 dark:border-indigo-500/20 rounded-xl px-5 h-10 font-bold transition-all"
          onClick={() => {
            const id = nextChannelId(form.channels);
            const typeId: ChannelTypeId = 1;
            setForm(
              repairRoutes({
                ...form,
                channels: [
                  ...form.channels,
                  {
                    channelId: id,
                    typeId,
                    name: defaultChannelName(typeId),
                    model: "",
                    baseUrl: "",
                    apiKey: "",
                    customHeadersText: "",
                    iconUrl: "",
                    concurrencyLimit: 15,
                    configExtra: {},
                    extra: {},
                  },
                ],
              }),
            );
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t("optionsAddChannel")}
        </Button>
      </div>

      <div className="grid gap-5">
        {form.channels
          .slice()
          .sort((a, b) => a.channelId - b.channelId)
          .map((channel) => {
            const channelErrors = errors.channels?.[channel.channelId] ?? {};
            const isTesting = testingChannelId === channel.channelId;
            const isExpanded = expandedChannels[channel.channelId] ?? false;

            return (
              <div key={channel.channelId} className="relative group">
                <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm" />
                <Card className="relative border-gray-200 dark:border-white/10 bg-white dark:bg-[#15161e] shadow-sm overflow-hidden rounded-2xl transition-all duration-300">
                  <CardHeader
                    className="pb-4 pt-5 px-6 cursor-pointer select-none"
                    onClick={() =>
                      setExpandedChannels((prev) => ({
                        ...prev,
                        [channel.channelId]: !isExpanded,
                      }))
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={cn(
                            "p-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 transition-transform duration-300",
                            isExpanded ? "rotate-90" : "",
                          )}
                        >
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg font-bold text-gray-900 dark:text-white">
                              {channel.name || `#${channel.channelId}`}
                            </CardTitle>
                            <Badge
                              variant="outline"
                              className="bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-500/20 px-2 py-0 text-[10px] font-bold"
                            >
                              {channelTypeLabel(channel.typeId)}
                            </Badge>
                          </div>
                          <CardDescription className="text-gray-500 dark:text-gray-400 mt-1 font-semibold text-[11px] uppercase tracking-wider">
                            {channel.model?.trim()
                              ? channel.model.trim()
                              : t("optionsChannelModelUnset")}
                          </CardDescription>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-white gap-2 rounded-xl px-4"
                          onClick={() => testProvider(channel)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4 text-indigo-500" />
                          )}
                          <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest">
                            {t("optionsTestConnection")}
                          </span>
                        </Button>

                        <div className="h-6 w-px bg-gray-200 dark:bg-white/10 mx-1" />

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-gray-400 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-50 dark:hover:bg-white/5 rounded-xl transition-colors"
                          onClick={() => {
                            const id = nextChannelId(form.channels);
                            const copy = {
                              ...channel,
                              channelId: id,
                              name: `${channel.name || defaultChannelName(channel.typeId)}${t("optionsChannelCopySuffix")}`,
                            };
                            setForm(
                              repairRoutes({
                                ...form,
                                channels: [...form.channels, copy],
                              }),
                            );
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-red-500/10 rounded-xl transition-colors"
                          onClick={() => {
                            if (form.channels.length <= 1) return;
                            const nextChannels = form.channels.filter(
                              (ch) => ch.channelId !== channel.channelId,
                            );
                            setForm(
                              repairRoutes({ ...form, channels: nextChannels }),
                            );
                          }}
                          disabled={form.channels.length <= 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <div
                    className={cn(
                      "grid transition-all duration-500 ease-in-out",
                      isExpanded
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="overflow-hidden">
                      <CardContent className="px-6 pb-8 pt-2 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2.5">
                            <Label
                              htmlFor={`channel-${channel.channelId}-name`}
                              className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                            >
                              {t("optionsChannelNameLabel")}
                            </Label>
                            <Input
                              id={`channel-${channel.channelId}-name`}
                              value={channel.name}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  channels: form.channels.map((ch) =>
                                    ch.channelId === channel.channelId
                                      ? { ...ch, name: e.target.value }
                                      : ch,
                                  ),
                                })
                              }
                              className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 focus:ring-indigo-500/30 rounded-xl h-11 font-medium transition-all"
                            />
                            {channelErrors.name && (
                              <p className="text-[10px] text-rose-500 font-bold ml-1">
                                {t(channelErrors.name)}
                              </p>
                            )}
                          </div>
                          <div className="space-y-2.5">
                            <Label
                              htmlFor={`channel-${channel.channelId}-type`}
                              className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                            >
                              {t("optionsChannelTypeLabel")}
                            </Label>
                            <Select
                              value={String(channel.typeId)}
                              onValueChange={(v) => {
                                const parsed = ChannelTypeIdSchema.safeParse(
                                  Number(v),
                                );
                                if (parsed.success)
                                  setForm({
                                    ...form,
                                    channels: form.channels.map((ch) =>
                                      ch.channelId === channel.channelId
                                        ? (() => {
                                            const nextTypeId = parsed.data;
                                            const shouldAutoRename =
                                              !ch.name.trim() ||
                                              ch.name === defaultChannelName(ch.typeId);
                                            return {
                                              ...ch,
                                              typeId: nextTypeId,
                                              ...(shouldAutoRename
                                                ? { name: defaultChannelName(nextTypeId) }
                                                : {}),
                                            };
                                          })()
                                        : ch,
                                    ),
                                  });
                              }}
                            >
                              <SelectTrigger
                                id={`channel-${channel.channelId}-type`}
                                className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 h-11 rounded-xl font-medium"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                                <SelectItem value="1">
                                  {channelTypeLabel(1)}
                                </SelectItem>
                                <SelectItem value="2">
                                  {channelTypeLabel(2)}
                                </SelectItem>
                                <SelectItem value="3">
                                  {channelTypeLabel(3)}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2.5">
                            <Label
                              htmlFor={`channel-${channel.channelId}-model`}
                              className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                            >
                              {t("optionsProviderModelLabel")}
                            </Label>
                            <Input
                              id={`channel-${channel.channelId}-model`}
                              value={channel.model}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  channels: form.channels.map((ch) =>
                                    ch.channelId === channel.channelId
                                      ? { ...ch, model: e.target.value }
                                      : ch,
                                  ),
                                })
                              }
                              className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                            />
                            {channelErrors.model && (
                              <p className="text-[10px] text-rose-500 font-bold ml-1">
                                {t(channelErrors.model)}
                              </p>
                            )}
                          </div>
                          <div className="space-y-2.5">
                            <Label
                              htmlFor={`channel-${channel.channelId}-api-key`}
                              className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                            >
                              {t("optionsProviderApiKeyLabel")}
                            </Label>
                            <Input
                              id={`channel-${channel.channelId}-api-key`}
                              type="password"
                              value={channel.apiKey}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  channels: form.channels.map((ch) =>
                                    ch.channelId === channel.channelId
                                      ? { ...ch, apiKey: e.target.value }
                                      : ch,
                                  ),
                                })
                              }
                              className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                              placeholder={t("optionsProviderApiKeyPlaceholder")}
                            />
                            {channelErrors.apiKey && (
                              <p className="text-[10px] text-rose-500 font-bold ml-1">
                                {t(channelErrors.apiKey)}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          <Label
                            htmlFor={`channel-${channel.channelId}-base-url`}
                            className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                          >
                            {t("optionsProviderBaseUrlLabel")}
                          </Label>
                          <Input
                            id={`channel-${channel.channelId}-base-url`}
                            value={channel.baseUrl}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                channels: form.channels.map((ch) =>
                                  ch.channelId === channel.channelId
                                    ? { ...ch, baseUrl: e.target.value }
                                    : ch,
                                ),
                              })
                            }
                            className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                            placeholder={
                              channel.typeId === 1
                                ? t("optionsProviderBaseUrlPlaceholder")
                                : channel.typeId === 2
                                  ? t("optionsClaudeBaseUrlPlaceholder")
                                  : t("optionsGeminiBaseUrlPlaceholder")
                            }
                          />
                          {channelErrors.baseUrl && (
                            <p className="text-[10px] text-rose-500 font-bold ml-1">
                              {t(channelErrors.baseUrl)}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2.5">
                          <Label
                            htmlFor={`channel-${channel.channelId}-concurrency-limit`}
                            className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1"
                          >
                            {t("optionsConcurrencyLimitLabel")}
                          </Label>
                          <Input
                            id={`channel-${channel.channelId}-concurrency-limit`}
                            type="number"
                            min="1"
                            max="500"
                            step="1"
                            value={channel.concurrencyLimit}
                            onChange={(e) => {
                              const next = e.target.valueAsNumber;
                              if (!Number.isFinite(next)) return;
                              const clamped = Math.min(
                                500,
                                Math.max(1, Math.trunc(next)),
                              );
                              setForm((prev) => ({
                                ...prev,
                                channels: prev.channels.map((ch) =>
                                  ch.channelId === channel.channelId
                                    ? { ...ch, concurrencyLimit: clamped }
                                    : ch,
                                ),
                              }));
                            }}
                            className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                            placeholder="15"
                          />
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 ml-1">
                            {t("optionsConcurrencyLimitDesc")}
                          </p>
                        </div>
                      </CardContent>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
      </div>
    </>
  );
}
