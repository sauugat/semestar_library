import { api, apiFetch, ApiError } from './api';
import { RawFileAsset } from '../utils/file-upload';

export interface Advertisement {
  id: number;
  feedItemType?: 'advertisement';
  _feedType?: 'advertisement';
  type?: 'advertisement';
  isSponsored: boolean;
  sponsored_label?: string;
  advertiser_name: string;
  advertiserName?: string;
  advertiser_logo_url: string | null;
  advertiserLogoUrl?: string | null;
  primary_text: string;
  primaryText?: string;
  headline?: string | null;
  description?: string | null;
  media_url: string;
  mediaUrl?: string;
  media_type: 'image' | 'video';
  mediaType?: 'image' | 'video';
  mime_type?: string | null;
  cta_label: string;
  ctaLabel?: string;
  destination_url: string;
  destinationUrl?: string;
  status: 'active' | 'inactive' | 'paused' | 'draft';
  is_active: number;
  isActive?: boolean;
  start_date?: string | null;
  startDate?: string | null;
  end_date?: string | null;
  endDate?: string | null;
  impression_count?: number;
  impressionCount?: number;
  click_count?: number;
  clickCount?: number;
  ctr?: number;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

export interface CreateAdvertisementParams {
  advertiser_name: string;
  advertiser_logo_url?: string | null;
  primary_text: string;
  headline?: string | null;
  description?: string | null;
  media_url?: string;
  media_type?: 'image' | 'video';
  mime_type?: string | null;
  cta_label?: string;
  destination_url: string;
  status?: 'active' | 'inactive' | 'paused' | 'draft';
  is_active?: boolean | number;
  start_date?: string | null;
  end_date?: string | null;
  creativeFile?: RawFileAsset | { uri: string; name?: string; type?: string; mimeType?: string } | null;
  logoFile?: RawFileAsset | { uri: string; name?: string; type?: string; mimeType?: string } | null;
}

export interface ManagedAdvertisementsResponse {
  advertisements: Advertisement[];
  summary: {
    total: number;
    active: number;
    inactive: number;
    totalImpressions: number;
    totalClicks: number;
    overallCtr: number;
  };
}

// Session-level impression deduplication cache so React rerenders never fire duplicate requests
const sessionRecordedImpressions = new Set<string>();
let currentFeedSessionKey = `mob_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export function getFeedSessionKey(): string {
  return currentFeedSessionKey;
}

export function resetFeedSessionKey(nextKey?: string): string {
  currentFeedSessionKey = nextKey || `mob_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  sessionRecordedImpressions.clear();
  return currentFeedSessionKey;
}

export function isSafeAdDestinationUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isAdCurrentlyEligible(ad: Advertisement, now: Date = new Date()): boolean {
  if (!ad) return false;
  const isActive = Number(ad.is_active ?? (ad.isActive ? 1 : 0)) === 1;
  const status = String(ad.status || '').toLowerCase();
  if (!isActive || status !== 'active') return false;

  const nowMs = now.getTime();
  const startRaw = ad.start_date ?? ad.startDate ?? null;
  if (startRaw) {
    const startMs = new Date(startRaw).getTime();
    if (!isNaN(startMs) && nowMs < startMs) return false;
  }
  const endRaw = ad.end_date ?? ad.endDate ?? null;
  if (endRaw) {
    const endMs = new Date(endRaw).getTime();
    if (!isNaN(endMs) && nowMs > endMs) return false;
  }
  return true;
}

export function hashSeed(seedInput: string): number {
  const str = String(seedInput || 'semester-library-default-seed');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSeededRng(seedInput: string): () => number {
  let a = hashSeed(seedInput) || 1;
  return function nextRandom() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithSeed<T>(items: T[], seedInput: string = 'default-seed'): T[] {
  const copy = Array.isArray(items) ? [...items] : [];
  if (copy.length <= 1) return copy;
  const rng = createSeededRng(seedInput);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Deterministic in-feed advertisement placement algorithm for mobile & web.
 * - Idempotent: strips any already-interleaved advertisement items so ads are never interleaved twice.
 * - Inserts an advertisement after every 2–3 organic feed items.
 * - Never places an ad at index 0 (top of the feed).
 * - Never places consecutive advertisements.
 * - Never repeats the same advertisement within a feed session.
 * - Never replaces or drops organic items.
 */
export function interleaveFeedWithAds<T>(
  organicItems: T[],
  eligibleAds: Advertisement[],
  options: { seed?: string; excludeAdIds?: number[] } = {}
): Array<T | { feedType: 'advertisement'; advertisement: Advertisement; time: number }> {
  const rawList = Array.isArray(organicItems) ? organicItems : [];
  const cleanOrganic = rawList.filter(
    (item: any) =>
      !(
        item &&
        (item.feedType === 'advertisement' ||
          item.feedItemType === 'advertisement' ||
          item._feedType === 'advertisement' ||
          item.isSponsored === true)
      )
  );
  if (cleanOrganic.length === 0) {
    return [];
  }

  const seed = String(options.seed || currentFeedSessionKey);
  const excludeSet = new Set<number>(options.excludeAdIds || []);
  const seenIds = new Set<number>(excludeSet);
  const validAds: Advertisement[] = [];

  for (const ad of Array.isArray(eligibleAds) ? eligibleAds : []) {
    if (!ad || !ad.id) continue;
    const id = Number(ad.id);
    if (seenIds.has(id)) continue;
    if (!isAdCurrentlyEligible(ad)) continue;
    seenIds.add(id);
    validAds.push(ad);
  }

  if (validAds.length === 0) {
    return [...cleanOrganic];
  }

  const shuffledAds = shuffleWithSeed(validAds, `${seed}:ads`);
  const intervalRng = createSeededRng(`${seed}:intervals`);

  const result: Array<T | { feedType: 'advertisement'; advertisement: Advertisement; time: number }> = [];
  let adIdx = 0;
  let organicSinceLastAd = 0;
  let nextGap = intervalRng() < 0.5 ? 2 : 3;

  for (let i = 0; i < cleanOrganic.length; i++) {
    result.push(cleanOrganic[i]);
    organicSinceLastAd++;

    if (organicSinceLastAd >= nextGap && adIdx < shuffledAds.length) {
      const ad = shuffledAds[adIdx++];
      result.push({
        feedType: 'advertisement',
        advertisement: ad,
        time: new Date(ad.created_at || ad.createdAt || 0).getTime() || 0,
      });
      organicSinceLastAd = 0;
      nextGap = intervalRng() < 0.5 ? 2 : 3;
    }
  }

  return result;
}

export async function getEligibleAdvertisements(seed?: string, excludeIds?: number[]): Promise<Advertisement[]> {
  try {
    const query = new URLSearchParams();
    if (seed) query.append('seed', seed);
    if (excludeIds && excludeIds.length > 0) query.append('excludeIds', excludeIds.join(','));
    const res = await api.get<{ advertisements: Advertisement[] }>(`/api/advertisements/eligible?${query.toString()}`);
    return Array.isArray(res?.advertisements) ? res.advertisements : [];
  } catch {
    return [];
  }
}

export async function recordAdImpression(adId: number, sessionKey: string = currentFeedSessionKey): Promise<void> {
  if (!adId || adId <= 0) return;
  const dedupeKey = `${sessionKey}:${adId}`;
  if (sessionRecordedImpressions.has(dedupeKey)) {
    return;
  }
  sessionRecordedImpressions.add(dedupeKey);

  try {
    await apiFetch(`/api/advertisements/${adId}/impression`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey }),
    });
  } catch {
    // Non-blocking analytics: never disrupt feed rendering
  }
}

export async function recordAdClick(adId: number, sessionKey: string = currentFeedSessionKey): Promise<void> {
  if (!adId || adId <= 0) return;
  try {
    await apiFetch(`/api/advertisements/${adId}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey }),
    });
  } catch {
    // Non-blocking analytics
  }
}

export async function uploadAdvertisementMedia(
  file: RawFileAsset | { uri: string; name?: string; type?: string; mimeType?: string }
): Promise<{ url: string; filename: string; media_type: 'image' | 'video'; mime_type?: string }> {
  const formData = new FormData();
  const assetName = (file as any).name || (file as any).fileName || `ad_${Date.now()}.jpg`;
  const assetMime = (file as any).type || (file as any).mimeType || 'image/jpeg';

  formData.append('file', {
    uri: file.uri,
    name: assetName,
    type: assetMime,
  } as any);

  const res = await apiFetch('/api/advertisements/media', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.message || `Media upload failed (HTTP ${res.status})`, res.status, err);
  }
  return res.json();
}

export async function createAdvertisement(params: CreateAdvertisementParams): Promise<Advertisement> {
  let mediaUrl = params.media_url;
  let mediaType = params.media_type || 'image';
  let mimeType = params.mime_type || null;
  let logoUrl = params.advertiser_logo_url || null;

  if (params.creativeFile && params.creativeFile.uri) {
    const uploaded = await uploadAdvertisementMedia(params.creativeFile);
    mediaUrl = uploaded.url;
    mediaType = uploaded.media_type;
    mimeType = uploaded.mime_type || null;
  }

  if (params.logoFile && params.logoFile.uri) {
    const uploadedLogo = await uploadAdvertisementMedia(params.logoFile);
    logoUrl = uploadedLogo.url;
  }

  const res = await apiFetch('/api/advertisements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advertiser_name: params.advertiser_name,
      advertiser_logo_url: logoUrl,
      primary_text: params.primary_text,
      headline: params.headline || null,
      description: params.description || null,
      media_url: mediaUrl,
      media_type: mediaType,
      mime_type: mimeType,
      cta_label: params.cta_label || 'Learn More',
      destination_url: params.destination_url,
      status: params.status || 'active',
      is_active: params.is_active !== undefined ? params.is_active : true,
      start_date: params.start_date || null,
      end_date: params.end_date || null,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.message || `Failed to create advertisement (HTTP ${res.status})`, res.status, err);
  }
  const data = await res.json();
  return data.advertisement || data;
}

export async function updateAdvertisement(
  adId: number,
  params: Partial<CreateAdvertisementParams>
): Promise<Advertisement> {
  let mediaUrl = params.media_url;
  let mediaType = params.media_type;
  let mimeType = params.mime_type;
  let logoUrl = params.advertiser_logo_url;

  if (params.creativeFile && params.creativeFile.uri) {
    const uploaded = await uploadAdvertisementMedia(params.creativeFile);
    mediaUrl = uploaded.url;
    mediaType = uploaded.media_type;
    mimeType = uploaded.mime_type || null;
  }

  if (params.logoFile && params.logoFile.uri) {
    const uploadedLogo = await uploadAdvertisementMedia(params.logoFile);
    logoUrl = uploadedLogo.url;
  }

  const payload: Record<string, any> = { ...params };
  delete payload.creativeFile;
  delete payload.logoFile;
  if (mediaUrl !== undefined) payload.media_url = mediaUrl;
  if (mediaType !== undefined) payload.media_type = mediaType;
  if (mimeType !== undefined) payload.mime_type = mimeType;
  if (logoUrl !== undefined) payload.advertiser_logo_url = logoUrl;

  const res = await apiFetch(`/api/advertisements/${adId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.message || `Failed to update advertisement (HTTP ${res.status})`, res.status, err);
  }
  const data = await res.json();
  return data.advertisement || data;
}

export async function setAdvertisementStatus(
  adId: number,
  status: 'active' | 'inactive' | 'paused'
): Promise<Advertisement> {
  const res = await apiFetch(`/api/advertisements/${adId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, is_active: status === 'active' }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.message || `Failed to update advertisement status (HTTP ${res.status})`, res.status, err);
  }
  const data = await res.json();
  return data.advertisement || data;
}

export async function deleteAdvertisement(adId: number): Promise<void> {
  const res = await apiFetch(`/api/advertisements/${adId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.message || `Failed to delete advertisement (HTTP ${res.status})`, res.status, err);
  }
}

export async function getManagedAdvertisements(params?: {
  status?: string;
  search?: string;
}): Promise<ManagedAdvertisementsResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.append('status', params.status);
  if (params?.search) query.append('search', params.search);
  const qs = query.toString();
  const res = await apiFetch(`/api/advertisements/manage${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.message || `Failed to load advertisements (HTTP ${res.status})`, res.status, err);
  }
  return res.json();
}
