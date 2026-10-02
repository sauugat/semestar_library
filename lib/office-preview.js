const crypto = require('crypto');
const path = require('path');

const DEFAULT_SECRET = 'gu_office_preview_sec_9938b849204018247df4382';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLOCK_TOLERANCE_MS = 30 * 1000; // 30 seconds

const OFFICE_SUPPORTED_EXTENSIONS = ['.pptx', '.ppt', '.docx', '.doc', '.xlsx', '.xls'];

const OFFICE_MIME_TYPES = {
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel'
};

function getSecret() {
  return process.env.OFFICE_PREVIEW_SECRET || process.env.SESSION_SECRET || DEFAULT_SECRET;
}

function isOfficePreviewSupported(filename) {
  if (!filename || typeof filename !== 'string') return false;
  const ext = path.extname(filename).toLowerCase();
  return OFFICE_SUPPORTED_EXTENSIONS.includes(ext);
}

function getOfficeMimeType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return OFFICE_MIME_TYPES[ext] || 'application/octet-stream';
}

function signOfficePreviewPayload(fileId, expiresAt, secret) {
  const payload = `${fileId}:${expiresAt}`;
  const key = secret || getSecret();
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function verifyOfficePreviewSignature(fileId, expiresAt, signature, secret) {
  if (!fileId || !expiresAt || !signature || typeof signature !== 'string') {
    return false;
  }
  const expected = signOfficePreviewPayload(fileId, expiresAt, secret);
  if (signature.length !== expected.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

function getPublicHost(req) {
  if (process.env.OFFICE_PREVIEW_PUBLIC_ORIGIN) {
    return process.env.OFFICE_PREVIEW_PUBLIC_ORIGIN.replace(/\/+$/, '');
  }
  if (process.env.PUBLIC_APP_URL) {
    return process.env.PUBLIC_APP_URL.replace(/\/+$/, '');
  }

  const rawHost = req?.headers ? (req.headers['x-forwarded-host'] || req.headers.host || '') : '';
  const proto = (req?.headers && req.headers['x-forwarded-proto'])
    ? req.headers['x-forwarded-proto'].split(',')[0].trim()
    : 'https';

  const hostWithoutPort = rawHost.split(':')[0].toLowerCase();
  const isPrivateOrLocal =
    !hostWithoutPort ||
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === '127.0.0.1' ||
    hostWithoutPort === '::1' ||
    hostWithoutPort.startsWith('192.168.') ||
    hostWithoutPort.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostWithoutPort);

  if (!isPrivateOrLocal && rawHost) {
    return `${proto}://${rawHost}`.replace(/\/+$/, '');
  }

  return 'https://semestar-library.vercel.app';
}

function createOfficePreviewUrl(fileId, req, ttlMs = DEFAULT_TTL_MS) {
  const expires = Date.now() + ttlMs;
  const signature = signOfficePreviewPayload(fileId, expires);
  const publicHost = getPublicHost(req);
  const previewFileUrl = `${publicHost}/api/files/${fileId}/office-public?expires=${expires}&signature=${signature}`;
  return {
    previewFileUrl,
    expiresAt: new Date(expires).toISOString(),
    expires
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  CLOCK_TOLERANCE_MS,
  OFFICE_SUPPORTED_EXTENSIONS,
  OFFICE_MIME_TYPES,
  getSecret,
  isOfficePreviewSupported,
  getOfficeMimeType,
  signOfficePreviewPayload,
  verifyOfficePreviewSignature,
  getPublicHost,
  createOfficePreviewUrl
};
