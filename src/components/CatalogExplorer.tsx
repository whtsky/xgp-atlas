import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowUpRightIcon,
  CaretDownIcon,
  ClockIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  memo,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  clientProductCatalogSchema,
  marketOverlaySchema,
  marketCodeSchema,
  type CatalogGameSummary,
  type CatalogManifest,
  type CatalogStatus,
  type MarketCode,
  type Platform,
  type SupportedLocale,
} from '../domain/catalog';
import { groupCatalogGames, type CatalogGameGroup } from '../domain/catalog-groups';
import { composeClientMarketCatalog } from '../domain/catalog-summary';
import { getXboxStoreUrl } from '../domain/markets';
import {
  filterCatalog,
  getLocalizedTitle,
  type CatalogSort,
  type PlaytimeBucket,
} from '../domain/selectors';
import {
  categoryTranslationKeys,
  getCapabilityLabel,
  getCategoryLabel,
} from '../i18n/domain-labels';
import { catalogPath, getTranslations, type TranslationKey } from '../i18n';
import { SelectControl, type SelectOption } from './ui/SelectControl';

interface CatalogExplorerProps {
  readonly initialGames: readonly CatalogGameSummary[];
  readonly initialMarket: MarketCode;
  readonly locale: SupportedLocale;
  readonly manifest: CatalogManifest;
}

type Plan = CatalogGameSummary['plans'][number];
type LoadState = 'error' | 'loaded' | 'loading';

const PAGE_SIZE = 12;
const CARD_IMAGE_WIDTH = 192;
const CARD_IMAGE_HEIGHT = 256;
const CARD_IMAGE_WIDTHS = [192, 384, 576] as const;
const marketTranslationKeys = {
  AU: 'market.AU',
  CA: 'market.CA',
  DE: 'market.DE',
  GB: 'market.GB',
  HK: 'market.HK',
  JP: 'market.JP',
  TW: 'market.TW',
  US: 'market.US',
} as const satisfies Readonly<Record<MarketCode, TranslationKey>>;
const plans: readonly Plan[] = ['ultimate', 'premium', 'essential', 'pc'];
const platforms: readonly Platform[] = ['console', 'pc'];
const playtimes: readonly PlaytimeBucket[] = ['short', 'medium', 'long', 'epic'];
const sorts: readonly CatalogSort[] = [
  'title',
  'releaseNewest',
  'rating',
  'playtimeShortest',
  'playtimeLongest',
];
const statuses: readonly Exclude<CatalogStatus, 'available'>[] = [
  'recentlyAdded',
  'comingSoon',
  'leavingSoon',
];
const capabilities = [
  'SinglePlayer',
  'XblOnlineCoop',
  'XblLocalCoop',
  'Capability4k',
  'CapabilityHDR',
  '60fps',
  'XPA',
  'ConsoleGen9Optimized',
] as const;
const catalogStateKeys = [
  'q',
  'platform',
  'plan',
  'playtime',
  'status',
  'category',
  'capability',
  'sort',
] as const;

const toggleValue = <T extends string>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

const getAllowedValue = <T extends string>(
  options: readonly T[],
  value: string | null,
): T | undefined => options.find((option) => option === value);

const getAllowedValues = <T extends string>(
  options: readonly T[],
  params: URLSearchParams,
  key: string,
): T[] => [
  ...new Set(
    params.getAll(key).flatMap((value) => {
      const match = getAllowedValue(options, value);
      return match === undefined ? [] : [match];
    }),
  ),
];

const formatDate = (value: string, locale: SupportedLocale): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value));

const formatHours = (minutes: number, locale: SupportedLocale): string => {
  const hours = minutes / 60;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: hours < 10 ? 1 : 0 }).format(hours);
};

const getCardImageUrl = (imageUrl: string, width: number, height: number): string => {
  const url = new URL(imageUrl);
  url.searchParams.set('w', String(width));
  url.searchParams.set('h', String(height));
  url.searchParams.set('mode', 'crop');
  return url.toString();
};

const getCardImageSrcSet = (imageUrl: string): string =>
  CARD_IMAGE_WIDTHS.map((width) => {
    const height = Math.round((width * CARD_IMAGE_HEIGHT) / CARD_IMAGE_WIDTH);
    return `${getCardImageUrl(imageUrl, width, height)} ${width}w`;
  }).join(', ');

const getMetascoreStyle = (score: number): string => {
  if (score >= 75) return 'border-emerald-400/30 bg-emerald-500/90 text-zinc-950';
  if (score >= 50) return 'border-amber-300/30 bg-amber-400/90 text-zinc-950';
  return 'border-red-300/30 bg-red-500/90 text-white';
};

interface FilterGroupProps<T extends string> {
  readonly label: string;
  readonly onToggle: (value: T) => void;
  readonly options: readonly T[];
  readonly selected: readonly T[];
  readonly toLabel: (value: T) => string;
}

const FilterGroup = <T extends string>({
  label,
  onToggle,
  options,
  selected,
  toLabel,
}: FilterGroupProps<T>) => (
  <details className="group border-t border-zinc-200 first:border-t-0 dark:border-white/8">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 outline-none [&::-webkit-details-marker]:hidden dark:text-zinc-400">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{label}</span>
        {selected.length > 0 && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] tracking-normal text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300">
            {selected.length}
          </span>
        )}
      </span>
      <CaretDownIcon
        aria-hidden="true"
        className="shrink-0 transition-transform group-open:rotate-180"
        size={14}
      />
    </summary>
    <fieldset className="pb-4">
      <legend className="sr-only">{label}</legend>
      <div className="grid gap-2">
        {options.map((option) => (
          <label
            className="group/option flex cursor-pointer items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-300"
            key={option}
          >
            <input
              checked={selected.includes(option)}
              className="peer sr-only"
              onChange={() => {
                onToggle(option);
              }}
              type="checkbox"
            />
            <span className="grid size-4 place-items-center rounded-[4px] border border-zinc-400 bg-white transition-colors peer-checked:border-emerald-500 peer-checked:bg-emerald-500 dark:border-zinc-600 dark:bg-zinc-900">
              <span className="size-1.5 scale-0 rounded-[2px] bg-white transition-transform peer-checked:scale-100 dark:bg-zinc-950" />
            </span>
            <span className="transition-colors group-hover/option:text-zinc-950 dark:group-hover/option:text-white">
              {toLabel(option)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  </details>
);

interface GameCardProps {
  readonly group: CatalogGameGroup;
  readonly locale: SupportedLocale;
  readonly storeLocale: string;
}

const getVariantScore = (game: CatalogGameSummary): number =>
  (game.metacritic === null ? 0 : 4) +
  (game.playtime === null ? 0 : 2) +
  (game.imageUrl === null ? 0 : 1);

const GameCard = memo(({ group, locale, storeLocale }: GameCardProps) => {
  const t = getTranslations(locale);
  const game = group.primary;
  const localized = getLocalizedTitle(game, locale);
  const href = getXboxStoreUrl(game.id, storeLocale);
  const prominentStatus = group.variants
    .flatMap(({ statuses: variantStatuses }) => variantStatuses)
    .find((status) => status !== 'available');
  const releaseYears = group.variants.flatMap(({ releaseDate }) => {
    if (releaseDate === null) return [];
    const year = new Date(releaseDate).getUTCFullYear();
    return year > 1900 && year < 2100 ? [year] : [];
  });
  const year = releaseYears.length === 0 ? null : Math.min(...releaseYears);
  const storeTargetsByProduct = new Map<
    string,
    { platforms: Platform[]; variant: CatalogGameSummary }
  >();
  for (const variant of group.variants.toSorted(
    (left, right) =>
      getVariantScore(right) - getVariantScore(left) || left.id.localeCompare(right.id),
  )) {
    const target = storeTargetsByProduct.get(variant.id) ?? { platforms: [], variant };
    for (const platform of variant.platforms) {
      if (!target.platforms.includes(platform)) target.platforms.push(platform);
    }
    storeTargetsByProduct.set(variant.id, target);
  }
  const storeTargets = [...storeTargetsByProduct.values()].map(
    ({ platforms: targetPlatforms, variant }) => ({
      platforms: targetPlatforms,
      productId: variant.id,
      variant,
    }),
  );

  return (
    <article className="catalog-card group min-w-0">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 shadow-sm dark:border-white/8 dark:bg-zinc-900 dark:shadow-none">
        {game.imageUrl === null ? (
          <div className="grid size-full place-items-center px-5 text-center text-sm text-zinc-500">
            {localized.title}
          </div>
        ) : (
          <img
            alt=""
            className="size-full object-cover transition duration-500 ease-out group-hover:scale-[1.025] group-hover:opacity-90"
            decoding="async"
            height={CARD_IMAGE_HEIGHT}
            referrerPolicy="no-referrer"
            src={getCardImageUrl(game.imageUrl, CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT)}
            srcSet={getCardImageSrcSet(game.imageUrl)}
            sizes="(min-width: 1536px) calc((min(1500px, 100vw) - 358px) / 6), (min-width: 1280px) calc((min(1500px, 100vw) - 346px) / 5), (min-width: 1024px) calc((min(1500px, 100vw) - 334px) / 4), (min-width: 768px) calc((min(1500px, 100vw) - 84px) / 4), (min-width: 640px) calc((min(1500px, 100vw) - 80px) / 3), calc((min(1500px, 100vw) - 44px) / 2)"
            width={CARD_IMAGE_WIDTH}
          />
        )}
        <a
          aria-label={`${localized.title} — ${t['catalog.openXboxStore']}`}
          className="absolute inset-0 z-10 rounded-xl"
          href={href}
          rel="noreferrer"
          target="_blank"
        >
          <span className="sr-only">{t['catalog.openXboxStore']}</span>
        </a>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-zinc-950/90 to-transparent" />
        {prominentStatus !== undefined && (
          <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 rounded-md border border-white/12 bg-zinc-950/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur">
            {t[`status.${prominentStatus}`]}
          </span>
        )}
        {game.metacritic !== null && game.metacritic.criticScore !== null && (
          <a
            aria-label={`${localized.title} — ${t['game.metacriticCritic']}: ${game.metacritic.criticScore.toFixed(0)}`}
            className={`absolute bottom-2.5 right-2.5 z-30 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[14px] font-bold leading-none shadow-lg backdrop-blur transition hover:brightness-110 ${getMetascoreStyle(game.metacritic.criticScore)}`}
            href={game.metacritic.url}
            rel="noreferrer"
            target="_blank"
            title={`${t['game.metacriticCritic']}: ${game.metacritic.criticScore.toFixed(0)}`}
          >
            <span aria-hidden="true" className="text-[10px] uppercase opacity-75">
              MC
            </span>
            <span>{game.metacritic.criticScore.toFixed(0)}</span>
            <ArrowUpRightIcon aria-hidden="true" size={11} weight="bold" />
          </a>
        )}
      </div>
      <div className="pt-3">
        <h2 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.02em] text-zinc-900 dark:text-zinc-100">
          <a
            className="inline-flex max-w-full items-center gap-1 transition-colors hover:text-emerald-700 dark:hover:text-emerald-300"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            <span className="truncate">{localized.title}</span>
            <ArrowUpRightIcon
              aria-hidden="true"
              className="shrink-0 text-zinc-400 dark:text-zinc-600"
              size={12}
            />
          </a>
        </h2>
        {localized.title !== game.canonicalTitle && (
          <p className="mt-1 truncate text-xs text-zinc-500">{game.canonicalTitle}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">
          {year !== null && <span>{year}</span>}
          {year !== null && storeTargets.length > 0 && (
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
          )}
          {storeTargets.map(({ platforms: targetPlatforms, productId, variant }, index) => {
            const platformLabel = targetPlatforms
              .map((platform) => t[`platform.${platform}`])
              .join(' + ');
            const targetLocalized = getLocalizedTitle(variant, locale);
            return (
              <span className="inline-flex items-center gap-2" key={productId}>
                {index > 0 && <span className="text-zinc-300 dark:text-zinc-700">+</span>}
                <a
                  aria-label={`${targetLocalized.title} — ${platformLabel} — ${t['catalog.openXboxStore']}`}
                  className="inline-flex items-center gap-0.5 transition-colors hover:text-emerald-700 dark:hover:text-emerald-300"
                  href={getXboxStoreUrl(productId, storeLocale)}
                  rel="noreferrer"
                  target="_blank"
                  title={targetLocalized.title}
                >
                  {platformLabel}
                  <ArrowUpRightIcon aria-hidden="true" size={10} />
                </a>
              </span>
            );
          })}
          {game.playtime !== null && game.playtime.mainMinutes !== null && (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className="inline-flex items-center gap-1" title={t['game.mainTime']}>
                <ClockIcon aria-hidden="true" size={12} />
                {formatHours(game.playtime.mainMinutes, locale)} {t['game.hours']}
              </span>
            </>
          )}
        </div>
      </div>
    </article>
  );
});

export const CatalogExplorer = ({
  initialGames,
  initialMarket,
  locale,
  manifest,
}: CatalogExplorerProps) => {
  const t = getTranslations(locale);
  const [games, setGames] = useState<CatalogGameSummary[]>([...initialGames]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const activeMarket = initialMarket;
  const [query, setQuery] = useState('');
  const [selectedPlans, setSelectedPlans] = useState<Plan[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [selectedPlaytimes, setSelectedPlaytimes] = useState<PlaytimeBucket[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<CatalogStatus[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [sort, setSort] = useState<CatalogSort>('title');
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const scrollToResults = useCallback(() => {
    window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ block: 'start' });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadInitialCatalog = async () => {
      setLoadState('loading');
      const entry = manifest.markets.find(({ code }) => code === initialMarket);
      if (entry === undefined) {
        setLoadState('error');
        return;
      }

      try {
        const [products, overlay] = await Promise.all([
          fetch(manifest.clientProductsPath).then(async (response) => {
            if (!response.ok)
              throw new Error(`Product catalog request failed: ${String(response.status)}`);
            return clientProductCatalogSchema.parse(await response.json());
          }),
          fetch(entry.overlayPath).then(async (response) => {
            if (!response.ok)
              throw new Error(`Market overlay request failed: ${String(response.status)}`);
            return marketOverlaySchema.parse(await response.json());
          }),
        ]);
        if (products.products.length !== manifest.productCount) {
          throw new Error(
            `Product catalog count mismatch: expected ${String(manifest.productCount)}, got ${String(products.products.length)}`,
          );
        }
        if (overlay.market !== initialMarket || overlay.games.length !== entry.productCount) {
          throw new Error(`Market overlay does not match manifest entry ${initialMarket}`);
        }
        if (cancelled) return;
        setGames(composeClientMarketCatalog(products, overlay));
        setLoadState('loaded');
      } catch (error) {
        if (cancelled) return;
        console.error('Unable to load catalog', error);
        setLoadState('error');
      }
    };

    void loadInitialCatalog();
    return () => {
      cancelled = true;
    };
  }, [initialMarket, manifest.clientProductsPath, manifest.markets, manifest.productCount]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const platformParam = params.get('platform');
    const parsedPlatform =
      platformParam === 'xbox' || platformParam === 'console'
        ? 'console'
        : getAllowedValue(platforms, platformParam);
    const parsedSort = getAllowedValue(sorts, params.get('sort'));

    setQuery((params.get('q') ?? '').slice(0, 200));
    setSelectedPlatform(parsedPlatform ?? null);
    setSelectedPlans(getAllowedValues(plans, params, 'plan'));
    setSelectedPlaytimes(getAllowedValues(playtimes, params, 'playtime'));
    setSelectedStatuses(getAllowedValues(statuses, params, 'status'));
    setSelectedCategories([
      ...new Set(
        params
          .getAll('category')
          .filter((category) => Object.hasOwn(categoryTranslationKeys, category)),
      ),
    ]);
    setSelectedCapabilities(getAllowedValues(capabilities, params, 'capability'));
    setSort(parsedSort ?? 'title');
    setUrlStateReady(true);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;

    const url = new URL(window.location.href);
    for (const key of catalogStateKeys) url.searchParams.delete(key);

    const normalizedQuery = query.trim();
    if (normalizedQuery.length > 0) url.searchParams.set('q', normalizedQuery);
    if (selectedPlatform !== null) {
      url.searchParams.set('platform', selectedPlatform === 'console' ? 'xbox' : 'pc');
    }
    for (const plan of selectedPlans.toSorted()) url.searchParams.append('plan', plan);
    for (const playtime of selectedPlaytimes.toSorted()) {
      url.searchParams.append('playtime', playtime);
    }
    for (const status of selectedStatuses.toSorted()) url.searchParams.append('status', status);
    for (const category of selectedCategories.toSorted()) {
      url.searchParams.append('category', category);
    }
    for (const capability of selectedCapabilities.toSorted()) {
      url.searchParams.append('capability', capability);
    }
    if (sort !== 'title') url.searchParams.set('sort', sort);

    window.history.replaceState({}, '', url);
    window.dispatchEvent(
      new CustomEvent<string>('xgp:catalog-state-change', { detail: url.search }),
    );
  }, [
    query,
    selectedCapabilities,
    selectedCategories,
    selectedPlans,
    selectedPlatform,
    selectedPlaytimes,
    selectedStatuses,
    sort,
    urlStateReady,
  ]);

  const activeMarketEntry = manifest.markets.find(({ code }) => code === activeMarket);
  if (activeMarketEntry === undefined) {
    throw new Error(`Manifest does not contain the active market ${activeMarket}`);
  }

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of games) {
      for (const category of game.categories) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([category]) => category in categoryTranslationKeys)
      .toSorted((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([category]) => category);
  }, [games]);

  const capabilityOptions = useMemo(
    () =>
      capabilities.filter((capability) =>
        games.some((game) => game.capabilities.some(({ name }) => name === capability)),
      ),
    [games],
  );

  const matchingGames = useMemo(
    () =>
      filterCatalog(
        games,
        {
          capabilities: selectedCapabilities,
          categories: selectedCategories,
          plans: selectedPlans,
          platforms: selectedPlatform === null ? [] : [selectedPlatform],
          playtimes: selectedPlaytimes,
          query,
          sort,
          statuses: selectedStatuses,
        },
        locale,
      ),
    [
      games,
      locale,
      query,
      selectedCapabilities,
      selectedCategories,
      selectedPlans,
      selectedPlatform,
      selectedPlaytimes,
      selectedStatuses,
      sort,
    ],
  );
  const allGameGroups = useMemo(() => groupCatalogGames(games), [games]);
  const groupedGames = useMemo(() => {
    const groupByVariantId = new Map<string, CatalogGameGroup>();
    for (const group of allGameGroups) {
      for (const variant of group.variants) groupByVariantId.set(variant.id, group);
    }

    const seenGroups = new Set<string>();
    return matchingGames.flatMap((game) => {
      const group = groupByVariantId.get(game.id);
      if (group === undefined || seenGroups.has(group.id)) return [];
      seenGroups.add(group.id);
      return [group];
    });
  }, [allGameGroups, matchingGames]);
  const hasMoreGames = visibleCount < groupedGames.length;

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [groupedGames]);

  useEffect(() => {
    if (!hasMoreGames) return undefined;
    const sentinel = loadMoreRef.current;
    if (sentinel === null) return undefined;

    if (typeof window.IntersectionObserver === 'undefined') {
      setVisibleCount(groupedGames.length);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting !== true) return;
        setVisibleCount((count) => Math.min(count + PAGE_SIZE, groupedGames.length));
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [groupedGames.length, hasMoreGames, visibleCount]);

  const updateFilter = <T extends string>(setter: Dispatch<SetStateAction<T[]>>, value: T) => {
    setter((current) => toggleValue(current, value));
    if (window.matchMedia('(min-width: 1024px)').matches) scrollToResults();
  };

  const clearFilters = () => {
    setQuery('');
    setSelectedPlans([]);
    setSelectedPlatform(null);
    setSelectedPlaytimes([]);
    setSelectedStatuses([]);
    setSelectedCategories([]);
    setSelectedCapabilities([]);
    setSort('title');
    scrollToResults();
  };

  const activeFilterCount =
    selectedPlans.length +
    (selectedPlatform === null ? 0 : 1) +
    selectedPlaytimes.length +
    selectedStatuses.length +
    selectedCategories.length +
    selectedCapabilities.length;

  const marketOptions: readonly SelectOption<MarketCode>[] = manifest.markets.map((market) => ({
    label: t[marketTranslationKeys[market.code]],
    value: market.code,
  }));
  const sortOptions: readonly SelectOption<CatalogSort>[] = [
    { label: t['catalog.sortTitle'], value: 'title' },
    { label: t['catalog.sortNewest'], value: 'releaseNewest' },
    { label: t['catalog.sortRating'], value: 'rating' },
    { label: t['catalog.sortShortest'], value: 'playtimeShortest' },
    { label: t['catalog.sortLongest'], value: 'playtimeLongest' },
  ];
  const platformChoices: readonly {
    readonly label: string;
    readonly value: Platform | null;
  }[] = [
    { label: t['catalog.platformAll'], value: null },
    { label: t['catalog.platformXbox'], value: 'console' },
    { label: t['catalog.platformPc'], value: 'pc' },
  ];

  const renderFilterGroups = () => (
    <>
      <FilterGroup
        label={t['catalog.plan']}
        onToggle={(value) => {
          updateFilter(setSelectedPlans, value);
        }}
        options={plans}
        selected={selectedPlans}
        toLabel={(value) => t[`plan.${value}`]}
      />
      <FilterGroup
        label={t['catalog.playtime']}
        onToggle={(value) => {
          updateFilter(setSelectedPlaytimes, value);
        }}
        options={playtimes}
        selected={selectedPlaytimes}
        toLabel={(value) => t[`playtime.${value}`]}
      />
      <FilterGroup
        label={t['catalog.status']}
        onToggle={(value) => {
          updateFilter(setSelectedStatuses, value);
        }}
        options={statuses}
        selected={selectedStatuses}
        toLabel={(value) => t[`status.${value}`]}
      />
      <FilterGroup
        label={t['catalog.category']}
        onToggle={(value) => {
          updateFilter(setSelectedCategories, value);
        }}
        options={categoryOptions}
        selected={selectedCategories}
        toLabel={(value) => getCategoryLabel(value, t)}
      />
      <FilterGroup
        label={t['catalog.capabilities']}
        onToggle={(value) => {
          updateFilter(setSelectedCapabilities, value);
        }}
        options={capabilityOptions}
        selected={selectedCapabilities}
        toLabel={(value) => getCapabilityLabel(value, t)}
      />
    </>
  );

  return (
    <section
      aria-busy={loadState === 'loading'}
      className="mx-auto max-w-[1500px] px-4 pb-24 pt-3 sm:px-6 lg:px-8"
    >
      <div className="z-30 -mx-4 border-y border-zinc-200 bg-white/92 px-4 py-2 shadow-sm backdrop-blur-xl sm:-mx-6 sm:px-6 lg:sticky lg:top-0 lg:mx-0 lg:rounded-xl lg:border lg:px-3 dark:border-white/8 dark:bg-[#151a18]/92 dark:shadow-none">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1fr)_180px_160px_200px]">
          <div className="col-span-2 flex gap-2 lg:col-span-1">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">{t['catalog.searchLabel']}</span>
              <MagnifyingGlassIcon
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                size={17}
              />
              <input
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-9 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-white/10 dark:bg-zinc-950/80 dark:text-white dark:shadow-none"
                onChange={(event) => {
                  setQuery(event.target.value);
                  scrollToResults();
                }}
                placeholder={t['catalog.searchPlaceholder']}
                type="search"
                value={query}
              />
              {query.length > 0 && (
                <button
                  aria-label={t['catalog.clear']}
                  className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-white/8 dark:hover:text-white"
                  onClick={() => {
                    setQuery('');
                    scrollToResults();
                  }}
                  type="button"
                >
                  <XIcon aria-hidden="true" size={15} />
                </button>
              )}
            </label>

            <Dialog.Root onOpenChange={setFiltersOpen} open={filtersOpen}>
              <Dialog.Trigger asChild>
                <button
                  aria-label={t['catalog.showFilters']}
                  className="relative grid size-10 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 dark:border-white/10 dark:bg-zinc-950/80 dark:text-zinc-200 dark:shadow-none dark:hover:border-white/20 dark:hover:text-white lg:hidden"
                  type="button"
                >
                  <SlidersHorizontalIcon aria-hidden="true" size={18} />
                  {activeFilterCount > 0 && (
                    <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-emerald-500 px-1 font-mono text-[9px] leading-4 text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[120] bg-zinc-950/45 backdrop-blur-[2px] data-[state=open]:animate-[menu-in_120ms_ease-out]" />
                <Dialog.Content
                  aria-describedby={undefined}
                  className="fixed inset-y-0 right-0 z-[130] flex w-[min(90vw,22rem)] flex-col border-l border-zinc-200 bg-white p-5 text-zinc-900 shadow-2xl outline-none dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <Dialog.Title className="inline-flex items-center gap-2 text-sm font-semibold">
                      <FunnelSimpleIcon aria-hidden="true" size={17} />
                      {t['catalog.filters']}
                    </Dialog.Title>
                    <div className="flex items-center gap-1">
                      {activeFilterCount > 0 && (
                        <button
                          className="px-2 py-1 text-xs text-emerald-700 transition hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-300"
                          onClick={clearFilters}
                          type="button"
                        >
                          {t['catalog.clear']}
                        </button>
                      )}
                      <Dialog.Close asChild>
                        <button
                          aria-label={t['catalog.hideFilters']}
                          className="grid size-9 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-white/8 dark:hover:text-white"
                          type="button"
                        >
                          <XIcon aria-hidden="true" size={18} />
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">{renderFilterGroups()}</div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>

          <fieldset className="col-span-2 grid h-10 grid-cols-3 rounded-lg border border-zinc-200 bg-zinc-100 p-1 shadow-inner lg:col-span-1 dark:border-white/10 dark:bg-zinc-950/80">
            <legend className="sr-only">{t['catalog.platform']}</legend>
            {platformChoices.map(({ label, value }) => {
              const active = selectedPlatform === value;
              return (
                <button
                  aria-pressed={active}
                  className={`rounded-md px-2 text-[13px] font-semibold transition ${
                    active
                      ? 'bg-emerald-600 text-white shadow-sm dark:bg-emerald-400 dark:text-zinc-950'
                      : 'text-zinc-500 hover:bg-white/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
                  }`}
                  key={value ?? 'all'}
                  onClick={() => {
                    setSelectedPlatform(value);
                    scrollToResults();
                  }}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </fieldset>

          <div className="col-span-2 grid grid-cols-2 gap-2 lg:contents">
            <div className="min-w-0">
              <SelectControl
                ariaLabel={t['catalog.market']}
                disabled={loadState === 'loading'}
                onValueChange={(value) => {
                  const nextMarket = marketCodeSchema.parse(value);
                  window.location.assign(catalogPath(nextMarket, locale));
                }}
                options={marketOptions}
                value={activeMarket}
              />
            </div>
            <div className="min-w-0">
              <SelectControl
                ariaLabel={t['catalog.sort']}
                onValueChange={(value) => {
                  setSort(value);
                  scrollToResults();
                }}
                options={sortOptions}
                value={sort}
              />
            </div>
          </div>
        </div>
      </div>

      {loadState === 'error' && (
        <p
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-100"
          role="alert"
        >
          {t['catalog.loadError']}
        </p>
      )}
      {loadState === 'loading' && (
        <p aria-live="polite" className="mt-4 text-sm text-zinc-500">
          {t['catalog.loading']}
        </p>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100dvh-10rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white/70 px-4 py-2 shadow-sm dark:border-white/8 dark:bg-zinc-950/35 dark:shadow-none">
            <div className="flex items-center justify-between border-b border-zinc-200 py-2 dark:border-white/8">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <FunnelSimpleIcon aria-hidden="true" size={17} />
                {t['catalog.filters']}
              </span>
              {activeFilterCount > 0 && (
                <button
                  className="text-xs text-emerald-700 transition hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-300"
                  onClick={clearFilters}
                  type="button"
                >
                  {t['catalog.clear']}
                </button>
              )}
            </div>
            {renderFilterGroups()}
          </div>
        </aside>

        <div className="min-w-0 scroll-mt-4 lg:scroll-mt-16" ref={resultsRef}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-white/8">
            <p className="font-mono text-xs uppercase tracking-wider text-zinc-500">
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                {groupedGames.length.toLocaleString(locale)}
              </strong>{' '}
              {t['catalog.results']}
            </p>
            {activeMarketEntry !== undefined && (
              <p className="text-xs text-zinc-500 dark:text-zinc-600">
                {t['catalog.region']}: {activeMarket} · {t['catalog.updated']}:{' '}
                <time dateTime={manifest.generatedAt}>
                  {formatDate(manifest.generatedAt, locale)}
                </time>
              </p>
            )}
          </div>

          {groupedGames.length === 0 ? (
            <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-zinc-300 px-6 text-center dark:border-white/10">
              <div>
                <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {t['catalog.noResults']}
                </p>
                <p className="mt-2 text-sm text-zinc-500">{t['catalog.noResultsDescription']}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {groupedGames.slice(0, visibleCount).map((group) => (
                  <GameCard
                    group={group}
                    key={group.id}
                    locale={locale}
                    storeLocale={activeMarketEntry?.storeLocale ?? 'en-US'}
                  />
                ))}
              </div>
              <p aria-live="polite" className="sr-only">
                {Math.min(visibleCount, groupedGames.length).toLocaleString(locale)} /{' '}
                {groupedGames.length.toLocaleString(locale)} {t['catalog.results']}
              </p>
              {hasMoreGames && <div aria-hidden="true" className="mt-8 h-px" ref={loadMoreRef} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
};
