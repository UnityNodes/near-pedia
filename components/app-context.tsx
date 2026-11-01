'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang, type Translations } from '@/lib/i18n';

interface AppContextValue {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const AppContext = createContext<AppContextValue | null>(null);

// Language is locked to English. The i18n infrastructure stays so a
// future UI toggle can be added without rewiring every component, but
// nothing in the app currently changes language - neither user action
// nor localStorage hydration. Ignoring any stale yourpedia-lang value
// guarantees we never ship a half-translated UI by accident.
const LOCKED_LANG: Lang = 'en';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('yourpedia-theme');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydration is intentional
    setTheme(savedTheme === 'light' ? 'light' : 'dark');
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('yourpedia-theme', theme);
  }, [theme, themeReady]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  // Kept on the context so callers that already destructure setLang
  // keep compiling; the body is a no-op by design.
  const setLang = (_: Lang) => { /* lang is locked to English */ };

  const t = TRANSLATIONS[LOCKED_LANG] as typeof TRANSLATIONS.en;

  return (
    <AppContext.Provider value={{ theme, toggleTheme, lang: LOCKED_LANG, setLang, t }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function useT() {
  return useApp().t;
}
