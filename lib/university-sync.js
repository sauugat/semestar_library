'use strict';

const { asKnowledgeDb } = require('./knowledge-db');
const { buildGUKnowledge } = require('./knowledge-builder');
const { persistKnowledgeResource } = require('./knowledge-sync');
const { isKnowledgeIndexingEnabled } = require('./knowledge-schema');

const GU_API_BASE = 'https://www.gandakiuniversity.edu.np/wp-json/wp/v2';
const GU_FETCH_TIMEOUT_MS = Number(process.env.GU_SYNC_TIMEOUT_MS) || 6000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Kyana-Knowledge-Bot/3.0; +https://semestar-library.vercel.app)';

/**
 * Strips HTML tags and normalizes whitespace safely.
 */
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/&#8211;/g, '-')
    .replace(/&#8217;/g, "'")
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Approved official university endpoints.
 * Strict whitelist to prevent indexing unrelated pages or systems.
 */
const APPROVED_OFFICIAL_FEEDS = [
  {
    type: 'pdfposter',
    endpoint: `${GU_API_BASE}/pdfposter?per_page=15&_fields=id,date,modified,slug,title,link,content`,
    label: 'Official Notices & Results'
  },
  {
    type: 'page',
    endpoint: `${GU_API_BASE}/pages?slug=gandaki-university-academic-calendar&_fields=id,date,modified,slug,title,link,content`,
    label: 'Academic Calendar'
  }
];

/**
 * Fetches items from an approved official endpoint with timeout and headers.
 */
async function fetchOfficialFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GU_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(feed.endpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${feed.label}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data ? [data] : []);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalizes raw WordPress post/poster into a canonical GU knowledge record.
 */
function normalizeGUIItem(raw, type = 'notice') {
  if (!raw || !raw.id) return null;

  const rawTitle = raw.title?.rendered || raw.title || 'Official Notice';
  const cleanTitle = stripHtml(rawTitle);
  const rawContent = raw.content?.rendered || raw.content || '';
  const cleanContent = stripHtml(rawContent);

  // Extract any embedded PDF document link
  const pdfMatch = String(rawContent).match(/https?:\/\/[^\s\"']+\.pdf/i);
  const pdfUrl = pdfMatch ? pdfMatch[0] : null;

  return {
    id: raw.id,
    type: type,
    title: cleanTitle,
    link: raw.link || `https://www.gandakiuniversity.edu.np/?p=${raw.id}`,
    date: raw.date || new Date().toISOString(),
    modified: raw.modified || raw.date,
    content: cleanContent || (pdfUrl ? `Official PDF Attachment: ${pdfUrl}` : cleanTitle),
    pdf_url: pdfUrl
  };
}

/**
 * Synchronizes approved public Gandaki University information into unified knowledge index.
 * Fails safely and non-destructively on network error.
 *
 * @param {object} db Database adapter
 * @param {object} [options]
 * @returns {Promise<{ scanned: number, indexed: number, skipped: number, failed: number, errors: string[] }>}
 */
async function syncGandakiUniversityNotices(db, options = {}) {
  db = asKnowledgeDb(db);
  const isPg = Boolean(db.isPostgres || (db.query && !db.all));

  const stats = {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  if (!isKnowledgeIndexingEnabled()) {
    return { ...stats, status: 'disabled_by_feature_flag' };
  }

  const rawItems = [];

  for (const feed of APPROVED_OFFICIAL_FEEDS) {
    try {
      const items = await fetchOfficialFeed(feed);
      for (const item of items) {
        const norm = normalizeGUIItem(item, feed.type);
        if (norm) rawItems.push(norm);
      }
    } catch (err) {
      stats.failed++;
      stats.errors.push(`[${feed.label}] ${err.message}`);
      console.warn(`[GU University Sync Warning] Failed to fetch ${feed.label}:`, err.message);
    }
  }

  stats.scanned = rawItems.length;

  for (const item of rawItems) {
    try {
      const built = buildGUKnowledge(item);

      // Check existing hash to skip redundant embedding
      let existing = null;
      if (isPg) {
        const exRes = await db.query('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = $1', [built.resource.id]);
        existing = exRes.rows[0];
      } else {
        existing = await db.get('SELECT content_hash, deleted_at FROM knowledge_resources WHERE id = ?', built.resource.id);
      }

      if (existing && existing.content_hash === built.resource.content_hash && !existing.deleted_at) {
        stats.skipped++;
        continue;
      }

      await persistKnowledgeResource(db, built, options);
      stats.indexed++;
    } catch (err) {
      stats.failed++;
      stats.errors.push(`[Item ${item.id}] ${err.message}`);
      console.warn(`[GU University Sync] Failed to persist GU notice ${item.id}:`, err.message);
    }
  }

  return stats;
}

module.exports = {
  stripHtml,
  normalizeGUIItem,
  syncGandakiUniversityNotices,
  APPROVED_OFFICIAL_FEEDS
};
