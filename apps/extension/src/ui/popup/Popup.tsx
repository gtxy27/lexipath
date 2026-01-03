import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import type { Settings } from '@lexipath/core';
import { sendMessage } from '../../shared/messages';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Loader2, Settings2, Power, Languages, GraduationCap } from 'lucide-react';

export function Popup(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      const response = await sendMessage('GET_SETTINGS', undefined);
      if (response.ok) {
        setSettings(response.value);
      } else {
        console.error('[LexiPath] Failed to get settings:', response.error);
      }
      setLoading(false);
    }
    loadSettings();
  }, []);

  async function toggleEnabled() {
    if (!settings) return;
    const nextEnabled = !settings.enabled;
    const response = await sendMessage('SET_SETTINGS', { enabled: nextEnabled });
    if (response.ok) {
      setSettings({ ...settings, enabled: nextEnabled });
    } else {
      console.error('[LexiPath] Failed to update settings:', response.error);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 w-80 items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="w-80 border-0 rounded-none shadow-none overflow-hidden">
      <CardHeader className="pb-3 pt-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
              <img src="../../icons/icon.svg" className="h-5 w-5" alt="LexiPath" />
            </div>
            <CardTitle className="text-lg font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
              LexiPath
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={!!settings?.enabled}
              onCheckedChange={toggleEnabled}
              id="extension-toggle"
              className="data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-primary data-[state=checked]:to-primary/80"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 py-4 px-4">
        <div className="rounded-xl border bg-gradient-to-br from-card to-card/50 p-3.5 shadow-md hover:shadow-lg transition-shadow duration-200 backdrop-blur-sm">
           <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <div className="p-1 rounded-md bg-primary/10">
                  <Power className="h-3.5 w-3.5 text-primary" />
                </div>
                {browser.i18n.getMessage('status')}
              </span>
              <Badge
                variant={settings?.enabled ? "default" : "secondary"}
                className={settings?.enabled
                  ? "bg-gradient-to-r from-green-500 to-emerald-600 border-0 shadow-sm"
                  : "bg-muted/50 border-border/50"}
              >
                {settings?.enabled
                  ? browser.i18n.getMessage('on')
                  : browser.i18n.getMessage('off')}
              </Badge>
           </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="group rounded-xl border bg-gradient-to-br from-card to-card/50 p-3 shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.02] hover:border-primary/30">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground group-hover:text-primary/70 transition-colors">
              <div className="p-0.5 rounded bg-blue-500/10">
                <Languages className="h-3 w-3 text-blue-600 dark:text-blue-400" />
              </div>
              {browser.i18n.getMessage('targetLanguage')}
            </div>
            <div className="text-sm font-bold uppercase text-foreground">
              {settings?.targetLanguage || '-'}
            </div>
          </div>

          <div className="group rounded-xl border bg-gradient-to-br from-card to-card/50 p-3 shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.02] hover:border-primary/30">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground group-hover:text-primary/70 transition-colors">
              <div className="p-0.5 rounded bg-purple-500/10">
                <GraduationCap className="h-3 w-3 text-purple-600 dark:text-purple-400" />
              </div>
              {browser.i18n.getMessage('proficiencyLevel')}
            </div>
            <div className="text-sm font-bold text-foreground">
              {settings?.proficiencyLevel || '-'}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-2 pb-4 pt-2 px-4">
        <Separator className="mb-2" />
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200 group"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          <Settings2 className="h-4 w-4 group-hover:rotate-90 transition-transform duration-300" />
          {browser.i18n.getMessage('openSettings')}
        </Button>
      </CardFooter>
    </Card>
  );
}
