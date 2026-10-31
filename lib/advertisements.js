'use strict';

const crypto = require('crypto');

const VALID_AD_MEDIA_TYPES = Object.freeze(['image', 'video']);
const VALID_AD_STATUSES = Object.freeze(['active', 'inactive', 'paused', 'draft']);
const DEFAULT_CTA_LABEL = 'Learn More';
const IMPRESSION_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30-minute deduplication window per user/session + ad

async function ensureAdvertisementsSchema(db) {
  const isPostgres = Boolean(db && db.isPostgres);
  const idCol = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const tsCol = isPostgres ? 'TIMESTAMPTZ' : 'TEXT';

  await db.exec(`
    CREATE TABLE IF NOT EXISTS advertisements (
      id ${idCol},
      advertiser_name TEXT NOT NULL,
      advertiser_logo_url TEXT,
      primary_text TEXT NOT NULL DEFAULT '',
      headline TEXT,
      description TEXT,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
      mime_type TEXT,
      cta_label TEXT NOT NULL DEFAULT 'Learn More',
      destination_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused', 'draft')),
      is_active INTEGER NOT NULL DEFAULT 1,
      start_date ${tsCol},
      end_date ${tsCol},
      impression_count INTEGER NOT NULL DEFAULT 0,
      click_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
      created_at ${tsCol} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${tsCol} NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_advertisements_active_status
      ON advertisements (is_active, status, start_date, end_date);

    CREATE INDEX IF NOT EXISTS idx_advertisements_created_at
      ON advertisements (created_at DESC);

    CREATE TABLE IF NOT EXISTS advertisement_impressions (
      id ${idCol},
      advertisement_id INTEGER NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
      viewer_key TEXT NOT NULL,
      session_key TEXT NOT NULL DEFAULT 'default',
      window_bucket TEXT NOT NULL,
      created_at ${tsCol} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(advertisement_id, viewer_key, session_key, window_bucket)
    );

    CREATE INDEX IF NOT EXISTS idx_ad_impressions_ad_id
      ON advertisement_impressions (advertisement_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS advertisement_clicks (
      id ${idCol},
      advertisement_id INTEGER NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
      viewer_key TEXT NOT NULL,
      session_key TEXT NOT NULL DEFAULT 'default',
      created_at ${tsCol} NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_ad_clicks_ad_id
      ON advertisement_clicks (advertisement_id, created_at DESC);
  `);
}

function isSafeDestinationUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function normalizeAdStatus(statusInput, isActiveInput) {
  if (typeof statusInput === 'string' && statusInput.trim()) {
    const lower = statusInput.trim().toLowerCase();
    if (VALID_AD_STATUSES.includes(lower)) {
      const activeFlag = lower === 'active' ? 1 : 0;
      return { status: lower, is_active: activeFlag };
    }
  }
  if (isActiveInput !== undefined && isActiveInput !== null && isActiveInput !== '') {
    const boolVal =
      isActiveInput === true ||
      isActiveInput === 1 ||
      isActiveInput === '1' ||
      String(isActiveInput).toLowerCase() === 'true' ||
      String(isActiveInput).toLowerCase() === 'active';
    return {
      status: boolVal ? 'active' : 'inactive',
      is_active: boolVal ? 1 : 0
    };
  }
  return { status: 'active', is_active: 1 };
}

function parseOptionalDate(val, fieldName = 'date') {
  if (val === undefined || val === null || val === '') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    const err = new Error(`Invalid ${fieldName}. Provide a valid ISO date or timestamp.`);
    err.status = 400;
    throw err;
  }
  return d.toISOString();
}

function validateAdvertisementInput(payload = {}, { partial = false } = {}) {
  const out = {};

  if (!partial || payload.advertiser_name !== undefined || payload.advertiserName !== undefined) {
    const name = String(payload.advertiser_name ?? payload.advertiserName ?? '').trim();
    if (!name) {
      const err = new Error('Advertiser or brand name is required.');
      err.status = 400;
      throw err;
    }
    if (name.length > 120) {
      const err = new Error('Advertiser name cannot exceed 120 characters.');
      err.status = 400;
      throw err;
    }
    out.advertiser_name = name;
  }

  if (!partial || payload.advertiser_logo_url !== undefined || payload.advertiserLogoUrl !== undefined) {
    const rawLogo = payload.advertiser_logo_url ?? payload.advertiserLogoUrl;
    out.advertiser_logo_url = rawLogo && String(rawLogo).trim() ? String(rawLogo).trim() : null;
  }

  if (!partial || payload.primary_text !== undefined || payload.primaryText !== undefined || payload.content !== undefined) {
    const text = String(payload.primary_text ?? payload.primaryText ?? payload.content ?? '').trim();
    if (!text) {
      const err = new Error('Primary advertisement text is required.');
      err.status = 400;
      throw err;
    }
    if (text.length > 5000) {
      const err = new Error('Primary advertisement text cannot exceed 5,000 characters.');
      err.status = 400;
      throw err;
    }
    out.primary_text = text;
  }

  if (!partial || payload.headline !== undefined) {
    const hl = payload.headline !== undefined && payload.headline !== null ? String(payload.headline).trim() : '';
    if (hl.length > 200) {
      const err = new Error('Headline cannot exceed 200 characters.');
      err.status = 400;
      throw err;
    }
    out.headline = hl || null;
  }

  if (!partial || payload.description !== undefined) {
    const desc = payload.description !== undefined && payload.description !== null ? String(payload.description).trim() : '';
    if (desc.length > 1000) {
      const err = new Error('Description cannot exceed 1,000 characters.');
      err.status = 400;
      throw err;
    }
    out.description = desc || null;
  }

  if (!partial || payload.media_url !== undefined || payload.mediaUrl !== undefined) {
    const mediaUrl = String(payload.media_url ?? payload.mediaUrl ?? '').trim();
    if (!mediaUrl) {
      const err = new Error('Advertisement image or video creative is required.');
      err.status = 400;
      throw err;
    }
    out.media_url = mediaUrl;
  }

  if (!partial || payload.media_type !== undefined || payload.mediaType !== undefined) {
    const rawType = String(payload.media_type ?? payload.mediaType ?? 'image').trim().toLowerCase();
    const mediaType = VALID_AD_MEDIA_TYPES.includes(rawType) ? rawType : null;
    if (!mediaType) {
      const err = new Error('Media type must be "image" or "video".');
      err.status = 400;
      throw err;
    }
    out.media_type = mediaType;
  }

  if (!partial || payload.mime_type !== undefined || payload.mimeType !== undefined) {
    const mime = payload.mime_type ?? payload.mimeType;
    out.mime_type = mime ? String(mime).trim() : null;
  }

  if (!partial || payload.cta_label !== undefined || payload.ctaLabel !== undefined) {
    const cta = String(payload.cta_label ?? payload.ctaLabel ?? DEFAULT_CTA_LABEL).trim() || DEFAULT_CTA_LABEL;
    if (cta.length > 60) {
      const err = new Error('CTA button label cannot exceed 60 characters.');
      err.status = 400;
      throw err;
    }
    out.cta_label = cta;
  }

  if (!partial || payload.destination_url !== undefined || payload.destinationUrl !== undefined) {
    const dest = String(payload.destination_url ?? payload.destinationUrl ?? '').trim();
    if (!isSafeDestinationUrl(dest)) {
      const err = new Error('A valid http:// or https:// destination URL is required.');
      err.status = 400;
      throw err;
    }
    out.destination_url = dest;
  }

  if (!partial || payload.status !== undefined || payload.is_active !== undefined || payload.isActive !== undefined) {
    const norm = normalizeAdStatus(payload.status, payload.is_active ?? payload.isActive);
    out.status = norm.status;
    out.is_active = norm.is_active;
  }

  if (!partial || payload.start_date !== undefined || payload.startDate !== undefined) {
    out.start_date = parseOptionalDate(payload.start_date ?? payload.startDate, 'start date');
  }

  if (!partial || payload.end_date !== undefined || payload.endDate !== undefined) {
    out.end_date = parseOptionalDate(payload.end_date ?? payload.endDate, 'end date');
  }

  if (out.start_date && out.end_date) {
    if (new Date(out.end_date).getTime() < new Date(out.start_date).getTime()) {
      const err = new Error('End date must be after start date.');
      err.status = 400;
      throw err;
    }
  }

  return out;
}

function isAdCurrentlyEligible(ad, now = new Date()) {
  if (!ad) return false;
  const isActive = Number(ad.is_active ?? ad.isActive ?? 0) === 1;
  const status = String(ad.status || '').toLowerCase();
  if (!isActive || status !== 'active') return false;

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
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

function formatAdvertisement(row, { includeAdminFields = false } = {}) {
  if (!row) return null;
  const id = Number(row.id);
  const isActive = Number(row.is_active ?? row.isActive ?? 0) === 1;
  const status = row.status || (isActive ? 'active' : 'inactive');
  const impressions = Number(row.impression_count ?? row.impressionCount ?? 0);
  const clicks = Number(row.click_count ?? row.clickCount ?? 0);
  const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;

  const formatted = {
    id,
    feedItemType: 'advertisement',
    _feedType: 'advertisement',
    type: 'advertisement',
    isSponsored: true,
    sponsored_label: 'Sponsored',
    advertiser_name: row.advertiser_name ?? row.advertiserName ?? '',
    advertiserName: row.advertiser_name ?? row.advertiserName ?? '',
    advertiser_logo_url: row.advertiser_logo_url ?? row.advertiserLogoUrl ?? null,
    advertiserLogoUrl: row.advertiser_logo_url ?? row.advertiserLogoUrl ?? null,
    primary_text: row.primary_text ?? row.primaryText ?? '',
    primaryText: row.primary_text ?? row.primaryText ?? '',
    headline: row.headline ?? null,
    description: row.description ?? null,
    media_url: row.media_url ?? row.mediaUrl ?? '',
    mediaUrl: row.media_url ?? row.mediaUrl ?? '',
    media_type: row.media_type ?? row.mediaType ?? 'image',
    mediaType: row.media_type ?? row.mediaType ?? 'image',
    mime_type: row.mime_type ?? row.mimeType ?? null,
    mimeType: row.mime_type ?? row.mimeType ?? null,
    cta_label: row.cta_label ?? row.ctaLabel ?? DEFAULT_CTA_LABEL,
    ctaLabel: row.cta_label ?? row.ctaLabel ?? DEFAULT_CTA_LABEL,
    destination_url: row.destination_url ?? row.destinationUrl ?? '',
    destinationUrl: row.destination_url ?? row.destinationUrl ?? '',
    status,
    is_active: isActive ? 1 : 0,
    isActive,
    start_date: row.start_date ?? row.startDate ?? null,
    startDate: row.start_date ?? row.startDate ?? null,
    end_date: row.end_date ?? row.endDate ?? null,
    endDate: row.end_date ?? row.endDate ?? null,
    created_at: row.created_at ?? row.createdAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updated_at: row.updated_at ?? row.updatedAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };

  if (includeAdminFields) {
    formatted.impression_count = impressions;
    formatted.impressionCount = impressions;
    formatted.click_count = clicks;
    formatted.clickCount = clicks;
    formatted.ctr = ctr;
    formatted.created_by = row.created_by ?? row.createdBy ?? null;
    formatted.createdBy = row.created_by ?? row.createdBy ?? null;
    formatted.is_currently_eligible = isAdCurrentlyEligible(row);
    formatted.isCurrentlyEligible = isAdCurrentlyEligible(row);
  }

  return formatted;
}

/**
 * Deterministic 32-bit FNV-1a hash from any seed string/number
 */
function hashSeed(seedInput) {
  const str = String(seedInput ?? 'semester-library-default-seed');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 deterministic PRNG returning values in [0, 1)
 */
function createSeededRng(seedInput) {
  let a = hashSeed(seedInput) || 1;
  return function nextRandom() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffles an array using Fisher-Yates and a seeded PRNG
 */
function shuffleWithSeed(items, seedInput = 'default-seed') {
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

// Track placed advertisement IDs across cursor pagination per viewer + seed session
const paginationSeenAdsCache = new Map();
const MAX_PAGINATION_CACHE_ENTRIES = 2000;

function getPaginationSeenAds(sessionKey, isFirstPage = false) {
  if (!sessionKey) return new Set();
  if (isFirstPage) {
    paginationSeenAdsCache.delete(sessionKey);
  }
  let set = paginationSeenAdsCache.get(sessionKey);
  if (!set) {
    if (paginationSeenAdsCache.size >= MAX_PAGINATION_CACHE_ENTRIES) {
      const oldestKey = paginationSeenAdsCache.keys().next().value;
      if (oldestKey) paginationSeenAdsCache.delete(oldestKey);
    }
    set = new Set();
    paginationSeenAdsCache.set(sessionKey, set);
  }
  return set;
}

function recordPaginationSeenAds(sessionKey, placedIds = []) {
  if (!sessionKey || !Array.isArray(placedIds) || placedIds.length === 0) return;
  const set = getPaginationSeenAds(sessionKey, false);
  for (const id of placedIds) {
    const num = Number(id);
    if (Number.isInteger(num) && num > 0) set.add(num);
  }
}

/**
 * Deterministically interleaves active advertisements into organic feed items.
 *
 * Placement guarantees:
 * 1. Idempotent: strips any pre-existing advertisement items so ads are never interleaved twice.
 * 2. Never inserts an advertisement at the very top of the feed (index 0).
 * 3. Inserts an advertisement after every 2–3 organic posts (controlled by seeded PRNG).
 * 4. Never places consecutive advertisements.
 * 5. Never duplicates an advertisement within the same feed session (respects excludeAdIds & pagination state).
 * 6. Never replaces or drops any organic post.
 * 7. If there are no eligible active advertisements, returns the organic feed unchanged without gaps.
 */
function interleaveAdvertisements(organicItems, rawEligibleAds, options = {}) {
  const rawList = Array.isArray(organicItems) ? organicItems : [];
  const organic = rawList.filter(
    item => !(item && (item.feedItemType === 'advertisement' || item._feedType === 'advertisement' || item.type === 'advertisement' || item.isSponsored === true))
  );
  if (organic.length === 0) {
    return {
      feedItems: [],
      adPlacements: [],
      placedAdIds: [],
      seed: String(options.seed || 'default-seed')
    };
  }

  const seed = String(options.seed || 'default-seed');
  const now = options.now ? new Date(options.now) : new Date();
  const excludeSet = new Set(
    (Array.isArray(options.excludeAdIds) ? options.excludeAdIds : [])
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && id > 0)
  );

  if (options.paginationSessionKey) {
    const isFirstPage = Boolean(options.isFirstPage);
    const sessionSeen = getPaginationSeenAds(options.paginationSessionKey, isFirstPage);
    for (const seenId of sessionSeen) {
      excludeSet.add(seenId);
    }
  }

  // Filter to currently active & date-eligible ads, deduplicating by ID
  const seenAdIds = new Set(excludeSet);
  const eligibleAds = [];
  for (const ad of (Array.isArray(rawEligibleAds) ? rawEligibleAds : [])) {
    if (!ad) continue;
    const adId = Number(ad.id);
    if (!adId || seenAdIds.has(adId)) continue;
    if (!isAdCurrentlyEligible(ad, now)) continue;
    seenAdIds.add(adId);
    eligibleAds.push(formatAdvertisement(ad));
  }

  if (eligibleAds.length === 0) {
    return {
      feedItems: organic.map(item => (
        item && typeof item === 'object' && !item.feedItemType
          ? { ...item, feedItemType: item._feedType || 'post' }
          : item
      )),
      adPlacements: [],
      placedAdIds: [],
      seed
    };
  }

  // Shuffle eligible ads deterministically using the session seed
  const shuffledAds = shuffleWithSeed(eligibleAds, `${seed}:ads`);
  const intervalRng = createSeededRng(`${seed}:intervals`);

  const feedItems = [];
  const adPlacements = [];
  const placedAdIds = [];

  let adIndex = 0;
  let organicSinceLastAd = 0;
  // Next gap is deterministically 2 or 3 organic posts
  let nextGap = intervalRng() < 0.5 ? 2 : 3;

  for (let i = 0; i < organic.length; i++) {
    const orgItem = organic[i];
    feedItems.push(
      orgItem && typeof orgItem === 'object' && !orgItem.feedItemType
        ? { ...orgItem, feedItemType: orgItem._feedType || 'post' }
        : orgItem
    );
    organicSinceLastAd++;

    if (organicSinceLastAd >= nextGap && adIndex < shuffledAds.length) {
      const adToInsert = shuffledAds[adIndex++];
      const insertIndex = feedItems.length;
      const placedAd = {
        ...adToInsert,
        feedItemType: 'advertisement',
        _feedType: 'advertisement',
        isSponsored: true,
        placementIndex: insertIndex,
        afterOrganicCount: i + 1
      };
      feedItems.push(placedAd);
      adPlacements.push({
        advertisementId: placedAd.id,
        afterOrganicCount: i + 1,
        insertIndex,
        advertisement: placedAd
      });
      placedAdIds.push(placedAd.id);
      organicSinceLastAd = 0;
      nextGap = intervalRng() < 0.5 ? 2 : 3;
    }
  }

  if (options.paginationSessionKey && placedAdIds.length > 0) {
    recordPaginationSeenAds(options.paginationSessionKey, placedAdIds);
  }

  return {
    feedItems,
    adPlacements,
    placedAdIds,
    seed
  };
}

async function getEligibleAdvertisements(db, { now = new Date() } = {}) {
  const rows = await db.all(
    `SELECT * FROM advertisements
     WHERE is_active = 1 AND status = 'active'
     ORDER BY id DESC`
  );
  return (rows || [])
    .filter(row => isAdCurrentlyEligible(row, now))
    .map(row => formatAdvertisement(row));
}

/**
 * Generates an anonymized first-party viewer key so student identity is never exposed to advertisers.
 */
function buildPrivacySafeViewerKey(studentId, sessionKey = '') {
  const raw = `${studentId || 'anon'}::${sessionKey || 'default'}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function getImpressionWindowBucket(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return String(Math.floor(ms / IMPRESSION_DEDUPE_WINDOW_MS));
}

async function recordAdvertisementImpression(db, {
  advertisementId,
  studentId,
  sessionKey = 'default',
  now = new Date()
}) {
  const adId = Number(advertisementId);
  if (!Number.isInteger(adId) || adId <= 0) {
    const err = new Error('Invalid advertisement ID.');
    err.status = 400;
    throw err;
  }

  const ad = await db.get('SELECT id, is_active, status, impression_count FROM advertisements WHERE id = ?', adId);
  if (!ad) {
    const err = new Error('Advertisement not found.');
    err.status = 404;
    throw err;
  }

  const normSession = String(sessionKey || 'default').trim().slice(0, 128) || 'default';
  const viewerKey = buildPrivacySafeViewerKey(studentId, normSession);
  const windowBucket = getImpressionWindowBucket(now);
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();

  let inserted = false;
  if (db.isPostgres) {
    const res = await db.run(
      `INSERT INTO advertisement_impressions (advertisement_id, viewer_key, session_key, window_bucket, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (advertisement_id, viewer_key, session_key, window_bucket) DO NOTHING
       RETURNING id`,
      adId, viewerKey, normSession, windowBucket, nowIso
    );
    inserted = Boolean(res && res.changes > 0);
  } else {
    const res = await db.run(
      `INSERT OR IGNORE INTO advertisement_impressions (advertisement_id, viewer_key, session_key, window_bucket, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      adId, viewerKey, normSession, windowBucket, nowIso
    );
    inserted = Boolean(res && res.changes > 0);
  }

  if (inserted) {
    await db.run(
      `UPDATE advertisements
       SET impression_count = COALESCE(impression_count, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      adId
    );
  }

  const updated = await db.get('SELECT impression_count FROM advertisements WHERE id = ?', adId);
  return {
    recorded: inserted,
    deduplicated: !inserted,
    impression_count: Number(updated?.impression_count ?? updated?.impressionCount ?? ad.impression_count ?? 0)
  };
}

async function recordAdvertisementClick(db, {
  advertisementId,
  studentId,
  sessionKey = 'default',
  now = new Date()
}) {
  const adId = Number(advertisementId);
  if (!Number.isInteger(adId) || adId <= 0) {
    const err = new Error('Invalid advertisement ID.');
    err.status = 400;
    throw err;
  }

  const ad = await db.get('SELECT id, destination_url, click_count FROM advertisements WHERE id = ?', adId);
  if (!ad) {
    const err = new Error('Advertisement not found.');
    err.status = 404;
    throw err;
  }

  const normSession = String(sessionKey || 'default').trim().slice(0, 128) || 'default';
  const viewerKey = buildPrivacySafeViewerKey(studentId, normSession);
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();

  await db.run(
    `INSERT INTO advertisement_clicks (advertisement_id, viewer_key, session_key, created_at)
     VALUES (?, ?, ?, ?)`,
    adId, viewerKey, normSession, nowIso
  );

  await db.run(
    `UPDATE advertisements
     SET click_count = COALESCE(click_count, 0) + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    adId
  );

  const updated = await db.get('SELECT click_count, destination_url FROM advertisements WHERE id = ?', adId);
  return {
    recorded: true,
    click_count: Number(updated?.click_count ?? updated?.clickCount ?? (Number(ad.click_count || 0) + 1)),
    destination_url: updated?.destination_url ?? updated?.destinationUrl ?? ad.destination_url
  };
}

module.exports = {
  VALID_AD_MEDIA_TYPES,
  VALID_AD_STATUSES,
  DEFAULT_CTA_LABEL,
  IMPRESSION_DEDUPE_WINDOW_MS,
  ensureAdvertisementsSchema,
  isSafeDestinationUrl,
  normalizeAdStatus,
  validateAdvertisementInput,
  isAdCurrentlyEligible,
  formatAdvertisement,
  hashSeed,
  createSeededRng,
  shuffleWithSeed,
  interleaveAdvertisements,
  getEligibleAdvertisements,
  recordAdvertisementImpression,
  recordAdvertisementClick
};
