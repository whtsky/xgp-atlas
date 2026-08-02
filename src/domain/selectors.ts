import type { CatalogGameSummary, CatalogStatus, Platform, SupportedLocale } from './catalog';

export type CatalogSort =
  'playtimeLongest' | 'playtimeShortest' | 'rating' | 'releaseNewest' | 'title';
export type PlaytimeBucket = 'epic' | 'long' | 'medium' | 'short';

export interface CatalogFilters {
  readonly capabilities?: readonly string[];
  readonly categories?: readonly string[];
  readonly plans?: readonly CatalogGameSummary['plans'][number][];
  readonly platforms?: readonly Platform[];
  readonly playtimes?: readonly PlaytimeBucket[];
  readonly query?: string;
  readonly sort?: CatalogSort;
  readonly statuses?: readonly CatalogStatus[];
}

type CatalogIndexEntry = CatalogGameSummary;

export interface ResolvedLocalizedTitle {
  readonly locale: SupportedLocale;
  readonly title: string;
}

export const getLocalizedTitle = (
  game: CatalogIndexEntry,
  locale: SupportedLocale,
): ResolvedLocalizedTitle => ({ locale, title: game.localized[locale].title });

const matchesAny = <T>(values: readonly T[], selected: readonly T[] | undefined): boolean =>
  selected === undefined ||
  selected.length === 0 ||
  selected.some((value) => values.includes(value));

const normalizeSearchValue = (value: string): string =>
  value.normalize('NFKC').replaceAll(/[©®™]/g, '').replaceAll(/\s+/g, ' ').toLocaleLowerCase();

const matchesQuery = (game: CatalogIndexEntry, query: string | undefined): boolean => {
  const normalizedQuery = query === undefined ? undefined : normalizeSearchValue(query.trim());
  if (normalizedQuery === undefined || normalizedQuery.length === 0) return true;

  const titles = [game.canonicalTitle, ...Object.values(game.localized).map(({ title }) => title)];
  return titles.some((title) => normalizeSearchValue(title).includes(normalizedQuery));
};

const getPlaytimeBucket = (minutes: number): PlaytimeBucket => {
  if (minutes < 600) return 'short';
  if (minutes < 1200) return 'medium';
  if (minutes < 3000) return 'long';
  return 'epic';
};

const matchesPlaytime = (
  game: CatalogIndexEntry,
  selected: readonly PlaytimeBucket[] | undefined,
): boolean => {
  if (selected === undefined || selected.length === 0) return true;
  const minutes = game.playtime?.mainMinutes;
  return minutes !== null && minutes !== undefined && selected.includes(getPlaytimeBucket(minutes));
};

const compareTitle = (
  left: CatalogIndexEntry,
  right: CatalogIndexEntry,
  locale: SupportedLocale,
): number =>
  getLocalizedTitle(left, locale).title.localeCompare(
    getLocalizedTitle(right, locale).title,
    locale,
  );

const compareGames = (
  left: CatalogIndexEntry,
  right: CatalogIndexEntry,
  sort: CatalogSort,
  locale: SupportedLocale,
): number => {
  if (sort === 'releaseNewest') {
    const leftTimestamp =
      left.releaseDate === null ? Number.NEGATIVE_INFINITY : Date.parse(left.releaseDate);
    const rightTimestamp =
      right.releaseDate === null ? Number.NEGATIVE_INFINITY : Date.parse(right.releaseDate);
    return rightTimestamp - leftTimestamp || compareTitle(left, right, locale);
  }
  if (sort === 'rating') {
    const leftRating = left.metacritic?.criticScore ?? Number.NEGATIVE_INFINITY;
    const rightRating = right.metacritic?.criticScore ?? Number.NEGATIVE_INFINITY;
    const leftUserRating = left.metacritic?.userScore ?? Number.NEGATIVE_INFINITY;
    const rightUserRating = right.metacritic?.userScore ?? Number.NEGATIVE_INFINITY;
    return (
      rightRating - leftRating ||
      rightUserRating - leftUserRating ||
      compareTitle(left, right, locale)
    );
  }
  if (sort === 'playtimeShortest' || sort === 'playtimeLongest') {
    const leftMinutes = left.playtime?.mainMinutes;
    const rightMinutes = right.playtime?.mainMinutes;
    const leftValue =
      leftMinutes ??
      (sort === 'playtimeShortest' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const rightValue =
      rightMinutes ??
      (sort === 'playtimeShortest' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    return (
      (sort === 'playtimeShortest' ? leftValue - rightValue : rightValue - leftValue) ||
      compareTitle(left, right, locale)
    );
  }
  return compareTitle(left, right, locale);
};

export const filterCatalog = <T extends CatalogIndexEntry>(
  games: readonly T[],
  filters: CatalogFilters,
  locale: SupportedLocale,
): T[] => {
  const selectedCapabilities = filters.capabilities;

  return games
    .filter(
      (game) =>
        matchesQuery(game, filters.query) &&
        matchesAny(game.plans, filters.plans) &&
        matchesAny(game.platforms, filters.platforms) &&
        matchesPlaytime(game, filters.playtimes) &&
        matchesAny(game.statuses, filters.statuses) &&
        matchesAny(game.categories, filters.categories) &&
        matchesAny(
          game.capabilities.map(({ name }) => name),
          selectedCapabilities,
        ),
    )
    .toSorted((left, right) => compareGames(left, right, filters.sort ?? 'title', locale));
};
