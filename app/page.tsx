'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  ext: string;
  path: string;
}

interface ModalState {
  type: 'video' | 'txt' | null;
  path: string;
  name: string;
}

// ── SRT parser ──────────────────────────────────────────────────────────────
function parseSRT(srt: string) {
  const normalized = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalized.split(/\n{2,}/);
  const SRT_TS = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/;
  const toSec = (h: string, m: string, sc: string, ms: string) =>
    +h * 3600 + +m * 60 + +sc + +ms / 1000;
  return blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) return null;
    const match = lines[timeIdx].match(SRT_TS);
    if (!match) return null;
    const text = lines.slice(timeIdx + 1).join('\n').trim();
    if (!text) return null;
    return {
      start: toSec(match[1], match[2], match[3], match[4]),
      end:   toSec(match[5], match[6], match[7], match[8]),
      text,
    };
  }).filter(Boolean) as { start: number; end: number; text: string }[];
}

// Convert parsed cues to a WebVTT blob URL the <track> element can use
function cuestoVTT(cues: { start: number; end: number; text: string }[]): string {
  const pad = (n: number, z = 2) => String(Math.floor(n)).padStart(z, '0');
  const ts = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s % 1) * 1000);
    return pad(h) + ':' + pad(m) + ':' + pad(sec) + '.' + pad(ms, 3);
  };
  const body = cues.map(c => ts(c.start) + ' --> ' + ts(c.end) + '\n' + c.text).join('\n\n');
  const blob = new Blob(['WEBVTT\n\n' + body], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

function FileIcon({ ext, type }: { ext: string; type: 'dir' | 'file' }) {
  if (type === 'dir') return <span className="fi">📁</span>;
  if (ext === '.mp4') return <span className="fi">🎬</span>;
  if (ext === '.txt') return <span className="fi">📄</span>;
  if (ext === '.url') return <span className="fi">🔗</span>;
  return <span className="fi">📎</span>;
}

// ── Folder Picker Panel ──────────────────────────────────────────────────────
function FolderPicker({ onSelect, onClose }: { onSelect: (p: string) => void; onClose: () => void }) {
  const [pickerPath, setPickerPath] = useState('');
  const [pickerStack, setPickerStack] = useState<{ name: string; path: string }[]>([]);
  const [pickerDirs, setPickerDirs] = useState<{ name: string; path: string }[]>([]);
  const [pickerLoading, setPickerLoading] = useState(true);
  const [manualInput, setManualInput] = useState('');

  // Load roots on mount
  useEffect(() => {
    fetch('/api/resolve-path')
      .then(r => r.json())
      .then(data => {
        setPickerDirs(data.roots || []);
        setPickerLoading(false);
      });
  }, []);

  const browseInto = async (name: string, p: string) => {
    setPickerLoading(true);
    setPickerPath(p);
    setPickerStack(prev => [...prev, { name, path: p }]);
    const res = await fetch('/api/files?path=' + encodeURIComponent(p));
    const data = await res.json();
    const dirs = (data.entries || [])
      .filter((e: FileEntry) => e.type === 'dir')
      .map((e: FileEntry) => ({ name: e.name, path: e.path }));
    setPickerDirs(dirs);
    setPickerLoading(false);
  };

  const pickerBack = async () => {
    if (pickerStack.length <= 1) {
      // Back to roots
      setPickerStack([]);
      setPickerPath('');
      setPickerLoading(true);
      const data = await fetch('/api/resolve-path').then(r => r.json());
      setPickerDirs(data.roots || []);
      setPickerLoading(false);
      return;
    }
    const newStack = pickerStack.slice(0, -1);
    setPickerStack(newStack);
    const parent = newStack[newStack.length - 1];
    setPickerLoading(true);
    setPickerPath(parent.path);
    const res = await fetch('/api/files?path=' + encodeURIComponent(parent.path));
    const data = await res.json();
    const dirs = (data.entries || [])
      .filter((e: FileEntry) => e.type === 'dir')
      .map((e: FileEntry) => ({ name: e.name, path: e.path }));
    setPickerDirs(dirs);
    setPickerLoading(false);
  };

  return (
    <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker-panel">
        <div className="picker-header">
          <span className="picker-title">Select Folder</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Breadcrumb */}
        <div className="picker-crumbs">
          <span className="pcrumb" onClick={() => { setPickerStack([]); setPickerPath(''); setPickerLoading(true); fetch('/api/resolve-path').then(r=>r.json()).then(d=>{setPickerDirs(d.roots||[]);setPickerLoading(false);}); }}>
            Locations
          </span>
          {pickerStack.map((c, i) => (
            <span key={i} style={{display:'flex',alignItems:'center',gap:'2px'}}>
              <span className="pcrumb-sep">/</span>
              <span className="pcrumb active">{c.name}</span>
            </span>
          ))}
        </div>

        {/* Current path as "Open this folder" target */}
        {pickerPath && (
          <div className="picker-open-row">
            <span className="picker-open-path">{pickerPath}</span>
            <button className="btn" onClick={() => onSelect(pickerPath)}>Open This Folder</button>
          </div>
        )}

        {/* Subfolder list */}
        <div className="picker-list">
          {pickerStack.length > 0 && (
            <div className="picker-item picker-back" onClick={pickerBack}>
              <span>← Back</span>
            </div>
          )}
          {pickerLoading && <div className="picker-loading">Loading…</div>}
          {!pickerLoading && pickerDirs.length === 0 && (
            <div className="picker-empty">No subfolders</div>
          )}
          {!pickerLoading && pickerDirs.map((d) => (
            <div key={d.path} className="picker-item" onClick={() => browseInto(d.name, d.path)}>
              <span className="fi">📁</span>
              <span className="picker-item-name">{d.name}</span>
              <span className="picker-arrow">›</span>
            </div>
          ))}
        </div>

        {/* Manual input fallback */}
        <div className="picker-manual">
          <input
            className="root-input"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && manualInput.trim() && onSelect(manualInput.trim())}
            placeholder="Or paste full path and press Enter"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function MediaBrowser() {
  const [rootPath, setRootPath] = useState('');
  const [rootInput, setRootInput] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [navStack, setNavStack] = useState<{ path: string; name: string }[]>([]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalState>({ type: null, path: '', name: '' });
  const [txtContent, setTxtContent] = useState('');
  const [subtitles, setSubtitles] = useState<{ start: number; end: number; text: string }[]>([]);
  const [currentSub, setCurrentSub] = useState('');
  const [subsEnabled, setSubsEnabled] = useState(true);
  const [srtFiles, setSrtFiles] = useState<FileEntry[]>([]);
  const [videoFiles, setVideoFiles] = useState<FileEntry[]>([]);
  const [subSize, setSubSize] = useState<'small'|'medium'|'large'>('small');
  const [autoNext, setAutoNext] = useState(true);
  const SUB_SIZES = { small: '1.8vw', medium: '2.7vw', large: '4.05vw' };
  const kbHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kbHintEl = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const vttUrlRef = useRef<string>('');
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const currentPath = navStack.length > 0 ? navStack[navStack.length - 1].path : '';

  // Imperatively update video font-size so ::cue re-renders at the new size
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.style.fontSize = SUB_SIZES[subSize];
    }
  }, [subSize]);

  const openPath = useCallback((p: string) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    setRootPath(trimmed);
    setRootInput(trimmed);
    setNavStack([{ path: trimmed, name: trimmed.split('/').pop() || trimmed }]);
    setEntries([]);
    setError('');
    setShowPicker(false);
  }, []);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    setEntries([]);
    try {
      const res = await fetch('/api/files?path=' + encodeURIComponent(dirPath));
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load directory');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentPath) loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const navigateTo = (entry: FileEntry) =>
    setNavStack(prev => [...prev, { path: entry.path, name: entry.name }]);

  const navigateToBreadcrumb = (index: number) =>
    setNavStack(prev => prev.slice(0, index + 1));

  const playEntry = async (entry: FileEntry, allEntries: FileEntry[]) => {
    const baseName = entry.name.replace(/\.mp4$/i, '');
    const allSrts = allEntries.filter(e => e.ext === '.srt');
    const matchedSrt = allSrts.find(e => e.name.replace(/\.srt$/i, '') === baseName);
    const allVideos = allEntries.filter(e => e.ext === '.mp4');
    setSrtFiles(allSrts);
    setVideoFiles(allVideos);
    if (vttUrlRef.current) { URL.revokeObjectURL(vttUrlRef.current); vttUrlRef.current = ''; }
    setSubtitles([]);
    setCurrentSub('');
    setSubsEnabled(true);
    setModal({ type: 'video', path: entry.path, name: entry.name });
    if (matchedSrt) {
      setTimeout(async () => {
        const res = await fetch('/api/files?path=' + encodeURIComponent(matchedSrt.path) + '&action=read');
        const data = await res.json();
        if (data.content) applyCues(parseSRT(data.content));
      }, 100);
    }
  };

  const handleFileClick = async (entry: FileEntry) => {
    if (entry.ext === '.url') {
      const res = await fetch('/api/files?path=' + encodeURIComponent(entry.path) + '&action=read');
      const data = await res.json();
      const match = data.content?.match(/URL=(.+)/i);
      if (match) window.open(match[1].trim(), '_blank');
      return;
    }
    if (entry.ext === '.txt') {
      const res = await fetch('/api/files?path=' + encodeURIComponent(entry.path) + '&action=read');
      const data = await res.json();
      setTxtContent(data.content || '');
      setModal({ type: 'txt', path: entry.path, name: entry.name });
      return;
    }
    if (entry.ext === '.mp4') {
      await playEntry(entry, entries);
    }
  };

  const applyCues = (cues: { start: number; end: number; text: string }[]) => {
    // Revoke previous blob URL
    if (vttUrlRef.current) URL.revokeObjectURL(vttUrlRef.current);
    if (cues.length === 0) { vttUrlRef.current = ''; setSubtitles([]); setCurrentSub(''); return; }
    const url = cuestoVTT(cues);
    vttUrlRef.current = url;
    setSubtitles(cues);
    setCurrentSub('');
    setSubsEnabled(true);
    // Re-attach track so browser picks up the new src
    if (trackRef.current) {
      trackRef.current.src = url;
      trackRef.current.track.mode = 'showing';
    }
  };

  const loadSrt = async (srtPath: string) => {
    const res = await fetch('/api/files?path=' + encodeURIComponent(srtPath) + '&action=read');
    const data = await res.json();
    if (data.content) applyCues(parseSRT(data.content));
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || !subsEnabled) { setCurrentSub(''); return; }
    const t = videoRef.current.currentTime;
    const sub = subtitles.find(s => t >= s.start && t <= s.end);
    setCurrentSub(sub ? sub.text : '');
  };

  const handleVideoEnded = () => {
    if (!autoNext || videoFiles.length < 2) return;
    const currentIdx = videoFiles.findIndex(v => v.path === modal.path);
    if (currentIdx === -1 || currentIdx === videoFiles.length - 1) return;
    const nextVideo = videoFiles[currentIdx + 1];
    playEntry(nextVideo, [...videoFiles, ...srtFiles]);
  };

  const closeModal = () => {
    setModal({ type: null, path: '', name: '' });
    setCurrentSub('');
    if (videoRef.current) videoRef.current.pause();
    if (vttUrlRef.current) { URL.revokeObjectURL(vttUrlRef.current); vttUrlRef.current = ''; }
    setSubtitles([]);
  };

  const toggleFullscreen = useCallback(() => {
    const wrap = videoWrapRef.current;
    const video = videoRef.current;
    if (!wrap || !video) return;

    const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || (document as any).webkitExitFullscreen).call(document);
      return;
    }

    // Chrome/Firefox: requestFullscreen on the wrap div so our overlays are inside
    if (wrap.requestFullscreen) {
      wrap.requestFullscreen()
        .then(() => {})
        .catch(err => {
          if ((video as any).webkitEnterFullscreen) (video as any).webkitEnterFullscreen();
        });
    } else if ((wrap as any).webkitRequestFullscreen) {
      (wrap as any).webkitRequestFullscreen();
    } else if ((video as any).webkitEnterFullscreen) {
      (video as any).webkitEnterFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      const fs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(fs);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // ── Keyboard shortcuts for video modal ──────────────────────────────────────
  const showHint = useCallback((icon: string, label: string, side: 'left'|'right'|'center' = 'center') => {
    if (kbHintEl.current) { kbHintEl.current.remove(); kbHintEl.current = null; }
    if (kbHintTimer.current) clearTimeout(kbHintTimer.current);
    const container = videoWrapRef.current;
    if (!container) return;

    const mk = (tag: string, css: Partial<CSSStyleDeclaration>, text?: string) => {
      const el = document.createElement(tag);
      Object.assign(el.style, css);
      if (text !== undefined) el.textContent = text;
      return el;
    };

    const hint = mk('div', { position:'absolute', zIndex:'9999', display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' });
    if (side === 'left')       Object.assign(hint.style, { top:'0', bottom:'0', left:'0', width:'26%' });
    else if (side === 'right') Object.assign(hint.style, { top:'0', bottom:'0', right:'0', width:'26%' });
    else                       Object.assign(hint.style, { top:'50%', left:'50%', transform:'translate(-50%,-50%)' });

    if (side === 'center') {
      const pill = mk('div', { background:'rgba(0,0,0,0.78)', borderRadius:'10px', padding:'10px 20px', display:'flex', flexDirection:'column', alignItems:'center', gap:'5px', opacity:'0', transition:'opacity 0.2s', transform:'translateZ(0)', willChange:'opacity' });
      pill.append(
        mk('span', { fontSize:'1.4rem', lineHeight:'1', color:'#fff' }, icon),
        mk('span', { fontSize:'13px', color:'rgba(255,255,255,.9)', whiteSpace:'nowrap', fontFamily:'Arial,sans-serif' }, label)
      );
      hint.append(pill);
      container.appendChild(hint);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pill.style.opacity = '1';
        setTimeout(() => { pill.style.opacity = '0'; }, 600);
      }));
    } else {
      const circle = mk('div', { width:'80px', height:'80px', borderRadius:'50%', background:'rgba(255,255,255,0.22)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'3px', opacity:'0', transition:'opacity 0.2s, transform 0.2s', transform:'scale(0.8) translateZ(0)', willChange:'opacity,transform' });
      circle.append(
        mk('span', { fontSize:'1rem', color:'#fff', letterSpacing:'3px' }, side === 'left' ? '\u25c0\u25c0' : '\u25b6\u25b6'),
        mk('span', { fontSize:'11px', color:'rgba(255,255,255,.85)', fontFamily:'Arial,sans-serif' }, label)
      );
      hint.append(circle);
      container.appendChild(hint);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        circle.style.opacity = '1';
        circle.style.transform = 'scale(1) translateZ(0)';
        setTimeout(() => { circle.style.opacity = '0'; circle.style.transform = 'scale(1.2) translateZ(0)'; }, 600);
      }));
    }

    kbHintEl.current = hint as HTMLDivElement;
    kbHintTimer.current = setTimeout(() => { hint.remove(); kbHintEl.current = null; }, 1000);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modal.type !== 'video' || !videoRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 10);
        showHint('10', '+10 seconds', 'right');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation();
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
        showHint('10', '−10 seconds', 'left');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const vol = Math.min(1, videoRef.current.volume + 0.1);
        videoRef.current.volume = vol;
        showHint(vol === 0 ? '🔇' : '🔊', `Volume ${Math.round(vol * 100)}%`, 'center');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        const vol = Math.max(0, videoRef.current.volume - 0.1);
        videoRef.current.volume = vol;
        showHint(vol === 0 ? '🔇' : '🔉', `Volume ${Math.round(vol * 100)}%`, 'center');
      } else if (e.key === ' ') {
        e.preventDefault(); e.stopPropagation();
        if (videoRef.current.paused) { videoRef.current.play(); showHint('▶', 'Play', 'center'); }
        else { videoRef.current.pause(); showHint('⏸', 'Pause', 'center'); }
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault(); e.stopPropagation();
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (isFullscreen) { document.exitFullscreen().catch(()=>{}); return; }
        closeModal();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [modal.type, closeModal, showHint, toggleFullscreen]);

  const dirs  = entries.filter(e => e.type === 'dir');
  const files = entries.filter(e => e.type === 'file' && e.ext !== '.srt');

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #020818; color: #F0F4FF; font-family: 'Inter',-apple-system,BlinkMacSystemFont,sans-serif; min-height: 100vh; -webkit-font-smoothing: antialiased; }
        .app { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }
        .logo    { font-size: 1rem; color: #06B6D4; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; margin-bottom: .25rem; }
        .tagline { font-size: .72rem; color: rgba(160,180,220,0.4); letter-spacing: .05em; margin-bottom: 2.5rem; }

        /* ── Open bar ── */
        .open-bar { display: flex; gap: .6rem; margin-bottom: 2rem; }
        .root-input { flex: 1; background: rgba(10,20,55,0.8); border: 1px solid rgba(59,130,246,0.15); color: #F0F4FF; font-family: inherit; font-size: .82rem; padding: .6rem 1rem; border-radius: 8px; outline: none; transition: border-color .2s, box-shadow .2s; }
        .root-input:focus { border-color: rgba(59,130,246,0.5); box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        .root-input::placeholder { color: rgba(160,180,220,0.3); }
        .btn { background: linear-gradient(135deg, #2563EB, #0EA5E9); color: #fff; border: none; cursor: pointer; font-family: inherit; font-size: .78rem; font-weight: 700; padding: .6rem 1.25rem; border-radius: 8px; letter-spacing: .05em; text-transform: uppercase; transition: opacity .15s, box-shadow .15s; white-space: nowrap; box-shadow: 0 0 12px rgba(59,130,246,0.3); }
        .btn:hover { opacity: .88; box-shadow: 0 0 20px rgba(59,130,246,0.5); }
        .btn-outline { background: rgba(10,20,55,0.6); border: 1px solid rgba(59,130,246,0.2); color: rgba(160,180,220,0.7); cursor: pointer; font-family: inherit; font-size: .78rem; font-weight: 600; padding: .6rem 1rem; border-radius: 8px; transition: all .15s; white-space: nowrap; }
        .btn-outline:hover { border-color: rgba(59,130,246,0.5); color: #06B6D4; background: rgba(59,130,246,0.08); }

        /* ── Breadcrumb ── */
        .breadcrumb { display: flex; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; gap: 2px; }
        .crumb      { font-size: .75rem; color: rgba(160,180,220,0.45); cursor: pointer; padding: .2rem .35rem; border-radius: 4px; transition: color .15s; }
        .crumb:hover{ color: #06B6D4; }
        .crumb.active{ color: #F0F4FF; cursor: default; }
        .crumb-sep  { color: rgba(59,130,246,0.2); font-size: .8rem; }

        /* ── File list ── */
        .section       { margin-bottom: 1.75rem; }
        .section-label { font-size: .62rem; color: rgba(59,130,246,0.5); letter-spacing: .15em; text-transform: uppercase; margin-bottom: .5rem; padding-left: .2rem; }
        .file-list { display: flex; flex-direction: column; gap: 1px; }
        .file-item { display: flex; align-items: center; gap: .7rem; padding: .55rem .7rem; border-radius: 8px; cursor: pointer; transition: background .1s, border-color .1s; border: 1px solid transparent; }
        .file-item:hover { background: rgba(59,130,246,0.07); border-color: rgba(59,130,246,0.2); }
        .file-item:hover .file-name { color: #06B6D4; }
        .fi        { font-size: .95rem; flex-shrink: 0; }
        .file-name { font-size: .8rem; color: rgba(160,180,220,0.8); flex: 1; }
        .dir-item .file-name { color: #F0F4FF; }
        .file-ext  { font-size: .65rem; color: rgba(59,130,246,0.5); background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.12); padding: .1rem .35rem; border-radius: 3px; }
        .loading   { color: rgba(160,180,220,0.35); font-size: .78rem; padding: .75rem 0; }
        .error     { color: #f87171; font-size: .78rem; padding: .65rem .9rem; background: rgba(239,68,68,0.08); border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); margin-bottom: 1rem; }
        .empty     { color: rgba(160,180,220,0.3); font-size: .78rem; padding: .75rem 0; }
        .no-root   { text-align: center; padding: 4rem 0; color: rgba(160,180,220,0.3); font-size: .78rem; }

        /* ── Folder Picker overlay ── */
        .picker-overlay { position: fixed; inset: 0; background: rgba(2,8,24,0.85); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 1rem; }
        .picker-panel   { background: rgba(6,15,40,0.95); border: 1px solid rgba(59,130,246,0.2); border-radius: 12px; width: 100%; max-width: 540px; display: flex; flex-direction: column; max-height: 80vh; overflow: hidden; box-shadow: 0 8px 40px rgba(59,130,246,0.15); }
        .picker-header  { display: flex; align-items: center; justify-content: space-between; padding: .8rem 1.1rem; border-bottom: 1px solid rgba(59,130,246,0.1); flex-shrink: 0; }
        .picker-title   { font-size: .8rem; color: #F0F4FF; font-weight: 700; letter-spacing: .05em; }
        .picker-crumbs  { display: flex; align-items: center; gap: 2px; padding: .5rem 1rem; border-bottom: 1px solid rgba(59,130,246,0.08); flex-shrink: 0; flex-wrap: wrap; }
        .pcrumb         { font-size: .7rem; color: rgba(160,180,220,0.45); cursor: pointer; padding: .15rem .3rem; border-radius: 3px; }
        .pcrumb:hover   { color: #06B6D4; }
        .pcrumb.active  { color: rgba(160,180,220,0.8); cursor: default; }
        .pcrumb-sep     { color: rgba(59,130,246,0.2); font-size: .75rem; }
        .picker-open-row{ display: flex; align-items: center; gap: .75rem; padding: .65rem 1rem; background: rgba(59,130,246,0.06); border-bottom: 1px solid rgba(59,130,246,0.1); flex-shrink: 0; }
        .picker-open-path{ font-size: .72rem; color: rgba(160,180,220,0.6); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .picker-list    { overflow-y: auto; flex: 1; }
        .picker-item    { display: flex; align-items: center; gap: .65rem; padding: .6rem 1rem; cursor: pointer; transition: background .1s; border-bottom: 1px solid rgba(59,130,246,0.06); }
        .picker-item:hover { background: rgba(59,130,246,0.08); }
        .picker-item:hover .picker-item-name { color: #06B6D4; }
        .picker-back    { color: rgba(160,180,220,0.45); font-size: .78rem; }
        .picker-back:hover { color: #06B6D4; }
        .picker-item-name { font-size: .8rem; color: rgba(160,180,220,0.8); flex: 1; }
        .picker-arrow   { color: rgba(59,130,246,0.3); font-size: .9rem; }
        .picker-loading { color: rgba(160,180,220,0.3); font-size: .78rem; padding: 1rem; }
        .picker-empty   { color: rgba(160,180,220,0.3); font-size: .78rem; padding: 1rem; }
        .picker-manual  { padding: .75rem 1rem; border-top: 1px solid rgba(59,130,246,0.1); flex-shrink: 0; }

        /* ── Video / txt modal ── */
        .overlay { position: fixed; inset: 0; background: rgba(2,8,24,0.92); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 1rem; }
        .modal   { background: rgba(6,15,40,0.97); border: 1px solid rgba(59,130,246,0.2); border-radius: 12px; width: 100%; max-width: 1200px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 8px 40px rgba(59,130,246,0.15); }
        .modal.fs { overflow: visible; }
        .modal-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }
        .modal-body.fs { overflow: visible; }
        .video-sidebar { width: 240px; flex-shrink: 0; border-left: 1px solid rgba(59,130,246,0.1); display: flex; flex-direction: column; overflow: hidden; background: rgba(2,8,24,0.5); }
        .sidebar-label { font-size: .6rem; color: rgba(59,130,246,0.5); letter-spacing: .15em; text-transform: uppercase; padding: .65rem .9rem .4rem; flex-shrink: 0; }
        .sidebar-list { overflow-y: auto; flex: 1; }
        .sidebar-item { display: flex; align-items: center; gap: .55rem; padding: .5rem .9rem; cursor: pointer; transition: background .1s; border-bottom: 1px solid rgba(59,130,246,0.06); }
        .sidebar-item:hover { background: rgba(59,130,246,0.08); }
        .sidebar-item.active { background: rgba(6,182,212,0.1); border-left: 2px solid #06B6D4; padding-left: calc(.9rem - 2px); }
        .sidebar-item.active .sidebar-name { color: #06B6D4; }
        .sidebar-name { font-size: .75rem; color: rgba(160,180,220,0.75); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
        .sidebar-ext  { font-size: .6rem; color: rgba(59,130,246,0.4); background: rgba(59,130,246,0.07); border: 1px solid rgba(59,130,246,0.1); padding: .08rem .3rem; border-radius: 3px; flex-shrink: 0; }
        .modal-header { display: flex; align-items: center; justify-content: space-between; padding: .8rem 1.1rem; border-bottom: 1px solid rgba(59,130,246,0.1); gap: 1rem; flex-shrink: 0; }
        .modal-title { font-size: .75rem; color: rgba(160,180,220,0.6); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .modal-controls { display: flex; align-items: center; gap: .5rem; flex-shrink: 0; }
        .close-btn { background: none; border: 1px solid rgba(59,130,246,0.2); color: rgba(160,180,220,0.45); cursor: pointer; font-size: 1.1rem; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all .15s; line-height: 1; }
        .close-btn:hover { border-color: #f87171; color: #f87171; }
        .sub-toggle { background: none; border: 1px solid rgba(59,130,246,0.2); color: rgba(160,180,220,0.5); cursor: pointer; font-size: .65rem; padding: .22rem .5rem; border-radius: 4px; font-family: inherit; transition: all .15s; letter-spacing: .05em; }
        .sub-toggle.on { border-color: #06B6D4; color: #06B6D4; box-shadow: 0 0 8px rgba(6,182,212,0.3); }
        .srt-select { background: rgba(10,20,55,0.8); border: 1px solid rgba(59,130,246,0.2); color: rgba(160,180,220,0.7); font-family: inherit; font-size: .65rem; padding: .22rem .4rem; border-radius: 4px; cursor: pointer; max-width: 160px; outline: none; transition: border-color .15s; }
        .srt-select:hover, .srt-select:focus { border-color: rgba(59,130,246,0.5); color: #F0F4FF; }
        .video-wrap { position: relative; background: #000; flex: 1; min-height: 0; overflow: hidden; isolation: isolate; }
        .video-wrap.fullscreen { position: fixed !important; inset: 0 !important; z-index: 9000; width: 100vw !important; height: 100vh !important; }
        .video-wrap.fullscreen video { height: 100vh; max-height: 100vh; }

        .video-wrap video { width: 100%; height: 100%; display: block; object-fit: contain; max-height: 85vh; }

        .fs-btn { background:none; border: 1px solid rgba(59,130,246,0.2); cursor:pointer; color:rgba(160,180,220,0.6); font-size:.75rem; padding:.22rem .5rem; border-radius:4px; font-family:inherit; display:flex; align-items:center; gap:.3rem; transition:all .15s; letter-spacing:.03em; }
        .fs-btn:hover { border-color:rgba(59,130,246,0.5); color:#F0F4FF; }
        .fs-btn.on { border-color:#06B6D4; color:#06B6D4; }
        video::cue { font-size: 100%; font-family: Arial, sans-serif; background: transparent; color: #ffffff; line-height: 1.4; text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.8); }
        .txt-content { padding: 1.25rem 1.4rem; overflow-y: auto; flex: 1; font-size: .8rem; line-height: 1.75; color: rgba(160,180,220,0.8); white-space: pre-wrap; word-break: break-word; }
      `}</style>

      <div className="app">
        <div className="logo">◈ Media Browser</div>
        <div className="tagline">local · video · docs · links</div>

        <div className="open-bar">
          <button className="btn-outline" onClick={() => setShowPicker(true)}>📂 Browse</button>
          <input
            className="root-input"
            value={rootInput}
            onChange={e => setRootInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && openPath(rootInput)}
            placeholder="or paste a full folder path here"
            spellCheck={false}
          />
          <button className="btn" onClick={() => openPath(rootInput)}>Open</button>
        </div>

        {error && <div className="error">⚠ {error}</div>}

        {!rootPath && !error && (
          <div className="no-root">Click Browse or paste a path to get started</div>
        )}

        {rootPath && (
          <>
            <div className="breadcrumb">
              {navStack.map((crumb, i) => (
                <span key={i} style={{ display:'flex', alignItems:'center', gap:'2px' }}>
                  <span
                    className={'crumb' + (i === navStack.length - 1 ? ' active' : '')}
                    onClick={() => { if (i < navStack.length - 1) navigateToBreadcrumb(i); }}
                  >
                    {crumb.name}
                  </span>
                  {i < navStack.length - 1 && <span className="crumb-sep">/</span>}
                </span>
              ))}
            </div>

            {loading && <div className="loading">Loading…</div>}

            {!loading && (
              <>
                {dirs.length > 0 && (
                  <div className="section">
                    <div className="section-label">Folders</div>
                    <div className="file-list">
                      {dirs.map(entry => (
                        <div key={entry.path} className="file-item dir-item" onClick={() => navigateTo(entry)}>
                          <FileIcon ext="" type="dir" />
                          <span className="file-name">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {files.length > 0 && (
                  <div className="section">
                    <div className="section-label">Files</div>
                    <div className="file-list">
                      {files.map(entry => (
                        <div key={entry.path} className="file-item" onClick={() => handleFileClick(entry)}>
                          <FileIcon ext={entry.ext} type="file" />
                          <span className="file-name">{entry.name.replace(/\.[^.]+$/, '')}</span>
                          <span className="file-ext">{entry.ext}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {dirs.length === 0 && files.length === 0 && (
                  <div className="empty">No supported files in this folder.</div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Folder Picker ── */}
      {showPicker && (
        <FolderPicker onSelect={openPath} onClose={() => setShowPicker(false)} />
      )}

      {/* ── Video modal ── */}
      {modal.type === 'video' && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={`modal${isFullscreen ? ' fs' : ''}`}>
            <div className="modal-header">
              <span className="modal-title">{modal.name}</span>
              <div className="modal-controls">
                {subtitles.length > 0 && (
                  <select className="srt-select" value={subSize} onChange={e => setSubSize(e.target.value as 'small'|'medium'|'large')}>
                    <option value="small">S</option>
                    <option value="medium">M</option>
                    <option value="large">L</option>
                  </select>
                )}
                {srtFiles.length > 0 && (
                  <select className="srt-select" defaultValue={subtitles.length > 0 ? '' : 'none'}
                    onChange={async (e) => {
                      if (e.target.value === 'none') { applyCues([]); return; }
                      await loadSrt(e.target.value);
                    }}>
                    <option value="none">No subtitles</option>
                    {srtFiles.map(s => (
                      <option key={s.path} value={s.path}>{s.name.replace(/\.srt$/i, '')}</option>
                    ))}
                  </select>
                )}
                {subtitles.length > 0 && (
                  <button className={'sub-toggle' + (subsEnabled ? ' on' : '')}
                    onClick={() => {
                      const next = !subsEnabled;
                      setSubsEnabled(next);
                      setCurrentSub('');
                      if (trackRef.current) trackRef.current.track.mode = next ? 'showing' : 'hidden';
                    }}>
                    CC {subsEnabled ? 'ON' : 'OFF'}
                  </button>
                )}
                <button className={'sub-toggle' + (autoNext ? ' on' : '')}
                  title="Auto-play next video"
                  onClick={() => setAutoNext(v => !v)}>
                  ▶▶ {autoNext ? 'ON' : 'OFF'}
                </button>
                <button className={`fs-btn${isFullscreen ? ' on' : ''}`} onClick={toggleFullscreen} title="Fullscreen (F)">
                  {isFullscreen ? '↙ Exit' : '↗ Full'}
                </button>
                <button className="close-btn" onClick={closeModal}>×</button>
              </div>
            </div>
            <div className={`modal-body${isFullscreen ? ' fs' : ''}`}>
              <div className={`video-wrap${isFullscreen ? ' fullscreen' : ''}`} ref={videoWrapRef}>
                <video ref={videoRef} controls autoPlay onTimeUpdate={handleTimeUpdate} onEnded={handleVideoEnded}
                  style={{ fontSize: SUB_SIZES[subSize] }}
                  controlsList="nofullscreen nodownload"
                  disablePictureInPicture
                  src={'/api/stream?path=' + encodeURIComponent(modal.path)}>
                  {vttUrlRef.current && (
                    <track ref={trackRef} kind="subtitles" src={vttUrlRef.current} default />
                  )}
                </video>
              </div>
              <div className="video-sidebar">
                <div className="sidebar-label">In this folder</div>
                <div className="sidebar-list">
                  {entries.filter(e => e.ext !== '.srt').map(entry => (
                    <div
                      key={entry.path}
                      className={'sidebar-item' + (entry.path === modal.path ? ' active' : '')}
                      onClick={() => {
                        if (entry.path === modal.path) return;
                        if (entry.ext === '.mp4') playEntry(entry, entries);
                        else handleFileClick(entry);
                      }}
                    >
                      <span style={{fontSize:'.85rem',flexShrink:0}}>
                        {entry.type === 'dir' ? '📁' : entry.ext === '.mp4' ? '🎬' : entry.ext === '.txt' ? '📄' : '🔗'}
                      </span>
                      <span className="sidebar-name">{entry.name.replace(/\.[^.]+$/, '')}</span>
                      {entry.type === 'file' && <span className="sidebar-ext">{entry.ext}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ── TXT modal ── */}
      {modal.type === 'txt' && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={`modal${isFullscreen ? ' fs' : ''}`}>
            <div className="modal-header">
              <span className="modal-title">{modal.name}</span>
              <div className="modal-controls">
                <button className="close-btn" onClick={closeModal}>×</button>
              </div>
            </div>
            <div className="txt-content">{txtContent}</div>
          </div>
        </div>
      )}

    </>
  );
}
