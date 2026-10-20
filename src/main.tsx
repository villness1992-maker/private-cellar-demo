import React from 'react';
import { createRoot } from 'react-dom/client';
import CellarApp from './CellarApp';
import { demoRequest } from './demo-db.js';
import './globals.css';

const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (path === '/api/state' || path === '/api/actions' || path === '/api/reset') {
    return demoRequest(path, init);
  }
  return originalFetch(input, init);
}) as typeof window.fetch;

const section = new URLSearchParams(location.search).get('section') || 'home';
createRoot(document.getElementById('root')!).render(<React.StrictMode><CellarApp section={section} /></React.StrictMode>);
