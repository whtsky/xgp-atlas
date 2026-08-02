import { z } from 'zod';

import { metacriticRatingSchema, playtimeSchema } from '../../../src/domain/catalog';
import type {
  CatalogProvider,
  CollectionQuery,
  CollectionResult,
  ProductEnrichment,
  ProductsQuery,
} from '../../catalog/provider';
import { discoverMicrosoftCatalogConfig, type MicrosoftCatalogConfig } from './discover-config';

interface ProviderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly landingPageUrl?: string;
}

interface InitializedConfig {
  readonly config: MicrosoftCatalogConfig;
  readonly sourceUrl: string;
}

const siglResponseSchema = z.array(
  z.looseObject({
    id: z.string().optional(),
    title: z.string().optional(),
  }),
);

const productResponseSchema = z.object({
  Products: z.array(z.unknown()),
});

const gamePassProductResponseSchema = z.object({
  Products: z.record(
    z.string(),
    z.looseObject({
      howLongToBeat: z
        .object({
          id: z.string().min(1),
          time: z.object({
            completionist: z.coerce.number().optional(),
            isReliable: z.boolean().optional(),
            main: z.coerce.number().optional(),
            mainPlus: z.coerce.number().optional(),
          }),
        })
        .nullish(),
      metacritic: z
        .object({
          metascore: z.coerce.number().min(0).max(100).optional(),
          url: z.url().optional(),
          userscore: z.coerce.number().min(0).max(10).optional(),
        })
        .nullish(),
    }),
  ),
});

const DEFAULT_LANDING_PAGE = 'https://www.xbox.com/en-US/xbox-game-pass/games';
const PRODUCT_BATCH_SIZE = 20;
const MAX_REQUEST_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MILLISECONDS = 30_000;
const REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const parseRetryAfterMilliseconds = (value: string | null): number | null => {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MILLISECONDS);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MILLISECONDS);
};

const secondsToMinutes = (seconds: number | undefined): number | null =>
  seconds === undefined || seconds <= 0 ? null : Math.max(1, Math.round(seconds / 60));

export class MicrosoftWebCatalogProvider implements CatalogProvider {
  readonly name = 'microsoft-web-catalog';

  #config: Promise<InitializedConfig> | null = null;
  #configSourceUrl: string | null = null;
  readonly #fetch: typeof globalThis.fetch;
  readonly #landingPageUrl: string;

  constructor(options: ProviderOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#landingPageUrl = options.landingPageUrl ?? DEFAULT_LANDING_PAGE;
  }

  get configSourceUrl(): string | null {
    return this.#configSourceUrl;
  }

  async #fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.#fetch(url, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
        });
        if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) return response;
        if (attempt === MAX_REQUEST_ATTEMPTS) return response;

        const retryAfter = parseRetryAfterMilliseconds(response.headers.get('retry-after'));
        await response.body?.cancel();
        await wait(retryAfter ?? 500 * 2 ** (attempt - 1));
      } catch (error) {
        lastError = error;
        if (attempt === MAX_REQUEST_ATTEMPTS) throw error;
        await wait(500 * 2 ** (attempt - 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Provider request failed');
  }

  async #fetchText(url: string): Promise<string> {
    const response = await this.#fetchWithRetry(url, {
      headers: { 'user-agent': 'xgp-atlas/0.1 catalog-sync' },
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(`Provider request failed (${String(response.status)}): ${url}`);
    return response.text();
  }

  async #fetchJson(url: URL): Promise<unknown> {
    const response = await this.#fetchWithRetry(url.toString(), {
      headers: { accept: 'application/json', 'user-agent': 'xgp-atlas/0.1 catalog-sync' },
    });
    if (!response.ok) {
      throw new Error(`Provider request failed (${String(response.status)}): ${url.toString()}`);
    }
    return response.json() as Promise<unknown>;
  }

  async #postJson(url: URL, body: unknown): Promise<unknown> {
    const response = await this.#fetchWithRetry(url.toString(), {
      body: JSON.stringify(body),
      headers: {
        accept: 'application/json',
        'calling-app-name': 'Garrison',
        'content-type': 'application/json',
        'user-agent': 'xgp-atlas/0.1 catalog-sync',
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Provider request failed (${String(response.status)}): ${url.toString()}`);
    }
    return response.json() as Promise<unknown>;
  }

  async #initialize(): Promise<InitializedConfig> {
    this.#config ??= discoverMicrosoftCatalogConfig({
      fetchText: (url) => this.#fetchText(url),
      landingPageUrl: this.#landingPageUrl,
    }).then((result) => {
      this.#configSourceUrl = result.sourceUrl;
      return result;
    });

    return this.#config;
  }

  async fetchCollection(query: CollectionQuery): Promise<CollectionResult> {
    const { config } = await this.#initialize();
    const pair = config.collections[query.collection];
    if (pair === undefined) throw new Error(`Unknown Microsoft collection: ${query.collection}`);

    const descriptor = pair[query.target];
    const subscriptionId = config.subscriptions[descriptor.plan];
    if (subscriptionId === undefined) {
      throw new Error(`Unknown Microsoft subscription context: ${descriptor.plan}`);
    }

    const url = new URL('https://catalog.gamepass.com/sigls/v3');
    url.search = new URLSearchParams({
      id: descriptor.siglId,
      language: query.language,
      market: query.market,
      platformContext: query.target === 'console' ? 'ConsoleGen8;ConsoleGen9' : 'pc',
      subscriptionContext: subscriptionId,
    }).toString();

    const data = siglResponseSchema.parse(await this.#fetchJson(url));
    const ids = data.flatMap((item) => (item.id === undefined ? [] : [item.id]));
    if (ids.length === 0 && query.allowEmpty !== true) {
      throw new Error(`Collection ${query.collection} returned no product IDs`);
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Collection ${query.collection} returned duplicate product IDs`);
    }

    return {
      ids,
      title: data[0]?.title ?? query.collection,
    };
  }

  async fetchProductEnrichments(query: ProductsQuery): Promise<readonly ProductEnrichment[]> {
    if (query.ids.length === 0) return [];

    const enrichments: ProductEnrichment[] = [];
    for (let index = 0; index < query.ids.length; index += PRODUCT_BATCH_SIZE) {
      const batch = query.ids.slice(index, index + PRODUCT_BATCH_SIZE);
      const url = new URL('https://catalog.gamepass.com/products');
      url.search = new URLSearchParams({
        hydration: 'PCLowAmber0',
        language: query.language,
        market: query.market,
      }).toString();

      const response = gamePassProductResponseSchema.parse(
        await this.#postJson(url, { Products: batch }),
      );
      for (const [productId, product] of Object.entries(response.Products)) {
        const metacritic = product.metacritic;
        const criticScore =
          metacritic?.metascore === undefined || metacritic.metascore <= 0
            ? null
            : metacritic.metascore;
        const userScore =
          metacritic?.userscore === undefined || metacritic.userscore <= 0
            ? null
            : metacritic.userscore;
        const metacriticRating =
          metacritic?.url === undefined || (criticScore === null && userScore === null)
            ? null
            : metacriticRatingSchema.parse({
                criticScore,
                url: metacritic.url,
                userScore,
              });

        const rawPlaytime = product.howLongToBeat;
        const mainMinutes = secondsToMinutes(rawPlaytime?.time.main);
        const mainPlusMinutes = secondsToMinutes(rawPlaytime?.time.mainPlus);
        const completionistMinutes = secondsToMinutes(rawPlaytime?.time.completionist);
        const playtime =
          rawPlaytime?.time.isReliable !== true ||
          (mainMinutes === null && mainPlusMinutes === null && completionistMinutes === null)
            ? null
            : playtimeSchema.parse({
                completionistMinutes,
                id: rawPlaytime.id,
                mainMinutes,
                mainPlusMinutes,
                reliable: true,
              });
        if (metacriticRating === null && playtime === null) continue;

        enrichments.push({ metacritic: metacriticRating, playtime, productId });
      }
    }

    return enrichments;
  }

  async fetchProducts(query: ProductsQuery): Promise<readonly unknown[]> {
    if (query.ids.length === 0) return [];
    await this.#initialize();

    const products: unknown[] = [];
    for (let index = 0; index < query.ids.length; index += PRODUCT_BATCH_SIZE) {
      const batch = query.ids.slice(index, index + PRODUCT_BATCH_SIZE);
      const url = new URL('https://displaycatalog.mp.microsoft.com/v7.0/products');
      url.search = new URLSearchParams({
        'MS-CV': 'DGU1mcuYo0WMMp',
        bigIds: batch.join(','),
        languages: query.language,
        market: query.market,
      }).toString();

      const response = productResponseSchema.parse(await this.#fetchJson(url));
      products.push(...response.Products);
    }

    return products;
  }
}
