import { open, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { supportedLocaleSchema } from '../src/domain/catalog';
import { localeConfig, localePaths } from '../src/i18n/locales';
import { marketRegistry } from '../src/domain/markets';
import { syncCatalogRelease } from './catalog/sync-service';
import { writeJsonAtomically } from './catalog/write-json-atomically';
import { MicrosoftWebCatalogProvider } from './providers/microsoft-web/provider';

const publicRoot = resolve('public');
const manifestPath = resolve(publicRoot, 'catalog-manifest.json');
const syncLockPath = resolve('.catalog-sync.lock');
const generatedAssetPattern = /^(?:p|[a-z]{2})\.[a-f0-9]{64}\.json$/;
const locales = localePaths.map((path) => supportedLocaleSchema.parse(localeConfig[path].locale));

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const acquireSyncLock = async (): Promise<() => Promise<void>> => {
  let handle;
  try {
    handle = await open(syncLockPath, 'wx');
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;

    let owner = 'unknown';
    try {
      owner = await readFile(syncLockPath, 'utf8');
    } catch {
      // The owner metadata is diagnostic only; the existing lock remains authoritative.
    }
    throw new Error(`Catalog synchronization lock already exists: ${owner}`, { cause: error });
  }

  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      'utf8',
    );
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(syncLockPath, { force: true });
    throw error;
  }

  return async () => {
    await rm(syncLockPath, { force: true });
  };
};

const removeOldBrowserAssets = async (currentPaths: ReadonlySet<string>): Promise<void> => {
  const entries = await readdir(publicRoot, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          generatedAssetPattern.test(entry.name) &&
          !currentPaths.has(`/${entry.name}`),
      )
      .map((entry) => rm(resolve(publicRoot, entry.name))),
  );
};

const releaseLock = await acquireSyncLock();
try {
  const release = await syncCatalogRelease({
    locales,
    markets: marketRegistry,
    provider: new MicrosoftWebCatalogProvider(),
  });

  const currentBrowserPaths = new Set<string>([release.manifest.clientProductsPath]);
  await writeJsonAtomically(
    resolve(publicRoot, release.manifest.clientProductsPath.slice(1)),
    release.clientProducts,
  );
  for (const entry of release.manifest.markets) {
    const overlay = release.overlays.get(entry.code);
    if (overlay === undefined) throw new Error(`Missing overlay for ${entry.code}`);
    await writeJsonAtomically(resolve(publicRoot, entry.overlayPath.slice(1)), overlay);
    currentBrowserPaths.add(entry.overlayPath);
  }
  await removeOldBrowserAssets(currentBrowserPaths);
  await writeJsonAtomically(manifestPath, release.manifest);

  console.log(
    JSON.stringify(
      {
        clientProducts: release.clientProducts.products.length,
        clientProductsPath: release.manifest.clientProductsPath,
        generatedAt: release.manifest.generatedAt,
        manifest: manifestPath,
        markets: release.manifest.markets.length,
        provider: release.manifest.provider,
      },
      null,
      2,
    ),
  );
} finally {
  await releaseLock();
}
