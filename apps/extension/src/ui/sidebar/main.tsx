import React from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from './Sidebar';
import '../styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<Sidebar />);
