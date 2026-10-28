import { AVATAR_IMAGES } from './constants';
import { validateAvatarImages } from './avatarPack';
import { AvatarState, type CustomAvatarImages } from './types';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP32 with stored entries: preserve image bytes, including transparency and animation. */
function imageArchive(files: { name: string; bytes: Uint8Array }[]): Blob {
  const entries: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true);
    header.setUint16(12, 33, true); // 1980-01-01, valid DOS date.
    header.setUint32(14, crc, true);
    header.setUint32(18, file.bytes.length, true); header.setUint32(22, file.bytes.length, true);
    header.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true); record.setUint16(4, 20, true); record.setUint16(6, 20, true);
    record.setUint16(14, 33, true); record.setUint32(16, crc, true);
    record.setUint32(20, file.bytes.length, true); record.setUint32(24, file.bytes.length, true);
    record.setUint16(28, name.length, true); record.setUint32(42, offset, true); central.set(name, 46);
    entries.push(local, file.bytes); directory.push(central);
    offset += local.length + file.bytes.length;
  }
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true); footer.setUint16(10, files.length, true);
  footer.setUint32(12, directory.reduce((size, entry) => size + entry.length, 0), true);
  footer.setUint32(16, offset, true);
  return new Blob([...entries, ...directory, end].map(part => new Uint8Array(part).buffer), { type: 'application/zip' });
}

export async function exportAvatarImages(custom: CustomAvatarImages): Promise<Blob> {
  const images = Object.keys(custom).length ? validateAvatarImages(custom) : {};
  const files = await Promise.all(Object.values(AvatarState).map(async state => {
    const image = images[state];
    if (image) {
      const mime = image.slice(11, image.indexOf(';'));
      const extension = mime === 'svg+xml' ? 'svg' : mime === 'jpeg' ? 'jpg' : mime;
      const bytes = Uint8Array.from(atob(image.slice(image.indexOf(',') + 1)), character => character.charCodeAt(0));
      return { name: `${state}.${extension}`, bytes };
    }
    const path = AVATAR_IMAGES[state];
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) throw new Error(`無法讀取 ${state} 預設圖片，請重新載入擴充功能後重試。`);
    return { name: `${state}.${path.split('.').pop()}`, bytes: new Uint8Array(await response.arrayBuffer()) };
  }));
  return imageArchive(files);
}
