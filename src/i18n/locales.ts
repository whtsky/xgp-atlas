import type { SupportedLocale } from '../domain/catalog';

export const defaultLocale: SupportedLocale = 'en';

export const localeConfig = {
  en: {
    aliases: [
      'en',
      'en-US',
      'en-GB',
      'en-AU',
      'en-CA',
      'en-IE',
      'en-IN',
      'en-NZ',
      'en-SA',
      'en-SG',
    ],
    catalogLanguage: 'en-US',
    direction: 'ltr',
    htmlLang: 'en',
    label: 'English',
    locale: 'en',
    ogLocale: 'en_US',
  },
  de: {
    aliases: ['de', 'de-DE', 'de-AT', 'de-CH'],
    catalogLanguage: 'de-DE',
    direction: 'ltr',
    htmlLang: 'de',
    label: 'Deutsch',
    locale: 'de',
    ogLocale: 'de_DE',
  },
  ja: {
    aliases: ['ja', 'ja-JP'],
    catalogLanguage: 'ja-JP',
    direction: 'ltr',
    htmlLang: 'ja',
    label: '日本語',
    locale: 'ja',
    ogLocale: 'ja_JP',
  },
  'zh-hans': {
    aliases: ['zh-Hans', 'zh-Hans-CN', 'zh-Hans-SG', 'zh-CN', 'zh-SG'],
    catalogLanguage: 'zh-Hans',
    direction: 'ltr',
    htmlLang: 'zh-Hans',
    label: '简体中文',
    locale: 'zh-Hans',
    ogLocale: 'zh_CN',
  },
  'zh-hant': {
    aliases: ['zh-Hant', 'zh-Hant-HK', 'zh-Hant-MO', 'zh-Hant-TW', 'zh-HK', 'zh-MO', 'zh-TW'],
    catalogLanguage: 'zh-Hant',
    direction: 'ltr',
    htmlLang: 'zh-Hant',
    label: '繁體中文',
    locale: 'zh-Hant',
    ogLocale: 'zh_TW',
  },
} as const;

export type LocalePath = keyof typeof localeConfig;
export const localePaths = [
  'en',
  'de',
  'ja',
  'zh-hans',
  'zh-hant',
] as const satisfies readonly LocalePath[];

const localeToPath: Readonly<Record<SupportedLocale, LocalePath>> = {
  en: 'en',
  de: 'de',
  ja: 'ja',
  'zh-Hans': 'zh-hans',
  'zh-Hant': 'zh-hant',
};

export const isLocalePath = (path: string): path is LocalePath => Object.hasOwn(localeConfig, path);

export const getPathFromLocale = (locale: SupportedLocale): LocalePath => localeToPath[locale];

export const getCatalogLanguage = (locale: SupportedLocale): string =>
  localeConfig[getPathFromLocale(locale)].catalogLanguage;

const getChineseScript = (languageTag: string): 'Hans' | 'Hant' => {
  try {
    const locale = new Intl.Locale(languageTag).maximize();
    return locale.script === 'Hant' ? 'Hant' : 'Hans';
  } catch {
    return 'Hans';
  }
};

/** Mirrors Xbox App's ordered preferred-language matching against installed resources. */
export const matchSupportedLocale = (preferredLanguages: readonly string[]): SupportedLocale => {
  for (const preferred of preferredLanguages) {
    const normalized = preferred.toLowerCase();
    for (const path of localePaths) {
      if (localeConfig[path].aliases.some((alias) => alias.toLowerCase() === normalized)) {
        return localeConfig[path].locale;
      }
    }

    let language: string;
    try {
      language = new Intl.Locale(preferred).language;
    } catch {
      continue;
    }
    if (language === 'en' || language === 'de' || language === 'ja') return language;
    if (language === 'zh') return getChineseScript(preferred) === 'Hant' ? 'zh-Hant' : 'zh-Hans';
  }
  return defaultLocale;
};

export const localeDetectionRules = localePaths.map((path) => ({
  aliases: localeConfig[path].aliases,
  locale: localeConfig[path].locale,
  path,
}));
