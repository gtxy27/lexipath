import React, { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import { Keyboard } from "lucide-react";

import { Button } from "../../components/ui/button";
import { OptionsPageHeader } from "../components/OptionsPageHeader";
import { OptionsSection } from "../components/OptionsSection";
import { OptionsRow } from "../components/OptionsRow";
import { t } from "../optionsI18n";

type CommandInfo = {
  name: string;
  description?: string;
  shortcut?: string;
};

function getShortcutConfigUrl(): string {
  // Chrome / Chromium
  if (typeof (browser as any).runtime?.getBrowserInfo !== "function") {
    return "chrome://extensions/shortcuts";
  }
  // Firefox
  return "about:addons";
}

function getShortcutConfigHint(url: string): string {
  if (url.startsWith("chrome://")) return t("optionsShortcutsHintChrome", [url]);
  return t("optionsShortcutsHintFirefox");
}

export function ShortcutsTab(): React.ReactElement {
  const [commands, setCommands] = useState<CommandInfo[] | null>(null);
  const [openBlocked, setOpenBlocked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await browser.commands.getAll();
        if (!alive) return;
        // Chrome may include built-in commands like `_execute_action` in `commands.getAll()`.
        // Users can't meaningfully manage these from our extension UI, so hide them.
        const cleaned: CommandInfo[] = [];
        for (const cmd of list) {
          const name = cmd?.name;
          if (typeof name !== "string" || name.length === 0) continue;
          if (name.startsWith("_execute_")) continue;

          const next: CommandInfo = { name };
          if (typeof cmd.description === "string") next.description = cmd.description;
          if (typeof cmd.shortcut === "string") next.shortcut = cmd.shortcut;
          cleaned.push(next);
        }

        setCommands(cleaned);
      } catch {
        if (!alive) return;
        setCommands([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const configUrl = useMemo(() => getShortcutConfigUrl(), []);
  const rows = commands ?? [];

  return (
    <>
      <OptionsPageHeader
        title={t("optionsShortcutsTitle")}
        description={t("optionsShortcutsDesc")}
        icon={Keyboard}
      />

      <div className="space-y-10 mt-4">
        <OptionsSection
          title={t("optionsShortcutsManageTitle")}
          description={t("optionsShortcutsManageDesc")}
        >
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                className="h-10 rounded-lg border border-border bg-background text-xs font-medium"
                onClick={async () => {
                  setOpenBlocked(false);
                  try {
                    const url = configUrl;
                    const created = await browser.tabs.create({ url });
                    if (!created) setOpenBlocked(true);
                  } catch {
                    setOpenBlocked(true);
                  }
                }}
              >
                {t("optionsShortcutsConfigureButton")}
              </Button>

              <div className="text-xs text-muted-foreground flex items-center">
                {getShortcutConfigHint(configUrl)}
              </div>
            </div>

            {openBlocked ? (
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
                {t("optionsShortcutsOpenBlocked", [configUrl])}
              </div>
            ) : null}
          </div>
        </OptionsSection>

        <OptionsSection
          title={t("optionsShortcutsListTitle")}
          description={t("optionsShortcutsListDesc")}
        >
          <div className="space-y-3">
            {commands === null ? (
              <div className="text-sm text-muted-foreground">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("optionsShortcutsEmpty")}</div>
            ) : (
              rows.map((cmd) => {
                const title = cmd.description?.trim();
                if (!title) return null;

                const binding = cmd.shortcut?.trim() ? cmd.shortcut : t("optionsShortcutsNotSet");
                return (
                  <OptionsRow key={cmd.name} title={title}>
                    <div className="font-mono text-xs px-2.5 py-1.5 rounded-md border border-border bg-background">
                      {binding}
                    </div>
                  </OptionsRow>
                );
              })
            )}
          </div>
        </OptionsSection>
      </div>
    </>
  );
}
