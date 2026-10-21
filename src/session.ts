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
const SESSION_KEY = 'md-editor-session';

function isDraft(data: Partial<Draft> | null): data is Draft {
  return !!data && typeof data.name === 'string' && typeof data.content === 'string' &&
    (data.path === null || typeof data.path === 'string') && typeof data.updatedAt === 'number';
}

// 未保存のタブの下書き (タブごとに 1 件)
export function readDrafts(): Draft[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '[]');
    const drafts = Array.isArray(list) ? list.filter(isDraft) : [];
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
      localStorage.removeItem(DRAFTS_KEY);
      return true;
    }
    const now = Date.now();
    const list = drafts.map(({ doc, content }) => ({ ...doc, content, updatedAt: now }) satisfies Draft);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function clearDrafts() {
  writeDrafts([]);
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
