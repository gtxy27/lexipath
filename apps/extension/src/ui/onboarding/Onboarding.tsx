import React from 'react';
import browser from 'webextension-polyfill';

export function Onboarding(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-3xl font-bold mb-4">
          {browser.i18n.getMessage('welcomeTitle')}
        </h1>
        <p className="text-gray-600 mb-8">
          {browser.i18n.getMessage('welcomeDesc')}
        </p>

        {/* TODO: Onboarding wizard steps */}
        <button className="bg-primary-500 text-white px-6 py-3 rounded-lg font-semibold">
          {browser.i18n.getMessage('getStarted')}
        </button>
      </div>
    </div>
  );
}
