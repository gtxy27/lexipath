import React from 'react';
import { createRoot } from 'react-dom/client';
import { createLogger } from '@lexipath/core/log';
import { Popup } from './Popup';
import '../styles.css';
import { t } from '../../shared/i18n';
import { startThemeSync } from '../lib/theme-sync';

const log = createLogger('ui:popup');

document.title = t('extensionName');

startThemeSync(log);

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
