import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface WriteJsonOptions {
  readonly space?: number;
}

export const serializeJson = (value: unknown, space?: number): string =>
  `${JSON.stringify(value, null, space)}\n`;

export const writeTextAtomically = async (destination: string, content: string): Promise<void> => {
  await mkdir(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const writeJsonAtomically = async (
  destination: string,
  value: unknown,
  { space }: WriteJsonOptions = {},
): Promise<void> => {
  await writeTextAtomically(destination, serializeJson(value, space));
};
