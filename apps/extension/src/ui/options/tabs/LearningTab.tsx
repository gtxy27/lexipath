import React from "react";
import { t } from "../optionsI18n";
import type { FieldErrors, FormState } from "../optionsTypes";
import { LanguageTab } from "./LanguageTab";
import { RoutingTab } from "./RoutingTab";

export function LearningTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  errors: FieldErrors;
  aiEnabled: boolean;
  onOpenChannels: () => void;
}): React.ReactElement {
  const { form, setForm, errors, aiEnabled, onOpenChannels } = props;

  return (
    <div className="space-y-10">
      <LanguageTab
        form={form}
        setForm={setForm}
        aiEnabled={aiEnabled}
        onOpenChannels={onOpenChannels}
      />

      <details className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#15161e] p-6">
        <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsLearningRoutingTitle")}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t("optionsLearningRoutingDesc")}
            </div>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("optionsAdvancedTitle")}
          </span>
        </summary>

        <div className="pt-6 space-y-8">
          <RoutingTab
            embedded
            form={form}
            setForm={setForm}
            errors={errors}
            aiEnabled={aiEnabled}
            onOpenChannels={onOpenChannels}
          />
        </div>
      </details>
    </div>
  );
}
