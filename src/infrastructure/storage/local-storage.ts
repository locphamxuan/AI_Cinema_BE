import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import { assertSafeKey, ObjectStorage, type Visibility } from './object-storage';

/** Development driver: files under STORAGE_LOCAL_ROOT/<visibility>/; the public folder is served on /media. */
export class LocalObjectStorage extends ObjectStorage {
  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string,
  ) {
    super();
  }

  /** Folder the API serves statically (only public objects). */
  get publicRoot(): string {
    return path.resolve(this.root, 'public');
  }

  async putBuffer(key: string, body: Buffer, _contentType: string, visibility: Visibility): Promise<void> {
    const target = await this.prepare(key, visibility);
    await writeFile(target, body);
  }

  async putFile(key: string, localPath: string, _contentType: string, visibility: Visibility): Promise<void> {
    const target = await this.prepare(key, visibility);
    await copyFile(localPath, target);
  }

  async read(key: string, visibility: Visibility): Promise<Buffer> {
    return readFile(this.pathOf(key, visibility));
  }

  async stream(key: string, visibility: Visibility): Promise<Readable> {
    const file = this.pathOf(key, visibility);
    await access(file);
    return createReadStream(file);
  }

  async remove(key: string, visibility: Visibility): Promise<void> {
    await rm(this.pathOf(key, visibility), { force: true });
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.publicBaseUrl}/${key}`;
  }

  /** Local disk has no signed URLs: the studio uploads through the API instead. */
  presignPut(): Promise<null> {
    return Promise.resolve(null);
  }

  async stat(key: string, visibility: Visibility): Promise<{ size: number } | null> {
    const found = await stat(this.pathOf(key, visibility)).catch(() => null);
    return found ? { size: found.size } : null;
  }

  async readHead(key: string, visibility: Visibility, bytes: number): Promise<Buffer> {
    const file = await open(this.pathOf(key, visibility), 'r');
    try {
      const head = Buffer.alloc(bytes);
      const { bytesRead } = await file.read(head, 0, bytes, 0);
      return head.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  }

  async move(fromKey: string, toKey: string, visibility: Visibility): Promise<void> {
    const target = await this.prepare(toKey, visibility);
    await rename(this.pathOf(fromKey, visibility), target);
  }

  private pathOf(key: string, visibility: Visibility): string {
    assertSafeKey(key);
    return path.resolve(this.root, visibility, key);
  }

  private async prepare(key: string, visibility: Visibility): Promise<string> {
    const target = this.pathOf(key, visibility);
    await mkdir(path.dirname(target), { recursive: true });
    return target;
  }
}
