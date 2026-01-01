import React from 'react';
import browser from 'webextension-polyfill';

export function Sidebar(): React.ReactElement {
  return (
    <div className="h-screen flex flex-col">
      <header className="p-4 border-b">
        <h1 className="font-semibold">{browser.i18n.getMessage('chatTitle')}</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {/* TODO: Chat messages */}
        <p className="text-gray-500 text-center">
          {browser.i18n.getMessage('chatEmpty')}
        </p>
      </main>

      <footer className="p-4 border-t">
        {/* TODO: Chat input */}
        <input
          type="text"
          placeholder={browser.i18n.getMessage('chatPlaceholder')}
          className="w-full px-4 py-2 border rounded-lg"
        />
      </footer>
    </div>
  );
}
