import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  catalogManifestSchema,
  clientProductCatalogSchema,
  marketOverlaySchema,
  type CatalogManifest,
  type ClientProductCatalog,
  type MarketCode,
  type MarketOverlay,
  type SupportedLocale,
} from './catalog';

const manifestPath = resolve('public/catalog-manifest.json');

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

const resolveCatalogPath = (catalogPath: string): string => {
  if (/^\/(?:p|[a-z]{2})\.[a-f0-9]{64}\.json$/.test(catalogPath)) {
    return resolve('public', catalogPath.slice(1));
  }
  throw new Error(`Invalid catalog artifact path: ${catalogPath}`);
};

export interface ActiveCatalog {
  readonly manifest: CatalogManifest;
  readonly overlay: MarketOverlay;
  readonly products: ClientProductCatalog;
}

export const loadActiveCatalog = async (
  market: MarketCode,
  requiredLocale: SupportedLocale,
): Promise<ActiveCatalog> => {
  const manifest = catalogManifestSchema.parse(await readJson(manifestPath));
  const marketEntry = manifest.markets.find(({ code }) => code === market);
  if (marketEntry === undefined) throw new Error(`Market ${market} is not active`);

  const [products, overlay] = await Promise.all([
    readJson(resolveCatalogPath(manifest.clientProductsPath)).then((value) =>
      clientProductCatalogSchema.parse(value),
    ),
    readJson(resolveCatalogPath(marketEntry.overlayPath)).then((value) =>
      marketOverlaySchema.parse(value),
    ),
  ]);
  if (products.products.length !== manifest.productCount) {
    throw new Error('Manifest product count does not match the active product catalog');
  }
  if (!manifest.locales.includes(requiredLocale)) {
    throw new Error(`Active catalog release does not publish locale ${requiredLocale}`);
  }
  const missingLocalization = products.products.find(
    ({ localized }) => localized[requiredLocale] === undefined,
  );
  if (missingLocalization !== undefined) {
    throw new Error(`Product ${missingLocalization.id} is missing locale ${requiredLocale}`);
  }
  if (overlay.market !== market || overlay.games.length !== marketEntry.productCount) {
    throw new Error(`Manifest entry does not match the ${market} overlay`);
  }

  return { manifest, overlay, products };
};
