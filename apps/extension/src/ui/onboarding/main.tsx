import React from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { Onboarding } from './Onboarding';
import '../styles.css';

function t(key: string): string {
  return browser.i18n.getMessage(key) || key;
}

document.title = t('welcomeTitle');

const root = createRoot(document.getElementById('root')!);
root.render(<Onboarding />);
