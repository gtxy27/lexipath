import React from "react";
import { t } from "../optionsI18n";
import type { FieldErrors, FormState } from "../optionsTypes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { LanguageTab } from "./LanguageTab";
import { RoutingTab } from "./RoutingTab";
import { OptionsDisclosure } from "../components/OptionsDisclosure";
import { OptionsRow } from "../components/OptionsRow";
import { OptionsSection } from "../components/OptionsSection";

export function LearningTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  errors: FieldErrors;
  aiEnabled: boolean;
  onOpenChannels: () => void;
}): React.ReactElement {
  const { form, setForm, errors, aiEnabled, onOpenChannels } = props;
  const contextEnabled = form.llmContextSentences > 0;
  const contextOptions = [1, 2, 3, 4, 5, 6];

  return (
    <div className="space-y-10">
      <div data-tour-id="learning-language">
        <LanguageTab
          form={form}
          setForm={setForm}
          aiEnabled={aiEnabled}
          onOpenChannels={onOpenChannels}
        />
      </div>

      <div data-tour-id="learning-context">
        <OptionsSection
          title={t("optionsLlmContextTitle")}
          description={t("optionsLlmContextDesc")}
        >
          <div className="space-y-5">
            <OptionsRow
              title={t("optionsLlmContextEnableTitle")}
              description={t("optionsLlmContextEnableDesc")}
            >
              <Switch
                data-testid="llm-context-enabled"
                checked={contextEnabled}
                onCheckedChange={(checked) =>
                  setForm({
                    ...form,
                    llmContextSentences: checked
                      ? Math.max(1, form.llmContextSentences || 1)
                      : 0,
                  })
                }
                className="data-[state=checked]:bg-primary"
              />
            </OptionsRow>

            {contextEnabled ? (
              <OptionsRow
                title={t("optionsLlmContextSizeTitle")}
                description={t("optionsLlmContextSizeDesc")}
              >
                <Select
                  value={String(form.llmContextSentences)}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      llmContextSentences: Number(v),
                    })
                  }
                >
                  <SelectTrigger
                    data-testid="llm-context-size"
                    className="w-full sm:w-56 h-11 rounded-lg text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {contextOptions.map((n) => (
                      <SelectItem key={String(n)} value={String(n)}>
                        {t("optionsLlmContextSentencesLabel", String(n))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </OptionsRow>
            ) : null}
          </div>
        </OptionsSection>
      </div>

      <div data-tour-id="learning-routing">
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
    </div>
  );
}
