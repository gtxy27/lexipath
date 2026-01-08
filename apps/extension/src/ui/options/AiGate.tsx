import React from "react";
import { Button } from "../components/ui/button";
import { t } from "./optionsI18n";

export function AiRequiredPanel(props: {
  onOpenChannels: () => void;
}): React.ReactElement {
  return (
    <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
        <div className="space-y-2">
          <div className="text-lg font-black text-gray-900 dark:text-white">
            {t("optionsAiRequiredTitle")}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed font-medium max-w-2xl">
            {t("optionsAiRequiredDesc")}
          </div>
        </div>
        <Button
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl px-6 h-10 shadow-lg shadow-indigo-600/20"
          onClick={props.onOpenChannels}
        >
          {t("optionsAiRequiredCta")}
        </Button>
      </div>
    </div>
  );
}

export function AiGate(props: {
  enabled: boolean;
  onOpenChannels: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  if (props.enabled) return <>{props.children}</>;
  return <AiRequiredPanel onOpenChannels={props.onOpenChannels} />;
}

