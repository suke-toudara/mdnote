// 開いたフォルダの中身 (サブフォルダと Markdown ファイル) を木構造で表示し、
// コードエディタのように作成・名前の変更・削除ができるようにする

import { type MenuEntry, showContextMenu } from './context-menu';
import {
  basename,
  createFile,
  createFolder,
  invalidName,
  listDir,
  renameItem,
  revealItem,
  trashItem,
  type DirItem,
} from './platform';

export interface TreeHandlers {
  open(path: string): void;
  openInNewTab(path: string): void;
  // ファイル・フォルダの名前が変わった (開いているタブの場所を付け替える)
  renamed(oldPath: string, newPath: string): void;
  // ゴミ箱へ移した (開いているタブを閉じる)
  deleted(path: string): void;
  confirm(message: string): Promise<boolean>;
  notify(message: string, isError?: boolean): void;
}

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`);
const parentOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

export class FileTree {
  private root: HTMLElement;
  private handlers: TreeHandlers;
  private folder: string | null = null;
  private expanded = new Set<string>();
  private active: string | null = null;
  // 一覧の中で選んでいる項目 (作成先や名前の変更の対象になる)
  private selected: { path: string; isDirectory: boolean } | null = null;
  private editing = false;

  constructor(root: HTMLElement, handlers: TreeHandlers) {
    this.root = root;
    this.handlers = handlers;
    root.tabIndex = 0;
    root.addEventListener('keydown', (e) => this.onKeyDown(e));
    root.addEventListener('contextmenu', (e) => this.onContextMenu(e));
  }

  get current() {
    return this.folder;
  }

  get folderName() {
    return this.folder ? basename(this.folder) : '';
  }

  get expandedDirs() {
    return [...this.expanded];
  }

  async setFolder(folder: string | null, expanded: string[] = []) {
    this.folder = folder;
    this.expanded = new Set(expanded);
    this.selected = null;
    await this.refresh();
  }

  setActive(path: string | null) {
    this.active = path;
    this.root.querySelectorAll<HTMLElement>('.tree-file').forEach((el) => el.classList.toggle('current', el.dataset.path === path));
  }

  // 他のアプリでファイルが増減した場合に備え、開いているフォルダを読み直す
  async refresh() {
    // 名前の入力中に読み直すと入力欄が消えるので待つ
    if (this.editing) return;
    if (!this.folder) {
      this.root.replaceChildren();
      return;
    }
    const list = await this.renderDir(this.folder, 0);
    if (this.editing) return;
    this.root.replaceChildren(...list.children);
    this.setActive(this.active);
    this.markSelected();
  }

  private markSelected() {
    this.root
      .querySelectorAll<HTMLElement>('.tree-dir, .tree-file')
      .forEach((el) => el.classList.toggle('selected', el.dataset.path === this.selected?.path));
  }

  private select(path: string, isDirectory: boolean) {
    this.selected = { path, isDirectory };
    this.markSelected();
  }

  private rowFor(path: string) {
    return [...this.root.querySelectorAll<HTMLElement>('.tree-dir, .tree-file')].find((el) => el.dataset.path === path);
  }

  private async renderDir(dir: string, depth: number): Promise<HTMLElement> {
    const ul = document.createElement('ul');
    ul.dataset.dir = dir;
    let items: DirItem[];
    try {
      items = await listDir(dir);
    } catch {
      ul.append(this.message('読み込めませんでした'));
      return ul;
    }
    if (!items.length && depth === 0) ul.append(this.message('Markdown ファイルがありません'));
    for (const item of items) {
      const li = document.createElement('li');
      const row = document.createElement('button');
      row.className = item.isDirectory ? 'tree-dir' : 'tree-file';
      row.dataset.path = item.path;
      row.dataset.depth = String(depth);
      row.title = item.path;
      row.tabIndex = -1;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      const open = this.expanded.has(item.path);
      row.textContent = `${item.isDirectory ? (open ? '▾ ' : '▸ ') : ''}${item.name}`;
      li.append(row);
      if (item.isDirectory) {
        if (open) li.append(await this.renderDir(item.path, depth + 1));
        row.addEventListener('click', () => {
          this.select(item.path, true);
          void this.toggle(item.path);
        });
      } else {
        row.addEventListener('click', () => {
          this.select(item.path, false);
          this.handlers.open(item.path);
        });
      }
      ul.append(li);
    }
    return ul;
  }

  private message(text: string) {
    const li = document.createElement('li');
    li.className = 'tree-empty';
    li.textContent = text;
    return li;
  }

  private async toggle(dir: string, open?: boolean) {
    const next = open ?? !this.expanded.has(dir);
    if (next === this.expanded.has(dir)) return;
    if (next) this.expanded.add(dir);
    else this.expanded.delete(dir);
    await this.refresh();
    this.root.dispatchEvent(new CustomEvent('tree-change'));
  }

  // ---- 作成・名前の変更・削除 ----

  // 新しい項目を作るフォルダ (選んでいるフォルダ、ファイルならその親、なければ一番上)
  private targetDir() {
    if (!this.selected) return this.folder;
    return this.selected.isDirectory ? this.selected.path : parentOf(this.selected.path);
  }

  // 一覧の中に名前の入力欄を出す。確定した名前を返す (Esc で取り消すと null)
  private askName(container: HTMLElement, before: Element | null, initial: string, depth: number, selectStem: boolean) {
    return new Promise<string | null>((resolve) => {
      this.editing = true;
      const input = document.createElement('input');
      input.className = 'tree-input';
      input.value = initial;
      input.spellcheck = false;
      input.style.marginLeft = `${8 + depth * 14}px`;
      input.style.width = `calc(100% - ${12 + depth * 14}px)`;
      const error = document.createElement('div');
      error.className = 'tree-input-error';
      error.hidden = true;
      const wrap = document.createElement('li');
      wrap.append(input, error);
      container.insertBefore(wrap, before);
      input.focus();
      // 拡張子を除いた部分を選択しておく (VS Code と同じ)
      const dot = initial.lastIndexOf('.');
      input.setSelectionRange(0, selectStem && dot > 0 ? dot : initial.length);

      let done = false;
      const finish = (value: string | null) => {
        if (done) return;
        done = true;
        wrap.remove();
        this.editing = false;
        resolve(value);
      };
      input.addEventListener('input', () => {
        const message = invalidName(input.value);
        error.hidden = !message || !input.value;
        error.textContent = message ?? '';
      });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          const message = invalidName(input.value);
          if (message) {
            error.textContent = message;
            error.hidden = false;
            return;
          }
          finish(input.value.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      });
      // ほかの場所をクリックしたら、入力中の名前で確定する (空なら取り消し)
      input.addEventListener('blur', () => finish(invalidName(input.value) ? null : input.value.trim()));
    });
  }

  private async containerFor(dir: string) {
    if (dir !== this.folder) await this.toggle(dir, true);
    const ul = [...this.root.querySelectorAll<HTMLElement>('ul')].find((el) => el.dataset.dir === dir);
    return ul ?? this.root;
  }

  async newFile() {
    const dir = this.targetDir();
    if (!dir) return;
    const container = await this.containerFor(dir);
    const depth = dir === this.folder ? 0 : Number(this.rowFor(dir)?.dataset.depth ?? 0) + 1;
    const name = await this.askName(container, container.firstElementChild, '新しいファイル.md', depth, true);
    if (!name) return;
    try {
      // 拡張子がなければ .md を付ける
      const path = await createFile(dir, /\.[^.]+$/.test(name) ? name : `${name}.md`);
      this.select(path, false);
      await this.refresh();
      this.handlers.openInNewTab(path);
    } catch (e) {
      this.handlers.notify(e instanceof Error ? e.message : String(e), true);
    }
  }

  async newFolder() {
    const dir = this.targetDir();
    if (!dir) return;
    const container = await this.containerFor(dir);
    const depth = dir === this.folder ? 0 : Number(this.rowFor(dir)?.dataset.depth ?? 0) + 1;
    const name = await this.askName(container, container.firstElementChild, '新しいフォルダ', depth, false);
    if (!name) return;
    try {
      const path = await createFolder(dir, name);
      this.expanded.add(path);
      this.select(path, true);
      await this.refresh();
      this.root.dispatchEvent(new CustomEvent('tree-change'));
    } catch (e) {
      this.handlers.notify(e instanceof Error ? e.message : String(e), true);
    }
  }

  async rename(path = this.selected?.path) {
    const row = path && this.rowFor(path);
    if (!path || !row) return;
    const isDirectory = row.classList.contains('tree-dir');
    const li = row.parentElement!;
    row.hidden = true;
    const name = await this.askName(li, row.nextSibling as Element | null, basename(path), Number(row.dataset.depth), !isDirectory);
    row.hidden = false;
    if (!name || name === basename(path)) return;
    try {
      const target = await renameItem(path, name);
      // フォルダの名前を変えたら、その中の展開状態も付け替える
      this.expanded = new Set([...this.expanded].map((p) => (isUnder(p, path) ? target + p.slice(path.length) : p)));
      this.select(target, isDirectory);
      this.handlers.renamed(path, target);
      await this.refresh();
      this.root.dispatchEvent(new CustomEvent('tree-change'));
    } catch (e) {
      this.handlers.notify(e instanceof Error ? e.message : String(e), true);
    }
  }

  async remove(path = this.selected?.path) {
    if (!path) return;
    const name = basename(path);
    if (!(await this.handlers.confirm(`「${name}」をゴミ箱へ移動しますか？`))) return;
    try {
      await trashItem(path);
      if (this.selected && isUnder(this.selected.path, path)) this.selected = null;
      this.handlers.deleted(path);
      await this.refresh();
      this.handlers.notify(`「${name}」をゴミ箱へ移動しました`);
    } catch (e) {
      this.handlers.notify(e instanceof Error ? e.message : String(e), true);
    }
  }

  // ---- 操作の受け付け ----

  private onKeyDown(e: KeyboardEvent) {
    if (this.editing || !this.selected) return;
    if (e.key === 'F2') this.rename();
    else if (e.key === 'Delete') this.remove();
    else return;
    e.preventDefault();
  }

  private onContextMenu(e: MouseEvent) {
    if (!this.folder || this.editing) return;
    e.preventDefault();
    const row = (e.target as HTMLElement).closest<HTMLElement>('.tree-dir, .tree-file');
    // 何もない所を右クリックしたら、一番上のフォルダに対する操作にする
    if (row) this.select(row.dataset.path!, row.classList.contains('tree-dir'));
    else {
      this.selected = null;
      this.markSelected();
    }
    const path = row?.dataset.path;
    const items: MenuEntry[] = [
      ...(path && row?.classList.contains('tree-file') ? [{ label: '新しいタブで開く', run: () => this.handlers.openInNewTab(path) } as MenuEntry, 'separator' as const] : []),
      { label: '新しいファイル', run: () => void this.newFile() },
      { label: '新しいフォルダ', run: () => void this.newFolder() },
    ];
    if (path) {
      items.push(
        'separator',
        { label: '名前を変更', shortcut: 'F2', run: () => void this.rename(path) },
        { label: 'ゴミ箱へ移動', shortcut: 'Delete', run: () => void this.remove(path) },
        'separator',
        {
          label: 'パスをコピー',
          run: () =>
            void navigator.clipboard
              .writeText(path)
              .then(() => this.handlers.notify('パスをコピーしました'))
              .catch(() => this.handlers.notify('コピーできませんでした', true)),
        },
        { label: 'ファイルマネージャーで表示', run: () => void revealItem(path).catch((err) => this.handlers.notify(String(err), true)) },
      );
    }
    showContextMenu(items, e.clientX, e.clientY);
  }
}
