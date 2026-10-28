import { AvatarState, type CustomAvatarImages } from './types';

const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_PACK_BYTES = 8 * 1024 * 1024;
const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,([a-zA-Z0-9+/]+={0,2})$/;
const states = Object.values(AvatarState);

export interface AvatarPack {
  format: 'ai-avatar-pack';
  version: 1;
  name: string;
  images: CustomAvatarImages;
}

export function validateAvatarImages(value: unknown): CustomAvatarImages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('表情包缺少 images 圖片資料。');
  const input = value as Record<string, unknown>;
  const images: CustomAvatarImages = {};
  for (const key of Object.keys(input)) {
    if (!states.includes(key as AvatarState)) throw new Error(`無法辨識表情狀態：${key}`);
    const url = input[key];
    const match = typeof url === 'string' ? IMAGE_URL.exec(url) : null;
    if (!match || match[2].length % 4 !== 0) throw new Error(`${key} 必須是內嵌的 PNG、JPG、GIF、WebP 或 SVG 圖片。`);
    let bytes: string;
    try { bytes = atob(match[2]); } catch { throw new Error(`${key} 圖片編碼無效。`); }
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${key} 圖片超過 1 MB，請縮小後重試。`);
    const kind = match[1];
    const valid = kind === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
      : kind === 'jpeg' ? bytes.startsWith('\xff\xd8\xff')
      : kind === 'gif' ? /^GIF8[79]a/.test(bytes)
      : kind === 'webp' ? bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
      : /<svg[\s>]/i.test(bytes) && !/<script|<foreignObject|<!ENTITY|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#)|url\(\s*(?!#)/i.test(bytes);
    if (!valid) throw new Error(`${key} 圖片格式無效或包含不支援的 SVG 內容。`);
    images[key as AvatarState] = url as string;
  }
  if (!Object.keys(images).length) throw new Error('表情包中沒有圖片。');
  if (JSON.stringify(images).length > MAX_PACK_BYTES) throw new Error('整組圖片超過 8 MB，請縮小圖片後重試。');
  return images;
}

export function parseAvatarPack(text: string): AvatarPack {
  if (text.length > 12 * 1024 * 1024) throw new Error('表情包檔案超過 12 MB。');
  let pack: Partial<AvatarPack>;
  try { pack = JSON.parse(text); } catch { throw new Error('無法讀取 JSON 表情包，請確認檔案格式。'); }
  if (!pack || pack.format !== 'ai-avatar-pack' || pack.version !== 1) throw new Error('不支援的表情包格式或版本。');
  return { format: 'ai-avatar-pack', version: 1, name: typeof pack.name === 'string' ? pack.name.slice(0, 100) : '自訂表情包', images: validateAvatarImages(pack.images) };
}

export function readFile(file: File, mode: 'text' | 'dataURL'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(String(reader.result));
    reader.onerror = (): void => reject(new Error(`無法讀取檔案：${file.name}`));
    if (mode === 'text') reader.readAsText(file); else reader.readAsDataURL(file);
  });
}

export async function importAvatarFiles(files: File[]): Promise<CustomAvatarImages> {
  if (!files.length) throw new Error('請先選擇圖片或表情包。');
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
    if (files[0].size > 12 * 1024 * 1024) throw new Error('表情包檔案超過 12 MB。');
    return parseAvatarPack(await readFile(files[0], 'text')).images;
  }
  if (files.length > states.length) throw new Error('一次最多選擇 12 張表情圖片。');
  const images: CustomAvatarImages = {};
  for (const file of files) {
    const state = file.name.replace(/\.[^.]+$/, '').toLowerCase() as AvatarState;
    if (!states.includes(state)) throw new Error(`無法對應 ${file.name}，請以 happy.png、sad.png 等狀態命名。`);
    if (images[state]) throw new Error(`同一表情重複選取：${state}`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} 超過 1 MB。`);
    images[state] = await readFile(file, 'dataURL');
  }
  return validateAvatarImages(images);
}
