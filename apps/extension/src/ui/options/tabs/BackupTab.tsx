import React, { useState } from "react";
import { WebDAVConfigSchema, type Settings } from "@lexipath/core";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useToast } from "../../components/ui/use-toast";
import { Download, Loader2, Upload } from "lucide-react";
import { AiGate } from "../AiGate";
import { OptionsPageHeader } from "../components/OptionsPageHeader";
import { OptionsSection } from "../components/OptionsSection";
import { t } from "../optionsI18n";
import { sendMessage } from "../optionsMessages";
import type { FieldErrors, FormState } from "../optionsTypes";

const log = createLogger("ui:Options:BackupTab");

export function BackupTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  errors: FieldErrors;
  aiEnabled: boolean;
  onOpenChannels: () => void;
  onReloadSettings: () => Promise<void>;
  embedded?: boolean;
}): React.ReactElement {
  const { toast } = useToast();
  const { form, setForm, errors, aiEnabled, onOpenChannels, onReloadSettings } =
    props;
  const embedded = props.embedded ?? false;
  const [webdavAction, setWebdavAction] = useState<"upload" | "download" | null>(
    null,
  );
  const [wordbookExportFormat, setWordbookExportFormat] = useState<
    "json" | "anki_csv" | "markdown"
  >("json");
  const [wordbookImportStrategy, setWordbookImportStrategy] = useState<
    "merge" | "overwrite" | "skip-duplicates"
  >("merge");

  async function ensureWebDAVPermission(url: string): Promise<boolean> {
    try {
      const origin = new URL(url).origin;
      const response = await sendMessage("REQUEST_HOST_PERMISSION", { origin });
      if (response.ok && response.value) return true;
      toast({
        title: t("optionsWebDAVPermissionDenied"),
        variant: "destructive",
      });
      return false;
    } catch (error: unknown) {
      log.error("WebDAV permission request failed", {
        message: getErrorMessage(error),
      });
      toast({
        title: t(
          "optionsWebDAVPermissionError",
          error instanceof Error ? error.message : t("error_unknown"),
        ),
        variant: "destructive",
      });
      return false;
    }
  }

  function buildWebDAVConfig():
    | { ok: true; value: NonNullable<Settings["webdav"]> }
    | { ok: false } {
    const parsed = WebDAVConfigSchema.safeParse({
      url: form.webdav.url.trim(),
      username: form.webdav.username,
      password: form.webdav.password,
      path: form.webdav.path.trim() || "/LexiPath/backup.json",
    });
    if (!parsed.success) {
      toast({
        title: t("optionsWebDAVInvalidConfig"),
        variant: "destructive",
      });
      return { ok: false };
    }
    return { ok: true, value: parsed.data };
  }

  async function handleWebDAVUpload() {
    if (webdavAction) return;
    const configResult = buildWebDAVConfig();
    if (!configResult.ok) return;

    const hasPermission = await ensureWebDAVPermission(configResult.value.url);
    if (!hasPermission) return;

    setWebdavAction("upload");
    try {
      const response = await sendMessage("WEBDAV_UPLOAD", configResult.value);
      if (response.ok) {
        toast({ title: t("optionsWebDAVUploadSuccess") });
      } else {
        toast({
          title: t("optionsWebDAVUploadError", response.error.message),
          variant: "destructive",
        });
      }
    } finally {
      setWebdavAction(null);
    }
  }

  async function handleWebDAVDownload() {
    if (webdavAction) return;
    const configResult = buildWebDAVConfig();
    if (!configResult.ok) return;

    const hasPermission = await ensureWebDAVPermission(configResult.value.url);
    if (!hasPermission) return;

    setWebdavAction("download");
    try {
      const response = await sendMessage("WEBDAV_DOWNLOAD", configResult.value);
      if (response.ok) {
        toast({ title: t("optionsWebDAVDownloadSuccess") });
        await onReloadSettings();
      } else {
        toast({
          title: t("optionsWebDAVDownloadError", response.error.message),
          variant: "destructive",
        });
      }
    } finally {
      setWebdavAction(null);
    }
  }

  async function handleExport() {
    const response = await sendMessage("EXPORT_DATA", undefined);
    if (!response.ok) {
      toast({
        title: t("optionsExportError", response.error.message),
        variant: "destructive",
      });
      return;
    }

    const blob = new Blob([JSON.stringify(response.value, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lexipath-backup-${new Date().toISOString().split("T")[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast({
      title: t("optionsExportSuccess"),
    });
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = e.target?.result;
        if (typeof raw !== "string") return;
        const data = JSON.parse(raw);
        const response = await sendMessage("IMPORT_DATA", data);
        if (response.ok) {
          toast({
            title: t("optionsImportSuccess"),
          });
          await onReloadSettings();
        } else {
          toast({
            title: t("optionsImportError", response.error.message),
            variant: "destructive",
          });
        }
      } catch (err: unknown) {
        log.error("Import failed", { message: getErrorMessage(err) });
        toast({
          title: t(
            "optionsImportError",
            err instanceof Error ? err.message : t("optionsImportInvalidJson"),
          ),
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function handleWordbookExport() {
    const response = await sendMessage("WORDBOOK_EXPORT", {
      format: wordbookExportFormat,
    });

    if (!response.ok) {
      toast({
        title: t("optionsWordbookExportError", response.error.message),
        variant: "destructive",
      });
      return;
    }

    const blob = new Blob([response.value.content], { type: response.value.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = response.value.filename;
    link.click();
    URL.revokeObjectURL(url);

    toast({ title: t("optionsWordbookExportSuccess") });
  }

  async function handleWordbookImport(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    const format = file.name.toLowerCase().endsWith(".csv") ? "anki_csv" : "json";

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = e.target?.result;
        if (typeof raw !== "string") return;

        const response = await sendMessage("WORDBOOK_IMPORT", {
          format,
          data: raw,
          strategy: wordbookImportStrategy,
        });

        if (!response.ok) {
          toast({
            title: t("optionsWordbookImportError", response.error.message),
            variant: "destructive",
          });
          return;
        }

        toast({
          title: t("optionsWordbookImportSuccess", [
            String(response.value.added),
            String(response.value.updated),
            String(response.value.skipped),
          ]),
        });
      } catch (err: unknown) {
        log.error("Wordbook import failed", { message: getErrorMessage(err) });
        toast({
          title: t(
            "optionsWordbookImportError",
            err instanceof Error ? err.message : t("error_unknown"),
          ),
          variant: "destructive",
        });
      }
    };

    reader.readAsText(file);
    input.value = "";
  }

  const content = (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
        <OptionsSection
          title={t("optionsExportButton")}
          description={t("optionsExportDesc")}
        >
          <Button
            onClick={handleExport}
            className="w-full h-11 rounded-lg flex items-center justify-center gap-2"
          >
            <Download className="h-4 w-4" />
            {t("optionsExportButton")}
          </Button>
        </OptionsSection>

        <OptionsSection
          title={t("optionsImportButton")}
          description={t("optionsImportDesc")}
        >
          <div className="relative">
            <Input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="absolute inset-0 opacity-0 cursor-pointer z-10"
            />
            <Button
              variant="outline"
              className="w-full h-11 rounded-lg flex items-center justify-center gap-2 bg-background/70 dark:bg-card/60 hover:bg-background dark:hover:bg-card/80"
            >
              <Upload className="h-4 w-4" />
              {t("optionsImportButton")}
            </Button>
          </div>
        </OptionsSection>
      </div>

      <OptionsSection
        title={t("optionsWordbookTransferTitle")}
        description={t("optionsWordbookTransferDesc")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="text-sm font-medium">{t("optionsWordbookExportTitle")}</div>
            <Select
              value={wordbookExportFormat}
              onValueChange={(v) =>
                setWordbookExportFormat(v as "json" | "anki_csv" | "markdown")
              }
            >
              <SelectTrigger className="h-11 rounded-lg bg-background/70 dark:bg-card/60 shadow-sm">
                <SelectValue placeholder={t("optionsWordbookFormatJson")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">{t("optionsWordbookFormatJson")}</SelectItem>
                <SelectItem value="anki_csv">{t("optionsWordbookFormatAnkiCsv")}</SelectItem>
                <SelectItem value="markdown">{t("optionsWordbookFormatMarkdown")}</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleWordbookExport}
              className="w-full h-11 rounded-lg flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {t("optionsWordbookExportButton")}
            </Button>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">{t("optionsWordbookImportTitle")}</div>
            <div className="space-y-2.5">
              <Label className="text-xs text-muted-foreground">
                {t("optionsWordbookImportStrategyLabel")}
              </Label>
              <Select
                value={wordbookImportStrategy}
                onValueChange={(v) =>
                  setWordbookImportStrategy(
                    v as "merge" | "overwrite" | "skip-duplicates",
                  )
                }
              >
                <SelectTrigger className="h-11 rounded-lg bg-background/70 dark:bg-card/60 shadow-sm">
                  <SelectValue placeholder={t("optionsWordbookImportStrategyMerge")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">{t("optionsWordbookImportStrategyMerge")}</SelectItem>
                  <SelectItem value="overwrite">
                    {t("optionsWordbookImportStrategyOverwrite")}
                  </SelectItem>
                  <SelectItem value="skip-duplicates">
                    {t("optionsWordbookImportStrategySkip")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="relative">
              <Input
                type="file"
                accept=".json,.csv"
                onChange={handleWordbookImport}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
              />
              <Button
                variant="outline"
                className="w-full h-11 rounded-lg flex items-center justify-center gap-2 bg-background/70 dark:bg-card/60 hover:bg-background dark:hover:bg-card/80"
              >
                <Upload className="h-4 w-4" />
                {t("optionsWordbookImportButton")}
              </Button>
            </div>
          </div>
        </div>
      </OptionsSection>

      <OptionsSection className="shadow-none">
        <header className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {t("optionsWebDAVCloudSyncTitle")}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("optionsWebDAVDesc")}
            </p>
          </div>
          <Badge
            variant="outline"
            className="px-2 py-0 text-xs font-medium text-muted-foreground"
          >
            {t("optionsPhase2Badge")}
          </Badge>
        </header>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2.5">
            <Label className="text-xs text-muted-foreground">
              {t("optionsWebDAVUrl")}
            </Label>
            <Input
              placeholder={t("optionsWebDAVUrlPlaceholder")}
              className="h-11 rounded-lg"
              value={form.webdav.url}
              onChange={(e) =>
                setForm({
                  ...form,
                  webdav: { ...form.webdav, url: e.target.value },
                })
              }
            />
            {errors.webdav?.url && (
              <p className="text-xs text-destructive">
                {t(errors.webdav.url)}
              </p>
            )}
          </div>
          <div className="space-y-2.5">
            <Label className="text-xs text-muted-foreground">
              {t("optionsWebDAVPath")}
            </Label>
            <Input
              placeholder={t("optionsWebDAVPathPlaceholder")}
              className="h-11 rounded-lg"
              value={form.webdav.path}
              onChange={(e) =>
                setForm({
                  ...form,
                  webdav: { ...form.webdav, path: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2.5">
            <Label className="text-xs text-muted-foreground">
              {t("optionsWebDAVUser")}
            </Label>
            <Input
              className="h-11 rounded-lg"
              value={form.webdav.username}
              onChange={(e) =>
                setForm({
                  ...form,
                  webdav: { ...form.webdav, username: e.target.value },
                })
              }
            />
            {errors.webdav?.username && (
              <p className="text-xs text-destructive">
                {t(errors.webdav.username)}
              </p>
            )}
          </div>
          <div className="space-y-2.5">
            <Label className="text-xs text-muted-foreground">
              {t("optionsWebDAVPass")}
            </Label>
            <Input
              type="password"
              className="h-11 rounded-lg"
              value={form.webdav.password}
              onChange={(e) =>
                setForm({
                  ...form,
                  webdav: { ...form.webdav, password: e.target.value },
                })
              }
            />
            {errors.webdav?.password && (
              <p className="text-xs text-destructive">
                {t(errors.webdav.password)}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-6">
          <Button
            variant="outline"
            className="flex-1 h-11 rounded-lg text-xs font-medium"
            onClick={handleWebDAVUpload}
            disabled={webdavAction !== null}
          >
            {webdavAction === "upload" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {t("optionsWebDAVUpload")}
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-11 rounded-lg text-xs font-medium"
            onClick={handleWebDAVDownload}
            disabled={webdavAction !== null}
          >
            {webdavAction === "download" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {t("optionsWebDAVDownload")}
          </Button>
        </div>
      </OptionsSection>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <>
      <OptionsPageHeader
        title={t("optionsBackupTitle")}
        description={t("optionsBackupDesc")}
      />

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        {content}
      </AiGate>
    </>
  );
}
