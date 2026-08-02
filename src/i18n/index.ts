import type { MarketCode, SupportedLocale } from '../domain/catalog';
import {
  defaultMarket,
  getMarketConfig,
  getPathFromMarket,
  marketRegistry,
} from '../domain/markets';
import de from './locales/de/common.json';
import en from './locales/en/common.json';
import ja from './locales/ja/common.json';
import zhHans from './locales/zh-Hans/common.json';
import zhHant from './locales/zh-Hant/common.json';
import { getPathFromLocale, isLocalePath, localeConfig, localePaths } from './locales';

export {
  defaultLocale,
  getCatalogLanguage,
  getPathFromLocale,
  isLocalePath,
  localeConfig,
  localeDetectionRules,
  localePaths,
  matchSupportedLocale,
  type LocalePath,
} from './locales';

export type TranslationKey = keyof typeof en;
export type Dictionary = Readonly<Record<TranslationKey, string>>;

const dictionaries: Readonly<Record<SupportedLocale, Dictionary>> = {
  en,
  de,
  ja,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};

export const getLocaleFromPath = (path: string): SupportedLocale => {
  if (isLocalePath(path)) return localeConfig[path].locale;
  throw new Error(`Unsupported locale path: ${path}`);
};

export const getTranslations = (locale: SupportedLocale): Dictionary => dictionaries[locale];

export const catalogPath = (market: MarketCode, locale: SupportedLocale, route = '/'): string => {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `/${getPathFromMarket(market)}/${getPathFromLocale(locale)}${normalizedRoute}`.replace(
    /\/{2,}/g,
    '/',
  );
};

export interface LanguageAlternate {
  readonly href: string;
  readonly hreflang: string;
}

const regionalLanguageTag = (locale: SupportedLocale, market: MarketCode): string =>
  `${localeConfig[getPathFromLocale(locale)].htmlLang}-${market}`;

export const getCatalogAlternates = (route: string, site: URL): LanguageAlternate[] => {
  const alternates = marketRegistry.flatMap((market) =>
    localePaths.map((localePath) => {
      const locale = localeConfig[localePath].locale;
      return {
        href: new URL(catalogPath(market.code, locale, route), site).toString(),
        hreflang: regionalLanguageTag(locale, market.code),
      };
    }),
  );
  const fallback = getMarketConfig(defaultMarket);

  return [
    ...alternates,
    {
      href: new URL(catalogPath(fallback.code, fallback.defaultLocale, route), site).toString(),
      hreflang: 'x-default',
    },
  ];
};
