import {
  catalogGameSummarySchema,
  clientProductCatalogSchema,
  type CatalogGameSummary,
  type ClientProductCatalog,
  type MarketOverlay,
  type ProductCatalog,
} from './catalog';

const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const createClientProductCatalog = (catalog: ProductCatalog): ClientProductCatalog =>
  clientProductCatalogSchema.parse({
    products: catalog.products
      .map((game) => ({
        canonicalTitle: game.canonicalTitle,
        capabilities: game.capabilities.toSorted((left, right) =>
          compareCodePoints(JSON.stringify(left), JSON.stringify(right)),
        ),
        categories: game.categories.toSorted(compareCodePoints),
        developer: game.developer,
        id: game.id,
        imageUrl: game.imageUrl,
        localized: Object.fromEntries(
          Object.entries(game.localized)
            .toSorted(([left], [right]) => compareCodePoints(left, right))
            .map(([locale, value]) => [locale, { title: value.title }]),
        ),
        metacritic: game.metacritic,
        playtime:
          game.playtime === null
            ? null
            : { id: game.playtime.id, mainMinutes: game.playtime.mainMinutes },
        publisher: game.publisher,
        productGroupId: game.productGroupId,
        releaseDate: game.releaseDate,
        xboxCrossGenSetId: game.xboxCrossGenSetId,
      }))
      .toSorted((left, right) => compareCodePoints(left.id, right.id)),
    schemaVersion: 2,
  });

export const composeClientMarketCatalog = (
  catalog: ClientProductCatalog,
  overlay: MarketOverlay,
): CatalogGameSummary[] => {
  const productsById = new Map(catalog.products.map((product) => [product.id, product]));
  return overlay.games
    .map((availability) => {
      const product = productsById.get(availability.id);
      if (product === undefined) {
        throw new Error(
          `Market ${overlay.market} references missing client product ${availability.id}`,
        );
      }
      return catalogGameSummarySchema.parse({ ...product, ...availability });
    })
    .toSorted((left, right) => left.canonicalTitle.localeCompare(right.canonicalTitle, 'en'));
};
