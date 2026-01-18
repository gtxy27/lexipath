import React from "react";
import { Button } from "../components/ui/button";
import { t } from "./optionsI18n";

export function AiRequiredPanel(props: {
  onOpenChannels: () => void;
}): React.ReactElement {
  return (
    <div
      className="bg-card border border-border rounded-lg p-6"
      data-tour-id="general-ai-required-panel"
    >

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
        <div className="space-y-2">
          <div className="text-base font-semibold">
            {t("optionsAiRequiredTitle")}
          </div>
          <div className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            {t("optionsAiRequiredDesc")}
          </div>
        </div>
        <Button
          className="w-full sm:w-auto rounded-lg px-5 h-10"
          data-tour-id="general-ai-required-cta"
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
