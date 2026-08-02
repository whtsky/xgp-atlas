import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CaretDownIcon, MoonIcon, SunIcon, TranslateIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import type { MarketCode, SupportedLocale } from '../domain/catalog';
import {
  catalogPath,
  getPathFromLocale,
  getTranslations,
  localeConfig,
  localePaths,
} from '../i18n';

type Theme = 'dark' | 'light';

interface SiteHeaderProps {
  readonly canonicalRoute: string;
  readonly locale: SupportedLocale;
  readonly market: MarketCode;
}

declare global {
  interface WindowEventMap {
    'xgp:catalog-state-change': CustomEvent<string>;
    'xgp:market-change': CustomEvent<MarketCode>;
  }
}

const THEME_STORAGE_KEY = 'xgp-atlas-theme';

const setDocumentTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#151a18' : '#f7f8f7');
};

export const SiteHeader = ({ canonicalRoute, locale, market }: SiteHeaderProps) => {
  const t = getTranslations(locale);
  const currentConfig = localeConfig[getPathFromLocale(locale)];
  const [activeMarket, setActiveMarket] = useState<MarketCode>(market);
  const [activeSearch, setActiveSearch] = useState('');
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(currentTheme);
    setDocumentTheme(currentTheme);
  }, []);

  useEffect(() => {
    setActiveSearch(window.location.search);
    const handleCatalogStateChange = (event: CustomEvent<string>) => {
      setActiveSearch(event.detail);
    };
    window.addEventListener('xgp:catalog-state-change', handleCatalogStateChange);
    return () => {
      window.removeEventListener('xgp:catalog-state-change', handleCatalogStateChange);
    };
  }, []);

  useEffect(() => {
    const handleMarketChange = (event: CustomEvent<MarketCode>) => {
      setActiveMarket(event.detail);
    };
    window.addEventListener('xgp:market-change', handleMarketChange);
    return () => {
      window.removeEventListener('xgp:market-change', handleMarketChange);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    setDocumentTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Theme remains active when preference storage is unavailable.
    }
  };

  const nextThemeLabel = theme === 'light' ? t['theme.dark'] : t['theme.light'];

  return (
    <header className="border-b border-zinc-200 bg-white/90 backdrop-blur-xl dark:border-white/8 dark:bg-[#151a18]/90">
      <div className="mx-auto flex h-12 max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <a
          className="truncate text-sm font-bold tracking-[-0.03em] text-zinc-950 dark:text-white"
          data-locale-link
          data-locale-path={getPathFromLocale(locale)}
          href={catalogPath(activeMarket, locale)}
        >
          {t['site.name']}
        </a>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={t['nav.language']}
                className="group inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-700 outline-none transition hover:bg-zinc-100 hover:text-zinc-950 data-[state=open]:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/8 dark:hover:text-white dark:data-[state=open]:bg-white/8"
                type="button"
              >
                <TranslateIcon
                  aria-hidden="true"
                  className="text-zinc-500 transition-colors duration-200 group-hover:text-emerald-600 group-data-[state=open]:text-emerald-600 dark:group-hover:text-emerald-400 dark:group-data-[state=open]:text-emerald-400"
                  size={16}
                />
                <span className="hidden sm:inline">{currentConfig.label}</span>
                <CaretDownIcon
                  aria-hidden="true"
                  className="text-zinc-400 transition duration-200 group-hover:translate-y-0.5 group-hover:text-emerald-600 group-data-[state=open]:rotate-180 group-data-[state=open]:text-emerald-600 dark:group-hover:text-emerald-400 dark:group-data-[state=open]:text-emerald-400"
                  size={12}
                />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-[110] min-w-44 rounded-xl border border-zinc-200 bg-white p-1.5 text-zinc-800 shadow-xl data-[state=open]:animate-[menu-in_120ms_ease-out] dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100"
                collisionPadding={12}
                sideOffset={6}
              >
                <DropdownMenu.Label className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  {t['nav.language']}
                </DropdownMenu.Label>
                {localePaths.map((path) => {
                  const config = localeConfig[path];
                  const active = config.locale === locale;
                  return (
                    <DropdownMenu.Item asChild key={path}>
                      <a
                        aria-current={active ? 'page' : undefined}
                        className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-950 dark:data-[highlighted]:bg-zinc-800 dark:data-[highlighted]:text-white"
                        data-locale-link
                        data-locale-path={path}
                        href={`${catalogPath(activeMarket, config.locale, canonicalRoute)}${activeSearch}`}
                        lang={config.htmlLang}
                      >
                        {config.label}
                        {active && <span className="size-1.5 rounded-full bg-emerald-500" />}
                      </a>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            aria-label={nextThemeLabel}
            className="group grid size-9 place-items-center rounded-lg text-zinc-600 outline-none transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/8"
            onClick={toggleTheme}
            title={nextThemeLabel}
            type="button"
          >
            {theme === 'light' ? (
              <MoonIcon
                aria-hidden="true"
                className="transition duration-200 group-hover:-rotate-12 group-hover:scale-110 group-hover:text-indigo-600 dark:group-hover:text-indigo-300"
                size={17}
              />
            ) : (
              <SunIcon
                aria-hidden="true"
                className="transition duration-200 group-hover:rotate-45 group-hover:scale-110 group-hover:text-amber-500"
                size={17}
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
