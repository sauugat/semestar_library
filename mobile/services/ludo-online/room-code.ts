/**
 * Room code utilities for Online Ludo.
 *
 * Charset: 31 characters, excluding confusing pairs (0, O, 1, I, L).
 * Length: 6 characters.
 * Entropy: 31^6 = 887,503,681 combinations.
 */

export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_REGEX = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export type RandomByteProvider = (count: number) => Uint8Array;

/**
 * Generates a short, human-friendly 6-character room code.
 * Uses cryptographically secure randomness by default, or an injectable provider for tests.
 */
export function generateRoomCode(randomBytesProvider?: RandomByteProvider): string {
  const chars = ROOM_CODE_ALPHABET;
  const len = ROOM_CODE_LENGTH;
  let code = '';

  if (randomBytesProvider) {
    const bytes = randomBytesProvider(len);
    for (let i = 0; i < len; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(len);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < len; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  for (let i = 0; i < len; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}

/**
 * Normalizes user input for room codes: trims whitespace and converts to uppercase.
 */
export function normalizeRoomCode(input: string): string {
  if (typeof input !== 'string') return '';
  return input.trim().toUpperCase();
}

/**
 * Validates whether a room code strictly conforms to the expected format.
 */
export function isValidRoomCode(input: string): boolean {
  if (typeof input !== 'string') return false;
  const normalized = normalizeRoomCode(input);
  return ROOM_CODE_REGEX.test(normalized);
}
