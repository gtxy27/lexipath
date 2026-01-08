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
import { ChevronRight, Zap } from "lucide-react";
import { AiGate } from "../AiGate";
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
}): React.ReactElement {
  const { form, setForm, aiEnabled, onOpenChannels } = props;

  const webStyleThemeKey = useMemo(
    () => deriveWebStyleThemeKey(form.webStyleMapping),
    [form.webStyleMapping],
  );
  const webStyleMapping = form.webStyleMapping ?? WEB_STYLE_THEME_PRESETS.standard;

  return (
    <>
      <header className="space-y-3">
        <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
          {t("optionsTab_display")}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">
          {t("optionsDisplayDesc")}
        </p>
      </header>

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsAppearanceTitle")}
            </h4>

            <div className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                  {t("optionsThemeLabel")}
                </Label>
                <Select
                  value={form.theme}
                  onValueChange={(v) => setForm({ ...form, theme: v as Settings["theme"] })}
                >
                  <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                    <SelectItem value="system">{t("optionsTheme_system")}</SelectItem>
                    <SelectItem value="light">{t("optionsTheme_light")}</SelectItem>
                    <SelectItem value="dark">{t("optionsTheme_dark")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="p-4 rounded-xl bg-indigo-50/30 dark:bg-indigo-500/5 border border-indigo-100/50 dark:border-indigo-500/10">
                <p className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed font-medium">
                  {t("optionsThemeHint")}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsWebShowOriginalLabel")}
            </h4>

            <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
              <div className="space-y-1">
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {t("optionsWebShowOriginalLabel")}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("optionsWebShowOriginalDesc")}
                </div>
              </div>
              <Switch
                checked={form.webShowOriginal ?? false}
                onCheckedChange={(checked) => setForm({ ...form, webShowOriginal: checked })}
                className="data-[state=checked]:bg-indigo-600"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsFloatingButtonLabel")}
            </h4>

            <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
              <div className="space-y-1">
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {t("optionsFloatingButtonLabel")}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("optionsFloatingButtonDesc")}
                </div>
              </div>
              <Switch
                checked={form.floatingButtonEnabled ?? true}
                onCheckedChange={(checked) => setForm({ ...form, floatingButtonEnabled: checked })}
              />
            </div>
          </div>

          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsScenesLabel")}
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
              {t("optionsScenesQuickDesc")}
            </p>

            <div className="space-y-4">
              {(() => {
                const scenes = (form.scenesEnabled as any) ?? {};
                const webEnabled =
                  scenes.webNative !== false || scenes.webTarget !== false;
                const videoEnabled =
                  scenes.videoNative !== false || scenes.videoTarget !== false;

                return (
                  <>
                    <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">
                          {t("optionsScenesWebLabel")}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {t("optionsScenesWebDesc")}
                        </div>
                      </div>
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
                        className="data-[state=checked]:bg-indigo-600"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">
                          {t("optionsScenesVideoLabel")}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {t("optionsScenesVideoDesc")}
                        </div>
                      </div>
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
                        className="data-[state=checked]:bg-indigo-600"
                      />
                    </div>
                  </>
                );
              })()}

              <details className="rounded-2xl border border-gray-200/60 dark:border-white/10 bg-white/60 dark:bg-white/5 p-5">
                <summary className="cursor-pointer list-none select-none flex items-center justify-between">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                    {t("optionsAdvancedTitle")}
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </summary>
                <div className="pt-5 space-y-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    {t("optionsScenesDesc")}
                  </p>
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
                      <div
                        key={item.key}
                        className="flex items-start justify-between gap-4 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="text-sm font-bold text-gray-900 dark:text-white truncate">
                            {item.title}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            {item.desc}
                          </div>
                        </div>
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
                          className="data-[state=checked]:bg-indigo-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div className="md:col-span-2 bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsWebStyleLabel")}
            </h4>

            <div className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                  <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
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
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {t("optionsWebStyleThemeDesc")}
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5 lx-style-preview">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                  {t("optionsWebStylePreviewLabel")}
                </div>
                <div className="mt-3 text-sm font-medium text-gray-900 dark:text-white leading-relaxed flex flex-wrap gap-2">
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

              <details className="rounded-2xl border border-gray-200/60 dark:border-white/10 bg-white/60 dark:bg-white/5 p-5">
                <summary className="cursor-pointer list-none select-none flex items-center justify-between">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                    {t("optionsAdvancedTitle")}
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </summary>
                <div className="pt-5 space-y-5">
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    {t("optionsWebStyleDesc")}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { key: "within", label: t("optionsWebStyleWithin") },
                      { key: "out", label: t("optionsWebStyleOut") },
                      { key: "forgotten", label: t("optionsWebStyleForgotten") },
                    ].map((item) => (
                      <div key={item.key} className="space-y-2.5">
                        <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                          <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
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
                    <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                      <Zap className="h-4 w-4 text-indigo-500" />
                      {t("optionsWebCustomCssLabel")}
                    </Label>
                    <Textarea
                      value={form.webCustomCss ?? ""}
                      onChange={(e) => setForm({ ...form, webCustomCss: e.target.value })}
                      rows={6}
                      className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-indigo-500/20 font-medium transition-all"
                      placeholder={t("optionsWebCustomCssPlaceholder")}
                    />
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t("optionsWebCustomCssDesc")}
                    </p>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </AiGate>
    </>
  );
}
