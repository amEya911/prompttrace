import fs from 'fs';
import path from 'path';
import { TraceRecord } from './types';

export class StorageEngine {
  private dirPath: string;
  private filePath: string;
  private memoryHashMap: Map<string, number>;

  constructor() {
    const root = this.resolveRootPath();

    this.dirPath = path.join(root, '.prompttrace');
    // Changed to JSONL for append-only concurrent safety
    this.filePath = path.join(this.dirPath, 'traces.jsonl');
    this.memoryHashMap = new Map();

    this.initialize();
  }

  /**
   * Walk up directories until we find project root (package.json)
   */
  private resolveRootPath(): string {
    let currentDir = process.cwd();

    while (true) {
      const possible = path.join(currentDir, 'package.json');

      if (fs.existsSync(possible)) {
        return currentDir;
      }

      const parent = path.dirname(currentDir);

      // reached filesystem root → fallback
      if (parent === currentDir) {
        console.warn('[Prompttrace] Could not find project root, using cwd');
        return process.cwd();
      }

      currentDir = parent;
    }
  }

  private initialize() {
    try {
      if (!fs.existsSync(this.dirPath)) {
        fs.mkdirSync(this.dirPath, { recursive: true });
      }

      if (!fs.existsSync(this.filePath)) {
        // Create empty jsonl file
        fs.writeFileSync(this.filePath, '');
      } else {
        // Note: For O(1) performance and scaling, we NO LONGER parse the entire file into memory 
        // to populate the memoryHashMap. It now operates as a runtime-only fast cache.
      }
    } catch (err) {
      console.error('[Prompttrace] Failed to initialize storage:', err);
    }
  }

  public saveTrace(trace: TraceRecord) {
    try {
      // Append-only JSONL format guarantees no corruption during concurrent TS/Python writes
      const line = JSON.stringify(trace) + '\n';
      fs.appendFileSync(this.filePath, line);

      // 🔥 Important: helps chokidar detect changes more reliably
      fs.utimesSync(this.filePath, new Date(), new Date());
    } catch (err) {
      console.error('[Prompttrace] Failed to save trace:', err);
    }
  }

  public registerAndGetHitCount(hash: string): number {
    const hits = this.memoryHashMap.get(hash) || 0;
    this.memoryHashMap.set(hash, hits + 1);
    return hits;
  }
}