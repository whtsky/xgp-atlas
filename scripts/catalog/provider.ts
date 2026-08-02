import type { MetacriticRating, Playtime } from '../../src/domain/catalog';

export type CollectionTarget = 'console' | 'pc';

export interface CollectionQuery {
  readonly allowEmpty?: boolean;
  readonly collection: string;
  readonly language: string;
  readonly market: string;
  readonly target: CollectionTarget;
}

export interface CollectionResult {
  readonly ids: readonly string[];
  readonly title: string;
}

export interface ProductsQuery {
  readonly ids: readonly string[];
  readonly language: string;
  readonly market: string;
}

export interface ProductEnrichment {
  readonly metacritic: MetacriticRating | null;
  readonly playtime: Playtime | null;
  readonly productId: string;
}

export interface CatalogProvider {
  readonly configSourceUrl: string | null;
  readonly name: string;
  fetchCollection(query: CollectionQuery): Promise<CollectionResult>;
  fetchProductEnrichments(query: ProductsQuery): Promise<readonly ProductEnrichment[]>;
  fetchProducts(query: ProductsQuery): Promise<readonly unknown[]>;
}
