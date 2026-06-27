import fs from 'node:fs';
import path from 'node:path';
import { Client as MinioClient } from 'minio';
import { config } from './config.js';

export type StoredFile = {
  storageBackend: 'local' | 'minio';
  storedName: string;
  filePath: string;
};

export type FileCategory = 'product' | 'source';

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildObjectName(category: FileCategory, storedName: string): string {
  return `${category}/${storedName}`;
}

class LocalStorage {
  init() {
    ensureDir(config.uploadDir);
    ensureDir(config.productFileDir);
  }

  async save(category: FileCategory, storedName: string, buffer: Buffer): Promise<StoredFile> {
    const baseDir = category === 'product' ? config.productFileDir : config.uploadDir;
    const filePath = path.join(baseDir, storedName);
    fs.writeFileSync(filePath, buffer);
    return {
      storageBackend: 'local',
      storedName,
      filePath,
    };
  }

  async read(filePath: string): Promise<Buffer> {
    return fs.readFileSync(filePath);
  }

  async remove(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

class MinioStorage {
  private readonly client: MinioClient;

  constructor() {
    this.client = new MinioClient({
      endPoint: config.minioEndpoint,
      port: config.minioPort,
      useSSL: config.minioUseSSL,
      accessKey: config.minioAccessKey,
      secretKey: config.minioSecretKey,
    });
  }

  async init() {
    const exists = await this.client.bucketExists(config.minioBucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(config.minioBucket);
    }
  }

  async save(category: FileCategory, storedName: string, buffer: Buffer): Promise<StoredFile> {
    const objectName = buildObjectName(category, storedName);
    await this.client.putObject(config.minioBucket, objectName, buffer, buffer.length);
    return {
      storageBackend: 'minio',
      storedName,
      filePath: objectName,
    };
  }

  async read(filePath: string): Promise<Buffer> {
    const stream = await this.client.getObject(config.minioBucket, filePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async remove(filePath: string): Promise<void> {
    await this.client.removeObject(config.minioBucket, filePath);
  }
}

type StorageBackend = LocalStorage | MinioStorage;

class FileStorage {
  private readonly backend: StorageBackend;

  constructor() {
    this.backend = config.storageDriver === 'minio' ? new MinioStorage() : new LocalStorage();
  }

  async init() {
    await this.backend.init();
  }

  async save(category: FileCategory, storedName: string, buffer: Buffer): Promise<StoredFile> {
    return this.backend.save(category, storedName, buffer);
  }

  async read(filePath: string): Promise<Buffer> {
    return this.backend.read(filePath);
  }

  async remove(filePath: string): Promise<void> {
    return this.backend.remove(filePath);
  }
}

export const fileStorage = new FileStorage();
