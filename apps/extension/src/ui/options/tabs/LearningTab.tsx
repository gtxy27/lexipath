import React from "react";
import { t } from "../optionsI18n";
import type { FieldErrors, FormState } from "../optionsTypes";
import { LanguageTab } from "./LanguageTab";
import { RoutingTab } from "./RoutingTab";
import { OptionsDisclosure } from "../components/OptionsDisclosure";

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

      <OptionsDisclosure
        title={t("optionsLearningRoutingTitle")}
        description={t("optionsLearningRoutingDesc")}
        summaryRight={t("optionsAdvancedTitle")}
      >
        <div className="space-y-8">
          <RoutingTab
            embedded
            form={form}
            setForm={setForm}
            errors={errors}
            aiEnabled={aiEnabled}
            onOpenChannels={onOpenChannels}
          />
        </div>
      </OptionsDisclosure>
    </div>
  );
}
