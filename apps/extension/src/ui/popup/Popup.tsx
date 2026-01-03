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
    <Card className="w-80 border-0 rounded-none shadow-none overflow-hidden bg-white/80 backdrop-blur-sm">
      <CardHeader className="pb-3 pt-4 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-pink-500/10 border-b border-purple-200/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
              <img src="../../icons/icon.svg" className="h-5 w-5" alt="LexiPath" />
            </div>
            <CardTitle className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              LexiPath
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={!!settings?.enabled}
              onCheckedChange={toggleEnabled}
              id="extension-toggle"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 py-4 px-4">
        <div className="rounded-xl border border-purple-200/50 bg-gradient-to-br from-white to-purple-50 p-3.5 shadow-md hover:shadow-xl transition-all duration-300">
           <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <div className="p-1 rounded-md bg-gradient-to-br from-indigo-400 to-indigo-500">
                  <Power className="h-3.5 w-3.5 text-white" />
                </div>
                {browser.i18n.getMessage('status')}
              </span>
              <Badge
                className={settings?.enabled
                  ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white border-0 shadow-sm"
                  : "bg-gray-200 text-gray-600 border-gray-300"}
              >
                {settings?.enabled
                  ? browser.i18n.getMessage('on')
                  : browser.i18n.getMessage('off')}
              </Badge>
           </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="group rounded-xl border border-blue-200/50 bg-gradient-to-br from-white to-blue-50 p-3 shadow-md hover:shadow-xl transition-all duration-300 hover:scale-[1.02] hover:border-blue-300">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-600 group-hover:text-blue-600 transition-colors">
              <div className="p-0.5 rounded bg-gradient-to-br from-blue-400 to-cyan-400">
                <Languages className="h-3 w-3 text-white" />
              </div>
              {browser.i18n.getMessage('targetLanguage')}
            </div>
            <div className="text-sm font-bold uppercase bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
              {settings?.targetLanguage || '-'}
            </div>
          </div>

          <div className="group rounded-xl border border-purple-200/50 bg-gradient-to-br from-white to-purple-50 p-3 shadow-md hover:shadow-xl transition-all duration-300 hover:scale-[1.02] hover:border-purple-300">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-600 group-hover:text-purple-600 transition-colors">
              <div className="p-0.5 rounded bg-gradient-to-br from-purple-400 to-pink-400">
                <GraduationCap className="h-3 w-3 text-white" />
              </div>
              {browser.i18n.getMessage('proficiencyLevel')}
            </div>
            <div className="text-sm font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              {settings?.proficiencyLevel || '-'}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-2 pb-4 pt-2 px-4 bg-gradient-to-r from-gray-50 to-purple-50/30">
        <Separator className="mb-2 bg-purple-200/50" />
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 hover:bg-gradient-to-r hover:from-indigo-50 hover:to-purple-50 transition-all duration-200 group"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          <Settings2 className="h-4 w-4 group-hover:rotate-90 transition-transform duration-300 text-indigo-600" />
          <span className="text-gray-700">{browser.i18n.getMessage('openSettings')}</span>
        </Button>
      </CardFooter>
    </Card>
  );
}
