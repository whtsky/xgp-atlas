import type { MarketCode, SupportedLocale } from './catalog';

export interface MarketConfig {
  readonly code: MarketCode;
  readonly defaultLocale: SupportedLocale;
  readonly label: string;
  readonly path: string;
  readonly storeLocale: string;
}

export const marketRegistry = [
  { code: 'US', defaultLocale: 'en', label: 'United States', path: 'us', storeLocale: 'en-US' },
  { code: 'GB', defaultLocale: 'en', label: 'United Kingdom', path: 'gb', storeLocale: 'en-GB' },
  { code: 'CA', defaultLocale: 'en', label: 'Canada', path: 'ca', storeLocale: 'en-CA' },
  { code: 'AU', defaultLocale: 'en', label: 'Australia', path: 'au', storeLocale: 'en-AU' },
  { code: 'DE', defaultLocale: 'de', label: 'Germany', path: 'de', storeLocale: 'de-DE' },
  { code: 'JP', defaultLocale: 'ja', label: 'Japan', path: 'jp', storeLocale: 'ja-JP' },
  { code: 'HK', defaultLocale: 'zh-Hant', label: 'Hong Kong', path: 'hk', storeLocale: 'zh-HK' },
  { code: 'TW', defaultLocale: 'zh-Hant', label: 'Taiwan', path: 'tw', storeLocale: 'zh-TW' },
] as const satisfies readonly MarketConfig[];

export type MarketPath = (typeof marketRegistry)[number]['path'];
export const marketPaths = marketRegistry.map(({ path }) => path);
export const defaultMarket: MarketCode = 'US';

export const isMarketPath = (path: string): path is MarketPath =>
  marketRegistry.some((market) => market.path === path);

export const getMarketConfig = (code: MarketCode): MarketConfig => {
  const config = marketRegistry.find((market) => market.code === code);
  if (config === undefined) throw new Error(`Unsupported market: ${code}`);
  return config;
};

export const getMarketFromPath = (path: string): MarketCode => {
  const config = marketRegistry.find((market) => market.path === path);
  if (config === undefined) throw new Error(`Unsupported market path: ${path}`);
  return config.code;
};

export const getPathFromMarket = (code: MarketCode): MarketPath => {
  const config = marketRegistry.find((market) => market.code === code);
  if (config === undefined) throw new Error(`Unsupported market: ${code}`);
  return config.path;
};

export const getXboxStoreUrl = (productId: string, storeLocale: string): string =>
  `https://www.xbox.com/${storeLocale}/games/store/-/${encodeURIComponent(productId)}`;
