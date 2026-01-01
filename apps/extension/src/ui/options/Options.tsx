import React from 'react';
import browser from 'webextension-polyfill';

export function Options(): React.ReactElement {
  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8">
        {browser.i18n.getMessage('settingsTitle')}
      </h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">
          {browser.i18n.getMessage('providerSettings')}
        </h2>
        <p className="text-gray-500">
          {browser.i18n.getMessage('providerSettingsDesc')}
        </p>
        {/* TODO: Provider configuration form */}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">
          {browser.i18n.getMessage('languageSettings')}
        </h2>
        {/* TODO: Language configuration */}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">
          {browser.i18n.getMessage('siteRules')}
        </h2>
        {/* TODO: Site rules configuration */}
      </section>
    </div>
  );
}
