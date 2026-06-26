import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Returns top-level browseable roots for the folder picker
export async function GET() {
  const home = os.homedir();
  const roots: { name: string; path: string }[] = [];

  const candidates = [
    { name: '~  Home', path: home },
    { name: 'Desktop', path: path.join(home, 'Desktop') },
    { name: 'Documents', path: path.join(home, 'Documents') },
    { name: 'Downloads', path: path.join(home, 'Downloads') },
    { name: 'Movies', path: path.join(home, 'Movies') },
    { name: 'Videos', path: path.join(home, 'Videos') },
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c.path) && fs.statSync(c.path).isDirectory()) {
        roots.push(c);
      }
    } catch { /* skip */ }
  }

  // Also add any mounted Volumes
  try {
    const vols = fs.readdirSync('/Volumes');
    for (const v of vols) {
      const p = path.join('/Volumes', v);
      if (fs.statSync(p).isDirectory()) roots.push({ name: `📀 ${v}`, path: p });
    }
  } catch { /* not macOS or no volumes */ }

  return NextResponse.json({ roots });
}
