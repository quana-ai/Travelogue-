import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../crypto/crypto.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface StoredFileInfo {
  filePath: string;
  fileHash: string;
}

/**
 * Stores AES-256-GCM encrypted bill files.
 *
 * When SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, files go to the private
 * Supabase Storage bucket (SUPABASE_BILLS_BUCKET) under "<userId>/<uuid>.enc".
 * Otherwise they are written to the local ./uploads directory (development fallback).
 * Legacy local files (keys without a "/") are still readable from ./uploads.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads');
  private readonly supabaseUrl?: string;
  private readonly supabaseKey?: string;
  private readonly bucket: string;

  constructor(
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
  ) {
    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL')?.replace(/\/+(rest\/v1\/?)?$/, '');
    this.supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = this.configService.get<string>('SUPABASE_BILLS_BUCKET') || 'bills';

    if (!this.useSupabase && process.env.NODE_ENV === 'production') {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in production.');
    }
    this.logger.log(this.useSupabase
      ? `Bill files are stored in Supabase Storage bucket "${this.bucket}".`
      : `Supabase Storage not configured; bill files are stored locally in ${this.uploadDir}.`);
  }

  private get useSupabase(): boolean {
    return Boolean(this.supabaseUrl && this.supabaseKey);
  }

  /** Encrypts the file and stores it. Returns the opaque storage key and SHA-256 of the plaintext. */
  async saveEncryptedFile(file: Express.Multer.File, ownerId: string): Promise<StoredFileInfo> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file content provided');
    }

    const fileHash = this.cryptoService.calculateSha256(file.buffer);
    const { iv, ciphertext, tag } = this.cryptoService.encryptBuffer(file.buffer);
    // Format: IV (12 bytes) + Tag (16 bytes) + Ciphertext
    const combined = Buffer.concat([iv, tag, ciphertext]);
    const opaqueName = `${crypto.randomUUID()}.enc`;

    if (this.useSupabase) {
      if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new BadRequestException('Invalid owner');
      const key = `${ownerId}/${opaqueName}`;
      const res = await this.storageRequest('POST', key, combined);
      if (!res.ok) {
        this.logger.error(`Supabase upload failed (${res.status}): ${await res.text()}`);
        throw new ServiceUnavailableException('Could not store the bill file. Please try again.');
      }
      return { filePath: key, fileHash };
    }

    await fs.promises.mkdir(this.uploadDir, { recursive: true });
    await fs.promises.writeFile(path.join(this.uploadDir, opaqueName), combined, { flag: 'wx' });
    return { filePath: opaqueName, fileHash };
  }

  /** Reads, decrypts (in memory) and verifies the integrity of a stored bill file. */
  async readDecryptedFile(filePath: string, expectedHash?: string): Promise<Buffer> {
    const combined = this.isRemoteKey(filePath)
      ? await this.readRemote(filePath)
      : await this.readLocal(filePath);

    if (combined.length < 28) {
      throw new BadRequestException('Corrupted file structure');
    }
    const decrypted = this.cryptoService.decryptBuffer(
      combined.subarray(28),
      combined.subarray(0, 12),
      combined.subarray(12, 28),
    );

    if (expectedHash && this.cryptoService.calculateSha256(decrypted) !== expectedHash) {
      throw new BadRequestException('File integrity check failed: SHA-256 mismatch');
    }
    return decrypted;
  }

  async removeFile(filePath: string): Promise<void> {
    if (this.isRemoteKey(filePath)) {
      const res = await this.storageRequest('DELETE', filePath);
      if (!res.ok && res.status !== 404) {
        this.logger.warn(`Supabase delete failed for ${filePath} (${res.status})`);
      }
      return;
    }
    await fs.promises.rm(this.localPath(filePath), { force: true });
  }

  private isRemoteKey(filePath: string): boolean {
    return filePath.includes('/');
  }

  private async readRemote(key: string): Promise<Buffer> {
    if (!this.useSupabase) throw new ServiceUnavailableException('Bill storage is not configured.');
    const res = await this.storageRequest('GET', key);
    if (res.status === 404 || res.status === 400) throw new NotFoundException('Bill file not found');
    if (!res.ok) {
      this.logger.error(`Supabase download failed (${res.status}): ${await res.text()}`);
      throw new ServiceUnavailableException('Could not load the bill file. Please try again.');
    }
    return Buffer.from(await res.arrayBuffer());
  }

  private async readLocal(filePath: string): Promise<Buffer> {
    const fullPath = this.localPath(filePath);
    if (!fs.existsSync(fullPath)) throw new NotFoundException('Bill file not found on disk');
    return fs.promises.readFile(fullPath);
  }

  private localPath(filePath: string): string {
    const fullPath = path.join(this.uploadDir, filePath);
    if (path.dirname(fullPath) !== this.uploadDir) {
      throw new BadRequestException('Invalid bill file path');
    }
    return fullPath;
  }

  private storageRequest(method: 'GET' | 'POST' | 'DELETE', key: string, body?: Buffer) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.enc$/i.test(key)) {
      throw new BadRequestException('Invalid bill file path');
    }
    const url = `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${key}`;
    return fetch(url, {
      method,
      headers: {
        apikey: this.supabaseKey!,
        Authorization: `Bearer ${this.supabaseKey}`,
        ...(body ? { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' } : {}),
      },
      body: body ? new Uint8Array(body) : undefined,
    });
  }
}
