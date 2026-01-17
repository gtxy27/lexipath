import React from "react";
import { Cloud, Globe, Keyboard, Settings2 } from "lucide-react";
import { Switch } from "../../components/ui/switch";
import { AiGate } from "../AiGate";
import { t } from "../optionsI18n";
import type { FieldErrors, FormState } from "../optionsTypes";
import { BackupTab } from "./BackupTab";
import { DisplayTab } from "./DisplayTab";
import { SitesTab } from "./SitesTab";
import { OptionsDisclosure } from "../components/OptionsDisclosure";
import { OptionsPageHeader } from "../components/OptionsPageHeader";
import { OptionsRow } from "../components/OptionsRow";
import { OptionsSection } from "../components/OptionsSection";
import { ShortcutsTab } from "./ShortcutsTab";

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
      <OptionsPageHeader
        title={t("optionsTab_general")}
        description={t("optionsGeneralDesc")}
        icon={Settings2}
      />

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        <div className="space-y-10 mt-4">
           <OptionsSection title={t("optionsGeneralStatusTitle")}>
             <OptionsRow
               title={t("optionsEnabledTitle")}
               description={t("optionsEnabledHint")}
             >
               <Switch
                 checked={form.enabled}
                 onCheckedChange={(checked) =>
                   setForm({ ...form, enabled: checked })
                 }
                 className="data-[state=checked]:bg-primary"
               />
             </OptionsRow>

             <OptionsRow
               title={t("optionsToolExecutionTitle")}
               description={t("optionsToolExecutionDesc")}
             >
               <Switch
                 checked={form.toolExecutionEnabled}
                 onCheckedChange={(checked) =>
                   setForm({ ...form, toolExecutionEnabled: checked })
                 }
                 className="data-[state=checked]:bg-primary"
               />
             </OptionsRow>
           </OptionsSection>

          <OptionsDisclosure
            title={t("optionsShortcutsTitle")}
            description={t("optionsShortcutsDesc")}
            summaryRight={t("optionsAdvancedTitle")}
            icon={Keyboard}
          >
            <ShortcutsTab />
          </OptionsDisclosure>

          <DisplayTab
             embedded
             form={form}
             setForm={setForm}
             aiEnabled={aiEnabled}
             onOpenChannels={onOpenChannels}
           />


          <OptionsDisclosure
            title={t("optionsGeneralSitesTitle")}
            description={t("optionsGeneralSitesDesc")}
            summaryRight={t("optionsAdvancedTitle")}
            icon={Globe}
          >
              <SitesTab
                embedded
                form={form}
                setForm={setForm}
                aiEnabled={aiEnabled}
                onOpenChannels={onOpenChannels}
              />
          </OptionsDisclosure>

          <OptionsDisclosure
            title={t("optionsGeneralBackupTitle")}
            description={t("optionsGeneralBackupDesc")}
            summaryRight={t("optionsAdvancedTitle")}
            icon={Cloud}
          >
              <BackupTab
                embedded
                form={form}
                setForm={setForm}
                errors={errors}
                aiEnabled={aiEnabled}
                onOpenChannels={onOpenChannels}
                onReloadSettings={onReloadSettings}
              />
          </OptionsDisclosure>
        </div>
      </AiGate>
    </>
  );
}
