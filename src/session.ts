import type { Doc } from './platform';

export interface Draft extends Doc {
  content: string;
  updatedAt: number;
}

export interface RecentFile {
  path: string;
  name: string;
}

// 旧形式 (下書き 1 件) のキー。読み込みだけ対応する
const DRAFT_KEY = 'md-editor-draft';
const DRAFTS_KEY = 'md-editor-drafts';
const RECENT_KEY = 'md-editor-recent';
const RECENT_FOLDERS_KEY = 'mdnote-recent-folders';
const SESSION_KEY = 'md-editor-session';
const HANDOFF_KEY = 'mdnote-handoff';

// 下書きの保存先。切り離したウィンドウはメインの下書きを上書きしないよう、自分専用のキーを使う
let draftsKey = DRAFTS_KEY;

export function useWindowDrafts(label: string) {
  draftsKey = `${DRAFTS_KEY}:${label}`;
}

function isDraft(data: Partial<Draft> | null): data is Draft {
  return !!data && typeof data.name === 'string' && typeof data.content === 'string' &&
    (data.path === null || typeof data.path === 'string') && typeof data.updatedAt === 'number';
}

// 未保存のタブの下書き (タブごとに 1 件)。extraKeys: 一緒に読む他のウィンドウの下書き
export function readDrafts(extraKeys: string[] = []): Draft[] {
  try {
    const drafts: Draft[] = [];
    for (const key of [draftsKey, ...extraKeys]) {
      const list: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (Array.isArray(list)) drafts.push(...list.filter(isDraft));
    }
    const legacy = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<Draft> | null;
    if (isDraft(legacy)) drafts.push(legacy);
    return drafts;
  } catch {
    return [];
  }
}

export function writeDrafts(drafts: { doc: Doc; content: string }[]): boolean {
  try {
    localStorage.removeItem(DRAFT_KEY);
    if (!drafts.length) {
      localStorage.removeItem(draftsKey);
      return true;
    }
    const now = Date.now();
    const list = drafts.map(({ doc, content }) => ({ ...doc, content, updatedAt: now }) satisfies Draft);
    localStorage.setItem(draftsKey, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function clearDrafts() {
  writeDrafts([]);
}

// 異常終了などで閉じずに終わった、切り離したウィンドウの下書きのキー
export function orphanDraftKeys(openLabels: string[]): string[] {
  try {
    const prefix = `${DRAFTS_KEY}:`;
    return Object.keys(localStorage).filter((key) => key.startsWith(prefix) && !openLabels.includes(key.slice(prefix.length)));
  } catch {
    return [];
  }
}

export function removeDraftKeys(keys: string[]) {
  try {
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // 消せなくても次回また復元を尋ねるだけ
  }
}

// タブを新しいウィンドウへ移すときの受け渡し (開いた側が読んだら消す)
export interface Handoff {
  doc: { path: string | null; name: string };
  content: string;
  dirty: boolean;
  folder: string | null;
  expanded: string[];
}

export function writeHandoff(label: string, handoff: Handoff) {
  localStorage.setItem(`${HANDOFF_KEY}:${label}`, JSON.stringify(handoff));
}

export function takeHandoff(label: string): Handoff | null {
  try {
    const key = `${HANDOFF_KEY}:${label}`;
    const data = JSON.parse(localStorage.getItem(key) ?? 'null') as Handoff | null;
    localStorage.removeItem(key);
    return data && typeof data.content === 'string' && typeof data.doc?.name === 'string' ? data : null;
  } catch {
    return null;
  }
}

export function removeHandoff(label: string) {
  try {
    localStorage.removeItem(`${HANDOFF_KEY}:${label}`);
  } catch {
    // 残っても誰も読まないだけ
  }
}

// 開いていたタブとフォルダ (次回起動時に開き直す)
export interface Session {
  files: string[];
  active: string | null;
  folder: string | null;
}

export function readSession(): Session {
  try {
    const data = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null;
    return {
      files: Array.isArray(data?.files) ? data.files.filter((f): f is string => typeof f === 'string') : [],
      active: typeof data?.active === 'string' ? data.active : null,
      folder: typeof data?.folder === 'string' ? data.folder : null,
    };
  } catch {
    return { files: [], active: null, folder: null };
  }
}

export function writeSession(session: Session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // 保存できなくても次回は空の状態で起動するだけ
  }
}

export function readRecent(): RecentFile[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is RecentFile =>
      item && typeof item.path === 'string' && typeof item.name === 'string',
    ).slice(0, 10);
  } catch {
    return [];
  }
}

export function addRecent(doc: Doc): RecentFile[] {
  if (!doc.path) return readRecent();
  const list = [{ path: doc.path, name: doc.name }, ...readRecent().filter((item) => item.path !== doc.path)].slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 履歴が保存できなくてもファイル操作は続ける
  }
  return list;
}

export function removeRecent(path: string): RecentFile[] {
  const list = readRecent().filter((item) => item.path !== path);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 同上
  }
  return list;
}

// 最近使ったフォルダ。文書の履歴とは独立して保持する。
export function readRecentFolders(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter((path): path is string => typeof path === 'string' && path.length > 0).slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function addRecentFolder(path: string): string[] {
  const list = [path, ...readRecentFolders().filter((item) => item !== path)].slice(0, 10);
  try { localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(list)); } catch { /* 履歴が保存できなくても操作は続ける */ }
  return list;
}

export function removeRecentFolder(path: string): string[] {
  const list = readRecentFolders().filter((item) => item !== path);
  try { localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(list)); } catch { /* 同上 */ }
  return list;
}
