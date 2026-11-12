#!/usr/bin/env node
'use strict';

/**
 * Document Pipeline Preflight Check (Phase D2-S)
 * Reads ONLY process.env (never loads .env, connects to DB, or makes network requests).
 * Reports yes/no set status without ever printing secret values, and states what each missing var disables.
 */

const PREFLIGHT_VARS = [
  {
    name: 'DATABASE_URL',
    disables: 'Postgres connection — worker CLI and reconciliation cannot read or write ingestion_jobs / document_pages'
  },
  {
    name: 'GEMINI_API_KEY',
    disables: 'Gemini Vision OCR for scanned/math/table/figure pages and Gemini text embeddings in knowledge_jobs'
  },
  {
    name: 'DOC_VISION_MODEL',
    disables: 'Gemini Vision OCR extraction (pages needing Vision fail non-transiently with VISION_MODEL_UNCONFIGURED)'
  },
  {
    name: 'KYANA_KNOWLEDGE_V3',
    disables: 'Unified knowledge indexing & in-process knowledge_jobs draining when not set to "true"'
  },
  {
    name: 'KYANA_KNOWLEDGE_V3_USERS',
    disables: 'isKnowledgeIndexingEnabled() (must also be non-empty alongside KYANA_KNOWLEDGE_V3=true or knowledge drain skips)'
  },
  {
    name: 'SUPABASE_URL',
    disables: 'Fallback download of files stored in external Supabase Storage buckets (file_blobs/local still work)'
  },
  {
    name: 'INTERNAL_CRON_SECRET',
    disables: 'Authenticated scheduled calls to /api/internal/knowledge/reconcile'
  },
  {
    name: 'GITHUB_DISPATCH_TOKEN',
    disables: 'Immediate upload-triggered workflow_dispatch (uploads still succeed; worker falls back to hourly cron)'
  },
  {
    name: 'GITHUB_DISPATCH_REPO',
    disables: 'Target owner/repo slug for upload-triggered workflow_dispatch when GITHUB_REPOSITORY is also unset'
  }
];

function evaluatePreflight(env = process.env) {
  return PREFLIGHT_VARS.map(spec => {
    const raw = env?.[spec.name];
    const isSet = typeof raw === 'string' ? raw.trim().length > 0 : Boolean(raw);
    const active = spec.name === 'KYANA_KNOWLEDGE_V3' ? String(raw || '').trim() === 'true' : isSet;
    return {
      name: spec.name,
      set: isSet ? 'yes' : 'no',
      active,
      disablesWhenMissing: spec.disables
    };
  });
}

function formatPreflightReport(entries = evaluatePreflight()) {
  const lines = ['Document Ingestion Preflight (process.env only):', ''];
  for (const item of entries) {
    lines.push(`- ${item.name}: set=${item.set} | if missing disables: ${item.disablesWhenMissing}`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  console.log(formatPreflightReport(evaluatePreflight(process.env)));
}

module.exports = {
  PREFLIGHT_VARS,
  evaluatePreflight,
  formatPreflightReport
};

