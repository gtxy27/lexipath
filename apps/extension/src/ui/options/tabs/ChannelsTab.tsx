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
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { OptionsPageHeader } from "../components/OptionsPageHeader";
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
      <OptionsPageHeader
        title={t("optionsChannelsTitle")}
        description={t("optionsChannelsDesc")}
        icon={Sparkles}
        actions={
          <Button
            variant="outline"
            className="h-10 rounded-lg px-4 font-medium"
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
        }
      />

      <div className="grid gap-5">
        {form.channels
          .slice()
          .sort((a, b) => a.channelId - b.channelId)
          .map((channel) => {
            const channelErrors = errors.channels?.[channel.channelId] ?? {};
            const isTesting = testingChannelId === channel.channelId;
            const isExpanded = expandedChannels[channel.channelId] ?? false;

            return (
              <div key={channel.channelId}>
                <Card className="border border-border bg-card shadow-none overflow-hidden rounded-xl">
                  <CardHeader
                    className="pb-3 pt-4 px-5 cursor-pointer select-none"
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
                            "p-2 rounded-md border border-border bg-muted/40 transition-transform duration-300",
                            isExpanded ? "rotate-90" : "",
                          )}
                        >
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base font-semibold">
                              {channel.name || `#${channel.channelId}`}
                            </CardTitle>
                            <Badge
                              variant="outline"
                              className="border-border bg-muted text-muted-foreground px-2 py-0 text-xs font-medium"
                            >
                              {channelTypeLabel(channel.typeId)}
                            </Badge>
                          </div>
                          <CardDescription className="mt-1 text-xs text-muted-foreground">
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
                          className="h-9 gap-2 rounded-lg px-3"
                          onClick={() => testProvider(channel)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4 text-primary" />
                          )}
                          <span className="hidden sm:inline text-xs font-medium">
                            {t("optionsTestConnection")}
                          </span>
                        </Button>

                        <div className="h-6 w-px bg-border mx-1" />

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
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
                          className="h-9 w-9 rounded-lg text-muted-foreground hover:text-destructive"
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
                              className="text-xs text-muted-foreground"
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
                              className="h-11 rounded-lg"
                            />
                            {channelErrors.name && (
                              <p className="text-xs text-destructive">
                                {t(channelErrors.name)}
                              </p>
                            )}
                          </div>
                          <div className="space-y-2.5">
                            <Label
                              htmlFor={`channel-${channel.channelId}-type`}
                              className="text-xs text-muted-foreground"
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
                                className="h-11 rounded-lg"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="border-border bg-popover">
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
                              className="text-xs text-muted-foreground"
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
                              className="h-11 rounded-lg"
                            />
                            {channelErrors.model && (
                              <p className="text-xs text-destructive">
                                {t(channelErrors.model)}
                              </p>
                            )}
                          </div>
                          <div className="space-y-2.5">
                            <Label
                              htmlFor={`channel-${channel.channelId}-api-key`}
                              className="text-xs text-muted-foreground"
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
                              className="h-11 rounded-lg"
                              placeholder={t("optionsProviderApiKeyPlaceholder")}
                            />
                            {channelErrors.apiKey && (
                              <p className="text-xs text-destructive">
                                {t(channelErrors.apiKey)}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          <Label
                            htmlFor={`channel-${channel.channelId}-base-url`}
                            className="text-xs text-muted-foreground"
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
                            className="h-11 rounded-lg"
                            placeholder={
                              channel.typeId === 1
                                ? t("optionsProviderBaseUrlPlaceholder")
                                : channel.typeId === 2
                                  ? t("optionsClaudeBaseUrlPlaceholder")
                                  : t("optionsGeminiBaseUrlPlaceholder")
                            }
                          />
                          {channelErrors.baseUrl && (
                            <p className="text-xs text-destructive">
                              {t(channelErrors.baseUrl)}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2.5">
                          <Label
                            htmlFor={`channel-${channel.channelId}-concurrency-limit`}
                            className="text-xs text-muted-foreground"
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
                            className="h-11 rounded-lg"
                            placeholder="15"
                          />
                          <p className="text-xs text-muted-foreground">
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
