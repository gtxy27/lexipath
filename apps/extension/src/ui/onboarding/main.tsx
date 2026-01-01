import React from 'react';
import { createRoot } from 'react-dom/client';
import { Onboarding } from './Onboarding';
import '../styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<Onboarding />);
