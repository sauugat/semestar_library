import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { normalizeUploadFile, RawFileAsset, validateFileSize } from '@/utils/file-upload';
import { CHAT_MAX_FILE_SIZE } from './chat';
import { safeChatFilename } from './chat-state';

export async function prepareChatAttachment(asset: RawFileAsset, photo = false) {
  let file = normalizeUploadFile(asset);
  if (photo || /image\/(heic|heif)/i.test(file.type) || file.type.startsWith('image')) {
    try {
      // Convert to standard compressed JPEG bytes for universal rendering across platforms
      const result = await manipulateAsync(
        asset.uri,
        [],
        { format: SaveFormat.JPEG, compress: 0.85 }
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

  validateFileSize(size, CHAT_MAX_FILE_SIZE, photo ? 'Photo' : 'Attachment');

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
