import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportAvatarImages } from '@/common/avatarImageExport';
import { importAvatarFiles } from '@/common/avatarPack';
import { AvatarState } from '@/common/types';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=';
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>default</text></svg>';

async function readEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const entries = new Map<string, Uint8Array>();
  let offset = view.getUint32(end + 16, true);
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(view.getUint16(offset + 10, true)).toBe(0);
    const nameSize = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameSize));
    const local = view.getUint32(offset + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, bytes.slice(start, start + view.getUint32(offset + 24, true)));
    offset += 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

describe('avatar image archive', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('exports all 12 PNGs byte-for-byte with state filenames and can import the extracted images', async () => {
    const custom = Object.fromEntries(Object.values(AvatarState).map(state => [state, png]));
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const archive = await exportAvatarImages(custom);
    expect(archive.type).toBe('application/zip');
    const entries = await readEntries(archive);
    expect(entries.size).toBe(12);
    expect(fetcher).not.toHaveBeenCalled();
    const raw = Uint8Array.from(atob(png.split(',')[1]), character => character.charCodeAt(0));
    for (const [name, bytes] of entries) {
      expect(name.endsWith('.png')).toBe(true); expect(bytes).toEqual(raw);
    }
    const files = Array.from(entries, ([name, bytes]) => new File([new Uint8Array(bytes).buffer], name, { type: 'image/png' }));
    expect(await importAvatarFiles(files)).toEqual(custom);
  });
  it('includes default images for missing states without changing custom image formats', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode(svg).buffer });
    vi.stubGlobal('fetch', fetcher);
    const entries = await readEntries(await exportAvatarImages({ happy: png }));
    expect(entries.size).toBe(12); expect(fetcher).toHaveBeenCalledTimes(11);
    expect(new TextDecoder().decode(entries.get('idle.svg'))).toBe(svg);
    expect(entries.has('happy.png')).toBe(true);
    expect(Array.from(entries.keys()).some(name => name.endsWith('.json'))).toBe(false);
  });
  it('exports the original 12 images when no custom pack is active', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode(svg).buffer }));
    const entries = await readEntries(await exportAvatarImages({}));
    expect(Array.from(entries.keys())).toEqual(Object.values(AvatarState).map(state => `${state}.svg`));
  });
  it('rejects a missing default image instead of downloading an incomplete archive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(exportAvatarImages({ happy: png })).rejects.toThrow('預設圖片');
    await expect(exportAvatarImages({ happy: 'https://example.test/happy.png' })).rejects.toThrow('內嵌');
  });
});
