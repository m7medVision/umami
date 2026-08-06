import type { FeatureFlag } from '@/generated/prisma/client';
import type { Auth } from '@/lib/types';
import { canDeleteWebsite, canUpdateWebsite, canViewWebsite } from './website';

export async function canViewFeatureFlag(auth: Auth, featureFlag: FeatureFlag | null) {
  return !!featureFlag && canViewWebsite(auth, featureFlag.websiteId);
}

export async function canUpdateFeatureFlag(auth: Auth, featureFlag: FeatureFlag | null) {
  return !!featureFlag && canUpdateWebsite(auth, featureFlag.websiteId);
}

export async function canDeleteFeatureFlag(auth: Auth, featureFlag: FeatureFlag | null) {
  return !!featureFlag && canDeleteWebsite(auth, featureFlag.websiteId);
}
