import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import type { Settings } from '@lexipath/core';
import { sendMessage } from '../../shared/messages';

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
      <div className="w-80 p-4">
        <p className="text-gray-500">{browser.i18n.getMessage('loading')}</p>
      </div>
    );
  }

  return (
    <div className="w-80 p-4">
      <h1 className="text-lg font-bold mb-4">LexiPath</h1>

      <div className="flex items-center justify-between mb-4">
        <span>{browser.i18n.getMessage('enabled')}</span>
        <button
          onClick={toggleEnabled}
          className={`px-3 py-1 rounded ${
            settings?.enabled
              ? 'bg-primary-500 text-white'
              : 'bg-gray-200 text-gray-700'
          }`}
        >
          {settings?.enabled
            ? browser.i18n.getMessage('on')
            : browser.i18n.getMessage('off')}
        </button>
      </div>

      <div className="text-sm text-gray-500">
        <p>
          {browser.i18n.getMessage('targetLanguage')}:{' '}
          {settings?.targetLanguage?.toUpperCase()}
        </p>
        <p>
          {browser.i18n.getMessage('proficiencyLevel')}:{' '}
          {settings?.proficiencyLevel}
        </p>
      </div>

      <div className="mt-4 pt-4 border-t">
        <button
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-primary-500 hover:underline text-sm"
        >
          {browser.i18n.getMessage('openSettings')}
        </button>
      </div>
    </div>
  );
}
