/**
 * File upload helper for React Native / Expo.
 * Normalizes file objects for multipart/form-data requests across iOS and Android.
 */

export interface RawFileAsset {
  uri: string;
  name?: string | null;
  fileName?: string | null;
  type?: string | null;
  mimeType?: string | null;
  size?: number | null;
  fileSize?: number | null;
}

export interface NormalizedUploadFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.jpg', // Normalizing HEIC to JPG
  'image/heif': '.jpg',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};

/**
 * Normalizes an asset picked from expo-image-picker or expo-document-picker
 * into a safe, valid multipart file payload for the backend.
 */
export function normalizeUploadFile(asset: RawFileAsset, defaultFallbackName = 'upload'): NormalizedUploadFile {
  let uri = asset.uri || '';

  // Extract raw name
  let rawName = asset.name || asset.fileName || '';
  if (!rawName) {
    const uriParts = uri.split('/');
    rawName = uriParts[uriParts.length - 1] || defaultFallbackName;
  }
  // Strip any query strings from URI or name
  rawName = rawName.split('?')[0];

  let mime = (asset.mimeType || asset.type || '').toLowerCase();

  // Extract extension
  const extMatch = /\.[0-9a-z]+$/i.exec(rawName);
  let ext = extMatch ? extMatch[0].toLowerCase() : '';

  // Normalize HEIC / HEIF to JPEG (standard for iOS photo exports)
  if (ext === '.heic' || ext === '.heif' || mime === 'image/heic' || mime === 'image/heif') {
    ext = '.jpg';
    mime = 'image/jpeg';
    rawName = rawName.replace(/\.(heic|heif)$/i, '.jpg');
  }

  // If filename lacks extension, derive from MIME
  if (!ext && mime && MIME_TO_EXT[mime]) {
    ext = MIME_TO_EXT[mime];
    rawName = `${rawName}${ext}`;
  }

  // If MIME is missing or generic octet-stream, derive from extension
  if ((!mime || mime === 'application/octet-stream') && ext && EXT_TO_MIME[ext]) {
    mime = EXT_TO_MIME[ext];
  }

  // Fallbacks if still undetermined
  if (!ext) {
    if (mime.startsWith('image/')) {
      ext = '.jpg';
      rawName = `${rawName}.jpg`;
      mime = mime || 'image/jpeg';
    } else {
      ext = '.pdf';
      rawName = `${rawName}.pdf`;
      mime = mime || 'application/pdf';
    }
  }
  if (!mime) {
    mime = EXT_TO_MIME[ext] || 'application/octet-stream';
  }

  const size = asset.size || asset.fileSize || undefined;

  return {
    uri,
    name: rawName,
    type: mime,
    size: typeof size === 'number' ? size : undefined,
  };
}

/**
 * Helper to validate file size before attempting upload.
 */
export function validateFileSize(sizeBytes: number | undefined, maxBytes: number, label = 'File'): void {
  if (sizeBytes && sizeBytes > maxBytes) {
    const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw new Error(`${label} is too large (${mb} MB). Maximum allowed size is ${maxMb} MB.`);
  }
}
