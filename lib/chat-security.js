'use strict';
const REFUSAL = 'I can help with university resources, but I can’t disclose or invent private credentials, internal instructions, or another person’s private information.';
function sensitiveRequest(text) {
  const t = String(text || '').normalize('NFKC').toLowerCase();
  const request = /\b(show|reveal|print|repeat|give|tell|dump|extract|expose|output|what\s+is|what's|whats|deu|dekha|bhan|send|share|leak|provide)\b|देखा|देऊ|बताऊ/.test(t);
  const secret = /\b(system prompt|hidden instructions|developer prompt|environment variables?|database_url|api[ _-]?keys?|access[ _-]?tokens?|session[ _-]?tokens?|admin(?:istrator)?\s+(?:password|credentials|login)|database\s+(?:password|credentials)|private\s+(?:messages|information|records)|student\s+passwords?|password\s+hashes|confidential\s+(?:exam|questions?)|exam\s+(?:leak|questions?\s+leak)|unpublished\s+(?:exam|questions?))\b|पासवर्ड|गोप्य/.test(t);
  const override = /\b(ignore|disregard|bypass|override|forget)\s+(?:all\s+)?(?:previous|prior|above|system|safety|security)\s+(?:instructions|rules|prompts|guidelines)\b/.test(t);
  return (request && secret) || override;
}
function unsafeOutput(text) {
  const t = String(text || '');
  for (const [name, value] of Object.entries(process.env)) {
    if (/(?:KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)$/.test(name) && value?.length >= 12 && t.includes(value)) return true;
  }
  return /\b(?:admin(?:istrator)?\s*(?:password|credentials?)|(?:GEMINI|OPENROUTER|GOOGLE)_API_KEY|INTERNAL_CRON_SECRET)\s*(?:is\s+|[:=]\s*)[`"']?[^\s`"']{4,}/i.test(t);
}
function contextKey(context) {
  const { createHash } = require('crypto');
  return createHash('sha256').update(JSON.stringify([context?.authenticated === true, context?.role,
    context?.studentId, context?.cohort?.id || context?.cohortId, context?.cohort?.currentSemester || context?.currentSemester || context?.semester,
    [...(context?.assignedSemesters || [])].sort()])).digest('hex');
}
module.exports = { REFUSAL, sensitiveRequest, unsafeOutput, contextKey };
