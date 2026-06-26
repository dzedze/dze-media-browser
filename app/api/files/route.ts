import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ALLOWED_EXTENSIONS = ['.mp4', '.srt', '.txt', '.url'];

export async function GET(request: NextRequest) {
  // Use request.nextUrl which is already parsed and decoded by Next.js
  const rawPath = request.nextUrl.searchParams.get('path') || '';
  const action  = request.nextUrl.searchParams.get('action') || 'list';

  if (action === 'read') {
    try {
      if (!fs.existsSync(rawPath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      const content = fs.readFileSync(rawPath, 'utf-8');
      return NextResponse.json({ content });
    } catch (e: unknown) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  if (!rawPath) {
    return NextResponse.json({ error: 'No path provided' }, { status: 400 });
  }

  try {
    const stat = fs.lstatSync(rawPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Not a directory' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Directory not found or inaccessible' }, { status: 404 });
  }

  let names: string[] = [];
  try {
    names = fs.readdirSync(rawPath);
  } catch {
    return NextResponse.json({ error: 'Cannot read directory' }, { status: 403 });
  }

  const result: Array<{ name: string; type: 'dir' | 'file'; ext: string; path: string }> = [];

  for (const name of names) {
    // Skip hidden files and macOS metadata
    if (name.startsWith('.')) continue;

    const fullPath = path.join(rawPath, name);
    try {
      const entryStat = fs.lstatSync(fullPath); // lstat: don't follow symlinks
      if (entryStat.isDirectory()) {
        result.push({ name, type: 'dir', ext: '', path: fullPath });
      } else if (entryStat.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (ALLOWED_EXTENSIONS.includes(ext)) {
          result.push({ name, type: 'file', ext, path: fullPath });
        }
      }
      // symlinks and other special files are silently skipped
    } catch {
      // skip inaccessible entries
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  return NextResponse.json({ entries: result, currentPath: rawPath });
}
