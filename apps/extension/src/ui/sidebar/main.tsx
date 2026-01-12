import React from 'react';
import { createRoot } from 'react-dom/client';
import { createLogger } from '@lexipath/core/log';
import { Sidebar } from './Sidebar';
import '../styles.css';
import { t } from '../../shared/i18n';
import { startThemeSync } from '../lib/theme-sync';

const log = createLogger('ui:sidebar');

document.title = t('chatPageTitle');

startThemeSync(log);

const root = createRoot(document.getElementById('root')!);
root.render(<Sidebar />);
