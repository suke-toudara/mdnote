// 開いているフォルダの中の Markdown ファイル全体 (クイックオープン・フォルダ内検索・被リンクで使う)

export interface VaultSource {
  // フォルダの下にある Markdown ファイルの絶対パス
  list(root: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

// 大きすぎるフォルダ (ホーム全体など) を開いても固まらないように打ち切る
export const MAX_FILES = 5000;

type ListDir = (dir: string) => Promise<{ path: string; isDirectory: boolean; isSymlink: boolean }[]>;

// サブフォルダも含めて辿る。シンボリックリンクのフォルダには入らない (循環を避ける)
export async function listMarkdownTree(root: string, listDir: ListDir): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length && files.length < MAX_FILES) {
    const dir = queue.shift()!;
    let items;
    try {
      items = await listDir(dir);
    } catch {
      continue;
    }
    for (const item of items) {
      if (item.isDirectory) {
        if (!item.isSymlink) queue.push(item.path);
      } else if (files.length < MAX_FILES) {
        files.push(item.path);
      }
    }
  }
  return files;
}

export class Vault {
  private cached: { root: string; files: Promise<string[]> } | null = null;
  private source: VaultSource;
  private getRoot: () => string | null;
  // タブで開いている文書は、保存前の内容を使う
  private openContent: (path: string) => string | undefined;

  constructor(source: VaultSource, getRoot: () => string | null, openContent: (path: string) => string | undefined) {
    this.source = source;
    this.getRoot = getRoot;
    this.openContent = openContent;
  }

  get root() {
    return this.getRoot();
  }

  // ファイルの追加・削除・名前の変更のあとに呼ぶ
  invalidate() {
    this.cached = null;
  }

  list(): Promise<string[]> {
    const root = this.getRoot();
    if (!root) return Promise.resolve([]);
    if (this.cached?.root !== root) {
      const files = this.source.list(root);
      this.cached = { root, files };
      // 失敗したら次回は読み直す
      files.catch(() => this.cached?.files === files && this.invalidate());
    }
    return this.cached.files;
  }

  async read(path: string) {
    return this.openContent(path) ?? (await this.source.read(path));
  }

  relative(path: string) {
    const root = this.getRoot();
    return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  }
}

// ---- パスの計算 (Linux の / 区切り) ----

export const dirOf = (path: string) => path.replace(/\/[^/]*$/, '') || '/';
export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function normalize(parts: string[]) {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

// 文書のあるフォルダから見た相対パスを絶対パスにする (#見出し や ?… は外す)
export function resolvePath(fromDir: string, href: string) {
  let path = href.replace(/[#?].*$/, '');
  try {
    path = decodeURI(path);
  } catch {
    // % を含む名前などはそのまま使う
  }
  if (!path) return null;
  return normalize((path.startsWith('/') ? path : `${fromDir}/${path}`).split('/'));
}

// fromDir から to への相対パス
export function relativePath(fromDir: string, to: string) {
  const from = fromDir.split('/').filter(Boolean);
  const target = to.split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < target.length - 1 && from[i] === target[i]) i++;
  return [...Array(from.length - i).fill('..'), ...target.slice(i)].join('/');
}

// Markdown のリンク先として書く形。空白や括弧を含むなら <…> で囲む
export const linkDestination = (path: string) => (/[\s()<>]/.test(path) ? `<${path}>` : path);
