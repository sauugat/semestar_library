import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { normalizeUploadFile, RawFileAsset, validateFileSize } from '@/utils/file-upload';
import { getBaseUrl, isLocalAddress } from './api';
import { CHAT_MAX_FILE_SIZE } from './chat';
import { safeChatFilename } from './chat-state';

// Vercel serverless functions enforce a 4.5 MB HTTP payload ceiling.
// Keep images well under 3.8 MB and validate remote non-image attachments at 4.2 MB.
const MAX_IMAGE_DIMENSION = 1600;
const TARGET_IMAGE_BYTES = 3.8 * 1024 * 1024;
const REMOTE_SERVER_MAX_BYTES = 4.2 * 1024 * 1024;

export interface ChatAttachmentAsset extends RawFileAsset {
  width?: number | null;
  height?: number | null;
}

export async function prepareChatAttachment(asset: ChatAttachmentAsset, photo = false) {
  let file = normalizeUploadFile(asset);
  const isImg = photo || /image\/(heic|heif)/i.test(file.type) || file.type.startsWith('image');

  if (isImg) {
    try {
      const actions: Array<{ resize: { width?: number; height?: number } }> = [];
      const w = typeof asset.width === 'number' ? asset.width : 0;
      const h = typeof asset.height === 'number' ? asset.height : 0;
      if (w > MAX_IMAGE_DIMENSION && w >= h) {
        actions.push({ resize: { width: MAX_IMAGE_DIMENSION } });
      } else if (h > MAX_IMAGE_DIMENSION && h > w) {
        actions.push({ resize: { height: MAX_IMAGE_DIMENSION } });
      } else if (!w && !h) {
        // Unknown dimensions (e.g. picked image file from document picker): cap width safely
        actions.push({ resize: { width: MAX_IMAGE_DIMENSION } });
      }

      // Convert to standard compressed JPEG bytes for universal rendering and fast upload
      const result = await manipulateAsync(
        asset.uri,
        actions,
        { format: SaveFormat.JPEG, compress: 0.78 }
      );
      if (result && result.uri) {
        file = {
          uri: result.uri,
          name: `${file.name.replace(/\.[^.]+$/, '')}.jpg`,
          type: 'image/jpeg',
          size: file.size,
        };
      }
    } catch (manipErr) {
      console.warn('[prepareChatAttachment] Image compression fallback to original asset:', manipErr);
    }
  }

  let size = file.size;
  try {
    const info = await FileSystem.getInfoAsync(file.uri);
    if (info.exists && 'size' in info && typeof info.size === 'number') {
      size = info.size;
    }
  } catch (fsErr) {
    console.warn('[prepareChatAttachment] File info inspection warning:', fsErr);
  }

  // Second-pass compression if an image is still close to the serverless upload ceiling
  if (isImg && typeof size === 'number' && size > TARGET_IMAGE_BYTES) {
    try {
      const smaller = await manipulateAsync(
        file.uri,
        [{ resize: { width: 1200 } }],
        { format: SaveFormat.JPEG, compress: 0.6 }
      );
      if (smaller && smaller.uri) {
        file = { ...file, uri: smaller.uri, type: 'image/jpeg' };
        const info = await FileSystem.getInfoAsync(smaller.uri);
        if (info.exists && 'size' in info && typeof info.size === 'number') {
          size = info.size;
        }
      }
    } catch {}
  }

  let maxAllowedBytes = CHAT_MAX_FILE_SIZE;
  try {
    const baseUrl = await getBaseUrl();
    if (!isLocalAddress(baseUrl)) {
      maxAllowedBytes = Math.min(CHAT_MAX_FILE_SIZE, REMOTE_SERVER_MAX_BYTES);
    }
  } catch {}

  validateFileSize(size, maxAllowedBytes, isImg ? 'Photo' : 'File');

  let outboxUri = file.uri;
  try {
    const directory = `${FileSystem.documentDirectory}chat-outbox/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    outboxUri = `${directory}${Date.now()}-${Math.random().toString(36).slice(2)}-${safeChatFilename(file.name)}`;
    await FileSystem.copyAsync({ from: file.uri, to: outboxUri });
  } catch (copyErr) {
    console.warn('[prepareChatAttachment] Outbox copy warning, using asset URI:', copyErr);
    outboxUri = file.uri;
  }

  return {
    uri: outboxUri,
    name: file.name,
    mimeType: file.type,
    size,
    isImage: (file.type || '').startsWith('image') || file.type === 'image',
  };
}

export async function removeOutboxFile(uri?: string) {
  if (uri?.startsWith(`${FileSystem.documentDirectory}chat-outbox/`)) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
