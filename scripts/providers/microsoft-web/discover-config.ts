export interface CollectionDescriptor {
  readonly plan: string;
  readonly siglId: string;
  readonly target: string;
}

export interface CollectionPair {
  readonly console: CollectionDescriptor;
  readonly pc: CollectionDescriptor;
}

export interface MicrosoftCatalogConfig {
  readonly collections: Readonly<Record<string, CollectionPair>>;
  readonly subscriptions: Readonly<Record<string, string>>;
}

interface DiscoverOptions {
  readonly fetchText: (url: string) => Promise<string>;
  readonly landingPageUrl: string;
}

interface DiscoveredConfig {
  readonly config: MicrosoftCatalogConfig;
  readonly sourceUrl: string;
}

const allowedXboxConfigHosts = new Set(['www.xbox.com', 'assets.xboxservices.com']);

const parseTrustedXboxConfigUrl = (value: string, label: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${label} is not a valid URL`, { cause: error });
  }

  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !allowedXboxConfigHosts.has(url.hostname)
  ) {
    throw new Error(`${label} is outside the trusted Xbox HTTPS origin allowlist`);
  }
  return url;
};

const parseDescriptor = (value: string): CollectionDescriptor => {
  const [siglId, target, plan, ...extra] = value.split(',');
  if (siglId === undefined || target === undefined || plan === undefined || extra.length > 0) {
    throw new Error(`Invalid Microsoft collection descriptor: ${value}`);
  }

  return { plan, siglId, target };
};

const parseStringEntries = (block: string): Record<string, string> => {
  const entries: Record<string, string> = {};
  const entryPattern = /([A-Za-z][A-Za-z0-9_]*)\s*:\s*["']([^"']+)["']/g;

  for (const match of block.matchAll(entryPattern)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) entries[key] = value;
  }

  return entries;
};

export const parseMicrosoftCatalogScript = (script: string): MicrosoftCatalogConfig => {
  const subscriptionsBlock = /(?:const|let|var)\s+gp_bigids\s*=\s*\{([\s\S]*?)\};/i.exec(
    script,
  )?.[1];
  const collectionsBlock = /guidAmpt\s*=\s*\{([\s\S]*?)\n\s*\};/i.exec(script)?.[1];

  if (subscriptionsBlock === undefined || collectionsBlock === undefined) {
    throw new Error('Microsoft catalog configuration was not found');
  }

  const subscriptions = parseStringEntries(subscriptionsBlock);
  const collections: Record<string, CollectionPair> = {};
  const collectionPattern =
    /([A-Za-z][A-Za-z0-9_]*)\s*:\s*\{[\s\S]*?console:\s*["']([^"']+)["']\s*,?[\s\S]*?pc:\s*["']([^"']+)["'][\s\S]*?\}/g;

  for (const match of collectionsBlock.matchAll(collectionPattern)) {
    const name = match[1];
    const consoleValue = match[2];
    const pcValue = match[3];
    if (name === undefined || consoleValue === undefined || pcValue === undefined) continue;

    collections[name] = {
      console: parseDescriptor(consoleValue),
      pc: parseDescriptor(pcValue),
    };
  }

  if (subscriptions.ultimate === undefined || collections.allgames === undefined) {
    throw new Error('Microsoft catalog configuration was not found');
  }

  return { collections, subscriptions };
};

export const discoverMicrosoftCatalogConfig = async ({
  fetchText,
  landingPageUrl,
}: DiscoverOptions): Promise<DiscoveredConfig> => {
  const landingUrl = parseTrustedXboxConfigUrl(landingPageUrl, 'Xbox catalog landing page');
  const landingPage = await fetchText(landingUrl.toString());
  const scriptPath = /src=["']([^"']*xgpcatPopulate[^"']*\.js)["']/i.exec(landingPage)?.[1];
  if (scriptPath === undefined) {
    throw new Error('Xbox catalog script was not found on the landing page');
  }

  const sourceUrl = parseTrustedXboxConfigUrl(
    new URL(scriptPath, landingUrl).toString(),
    'Xbox catalog configuration script',
  ).toString();
  const script = await fetchText(sourceUrl);

  return {
    config: parseMicrosoftCatalogScript(script),
    sourceUrl,
  };
};
