import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Dynamically traverse upwards to find .prompttrace folder, ensuring consumers running out of sub-directories still attach.
    let rootDir = process.env.PROMPTTRACE_DIR;
    
    if (!rootDir) {
      let currentDir = process.cwd();
      while (true) {
        let possible = path.join(currentDir, '.prompttrace');
        if (fs.existsSync(possible)) {
          rootDir = possible;
          break;
        }
        const parent = path.dirname(currentDir);
        if (parent === currentDir) {
           rootDir = path.join(process.cwd(), '.prompttrace'); // Ultimate Fallback
           break;
        }
        currentDir = parent;
      }
    }

    const tracesFile = path.join(rootDir, 'traces.jsonl');

    if (!fs.existsSync(tracesFile)) {
      return NextResponse.json({ traces: [] });
    }

    const stats = fs.statSync(tracesFile);
    if (stats.size === 0) {
      return NextResponse.json({ traces: [] });
    }

    // Read the file from the end to quickly collect the last 50 traces.
    // Instead of fs.readFileSync (which would load gigabytes into memory), we read backwards in chunks.
    const CHUNK_SIZE = 65536; // 64KB per read
    const fd = fs.openSync(tracesFile, 'r');

    let traces: any[] = [];
    let remainder = '';
    let position = stats.size;
    const MAX_TRACES = 50;

    // Stream chunks backwards until we have 50 items or hit the beginning of the file
    while (position > 0 && traces.length < MAX_TRACES) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;

      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, position);

      const chunk = buffer.toString('utf-8') + remainder;
      const lines = chunk.split('\n');

      // The first element might be an incomplete line if it's not the start of the file
      remainder = position > 0 ? lines.shift() || '' : '';

      // Parse from end of chunk to start of chunk (newest first)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const trace = JSON.parse(line);
          traces.push(trace);
          if (traces.length >= MAX_TRACES) break;
        } catch (e) {
          // ignore malformed JSON line
        }
      }
    }

    fs.closeSync(fd);

    // Ensure strict newest -> oldest sorting
    traces.sort((a: any, b: any) => b.timestamp - a.timestamp);

    return NextResponse.json({ traces });
  } catch (error) {
    console.error('Failed to read traces:', error);
    return NextResponse.json({ error: 'Failed to read traces' }, { status: 500 });
  }
}
