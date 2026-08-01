import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';

export type LocalePreference = 'system' | 'zh-CN' | 'en';

export function resolveLocale(pref: LocalePreference | string | null | undefined): 'zh-CN' | 'en' {
  if (pref === 'zh-CN' || pref === 'en') return pref;
  const nav =
    typeof navigator !== 'undefined' ? navigator.language || (navigator as any).userLanguage : 'zh-CN';
  return String(nav).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

let ready: Promise<typeof i18n> | null = null;

export async function initI18n(): Promise<typeof i18n> {
  if (ready) return ready;
  ready = (async () => {
    let pref: LocalePreference = 'system';
    try {
      const cfg = await window.api.getConfig();
      if (cfg.ok && cfg.data && typeof (cfg.data as any).locale === 'string') {
        const v = (cfg.data as any).locale as string;
        if (v === 'system' || v === 'zh-CN' || v === 'en') pref = v;
      }
    } catch {
      // ignore — first launch / IPC not ready
    }
    const lng = resolveLocale(pref);
    if (!i18n.isInitialized) {
      await i18n.use(initReactI18next).init({
        resources: {
          'zh-CN': { translation: zhCN },
          en: { translation: en },
        },
        lng,
        fallbackLng: 'zh-CN',
        interpolation: { escapeValue: false },
      });
    } else {
      await i18n.changeLanguage(lng);
    }
    return i18n;
  })();
  return ready;
}

export async function applyLocalePreference(pref: LocalePreference): Promise<void> {
  await i18n.changeLanguage(resolveLocale(pref));
}

export function formatLocalizedTime(ts: number | null | undefined, language?: string): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  try {
    return new Intl.DateTimeFormat(language || i18n.language || 'zh-CN', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export default i18n;
