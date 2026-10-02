import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.publicBaseUrl}/${key}`;
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
