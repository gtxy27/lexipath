import React, { useMemo } from "react";
import type { Settings } from "@lexipath/core";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { Zap } from "lucide-react";
import { AiGate } from "../AiGate";
import { OptionsDisclosure } from "../components/OptionsDisclosure";
import { OptionsPageHeader } from "../components/OptionsPageHeader";
import { OptionsRow } from "../components/OptionsRow";
import { OptionsSection } from "../components/OptionsSection";
import {
  WEB_STYLE_THEME_PRESETS,
  deriveWebStyleThemeKey,
  type WebStyleThemeKey,
} from "../optionsLogic";
import { t } from "../optionsI18n";
import type { FormState } from "../optionsTypes";

export function DisplayTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  aiEnabled: boolean;
  onOpenChannels: () => void;
  embedded?: boolean;
}): React.ReactElement {
  const { form, setForm, aiEnabled, onOpenChannels, embedded } = props;

  const webStyleThemeKey = useMemo(
    () => deriveWebStyleThemeKey(form.webStyleMapping),
    [form.webStyleMapping],
  );
  const webStyleMapping = form.webStyleMapping ?? WEB_STYLE_THEME_PRESETS.standard;

  const content = (
    <div className={embedded ? "mt-0" : "mt-4"}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
	          <OptionsSection title={t("optionsAppearanceTitle")}>
            <div className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">
                  {t("optionsThemeLabel")}
                </Label>
                <Select
                  value={form.theme}
                  onValueChange={(v) => setForm({ ...form, theme: v as Settings["theme"] })}
                >
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="system">{t("optionsTheme_system")}</SelectItem>
                    <SelectItem value="light">{t("optionsTheme_light")}</SelectItem>
                    <SelectItem value="dark">{t("optionsTheme_dark")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="p-4 rounded-lg bg-muted/40 border border-border">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("optionsThemeHint")}
                </p>
              </div>
            </div>
          </OptionsSection>

          <OptionsSection title={t("optionsWebShowOriginalLabel")}>
            <OptionsRow
              title={t("optionsWebShowOriginalLabel")}
              description={t("optionsWebShowOriginalDesc")}
            >
              <Switch
                checked={form.webShowOriginal ?? false}
                onCheckedChange={(checked) => setForm({ ...form, webShowOriginal: checked })}
                className="data-[state=checked]:bg-primary"
              />
            </OptionsRow>
          </OptionsSection>

	          <OptionsSection title={t("optionsFloatingButtonLabel")}>
              <OptionsRow
                title={t("optionsFloatingButtonLabel")}
                description={t("optionsFloatingButtonDesc")}
              >
                <Switch
                  checked={form.floatingButtonEnabled ?? true}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, floatingButtonEnabled: checked })
                  }
                />
              </OptionsRow>
	          </OptionsSection>

	          <OptionsSection
              title={t("optionsScenesLabel")}
              description={t("optionsScenesQuickDesc")}
            >
            <div className="space-y-5">
              {(() => {
                const scenes = (form.scenesEnabled as any) ?? {};
                const webEnabled =
                  scenes.webNative !== false || scenes.webTarget !== false;
                const videoEnabled =
                  scenes.videoNative !== false || scenes.videoTarget !== false;

                return (
                  <>
                    <OptionsRow
                      title={t("optionsScenesWebLabel")}
                      description={t("optionsScenesWebDesc")}
                    >
                      <Switch
                        checked={webEnabled}
                        onCheckedChange={(checked) =>
                          setForm({
                            ...form,
                            scenesEnabled: {
                              ...form.scenesEnabled,
                              webNative: checked,
                              webTarget: checked,
                            } as any,
                          })
                        }
                        className="data-[state=checked]:bg-primary"
                      />
                    </OptionsRow>

                    <OptionsRow
                      title={t("optionsScenesVideoLabel")}
                      description={t("optionsScenesVideoDesc")}
                    >
                      <Switch
                        checked={videoEnabled}
                        onCheckedChange={(checked) =>
                          setForm({
                            ...form,
                            scenesEnabled: {
                              ...form.scenesEnabled,
                              videoNative: checked,
                              videoTarget: checked,
                            } as any,
                          })
                        }
                        className="data-[state=checked]:bg-primary"
                      />
                    </OptionsRow>
                  </>
                );
              })()}

              <OptionsDisclosure
                title={t("optionsAdvancedTitle")}
                description={t("optionsScenesDesc")}
              >
                <div className="grid grid-cols-1 gap-4">
                  {[
                    {
                      key: "webNative",
                      title: t("onboardingSceneWebNativeTitle"),
                      desc: t("onboardingSceneWebNativeDesc"),
                    },
                    {
                      key: "webTarget",
                      title: t("onboardingSceneWebTargetTitle"),
                      desc: t("onboardingSceneWebTargetDesc"),
                    },
                    {
                      key: "videoNative",
                      title: t("onboardingSceneVideoNativeTitle"),
                      desc: t("onboardingSceneVideoNativeDesc"),
                    },
                    {
                      key: "videoTarget",
                      title: t("onboardingSceneVideoTargetTitle"),
                      desc: t("onboardingSceneVideoTargetDesc"),
                    },
                  ].map((item) => (
                    <OptionsRow
                      key={item.key}
                      title={item.title}
                      description={item.desc}
                    >
                      <Switch
                        checked={(form.scenesEnabled as any)?.[item.key] ?? true}
                        onCheckedChange={(checked) =>
                          setForm({
                            ...form,
                            scenesEnabled: {
                              ...(form.scenesEnabled as any),
                              [item.key]: checked,
                            } as any,
                          })
                        }
                        className="data-[state=checked]:bg-primary"
                      />
                    </OptionsRow>
                  ))}
                </div>
              </OptionsDisclosure>
            </div>
          </OptionsSection>

          <div className="md:col-span-2">
          <OptionsSection title={t("optionsWebStyleLabel")}>
            <div className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">
                  {t("optionsWebStyleThemeLabel")}
                </Label>
                <Select
                  value={webStyleThemeKey}
                  onValueChange={(v) => {
                    const next = v as WebStyleThemeKey;
                    if (next === "custom") return;
                    const preset = WEB_STYLE_THEME_PRESETS[next];
                    setForm({
                      ...form,
                      webStyleMapping: {
                        within: preset.within,
                        out: preset.out,
                        forgotten: preset.forgotten,
                      } as any,
                    });
                  }}
                >
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="standard">
                      {t("optionsWebStyleTheme_standard")}
                    </SelectItem>
                    <SelectItem value="subtle">
                      {t("optionsWebStyleTheme_subtle")}
                    </SelectItem>
                    <SelectItem value="contrast">
                      {t("optionsWebStyleTheme_contrast")}
                    </SelectItem>
                    <SelectItem value="minimal">
                      {t("optionsWebStyleTheme_minimal")}
                    </SelectItem>
                    <SelectItem value="custom">
                      {t("optionsWebStyleTheme_custom")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("optionsWebStyleThemeDesc")}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-4 lx-style-preview">
                <div className="text-xs text-muted-foreground">
                  {t("optionsWebStylePreviewLabel")}
                </div>
                <div className="mt-3 text-sm font-medium leading-relaxed flex flex-wrap gap-2">
                  <span className="lx-preview-word" data-lx-style={webStyleMapping.within}>
                    {t("optionsWebStyleWithin")}
                  </span>
                  <span className="lx-preview-word" data-lx-style={webStyleMapping.out}>
                    {t("optionsWebStyleOut")}
                  </span>
                  <span className="lx-preview-word" data-lx-style={webStyleMapping.forgotten}>
                    {t("optionsWebStyleForgotten")}
                  </span>
                </div>
              </div>

              <OptionsDisclosure
                title={t("optionsAdvancedTitle")}
                description={t("optionsWebStyleDesc")}
              >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { key: "within", label: t("optionsWebStyleWithin") },
                      { key: "out", label: t("optionsWebStyleOut") },
                      { key: "forgotten", label: t("optionsWebStyleForgotten") },
                    ].map((item) => (
                      <div key={item.key} className="space-y-2.5">
                        <Label className="text-xs text-muted-foreground">
                          {item.label}
                        </Label>
                        <Select
                          value={(form.webStyleMapping as any)?.[item.key] ?? "border"}
                          onValueChange={(value) =>
                            setForm({
                              ...form,
                              webStyleMapping: {
                                ...(form.webStyleMapping as any),
                                [item.key]: value,
                              } as any,
                            })
                          }
                        >
                          <SelectTrigger className="h-11 rounded-lg">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            {["border", "dashedLine", "weakened", "background", "textColor"].map(
                              (k) => (
                                <SelectItem key={k} value={k}>
                                  {t(`optionsWebStyleKey_${k}`)}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-sm font-medium flex items-center gap-2.5">
                      <Zap className="h-4 w-4 text-primary" />
                      {t("optionsWebCustomCssLabel")}
                    </Label>
                    <Textarea
                      value={form.webCustomCss ?? ""}
                      onChange={(e) => setForm({ ...form, webCustomCss: e.target.value })}
                      rows={6}
                      className="rounded-lg p-3"
                      placeholder={t("optionsWebCustomCssPlaceholder")}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("optionsWebCustomCssDesc")}
                    </p>
                  </div>
              </OptionsDisclosure>
	            </div>
	          </OptionsSection>
            </div>
	        </div>
	    </div>
	  );

  if (embedded) return content;

  return (
    <>
      <OptionsPageHeader
        title={t("optionsTab_display")}
        description={t("optionsDisplayDesc")}
      />

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        {content}
      </AiGate>
    </>
  );
}
