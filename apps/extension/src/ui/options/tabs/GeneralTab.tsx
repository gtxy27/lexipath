import React from "react";
import { Settings2 } from "lucide-react";
import { Switch } from "../../components/ui/switch";
import { AiGate } from "../AiGate";
import { t } from "../optionsI18n";
import type { FieldErrors, FormState } from "../optionsTypes";
import { BackupTab } from "./BackupTab";
import { SitesTab } from "./SitesTab";

export function GeneralTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  errors: FieldErrors;
  aiEnabled: boolean;
  onOpenChannels: () => void;
  onReloadSettings: () => Promise<void>;
}): React.ReactElement {
  const { form, setForm, errors, aiEnabled, onOpenChannels, onReloadSettings } =
    props;

  return (
    <>
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-indigo-50 dark:bg-white/5 border border-indigo-100 dark:border-white/10 flex items-center justify-center">
            <Settings2 className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
          </div>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
            {t("optionsTab_general")}
          </h2>
        </div>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">
          {t("optionsGeneralDesc")}
        </p>
      </header>

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        <div className="space-y-10 mt-4">
          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-6 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsGeneralStatusTitle")}
            </h4>

            <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
              <div className="space-y-1">
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {t("optionsEnabledTitle")}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("optionsEnabledHint")}
                </div>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
                className="data-[state=checked]:bg-indigo-600"
              />
            </div>
          </div>

          <details className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#15161e] p-6">
            <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                  {t("optionsGeneralSitesTitle")}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("optionsGeneralSitesDesc")}
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {t("optionsAdvancedTitle")}
              </span>
            </summary>

            <div className="pt-6">
              <SitesTab
                embedded
                form={form}
                setForm={setForm}
                aiEnabled={aiEnabled}
                onOpenChannels={onOpenChannels}
              />
            </div>
          </details>

          <details className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#15161e] p-6">
            <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                  {t("optionsGeneralBackupTitle")}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("optionsGeneralBackupDesc")}
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {t("optionsAdvancedTitle")}
              </span>
            </summary>

            <div className="pt-6">
              <BackupTab
                embedded
                form={form}
                setForm={setForm}
                errors={errors}
                aiEnabled={aiEnabled}
                onOpenChannels={onOpenChannels}
                onReloadSettings={onReloadSettings}
              />
            </div>
          </details>
        </div>
      </AiGate>
    </>
  );
}

