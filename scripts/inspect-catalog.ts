import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  catalogManifestSchema,
  clientProductCatalogSchema,
  marketOverlaySchema,
} from '../src/domain/catalog';
import { catalogPath, getLocaleFromPath } from '../src/i18n';
import { defaultSiteUrl } from '../src/config/site';
import { localeConfig, localePaths } from '../src/i18n/locales';
import { marketRegistry } from '../src/domain/markets';

const artifactRoot = (() => {
  const index = process.argv.indexOf('--artifact');
  const value = index === -1 ? 'public' : process.argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error('--artifact requires a directory');
  }
  return resolve(value);
})();

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

const resolveArtifact = (artifactPath: string): string => {
  if (/^\/(?:p|[a-z]{2})\.[a-f0-9]{64}\.json$/.test(artifactPath)) {
    return resolve(artifactRoot, artifactPath.slice(1));
  }
  throw new Error(`Invalid catalog artifact path: ${artifactPath}`);
};

const manifest = catalogManifestSchema.parse(
  await readJson(resolve(artifactRoot, 'catalog-manifest.json')),
);
const expectedMarkets = marketRegistry.map(({ code }) => code).toSorted();
const actualMarkets = manifest.markets.map(({ code }) => code).toSorted();
if (expectedMarkets.join(',') !== actualMarkets.join(',')) {
  throw new Error(
    `Manifest markets differ from registry: expected ${expectedMarkets.join(',')}, got ${actualMarkets.join(',')}`,
  );
}
const expectedLocales = localePaths
  .map((path) => localeConfig[path].locale)
  .toSorted()
  .join(',');
if (manifest.locales.toSorted().join(',') !== expectedLocales) {
  throw new Error(`Manifest locales differ from registry: expected ${expectedLocales}`);
}

const clientProductsBytes = await readFile(resolveArtifact(manifest.clientProductsPath));
const clientProducts = clientProductCatalogSchema.parse(
  JSON.parse(clientProductsBytes.toString('utf8')) as unknown,
);
if (clientProducts.products.length !== manifest.productCount) {
  throw new Error('Manifest product count does not match the client product catalog');
}
const clientProductIds = new Set(clientProducts.products.map(({ id }) => id));
const clientProductsHash = createHash('sha256').update(clientProductsBytes).digest('hex');
if (manifest.clientProductsPath !== `/p.${clientProductsHash}.json`) {
  throw new Error('Client product catalog path does not match its content hash');
}

const marketStats: Record<string, unknown> = {};
const overlayProductIds = new Set<string>();
for (const entry of manifest.markets) {
  const overlayBytes = await readFile(resolveArtifact(entry.overlayPath));
  const overlay = marketOverlaySchema.parse(JSON.parse(overlayBytes.toString('utf8')) as unknown);
  if (overlay.market !== entry.code || overlay.games.length !== entry.productCount) {
    throw new Error(`Manifest entry does not match overlay ${entry.code}`);
  }
  const overlayHash = createHash('sha256').update(overlayBytes).digest('hex');
  if (entry.overlayPath !== `/${entry.code.toLowerCase()}.${overlayHash}.json`) {
    throw new Error(`Market overlay path does not match its content hash: ${entry.code}`);
  }
  const missing = overlay.games.filter(({ id }) => !clientProductIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Overlay ${entry.code} references ${String(missing.length)} missing compact products: ${missing
        .slice(0, 10)
        .map(({ id }) => id)
        .join(', ')}`,
    );
  }
  for (const { id } of overlay.games) overlayProductIds.add(id);
  marketStats[entry.code] = {
    games: overlay.games.length,
    pc: overlay.games.filter(({ platforms }) => platforms.includes('pc')).length,
    ultimate: overlay.games.filter(({ plans }) => plans.includes('ultimate')).length,
  };
}
if (
  overlayProductIds.size !== clientProductIds.size ||
  [...clientProductIds].some((id) => !overlayProductIds.has(id))
) {
  throw new Error('Market overlay IDs do not cover exactly the compact product catalog');
}

if (process.argv.includes('--artifact')) {
  const site = new URL(defaultSiteUrl);
  for (const market of marketRegistry) {
    for (const localePath of localePaths) {
      const locale = getLocaleFromPath(localePath);
      const route = catalogPath(market.code, locale);
      const htmlPath = resolve(artifactRoot, route.slice(1), 'index.html');
      const html = await readFile(htmlPath, 'utf8');
      const canonical = new URL(route, site).toString();
      if (!html.includes(`<link rel="canonical" href="${canonical}"`)) {
        throw new Error(`Missing canonical URL in ${htmlPath}`);
      }
      if (!html.includes('hreflang="x-default"')) {
        throw new Error(`Missing x-default alternate in ${htmlPath}`);
      }
      if (!html.includes('"@type":"CollectionPage"')) {
        throw new Error(`Missing CollectionPage JSON-LD in ${htmlPath}`);
      }
    }
  }
  const robots = await readFile(resolve(artifactRoot, 'robots.txt'), 'utf8');
  if (!robots.includes('Sitemap:')) throw new Error('robots.txt does not reference a sitemap');
  const sitemapIndex = await readFile(resolve(artifactRoot, 'sitemap-index.xml'), 'utf8');
  const sitemapLinks = [...sitemapIndex.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
  if (sitemapLinks.length === 0) throw new Error('sitemap-index.xml contains no child sitemaps');
  const sitemapUrls = new Set<string>();
  for (const link of sitemapLinks) {
    const sitemapPath = new URL(link).pathname.slice(1);
    const sitemap = await readFile(resolve(artifactRoot, sitemapPath), 'utf8');
    for (const [, value] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (value !== undefined) sitemapUrls.add(value);
    }
  }
  for (const market of marketRegistry) {
    for (const localePath of localePaths) {
      const locale = getLocaleFromPath(localePath);
      const url = new URL(catalogPath(market.code, locale), site).toString();
      if (!sitemapUrls.has(url)) throw new Error(`Sitemap is missing ${url}`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      artifactRoot,
      clientProducts: clientProducts.products.length,
      clientProductsPath: manifest.clientProductsPath,
      generatedAt: manifest.generatedAt,
      marketStats,
      markets: manifest.markets.length,
      provider: manifest.provider,
      schemaVersion: manifest.schemaVersion,
    },
    null,
    2,
  ),
);
