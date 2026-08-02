import { z } from 'zod';

const trustedHttpsUrl = (hosts: readonly string[]) =>
  z.url().refine(
    (value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && hosts.includes(url.hostname);
    },
    { message: `URL must use HTTPS and one of these hosts: ${hosts.join(', ')}` },
  );

export const xboxProductIdSchema = z.string().regex(/^[A-Z0-9]{12}$/);

export const supportedLocaleSchema = z.enum(['en', 'de', 'ja', 'zh-Hans', 'zh-Hant']);
export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;

export const marketCodeSchema = z.enum(['US', 'GB', 'CA', 'AU', 'DE', 'JP', 'HK', 'TW']);
export type MarketCode = z.infer<typeof marketCodeSchema>;

export const platformSchema = z.enum(['console', 'pc']);
export type Platform = z.infer<typeof platformSchema>;

const localizedGameSchema = z.object({
  description: z.string(),
  title: z.string().min(1),
});
const localizedGameRecordSchema = z.record(supportedLocaleSchema, localizedGameSchema);

export const capabilitySchema = z.object({
  maximum: z.number().nullable(),
  minimum: z.number().nullable(),
  name: z.string().min(1),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const storeRatingSchema = z.object({
  average: z.number().min(0).max(5),
  count: z.number().int().positive(),
});
export type StoreRating = z.infer<typeof storeRatingSchema>;

export const metacriticRatingSchema = z
  .object({
    criticScore: z.number().min(0).max(100).nullable(),
    url: trustedHttpsUrl(['www.metacritic.com']),
    userScore: z.number().min(0).max(10).nullable(),
  })
  .refine((rating) => rating.criticScore !== null || rating.userScore !== null, {
    message: 'A Metacritic rating must include a critic or user score',
  });
export type MetacriticRating = z.infer<typeof metacriticRatingSchema>;

export const playtimeSchema = z
  .object({
    completionistMinutes: z.number().int().positive().nullable(),
    id: z.string().min(1),
    mainMinutes: z.number().int().positive().nullable(),
    mainPlusMinutes: z.number().int().positive().nullable(),
    reliable: z.literal(true),
  })
  .refine(
    (playtime) =>
      playtime.mainMinutes !== null ||
      playtime.mainPlusMinutes !== null ||
      playtime.completionistMinutes !== null,
    { message: 'Playtime must include at least one duration' },
  );
export type Playtime = z.infer<typeof playtimeSchema>;

/** Product metadata shared across every Xbox market. */
export const gameSchema = z.object({
  canonicalTitle: z.string().min(1),
  capabilities: z.array(capabilitySchema),
  categories: z.array(z.string()),
  developer: z.string(),
  id: xboxProductIdSchema,
  imageUrl: trustedHttpsUrl(['store-images.s-microsoft.com']).nullable(),
  localized: localizedGameRecordSchema,
  metacritic: metacriticRatingSchema.nullable().default(null),
  playtime: playtimeSchema.nullable().default(null),
  publisher: z.string(),
  productGroupId: z.string().min(1).nullable().default(null),
  releaseDate: z.iso.datetime().nullable(),
  storeRating: storeRatingSchema.nullable(),
  xboxCrossGenSetId: z.string().min(1).nullable().default(null),
});
export type Game = z.infer<typeof gameSchema>;

export const catalogStatusSchema = z.enum([
  'available',
  'comingSoon',
  'leavingSoon',
  'recentlyAdded',
]);
export type CatalogStatus = z.infer<typeof catalogStatusSchema>;

export const planSchema = z.enum(['ultimate', 'premium', 'essential', 'pc']);
export type Plan = z.infer<typeof planSchema>;

/** Compact availability row that is specific to one Xbox market. */
export const marketGameSchema = z.object({
  id: xboxProductIdSchema,
  plans: z.array(planSchema),
  platforms: z.array(platformSchema),
  statuses: z.array(catalogStatusSchema),
});
export type MarketGame = z.infer<typeof marketGameSchema>;

export const marketOverlaySchema = z
  .object({
    games: z.array(marketGameSchema),
    market: marketCodeSchema,
    schemaVersion: z.literal(2),
    source: z.object({
      provider: z.string().min(1),
      providerConfigUrl: trustedHttpsUrl(['www.xbox.com', 'assets.xboxservices.com']),
    }),
  })
  .refine((overlay) => new Set(overlay.games.map(({ id }) => id)).size === overlay.games.length, {
    message: 'Market overlay contains duplicate product IDs',
  });
export type MarketOverlay = z.infer<typeof marketOverlaySchema>;

export const productCatalogSchema = z
  .object({
    products: z.array(gameSchema),
    schemaVersion: z.literal(2),
  })
  .refine(
    (catalog) => new Set(catalog.products.map(({ id }) => id)).size === catalog.products.length,
    { message: 'Product catalog contains duplicate product IDs' },
  );
export type ProductCatalog = z.infer<typeof productCatalogSchema>;

export const clientProductSchema = gameSchema.omit({ localized: true, storeRating: true }).extend({
  localized: z.record(supportedLocaleSchema, z.object({ title: z.string().min(1) })),
  playtime: z
    .object({
      id: z.string().min(1),
      mainMinutes: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export type ClientProduct = z.infer<typeof clientProductSchema>;

export const clientProductCatalogSchema = z
  .object({
    products: z.array(clientProductSchema),
    schemaVersion: z.literal(2),
  })
  .refine(
    (catalog) => new Set(catalog.products.map(({ id }) => id)).size === catalog.products.length,
    { message: 'Client product catalog contains duplicate product IDs' },
  );
export type ClientProductCatalog = z.infer<typeof clientProductCatalogSchema>;

const clientProductPathSchema = z.string().regex(/^\/p\.[a-f0-9]{64}\.json$/);
const marketOverlayPathSchema = z.string().regex(/^\/[a-z]{2}\.[a-f0-9]{64}\.json$/);

export const marketManifestEntrySchema = z.object({
  code: marketCodeSchema,
  label: z.string().min(1),
  overlayPath: marketOverlayPathSchema,
  productCount: z.number().int().positive(),
  storeLocale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
});
export type MarketManifestEntry = z.infer<typeof marketManifestEntrySchema>;

export const catalogManifestSchema = z
  .object({
    clientProductsPath: clientProductPathSchema,
    defaultMarket: marketCodeSchema,
    generatedAt: z.iso.datetime(),
    locales: z.array(supportedLocaleSchema).min(1),
    markets: z.array(marketManifestEntrySchema).min(1),
    productCount: z.number().int().positive(),
    provider: z.string().min(1),
    schemaVersion: z.literal(2),
  })
  .refine((manifest) => manifest.markets.some(({ code }) => code === manifest.defaultMarket), {
    message: 'Default market is absent from the manifest',
  })
  .refine(
    (manifest) =>
      new Set(manifest.markets.map(({ code }) => code)).size === manifest.markets.length,
    { message: 'Manifest contains duplicate markets' },
  )
  .refine(
    (manifest) =>
      manifest.markets.every(({ code, overlayPath }) =>
        new RegExp(`^/${code.toLowerCase()}\\.[a-f0-9]{64}\\.json$`).test(overlayPath),
      ),
    { message: 'Manifest artifact paths do not match their market' },
  );
export type CatalogManifest = z.infer<typeof catalogManifestSchema>;

export const catalogGameSummarySchema = clientProductSchema.extend({
  plans: z.array(planSchema),
  platforms: z.array(platformSchema),
  statuses: z.array(catalogStatusSchema),
});
export type CatalogGameSummary = z.infer<typeof catalogGameSummarySchema>;
