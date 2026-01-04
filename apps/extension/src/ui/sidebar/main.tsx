import React from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { Sidebar } from './Sidebar';
import '../styles.css';

function t(key: string): string {
  return browser.i18n.getMessage(key) || key;
}

document.title = t('chatPageTitle');

const root = createRoot(document.getElementById('root')!);
root.render(<Sidebar />);
