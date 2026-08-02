import type { CatalogGameSummary, Platform } from './catalog';

export interface CatalogGameGroup {
  readonly id: string;
  readonly platforms: readonly Platform[];
  readonly primary: CatalogGameSummary;
  readonly variants: readonly CatalogGameSummary[];
}

const platformOrder: readonly Platform[] = ['console', 'pc'];

const normalizeIdentity = (value: string): string =>
  value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLocaleLowerCase('en');

const normalizeTitleIdentity = (value: string): string =>
  normalizeIdentity(value.replaceAll(/[©®™]/g, ''));

const collectCompleteIdentityValues = (
  games: readonly CatalogGameSummary[],
  getValue: (game: CatalogGameSummary) => string | null,
): Set<string> | null => {
  const values = games.map(getValue);
  const normalizedValues = values.flatMap((value) =>
    value === null || value.trim().length === 0 ? [] : [normalizeIdentity(value)],
  );
  return normalizedValues.length === values.length ? new Set(normalizedValues) : null;
};

const spansPcAndConsole = (games: readonly CatalogGameSummary[]): boolean => {
  const platforms = new Set(games.flatMap((game) => game.platforms));
  return platforms.has('console') && platforms.has('pc');
};

const hasCompatibleIdentity = (games: readonly CatalogGameSummary[]): boolean => {
  const metacriticUrls = collectCompleteIdentityValues(
    games,
    (game) => game.metacritic?.url ?? null,
  );
  const playtimeIds = collectCompleteIdentityValues(games, (game) => game.playtime?.id ?? null);
  const productGroupIds = collectCompleteIdentityValues(games, (game) => game.productGroupId);

  if (metacriticUrls !== null && metacriticUrls.size > 1) return false;
  if (playtimeIds !== null && playtimeIds.size > 1) return false;
  if (metacriticUrls?.size === 1 || playtimeIds?.size === 1) return true;
  if (productGroupIds?.size === 1) return true;

  const releaseDates = collectCompleteIdentityValues(games, (game) => game.releaseDate);
  if (releaseDates?.size === 1) return true;

  const developers = collectCompleteIdentityValues(games, (game) => game.developer);
  const publishers = collectCompleteIdentityValues(games, (game) => game.publisher);
  return developers?.size === 1 && publishers?.size === 1;
};

const getStrongIdentityKeys = (game: CatalogGameSummary): string[] => [
  ...(game.xboxCrossGenSetId === null
    ? []
    : [`xbox-cross-gen:${normalizeIdentity(game.xboxCrossGenSetId)}`]),
  ...(game.metacritic?.url === undefined
    ? []
    : [`metacritic:${normalizeIdentity(game.metacritic.url)}`]),
  ...(game.playtime?.id === undefined ? [] : [`playtime:${normalizeIdentity(game.playtime.id)}`]),
];

const isAuthoritativeStoreIdentity = (key: string): boolean => key.startsWith('xbox-cross-gen:');

const createDisjointSet = (size: number) => {
  const parents = Array.from({ length: size }, (_, index) => index);
  const find = (index: number): number => {
    const parent = parents[index];
    if (parent === undefined) throw new Error(`Missing disjoint-set entry ${String(index)}`);
    if (parent === index) return index;
    const root = find(parent);
    parents[index] = root;
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  return { find, union };
};

const getPrimaryScore = (game: CatalogGameSummary): number =>
  (game.metacritic === null ? 0 : 16) +
  (game.playtime === null ? 0 : 8) +
  (game.imageUrl === null ? 0 : 4) +
  (game.localized.en === undefined ? 0 : 2) +
  (game.platforms.includes('console') ? 1 : 0);

const createGroup = (variants: readonly CatalogGameSummary[]): CatalogGameGroup => {
  const sortedIds = variants.map(({ id }) => id).toSorted();
  const primary = variants.toSorted(
    (left, right) =>
      getPrimaryScore(right) - getPrimaryScore(left) || left.id.localeCompare(right.id),
  )[0];
  if (primary === undefined) throw new Error('A catalog game group must contain a variant');

  const availablePlatforms = new Set(variants.flatMap((variant) => variant.platforms));
  return {
    id: sortedIds.join(':'),
    platforms: platformOrder.filter((platform) => availablePlatforms.has(platform)),
    primary,
    variants,
  };
};

/**
 * Collapses platform-specific Store products into one user-facing game card.
 * Raw Xbox Product IDs remain separate so each platform keeps its correct Store destination.
 */
export const groupCatalogGames = (games: readonly CatalogGameSummary[]): CatalogGameGroup[] => {
  const disjointSet = createDisjointSet(games.length);
  const getGame = (index: number): CatalogGameSummary => {
    const game = games[index];
    if (game === undefined) throw new Error(`Missing catalog game ${String(index)}`);
    return game;
  };
  const identityCandidates = new Map<string, number[]>();
  const titleCandidates = new Map<string, number[]>();

  games.forEach((game, index) => {
    for (const key of getStrongIdentityKeys(game)) {
      const candidates = identityCandidates.get(key) ?? [];
      candidates.push(index);
      identityCandidates.set(key, candidates);
    }
    const title = normalizeTitleIdentity(game.canonicalTitle);
    const candidates = titleCandidates.get(title) ?? [];
    candidates.push(index);
    titleCandidates.set(title, candidates);
  });

  // Provider identities are the safe bridge for platform/edition labels. XboxCrossGenSetId is
  // authoritative for cross-generation listings; ProductGroupId is only an additional identity
  // check inside an exact-title candidate set and is never used for a global union.
  for (const [identityKey, indexes] of identityCandidates) {
    const variants = indexes.map(getGame);
    if (
      variants.length < 2 ||
      (!isAuthoritativeStoreIdentity(identityKey) && !spansPcAndConsole(variants))
    ) {
      continue;
    }
    const first = indexes[0];
    if (first === undefined) continue;
    for (const index of indexes.slice(1)) disjointSet.union(first, index);
  }

  for (const indexes of titleCandidates.values()) {
    const variants = indexes.map(getGame);
    if (variants.length < 2 || !spansPcAndConsole(variants) || !hasCompatibleIdentity(variants)) {
      continue;
    }
    const first = indexes[0];
    if (first === undefined) continue;
    for (const index of indexes.slice(1)) disjointSet.union(first, index);
  }

  const grouped = new Map<number, CatalogGameSummary[]>();
  games.forEach((game, index) => {
    const root = disjointSet.find(index);
    const variants = grouped.get(root) ?? [];
    variants.push(game);
    grouped.set(root, variants);
  });
  return [...grouped.values()].map((variants) => createGroup(variants));
};
