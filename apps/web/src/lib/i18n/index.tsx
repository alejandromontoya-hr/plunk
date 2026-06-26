import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';

// English namespaces (also used as the fallback locale)
import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enAuth from './locales/en/auth.json';
import enDashboard from './locales/en/dashboard.json';
import enContacts from './locales/en/contacts.json';
import enSegments from './locales/en/segments.json';
import enCampaigns from './locales/en/campaigns.json';
import enTemplates from './locales/en/templates.json';

// Spanish namespaces
import esCommon from './locales/es/common.json';
import esNav from './locales/es/nav.json';
import esAuth from './locales/es/auth.json';
import esDashboard from './locales/es/dashboard.json';
import esContacts from './locales/es/contacts.json';
import esSegments from './locales/es/segments.json';
import esCampaigns from './locales/es/campaigns.json';
import esTemplates from './locales/es/templates.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Messages = Record<string, any>;

function buildMessages(
  common: Messages,
  nav: Messages,
  auth: Messages,
  dashboard: Messages,
  contacts: Messages,
  segments: Messages,
  campaigns: Messages,
  templates: Messages,
): Messages {
  return {common, nav, auth, dashboard, contacts, segments, campaigns, templates};
}

const MESSAGES: Record<string, Messages> = {
  en: buildMessages(enCommon, enNav, enAuth, enDashboard, enContacts, enSegments, enCampaigns, enTemplates),
  es: buildMessages(esCommon, esNav, esAuth, esDashboard, esContacts, esSegments, esCampaigns, esTemplates),
};

export interface UiLanguage {
  code: string;
  nativeName: string;
  flag: string;
}

// Languages exposed in the dashboard language switcher. Add more here as their
// namespaces get translated.
export const UI_LANGUAGES: UiLanguage[] = [
  {code: 'en', nativeName: 'English', flag: '🇺🇸'},
  {code: 'es', nativeName: 'Español', flag: '🇪🇸'},
];

export const DEFAULT_UI_LANGUAGE = 'en';
const STORAGE_KEY = 'plunk-language';

function isSupported(code: string): boolean {
  return UI_LANGUAGES.some(lang => lang.code === code);
}

function lookup(messages: Messages, key: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = messages;
  for (const part of key.split('.')) {
    value = value?.[part];
    if (value === undefined) {
      return undefined;
    }
  }
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const replacement = values[name];
    return replacement === undefined ? `{${name}}` : String(replacement);
  });
}

export type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

interface I18nContextValue {
  locale: string;
  setLocale: (code: string) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLocale(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_LANGUAGE;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && isSupported(stored)) {
    return stored;
  }

  const browser = window.navigator.language?.split('-')[0];
  if (browser && isSupported(browser)) {
    return browser;
  }

  return DEFAULT_UI_LANGUAGE;
}

export function I18nProvider({children}: {children: React.ReactNode}) {
  // Always start from the default locale so server and first client render match,
  // then sync to the persisted/browser preference after mount to avoid hydration
  // mismatches.
  const [locale, setLocaleState] = useState<string>(DEFAULT_UI_LANGUAGE);

  useEffect(() => {
    const initial = detectInitialLocale();
    if (initial !== DEFAULT_UI_LANGUAGE) {
      setLocaleState(initial);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((code: string) => {
    if (!isSupported(code)) {
      return;
    }
    setLocaleState(code);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, code);
    }
  }, []);

  const t = useCallback<TranslateFn>(
    (key, values) => {
      const active = MESSAGES[locale] ?? MESSAGES[DEFAULT_UI_LANGUAGE];
      const translated = lookup(active, key) ?? lookup(MESSAGES[DEFAULT_UI_LANGUAGE], key);
      if (translated === undefined) {
        // Surface the missing key instead of crashing.
        return key;
      }
      return interpolate(translated, values);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({locale, setLocale, t}), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return ctx;
}
