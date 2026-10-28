import { describe, expect, it } from 'vitest';
import { importAvatarFiles, parseAvatarPack, validateAvatarImages } from '@/common/avatarPack';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=';
const pack = (images: unknown): string => JSON.stringify({ format: 'ai-avatar-pack', version: 1, name: '測試角色', images });

describe('avatar pack import', () => {
  it('accepts a portable pack with partial states and leaves omitted states absent', () => {
    expect(parseAvatarPack(pack({ happy: png })).images).toEqual({ happy: png });
  });
  it('rejects remote URLs, invalid data, unknown states and incompatible versions', () => {
    for (const images of [{ happy: 'https://example.com/pic.png' }, { happy: 'data:image/png;base64,abcd' }, { nonexistent: png }, []]) {
      expect(() => parseAvatarPack(pack(images))).toThrow();
    }
    expect(() => parseAvatarPack('{')).toThrow('JSON');
    expect(() => parseAvatarPack('{"format":"ai-avatar-pack","version":2}')).toThrow('版本');
    expect(() => parseAvatarPack(pack({}))).toThrow('沒有圖片');
  });
  it('rejects oversized images and active SVGs', () => {
    expect(() => validateAvatarImages({ happy: `data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n' + 'a'.repeat(1024 * 1024))}` })).toThrow('1 MB');
    for (const svg of ['<svg><script>alert(1)</script></svg>', '<svg><image href="https://example.com/a.png"/></svg>', '<svg onload="alert(1)"></svg>']) {
      expect(() => validateAvatarImages({ happy: `data:image/svg+xml;base64,${btoa(svg)}` })).toThrow('SVG');
    }
  });
  it('imports multiple state-named files together and rejects duplicates without returning partial data', async () => {
    const bytes = Uint8Array.from(atob(png.split(',')[1]), character => character.charCodeAt(0));
    const file = (name: string): File => new File([bytes], name, { type: 'image/png' });
    expect(await importAvatarFiles([file('happy.png'), file('SAD.png')])).toEqual({ happy: png, sad: png });
    await expect(importAvatarFiles([file('happy.png'), file('happy.webp')])).rejects.toThrow('重複');
    await expect(importAvatarFiles([file('happy.png'), file('unknown.png')])).rejects.toThrow('無法對應');
  });
  it('imports a JSON file in one selection', async () => {
    const result = await importAvatarFiles([new File([pack({ happy: png, sad: png })], 'test.avatar-pack.json', { type: 'application/json' })]);
    expect(Object.keys(result)).toEqual(['happy', 'sad']);
  });
});
