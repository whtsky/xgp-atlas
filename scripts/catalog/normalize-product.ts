import { z } from 'zod';

import { gameSchema, type Game, type SupportedLocale } from '../../src/domain/catalog';

const attributeSchema = z.object({
  Maximum: z.number().nullable().optional(),
  Minimum: z.number().nullable().optional(),
  Name: z.string(),
});

const localizedPropertiesSchema = z.object({
  DeveloperName: z.string().optional().default(''),
  Images: z
    .array(
      z.object({
        ImagePurpose: z.string().nullable().optional(),
        Uri: z.string(),
      }),
    )
    .optional()
    .default([]),
  ProductDescription: z.string().optional().default(''),
  ProductTitle: z.string().min(1),
  PublisherName: z.string().optional().default(''),
});

const marketPropertiesSchema = z.object({
  OriginalReleaseDate: z.iso.datetime().nullable().optional(),
  UsageData: z
    .array(
      z.object({
        AggregateTimeSpan: z.string(),
        AverageRating: z.number(),
        RatingCount: z.number(),
      }),
    )
    .optional()
    .default([]),
});

const productSchema = z.object({
  LocalizedProperties: z.array(localizedPropertiesSchema).min(1),
  MarketProperties: z.array(marketPropertiesSchema).optional().default([]),
  ProductId: z.string().min(1),
  Properties: z.object({
    Attributes: z
      .array(attributeSchema)
      .nullish()
      .transform((value) => value ?? []),
    Categories: z
      .array(z.string())
      .nullish()
      .transform((value) => value ?? []),
    ProductGroupId: z.string().min(1).nullish(),
    XboxCrossGenSetId: z.string().min(1).nullish(),
  }),
});

type Product = z.infer<typeof productSchema>;

interface LocalizedProductInput {
  readonly locale: SupportedLocale;
  readonly product: unknown;
}

const normalizeImageUrl = (uri: string | undefined): string | null => {
  if (uri === undefined) return null;
  return uri.startsWith('//') ? `https:${uri}` : uri;
};

const getImageUrl = (product: Product): string | null => {
  const images = product.LocalizedProperties[0]?.Images ?? [];
  const preferred = ['Poster', 'BoxArt', 'Tile', 'Logo']
    .map((purpose) => images.find((image) => image.ImagePurpose === purpose))
    .find((image) => image !== undefined);

  return normalizeImageUrl((preferred ?? images[0])?.Uri);
};

const getStoreRating = (product: Product): Game['storeRating'] => {
  const usage = product.MarketProperties.flatMap((market) => market.UsageData).find(
    (entry) => entry.AggregateTimeSpan === 'AllTime',
  );

  return usage === undefined || usage.RatingCount <= 0
    ? null
    : { average: usage.AverageRating, count: usage.RatingCount };
};

export const mergeLocalizedProducts = (inputs: readonly LocalizedProductInput[]): Game => {
  if (inputs.length === 0) throw new Error('At least one localized product is required');

  const parsed = inputs.map(({ locale, product }) => ({
    locale,
    product: productSchema.parse(product),
  }));
  const base = parsed[0]?.product;
  if (base === undefined) throw new Error('At least one localized product is required');

  if (parsed.some(({ product }) => product.ProductId !== base.ProductId)) {
    throw new Error('Localized products do not share a product ID');
  }

  const localized = Object.fromEntries(
    parsed.map(({ locale, product }) => {
      const properties = product.LocalizedProperties[0];
      if (properties === undefined)
        throw new Error(`Product ${product.ProductId} has no localization`);

      return [
        locale,
        {
          description: properties.ProductDescription,
          title: properties.ProductTitle,
        },
      ];
    }),
  );
  const english = parsed.find(({ locale }) => locale === 'en')?.product.LocalizedProperties[0];
  const first = base.LocalizedProperties[0];
  if (first === undefined) throw new Error(`Product ${base.ProductId} has no localization`);

  return gameSchema.parse({
    canonicalTitle: english?.ProductTitle ?? first.ProductTitle,
    capabilities: base.Properties.Attributes.map((attribute) => ({
      maximum: attribute.Maximum ?? null,
      minimum: attribute.Minimum ?? null,
      name: attribute.Name,
    })),
    categories: base.Properties.Categories,
    developer: english?.DeveloperName ?? first.DeveloperName,
    id: base.ProductId,
    imageUrl: getImageUrl(base),
    localized,
    metacritic: null,
    playtime: null,
    publisher: english?.PublisherName ?? first.PublisherName,
    productGroupId: base.Properties.ProductGroupId ?? null,
    releaseDate: base.MarketProperties[0]?.OriginalReleaseDate ?? null,
    storeRating: getStoreRating(base),
    xboxCrossGenSetId: base.Properties.XboxCrossGenSetId ?? null,
  });
};
