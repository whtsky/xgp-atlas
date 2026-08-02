import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  catalogManifestSchema,
  clientProductCatalogSchema,
  marketOverlaySchema,
  marketCodeSchema,
  productCatalogSchema,
  xboxProductIdSchema,
  type CatalogManifest,
  type CatalogStatus,
  type ClientProductCatalog,
  type MarketCode,
  type MarketOverlay,
  type Plan,
  type Platform,
  type SupportedLocale,
} from '../../src/domain/catalog';
import { createClientProductCatalog } from '../../src/domain/catalog-summary';
import type { MarketConfig } from '../../src/domain/markets';
import { getCatalogLanguage } from '../../src/i18n/locales';
import { mergeLocalizedProducts } from './normalize-product';
import type { CatalogProvider, CollectionTarget } from './provider';
import { serializeJson } from './write-json-atomically';

interface SyncCatalogOptions {
  readonly locales: readonly SupportedLocale[];
  readonly markets: readonly MarketConfig[];
  readonly now?: () => Date;
  readonly provider: CatalogProvider;
}

interface PlanCollectionSpec {
  readonly collection: string;
  readonly plan: Plan;
  readonly target: CollectionTarget;
}

interface StatusCollectionSpec {
  readonly collection: string;
  readonly status: Exclude<CatalogStatus, 'available'>;
  readonly target: CollectionTarget;
}

export interface CatalogRelease {
  readonly clientProducts: ClientProductCatalog;
  readonly manifest: CatalogManifest;
  readonly overlays: ReadonlyMap<MarketCode, MarketOverlay>;
}

const planCollections: readonly PlanCollectionSpec[] = [
  { collection: 'allgames', plan: 'ultimate', target: 'console' },
  { collection: 'allgames', plan: 'ultimate', target: 'pc' },
  { collection: 'allgamespremium', plan: 'premium', target: 'console' },
  { collection: 'allgamespremium', plan: 'premium', target: 'pc' },
  { collection: 'allgamesessential', plan: 'essential', target: 'console' },
  { collection: 'allgamesessential', plan: 'essential', target: 'pc' },
  { collection: 'allgamespc', plan: 'pc', target: 'pc' },
];

const statusCollections: readonly StatusCollectionSpec[] = [
  { collection: 'recentlyadded', status: 'recentlyAdded', target: 'console' },
  { collection: 'recentlyadded', status: 'recentlyAdded', target: 'pc' },
  { collection: 'comingsoon', status: 'comingSoon', target: 'console' },
  { collection: 'comingsoon', status: 'comingSoon', target: 'pc' },
  { collection: 'leavingsoon', status: 'leavingSoon', target: 'console' },
  { collection: 'leavingsoon', status: 'leavingSoon', target: 'pc' },
];

const productIdentitySchema = z.object({ ProductId: xboxProductIdSchema });
const planOrder: readonly Plan[] = ['essential', 'pc', 'premium', 'ultimate'];
const statusOrder: readonly CatalogStatus[] = [
  'available',
  'recentlyAdded',
  'comingSoon',
  'leavingSoon',
];
const SYNC_CONCURRENCY = 2;

const sortByOrder = <T extends string>(values: Iterable<T>, order: readonly T[]): T[] =>
  [...values].toSorted((left, right) => order.indexOf(left) - order.indexOf(right));

const mapConcurrent = async <T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), values.length) }, worker),
  );
  return results;
};

const buildMarketOverlay = async (
  provider: CatalogProvider,
  market: MarketCode,
): Promise<MarketOverlay> => {
  const planResults = await Promise.all(
    planCollections.map(async (spec) => ({
      result: await provider.fetchCollection({
        allowEmpty: spec.collection !== 'allgames',
        collection: spec.collection,
        language: 'en-us',
        market,
        target: spec.target,
      }),
      spec,
    })),
  );
  const statusResults = await Promise.all(
    statusCollections.map(async (spec) => ({
      result: await provider.fetchCollection({
        allowEmpty: true,
        collection: spec.collection,
        language: 'en-us',
        market,
        target: spec.target,
      }),
      spec,
    })),
  );

  const plansById = new Map<string, Set<Plan>>();
  const platformsById = new Map<string, Set<Platform>>();
  for (const { result, spec } of planResults) {
    for (const id of result.ids) {
      const plans = plansById.get(id) ?? new Set<Plan>();
      plans.add(spec.plan);
      plansById.set(id, plans);

      const platforms = platformsById.get(id) ?? new Set<Platform>();
      platforms.add(spec.target);
      platformsById.set(id, platforms);
    }
  }
  if (plansById.size === 0) throw new Error(`Market ${market} returned no catalog products`);

  const statusesById = new Map<string, Set<CatalogStatus>>();
  for (const id of plansById.keys()) statusesById.set(id, new Set<CatalogStatus>(['available']));
  for (const { result, spec } of statusResults) {
    for (const id of result.ids) {
      if (!plansById.has(id)) continue;
      const statuses = statusesById.get(id) ?? new Set<CatalogStatus>();
      statuses.add(spec.status);
      statusesById.set(id, statuses);
    }
  }

  const providerConfigUrl = provider.configSourceUrl;
  if (providerConfigUrl === null)
    throw new Error(`Provider configuration was unavailable after syncing ${market}`);

  return marketOverlaySchema.parse({
    games: [...plansById.keys()]
      .map((id) => ({
        id,
        plans: sortByOrder(plansById.get(id) ?? [], planOrder),
        platforms: [...(platformsById.get(id) ?? [])].toSorted(),
        statuses: sortByOrder(statusesById.get(id) ?? ['available'], statusOrder),
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    market,
    schemaVersion: 2,
    source: {
      provider: provider.name,
      providerConfigUrl,
    },
  });
};

interface ProductSourceGroup {
  readonly ids: readonly string[];
  readonly market: MarketCode;
}

const fetchProductGroup = async (
  provider: CatalogProvider,
  locales: readonly SupportedLocale[],
  group: ProductSourceGroup,
) => {
  const [localizedProducts, enrichments] = await Promise.all([
    Promise.all(
      locales.map(async (locale) => ({
        locale,
        products: await provider.fetchProducts({
          ids: group.ids,
          language: getCatalogLanguage(locale),
          market: group.market,
        }),
      })),
    ),
    provider.fetchProductEnrichments({
      ids: group.ids,
      language: 'en-US',
      market: group.market,
    }),
  ]);

  const productsByLocale = new Map<SupportedLocale, Map<string, unknown>>();
  const requestedIds = new Set(group.ids);
  for (const { locale, products } of localizedProducts) {
    const byId = new Map<string, unknown>();
    for (const product of products) {
      const { ProductId } = productIdentitySchema.parse(product);
      if (!requestedIds.has(ProductId)) {
        throw new Error(
          `Product metadata for ${group.market}/${locale} returned unexpected ID ${ProductId}`,
        );
      }
      if (byId.has(ProductId)) {
        throw new Error(
          `Product metadata for ${group.market}/${locale} returned duplicate ID ${ProductId}`,
        );
      }
      byId.set(ProductId, product);
    }
    const missingIds = group.ids.filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      throw new Error(
        `Product metadata for ${group.market}/${locale} omitted ${String(missingIds.length)}/${String(group.ids.length)} requested IDs: ${missingIds.slice(0, 10).join(', ')}`,
      );
    }
    productsByLocale.set(locale, byId);
  }
  const enrichmentById = new Map(
    enrichments.map((enrichment) => [enrichment.productId, enrichment]),
  );

  return group.ids.map((id) => {
    const inputs = locales.map((locale) => {
      const product = productsByLocale.get(locale)?.get(id);
      if (product === undefined) {
        throw new Error(`Missing validated product metadata for ${group.market}/${locale}/${id}`);
      }
      return { locale, product };
    });

    const enrichment = enrichmentById.get(id);
    return {
      ...mergeLocalizedProducts(inputs),
      metacritic: enrichment?.metacritic ?? null,
      playtime: enrichment?.playtime ?? null,
    };
  });
};

export const syncCatalogRelease = async ({
  locales,
  markets,
  now = () => new Date(),
  provider,
}: SyncCatalogOptions): Promise<CatalogRelease> => {
  if (markets.length === 0) throw new Error('At least one market must be enabled');

  const refreshes = await mapConcurrent(markets, SYNC_CONCURRENCY, async (config) => {
    try {
      return { config, overlay: await buildMarketOverlay(provider, config.code) };
    } catch (error) {
      return { config, error: error instanceof Error ? error : new Error(String(error)) };
    }
  });

  const overlays = new Map<MarketCode, MarketOverlay>();
  for (const refresh of refreshes) {
    if ('error' in refresh) {
      throw new Error(`Market ${refresh.config.code} refresh failed: ${refresh.error.message}`);
    }
    overlays.set(refresh.config.code, refresh.overlay);
  }

  const sourceMarketById = new Map<string, MarketCode>();
  for (const config of markets) {
    const overlay = overlays.get(config.code);
    if (overlay === undefined) throw new Error(`Missing overlay for ${config.code}`);
    for (const { id } of overlay.games) {
      if (!sourceMarketById.has(id)) sourceMarketById.set(id, config.code);
    }
  }

  const groups = markets.map((config) => ({
    ids: [...sourceMarketById.entries()]
      .filter(([, sourceMarket]) => sourceMarket === config.code)
      .map(([id]) => id),
    market: config.code,
  }));
  const refreshedProductGroups = await mapConcurrent(groups, SYNC_CONCURRENCY, (group) =>
    fetchProductGroup(provider, locales, group),
  );
  const refreshedProducts = new Map(
    refreshedProductGroups.flat().map((product) => [product.id, product]),
  );

  const requiredIds = new Set(
    [...overlays.values()].flatMap((overlay) => overlay.games.map(({ id }) => id)),
  );
  const missingIds: string[] = [];
  const products = [...requiredIds].flatMap((id) => {
    const product = refreshedProducts.get(id);
    if (product === undefined) {
      missingIds.push(id);
      return [];
    }
    return [product];
  });
  if (missingIds.length > 0) {
    throw new Error(
      `Product metadata was unavailable for ${String(missingIds.length)} IDs: ${missingIds.slice(0, 10).join(', ')}`,
    );
  }

  const productCatalog = productCatalogSchema.parse({
    products: products.toSorted((left, right) =>
      left.canonicalTitle.localeCompare(right.canonicalTitle, 'en'),
    ),
    schemaVersion: 2,
  });
  const availableProductIds = new Set(productCatalog.products.map(({ id }) => id));
  for (const overlay of overlays.values()) {
    const missing = overlay.games.filter(({ id }) => !availableProductIds.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Market ${overlay.market} references ${String(missing.length)} missing products`,
      );
    }
  }

  const clientProducts = clientProductCatalogSchema.parse(
    createClientProductCatalog(productCatalog),
  );
  const generatedAt = now().toISOString();
  const clientProductsHash = createHash('sha256')
    .update(serializeJson(clientProducts))
    .digest('hex');
  const manifest = catalogManifestSchema.parse({
    clientProductsPath: `/p.${clientProductsHash}.json`,
    defaultMarket: markets[0]?.code,
    generatedAt,
    locales,
    markets: markets.map((config) => {
      const overlay = overlays.get(config.code);
      if (overlay === undefined) throw new Error(`Missing overlay for ${config.code}`);
      return {
        code: marketCodeSchema.parse(config.code),
        label: config.label,
        overlayPath: `/${config.code.toLowerCase()}.${createHash('sha256')
          .update(serializeJson(overlay))
          .digest('hex')}.json`,
        productCount: overlay.games.length,
        storeLocale: config.storeLocale,
      };
    }),
    productCount: clientProducts.products.length,
    provider: provider.name,
    schemaVersion: 2,
  });

  return { clientProducts, manifest, overlays };
};
