import type { Dictionary, TranslationKey } from './index';

export const categoryTranslationKeys: Readonly<Record<string, TranslationKey>> = {
  'Action & adventure': 'category.actionAdventure',
  'Family & kids': 'category.familyKids',
  Platformer: 'category.platformer',
  'Puzzle & trivia': 'category.puzzleTrivia',
  'Racing & flying': 'category.racingFlying',
  'Role playing': 'category.rolePlaying',
  Shooter: 'category.shooter',
  Simulation: 'category.simulation',
  Sports: 'category.sports',
  Strategy: 'category.strategy',
};

export const capabilityTranslationKeys: Readonly<Record<string, TranslationKey>> = {
  '60fps': 'capability.60fps',
  Capability4k: 'capability.Capability4k',
  CapabilityHDR: 'capability.CapabilityHDR',
  ConsoleGen9Optimized: 'capability.ConsoleGen9Optimized',
  SinglePlayer: 'capability.SinglePlayer',
  XblLocalCoop: 'capability.XblLocalCoop',
  XblOnlineCoop: 'capability.XblOnlineCoop',
  XPA: 'capability.XPA',
};

export const getCategoryLabel = (category: string, dictionary: Dictionary): string => {
  const key = categoryTranslationKeys[category];
  return key === undefined ? category : dictionary[key];
};

export const getCapabilityLabel = (capability: string, dictionary: Dictionary): string => {
  const key = capabilityTranslationKeys[capability];
  return key === undefined ? capability : dictionary[key];
};
