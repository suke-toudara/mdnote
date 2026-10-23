// デスクトップ (Tauri) とブラウザの差を吸収する層。
// Tauri ではファイルパスで直接読み書きし、ブラウザでは File System Access API 等で代用する。

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { dirname, join, normalize } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readFile, readTextFile, rename, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath as openWithSystemApp, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';

export const isTauri = '__TAURI_INTERNALS__' in window;

export interface Doc {
  // Tauri ではファイルの絶対パス。ブラウザでは常に null。
  path: string | null;
  name: string;
  // ブラウザ版ではタブごとに保存先を保持する。
  handle?: FileHandle;
}

export interface OpenedDoc extends Doc {
  content: string;
}

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MD_EXT = /\.(md|markdown|txt)$/i;

export const isImagePath = (p: string) => IMAGE_EXT.test(p);
export const isMarkdownPath = (p: string) => MD_EXT.test(p);

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

// ---- ブラウザ用 (File System Access API) ----

type FileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (opts: object) => Promise<FileHandle[]>;
  showSaveFilePicker?: (opts: object) => Promise<FileHandle>;
};

const w = window as PickerWindow;
const supportsFSA = typeof w.showOpenFilePicker === 'function';
const pickerTypes = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }];

function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === 'AbortError';
}

// ---- 共通 API ----

export async function confirmDialog(message: string): Promise<boolean> {
  if (isTauri) return ask(message, { title: 'mdnote', kind: 'warning' });
  return window.confirm(message);
}

export async function readDoc(path: string): Promise<OpenedDoc> {
  return { path, name: basename(path), content: await readTextFile(path) };
}

export async function openDoc(fallbackInput: HTMLInputElement): Promise<OpenedDoc | null> {
  if (isTauri) {
    const path = await open({ multiple: false, directory: false, filters: MD_FILTERS });
    return path ? readDoc(path) : null;
  }

  if (supportsFSA) {
    try {
      const [h] = await w.showOpenFilePicker!({ types: pickerTypes });
      const file = await h.getFile();
      return { path: null, name: file.name, handle: h, content: await file.text() };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }

  return new Promise((resolve) => {
    fallbackInput.value = '';
    fallbackInput.onchange = async () => {
      const file = fallbackInput.files?.[0];
      if (!file) return resolve(null);
      resolve({ path: null, name: file.name, content: await file.text() });
    };
    fallbackInput.click();
  });
}

export function forgetBrowserHandle() {
  // 旧呼び出しとの互換用。保存先は Doc.handle で保持する。
}

// ---- フォルダ ----

export async function openFolderDialog(): Promise<string | null> {
  if (!isTauri) return null;
  return open({ directory: true, multiple: false });
}

export interface DirItem {
  name: string;
  path: string;
  isDirectory: boolean;
}

// フォルダ内のサブフォルダと Markdown ファイル。隠しファイルや node_modules は除く
export async function listDir(dir: string): Promise<DirItem[]> {
  const entries = await readDir(dir);
  const items: DirItem[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (!e.isDirectory && !isMarkdownPath(e.name)) continue;
    items.push({ name: e.name, path: await join(dir, e.name), isDirectory: e.isDirectory });
  }
  const collator = new Intl.Collator('ja', { numeric: true });
  return items.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || collator.compare(a.name, b.name));
}

export { basename };

// ---- ファイル操作 (ファイル一覧から) ----

// ファイル・フォルダ名として使えない名前ならその理由を返す
export function invalidName(name: string): string | null {
  if (!name.trim()) return '名前を入力してください';
  if (/[\\/]/.test(name)) return '名前に / や \\ は使えません';
  if (name === '.' || name === '..') return 'その名前は使えません';
  return null;
}

async function ensureFree(path: string) {
  if (await exists(path)) throw new Error(`「${basename(path)}」はすでに存在します`);
}

export async function createFile(dir: string, name: string): Promise<string> {
  const path = await join(dir, name);
  await ensureFree(path);
  await writeTextFile(path, '');
  return path;
}

export async function createFolder(dir: string, name: string): Promise<string> {
  const path = await join(dir, name);
  await ensureFree(path);
  await mkdir(path);
  return path;
}

export async function renameItem(path: string, newName: string): Promise<string> {
  const target = await join(await dirname(path), newName);
  if (target === path) return path;
  // 大文字小文字だけの変更は、同じファイルとして存在判定されるので確認しない
  if (target.toLowerCase() !== path.toLowerCase()) await ensureFree(target);
  await rename(path, target);
  return target;
}

export async function trashItem(path: string) {
  await invoke('move_to_trash', { path });
}

export async function revealItem(path: string) {
  await revealItemInDir(path);
}

// ---- PDF ----

// PDF の保存先を選ぶ。文書と同じ場所・同じ名前 (.pdf) を初期値にする
export async function pickPdfPath(doc: Doc): Promise<string | null> {
  const base = doc.path ? doc.path.replace(/\.[^./\\]+$/, '') : doc.name.replace(/\.[^.]+$/, '');
  return save({ defaultPath: `${base}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
}

export async function exportPdf(path: string, pageSize: string, marginMm: number) {
  await invoke('export_pdf', { path, pageSize, marginMm });
}

// ---- リンク ----

export async function openExternalUrl(url: string) {
  if (isTauri) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

// Markdown 以外のファイルは、関連付けられたアプリで開く
export async function openWithSystem(path: string) {
  await openWithSystemApp(path);
}

// 文書からの相対パスを絶対パスにする (../ なども解決する)
export async function resolveFromDoc(rel: string, docPath: string | null): Promise<string | null> {
  if (rel.startsWith('/') || /^[a-z]:[\\/]/i.test(rel)) return normalize(rel);
  if (!docPath) return null;
  return normalize(await join(await dirname(docPath), rel));
}

// ファイルの更新を見分けるための値 (更新日時とサイズ)。ファイルが無ければ null。
export async function fileStamp(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return `${info.mtime?.getTime() ?? 0}:${info.size}`;
  } catch {
    return null;
  }
}

// 保存先の Doc を返す。キャンセル時は null。
export async function saveDoc(content: string, doc: Doc, saveAs: boolean): Promise<Doc | null> {
  if (isTauri) {
    let path = doc.path;
    if (!path || saveAs) {
      path = await save({ defaultPath: doc.path ?? doc.name, filters: MD_FILTERS });
      if (!path) return null;
    }
    await writeTextFile(path, content);
    return { path, name: basename(path) };
  }

  if (supportsFSA) {
    try {
      const handle = saveAs || !doc.handle
        ? await w.showSaveFilePicker!({ suggestedName: doc.name, types: pickerTypes })
        : doc.handle;
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { path: null, name: handle.name, handle };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = doc.name;
  a.click();
  URL.revokeObjectURL(a.href);
  return { path: null, name: doc.name };
}

// ---- 画像 ----

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function uniqueImagePath(dir: string, ext: string, original?: string) {
  const stem = original ? original.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') : `image-${timestamp()}`;
  for (let i = 0; ; i++) {
    const name = `${stem}${i ? `-${i}` : ''}.${ext}`;
    const path = await join(dir, name);
    if (!(await exists(path))) return { name, path };
  }
}

// 画像を Markdown ファイルと同じ場所の images/ に保存し、Markdown に書く相対パスを返す。
// data は貼り付けられた画像か、ドロップされたファイルのパス。
// ブラウザ版はファイルを置けないので data URL を返す。
export async function storeImage(data: Blob | string, docPath: string | null, originalName?: string): Promise<string> {
  if (!isTauri || !docPath) {
    if (typeof data === 'string') throw new Error('保存先のファイルがありません');
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(data);
    });
  }

  const dir = await join(await dirname(docPath), 'images');
  await mkdir(dir, { recursive: true });

  let bytes: Uint8Array;
  let ext: string;
  if (typeof data === 'string') {
    bytes = await readFile(data);
    ext = data.split('.').pop()!.toLowerCase();
    originalName = basename(data);
  } else {
    bytes = new Uint8Array(await data.arrayBuffer());
    ext = MIME_EXT[data.type] ?? 'png';
  }
  const target = await uniqueImagePath(dir, ext, originalName);
  await writeFile(target.path, bytes);
  return `images/${encodeURI(target.name)}`;
}

// Markdown 内の画像パスを、WebView で表示できる URL に変換する。
export async function resolveImageUrl(url: string, docPath: string | null): Promise<string> {
  if (!isTauri || /^(https?:|data:|blob:|asset:|tauri:)/i.test(url)) return url;
  const decoded = decodeURI(url);
  if (decoded.startsWith('/') || /^[a-z]:[\\/]/i.test(decoded)) return convertFileSrc(decoded);
  if (!docPath) return url;
  return convertFileSrc(await join(await dirname(docPath), decoded));
}

// ---- ウィンドウ ----

export async function setWindowTitle(title: string) {
  document.title = title;
  if (isTauri) await getCurrentWindow().setTitle(title);
}

// メインのウィンドウだけが前回のタブやフォルダを引き継ぐ。切り離したタブのウィンドウは doc-*
export const windowLabel = isTauri ? getCurrentWindow().label : 'main';
export const isMainWindow = windowLabel === 'main';

export const newWindowLabel = () => `doc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function openWindowLabels(): Promise<string[]> {
  return isTauri ? (await getAllWindows()).map((w) => w.label) : [];
}

// 新しいウィンドウを開く。x, y はウィンドウの左上に置く画面上の位置
export async function openNewWindow(label: string, x?: number, y?: number) {
  const win = new WebviewWindow(label, {
    url: 'index.html',
    title: 'mdnote',
    width: 1100,
    height: 780,
    minWidth: 480,
    minHeight: 320,
    dragDropEnabled: true,
    ...(x !== undefined && y !== undefined ? { x, y } : { center: true }),
  });
  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve());
    void win.once('tauri://error', (e) => reject(new Error(`ウィンドウを開けませんでした: ${String(e.payload)}`)));
  });
}

export async function initialFile(): Promise<string | null> {
  return isTauri ? invoke<string | null>('initial_file') : null;
}

export function onCloseRequested(shouldClose: () => Promise<boolean>) {
  if (isTauri) {
    getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await shouldClose())) e.preventDefault();
    });
  }
}

export interface FileDrop {
  paths: string[];
  // CSS ピクセル座標
  x: number;
  y: number;
}

// Tauri ではファイルのドロップを WebView が横取りするため、ネイティブのイベントで受け取る
export function onFileDrop(handler: (drop: FileDrop) => void) {
  if (!isTauri) return;
  getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type !== 'drop') return;
    const ratio = window.devicePixelRatio || 1;
    handler({ paths: e.payload.paths, x: e.payload.position.x / ratio, y: e.payload.position.y / ratio });
  });
}
