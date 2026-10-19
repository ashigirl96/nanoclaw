import type { Image } from './store.js';

const MAX_AVATAR_BYTES = 1024 * 1024;

export class AvatarImageError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

/** Checks the bytes against what an Avatar accepts, taking the type from the bytes themselves. */
export function toAvatarImage(data: Buffer): Image {
  if (data.length > MAX_AVATAR_BYTES) throw new AvatarImageError(413, 'the image must be 1 MB or smaller');
  const mimeType = typeOf(data);
  if (!mimeType) throw new AvatarImageError(400, 'the image must be PNG, JPEG, WebP, GIF');
  return { mimeType, data };
}

function typeOf(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (data.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
