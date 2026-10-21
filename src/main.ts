import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { diffLines } from 'diff';
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { type EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { insert, replaceAll } from '@milkdown/kit/utils';
import '@fontsource/m-plus-rounded-1c/400.css';
import '@fontsource/m-plus-rounded-1c/500.css';
import '@fontsource/m-plus-rounded-1c/700.css';
import '@milkdown/crepe/theme/common/style.css';
import lightTheme from '@milkdown/crepe/theme/frame.css?inline';
import darkTheme from '@milkdown/crepe/theme/frame-dark.css?inline';
import './style.css';
import { FileTree } from './filetree';
import { setupLinks, slugify } from './links';
import { EditorTarget, FindBar, SourceTarget } from './find';
import { parseHeadings, renderOutline, type Heading } from './outline';
import {
  type Doc,
  confirmDialog,
  fileStamp,
  forgetBrowserHandle,
  initialFile,
  isImagePath,
  isMarkdownPath,
  isTauri,
  onCloseRequested,
  exportPdf,
  onFileDrop,
  openDoc,
  pickPdfPath,
  openExternalUrl,
  openWithSystem,
  resolveFromDoc,
  openFolderDialog,
  readDoc,
  resolveImageUrl,
  saveDoc,
  setWindowTitle,
  storeImage,
} from './platform';
import { addRecent, readDrafts, readRecent, readSession, removeRecent, writeDrafts, writeSession, type Draft, type RecentFile } from './session';
import { brInTableCells, excelLikeTable, selectionInTable } from './table-edit';
import { setupTableMenu } from './table-menu';
import { showContextMenu } from './context-menu';
import { defaultHandlers } from 'mdast-util-to-markdown';
import type { Handle } from 'mdast-util-to-markdown';
import { offsetTopsOf, replaceRange, scrollToPos, setupSourceEditor } from './source-editor';
import { looksLikeTsv, tsvToMarkdownTable } from './tsv';

type Mode = 'wysiwyg' | 'split' | 'source';
type Theme = 'system' | 'light' | 'dark';
type Panel = 'outline' | 'files';
const MODES: Mode[] = ['wysiwyg', 'split', 'source'];
const THEMES: Theme[] = ['system', 'light', 'dark'];
const THEME_LABEL: Record<Theme, string> = { system: 'システムに合わせる', light: 'ライト', dark: 'ダーク' };
const UNTITLED = '無題.md';
const AUTOSAVE_DELAY = 1500;

const SAMPLE = `# mdnote へようこそ

この画面のまま直接編集できます。保存すると普通の Markdown になります。

## 表

| 項目 | 説明 |
| --- | --- |
| Tab | 次のセルへ移動 |
| 右クリック | 行・列の挿入や削除、配置の変更 |

Excel やスプレッドシートの範囲をコピーして貼り付けると表になります。

## 書き方のヒント

- \`/\` でブロック挿入メニュー
- 文字を選択すると書式ツールバー
- [ ] チェックボックスはクリックで切り替え
- 画像は貼り付けかドラッグ＆ドロップで \`images/\` に保存

## ショートカット

| キー | 動作 |
| --- | --- |
| Ctrl+/ | プレビュー編集・分割・ソースの切り替え |
| Ctrl+F / Ctrl+H | 検索 / 置換 |
| Ctrl+Shift+E | サイドバーの表示切り替え |
| Ctrl+S / Ctrl+Shift+S | 保存 / 名前を付けて保存 |
| Ctrl+P | PDF として書き出す |
| Enter / Enter 2 回 | 改行 (行末に半角スペース 2 つ) / 段落を分ける |
| Ctrl+Shift+O | フォルダを開く |
| Ctrl+W / Ctrl+Tab | タブを閉じる / 次のタブへ |
| F2 / Enter / ダブルクリック | 表のセルを編集 (Esc で終了) |
| Ctrl+C / Ctrl+V | 表のセルを Excel 形式でコピー・貼り付け |
`;

// ---- 設定の保存 (失敗しても動くように) ----

// allowed が null なら任意の文字列を受け付ける
function loadPref<T extends string>(key: string, allowed: readonly T[] | null, fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && (!allowed || allowed.includes(v)) ? v : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても既定値で動く
  }
}

// ---- DOM ----

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const workspace = $('workspace');
const source = $<HTMLTextAreaElement>('source');
const wysiwygPane = $('wysiwyg-pane');
const fileInput = $<HTMLInputElement>('file-input');
const filenameEl = $('filename');
const dirtyEl = $('dirty');
const tabBar = $('tab-bar');
const outlineList = $('outline-list');
const statusMessage = $('status-message');
const statusCount = $('status-count');
const docStats = $('doc-stats');
const themeButton = $<HTMLButtonElement>('btn-theme');
const autosaveButton = $<HTMLButtonElement>('btn-autosave');
const recentButton = $<HTMLButtonElement>('btn-recent');
const recentMenu = $('recent-menu');
const diffDialog = $<HTMLDialogElement>('diff-dialog');
const notice = $('notice');
const modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode button');
const panelButtons = document.querySelectorAll<HTMLButtonElement>('.sidebar-tabs button');

// ---- タブ ----

interface NoticeState {
  text: string;
  reload: boolean;
  diff: boolean;
}

interface Tab {
  id: number;
  doc: Doc;
  // 正となる Markdown。ソース側で書いた生テキストはそのまま保持する。
  markdown: string;
  // エディタが最後に出力した Markdown。replaceAll 後の再通知を本物の編集と区別するために使う。
  lastEditorMd: string;
  dirty: boolean;
  // 裏に回っているタブのエディタの状態 (元に戻す履歴ごと保持する)
  state: EditorState | null;
  scroll: [number, number];
  // 内容を丸ごと読み込み直すたびに増やす。保存中に読み込み直された場合の後処理を止めるため
  generation: number;
  saving: boolean;
  autosaveTimer?: number;
  // ディスク上のファイルの、最後に確認した内容と更新日時
  diskContent: string | null;
  diskStamp: string | null;
  // 確認するかどうか。保存中は自分の書き込みを誤検知しないよう止める
  watching: boolean;
  externalContent: string | null;
  externalConflict: boolean;
  notice: NoticeState | null;
}

let nextTabId = 1;
const tabs: Tab[] = [];

function createTab(doc: Doc, content: string): Tab {
  return {
    id: nextTabId++,
    doc,
    markdown: content,
    lastEditorMd: '',
    dirty: false,
    state: null,
    scroll: [0, 0],
    generation: 0,
    saving: false,
    diskContent: null,
    diskStamp: null,
    watching: false,
    externalContent: null,
    externalConflict: false,
    notice: null,
  };
}

// いま表示しているタブ
let cur = createTab({ path: null, name: UNTITLED }, SAMPLE);
tabs.push(cur);

// ---- 状態 ----

let mode: Mode = loadPref('mode', MODES, 'wysiwyg');
let theme: Theme = loadPref('theme', THEMES, 'system');
let autosave = loadPref('autosave', ['on', 'off'] as const, 'on') === 'on';
// Enter を段落内の改行 (行末に半角スペース 2 つ) にするか。オフなら Enter で段落を分ける
let hardBreakEnter = loadPref('hardBreakEnter', ['on', 'off'] as const, 'on') === 'on';
// 旧版で覚えていた「前回のファイル」(起動処理で上書きされる前に読んでおく)
const lastFile = loadPref('lastFile', null, '');
const savedSession = readSession();
let draftTimer: number | undefined;
let draftStorageWarning = false;
let pendingApply: number | undefined;
// ソース表示での編集がまだエディタに入っていないか
let editorBehind = false;
let headings: Heading[] = [];

// ---- テーマ ----

const crepeTheme = document.createElement('style');
document.head.append(crepeTheme);
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

// forced: PDF の書き出し中など、一時的に決まったテーマで表示する
function applyTheme(forced?: 'light' | 'dark') {
  const resolved = forced ?? (theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme);
  document.documentElement.dataset.theme = resolved;
  crepeTheme.textContent = resolved === 'dark' ? darkTheme : lightTheme;
  themeButton.title = `テーマ: ${THEME_LABEL[theme]}`;
}

darkQuery.addEventListener('change', () => applyTheme());
applyTheme();

// ---- エディタ ----

async function uploadImage(file: Blob | string, name?: string): Promise<string> {
  const t = cur;
  if (isTauri && !t.doc.path) {
    const ok = await confirmDialog('画像はMarkdownファイルと同じ場所の images/ に保存します。先にファイルを保存しますか？');
    if (!ok || !(await doSave(t))) throw new Error('画像の保存を中止しました');
  }
  return storeImage(file, t.doc.path, name);
}

// 段落内の改行は行末の半角スペース 2 つ、表のセル内の改行は <br> で書く
const lineBreakHandler: Handle = (node, parent, state, info) => {
  if ((state.stack as string[]).includes('tableCell')) return '<br>';
  const out = defaultHandlers.break(node as never, parent as never, state, info);
  return out === '\\\n' ? '  \n' : out;
};

const crepe = new Crepe({
  root: '#editor',
  defaultValue: cur.markdown,
  featureConfigs: {
    [CrepeFeature.ImageBlock]: {
      onUpload: (f) => uploadImage(f, f.name),
      proxyDomURL: (url) => resolveImageUrl(url, cur.doc.path),
    },
    [CrepeFeature.Placeholder]: { text: '入力するか「/」でメニュー' },
  },
});
// 出力する Markdown の記法を一般的なものに揃える
crepe.editor.config((ctx) => {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    bullet: '-' as const,
    emphasis: '*' as const,
    rule: '-' as const,
    // 段落内の改行は「\」ではなく、行末の半角スペース 2 つで書く (表の中など改行できない所は既定のまま)
    handlers: { ...prev.handlers, break: lineBreakHandler },
  }));
});
crepe.editor.use(excelLikeTable).use(brInTableCells);
crepe.on((api) => api.markdownUpdated(() => syncFromEditor()));
await crepe.create();
cur.lastEditorMd = crepe.getMarkdown();
source.value = cur.markdown;

const view = () => crepe.editor.action((ctx) => ctx.get(editorViewCtx));

// プレビュー編集の Enter: 段落の中では改行 (Markdown では行末に半角スペース 2 つ) を入れ、
// 改行の直後でもう一度 Enter を押したら段落を分ける。箇条書き・見出し・表・コードでは既定の動きのまま。
view().dom.addEventListener(
  'keydown',
  (e) => {
    if (!hardBreakEnter || e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.isComposing || e.keyCode === 229) return;
    // 「/」メニューなどが開いているときは、Enter で項目を選ぶ
    if (document.querySelector('.milkdown-slash-menu[data-show="true"]')) return;
    const v = view();
    const { selection, schema } = v.state;
    if (!(selection instanceof TextSelection)) return;
    const { $from } = selection;
    if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size === 0) return;
    const container = $from.node($from.depth - 1).type.name;
    if (container !== 'doc' && container !== 'blockquote') return;
    e.preventDefault();
    e.stopPropagation();
    const tr = v.state.tr;
    if (selection.empty && $from.nodeBefore?.type.name === 'hardbreak') {
      // 改行の直後: その改行を取り除いて段落を分ける
      tr.delete($from.pos - 1, $from.pos).split($from.pos - 1);
    } else {
      tr.replaceSelectionWith(schema.nodes.hardbreak.create());
    }
    v.dispatch(tr.scrollIntoView());
  },
  true,
);

// 改行の直後に「- 」「1. 」「# 」「> 」「``` 」などを打ったら、そこで段落を分けて
// 箇条書きや見出しへの自動変換が効くようにする (自動変換は段落の先頭でしか働かないため)
const BLOCK_MARKER = /^(?:[-*+]|\d+[.)]|#{1,6}|>|```\w*)$/;
view().dom.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const v = view();
    const { selection } = v.state;
    if (!(selection instanceof TextSelection) || !selection.empty) return;
    const { $from } = selection;
    if ($from.parent.type.name !== 'paragraph') return;
    // カーソルより前で最後の改行を探す
    let breakPos = -1;
    $from.parent.forEach((child, offset) => {
      if (child.type.name === 'hardbreak' && offset < $from.parentOffset) breakPos = $from.start() + offset;
    });
    if (breakPos < 0) return;
    const marker = v.state.doc.textBetween(breakPos + 1, $from.pos);
    if (!BLOCK_MARKER.test(marker)) return;
    // ここでは段落を分けるだけ。続けて入るスペースで自動変換が働く
    v.dispatch(v.state.tr.delete(breakPos, breakPos + 1).split(breakPos));
  },
  true,
);

setupSourceEditor(source, { hardBreakOnEnter: () => hardBreakEnter });

const sourceTarget = new SourceTarget(source);
const editorTarget = new EditorTarget(view);
const findBar = new FindBar($('find-bar'), () => (mode === 'source' ? sourceTarget : editorTarget));

// ---- ステータス ----

let statusTimer: number | undefined;
function showStatus(message: string, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (statusMessage.textContent = ''), isError ? 8000 : 3000);
}

function reportError(e: unknown) {
  console.error(e);
  showStatus(`エラー: ${e instanceof Error ? e.message : String(e)}`, true);
}

setupTableMenu(view, (message) => showStatus(message));

function updateCount() {
  const md = cur.markdown;
  const chars = [...md.replace(/\s/g, '')].length;
  const lines = md ? md.split('\n').length : 0;
  const tasks = [...md.matchAll(/^\s*[-*+]\s+\[([ xX])\]/gm)];
  const checked = tasks.filter((m) => m[1].toLowerCase() === 'x').length;
  const words = (md.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu) ?? []).length;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md)?.[1];
  const metaKeys = frontmatter ? frontmatter.split(/\r?\n/).filter((line) => /^[\w-]+\s*:/.test(line)).length : 0;
  statusCount.textContent = `${chars.toLocaleString()} 文字 · ${lines.toLocaleString()} 行`;
  docStats.textContent = `${words.toLocaleString()} 語 · 約 ${Math.max(1, Math.ceil(words / 500))} 分${tasks.length ? ` · ☑ ${checked}/${tasks.length}` : ''}${metaKeys ? ` · frontmatter ${metaKeys} 項目` : ''}`;
  docStats.title = '日本語は連続する文字列を1語として概算。読了時間は毎分500語換算。';
}

function splitFrontmatter(markdown: string) {
  const match = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/.exec(markdown);
  return match ? { frontmatter: match[1], body: markdown.slice(match[1].length) } : { frontmatter: '', body: markdown };
}

// 表示中のタブの名前・未保存マーク・ウィンドウタイトルを更新する
function updateDocUi() {
  filenameEl.textContent = cur.doc.name;
  filenameEl.title = cur.doc.path ?? cur.doc.name;
  dirtyEl.hidden = !cur.dirty;
  setWindowTitle(`${cur.dirty ? '● ' : ''}${cur.doc.name} - mdnote`);
  renderTabs();
  fileTree.setActive(cur.doc.path);
}

function setDirty(t: Tab, value: boolean) {
  t.dirty = value;
  if (t === cur) updateDocUi();
  else renderTabs();
  if (value) {
    scheduleDraft();
    scheduleAutosave(t);
  }
}

// ---- 下書き (未保存のタブの内容を一時保存し、異常終了しても復元できるようにする) ----

function persistDrafts() {
  window.clearTimeout(draftTimer);
  flush();
  const drafts = tabs.filter((t) => t.dirty).map((t) => ({ doc: t.doc, content: t.markdown }));
  if (!writeDrafts(drafts) && !draftStorageWarning) {
    draftStorageWarning = true;
    showStatus('下書きの一時保存に失敗しました。手動で保存してください。', true);
  }
}

function scheduleDraft() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(persistDrafts, 600);
}

// ---- 自動保存 ----

function scheduleAutosave(t: Tab) {
  window.clearTimeout(t.autosaveTimer);
  if (!autosave || !t.doc.path) return;
  t.autosaveTimer = window.setTimeout(() => void autosaveTab(t), AUTOSAVE_DELAY);
}

async function autosaveTab(t: Tab) {
  window.clearTimeout(t.autosaveTimer);
  // 他のアプリとの競合があるときは、勝手に上書きせず判断を待つ
  if (!autosave || !t.dirty || !t.doc.path || t.saving || t.externalConflict || !tabs.includes(t)) return;
  try {
    await doSave(t, false, true);
  } catch (e) {
    reportError(e);
  }
}

async function autosaveAll() {
  if (!autosave) return;
  for (const t of [...tabs]) await autosaveTab(t);
}

function setAutosave(value: boolean) {
  autosave = value;
  savePref('autosave', value ? 'on' : 'off');
  autosaveButton.classList.toggle('on', value);
  autosaveButton.title = value ? '自動保存: オン (編集が止まると保存)' : '自動保存: オフ';
  if (value) for (const t of tabs) if (t.dirty) scheduleAutosave(t);
}

// ---- 最近開いたファイル ----

function renderRecent(files: RecentFile[] = readRecent()) {
  recentMenu.replaceChildren();
  if (!files.length) {
    const empty = document.createElement('span');
    empty.className = 'recent-empty';
    empty.textContent = '履歴はありません';
    recentMenu.append(empty);
    return;
  }
  for (const file of files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-item';
    button.title = file.path;
    button.textContent = file.name;
    button.addEventListener('click', () => {
      closeRecent();
      openPath(file.path).catch((error) => {
        renderRecent(removeRecent(file.path));
        reportError(error);
      });
    });
    recentMenu.append(button);
  }
}

function closeRecent() {
  recentMenu.hidden = true;
  recentButton.setAttribute('aria-expanded', 'false');
}

// ---- 同期 ----

let changeTimer: number | undefined;
// 文書が変わったときの重めの処理 (目次・文字数・検索結果) はまとめて行う
function onContentChanged() {
  window.clearTimeout(changeTimer);
  // 長い文書では目次・統計・検索の再計算を少し待ち、入力中の連続処理を抑える。
  const delay = Math.min(900, 150 + Math.floor(cur.markdown.length / 100_000) * 100);
  changeTimer = window.setTimeout(() => {
    sourceTops = null;
    refreshOutline();
    updateCount();
    findBar.search();
  }, delay);
}

function syncFromEditor() {
  const md = crepe.getMarkdown();
  if (md === cur.lastEditorMd) return;
  cur.lastEditorMd = md;
  cur.markdown = splitFrontmatter(cur.markdown).frontmatter + md;
  if (document.activeElement !== source) source.value = cur.markdown;
  setDirty(cur, true);
  onContentChanged();
}

// flush=true は文書を丸ごと入れ替える (元に戻す履歴もリセットする)
function applyToEditor(flushHistory = false) {
  window.clearTimeout(pendingApply);
  pendingApply = undefined;
  crepe.editor.action(replaceAll(splitFrontmatter(cur.markdown).body, flushHistory));
  cur.lastEditorMd = crepe.getMarkdown();
  editorBehind = false;
}

function setMode(next: Mode) {
  if (findBar.isOpen) (mode === 'source' ? sourceTarget : editorTarget).highlight([], -1);
  // エディタの変更通知は遅れて届くので、切り替え前に直近の編集を取り込んでおく
  if (mode !== 'source') syncFromEditor();
  if (mode === 'source' && next !== 'source') applyToEditor();
  if (next !== 'wysiwyg') source.value = cur.markdown;
  mode = next;
  savePref('mode', next);
  workspace.className = `workspace mode-${next}`;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === next));
  sourceTops = null;
  if (next === 'source') source.focus();
  findBar.search();
}

// 保存などの直前に、まだ反映していない編集を確定させる
function flush() {
  if (pendingApply !== undefined) applyToEditor();
  if (mode !== 'source') syncFromEditor();
}

source.addEventListener('input', () => {
  cur.markdown = source.value;
  if (mode === 'source') editorBehind = true;
  setDirty(cur, true);
  onContentChanged();
  if (mode === 'split') {
    window.clearTimeout(pendingApply);
    pendingApply = window.setTimeout(() => applyToEditor(), 300);
  }
});

// ---- タブの切り替え ----

// 同じ名前のファイルが複数開いているときは、親フォルダ名を添えて区別する
function tabLabel(t: Tab) {
  const { name, path } = t.doc;
  if (!path || tabs.filter((o) => o.doc.name === name).length < 2) return name;
  const parent = path.split(/[\\/]/).slice(-2, -1)[0];
  return parent ? `${name} — ${parent}` : name;
}

function renderTabs() {
  tabBar.replaceChildren();
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = `tab${t === cur ? ' active' : ''}${t.dirty ? ' dirty' : ''}`;
    el.title = t.doc.path ?? t.doc.name;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t === cur));
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tabLabel(t);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.title = '閉じる (Ctrl+W)';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void closeTab(t).catch(reportError);
    });
    el.append(name, closeBtn);
    el.addEventListener('mousedown', (e) => {
      // 中クリックで閉じる
      if (e.button === 1) {
        e.preventDefault();
        void closeTab(t).catch(reportError);
      }
    });
    el.addEventListener('click', () => activate(t));
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/tab-id', String(t.id));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => { e.preventDefault(); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = tabs.findIndex((x) => x.id === Number(e.dataTransfer?.getData('text/tab-id')));
      const to = tabs.indexOf(t);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      renderTabs();
    });
    tabBar.append(el);
  }
  tabBar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// 表示中のタブの状態をタブに書き戻す
function captureCurrent() {
  flush();
  // ソース表示で編集した内容は、まだエディタに入っていないので入れてから保存する
  if (editorBehind) applyToEditor();
  cur.state = view().state;
  cur.scroll = [source.scrollTop, wysiwygPane.scrollTop];
}

function showTab(t: Tab) {
  cur = t;
  window.clearTimeout(pendingApply);
  pendingApply = undefined;
  source.value = t.markdown;
  // 画像の相対パスを解決するため、cur を切り替えてからエディタの中身を入れ替える
  if (t.state) {
    view().updateState(t.state);
    t.state = null;
    editorBehind = false;
  } else {
    applyToEditor(true);
  }
  updateDocUi();
  renderNotice();
  onContentChanged();
  const [s, w] = t.scroll;
  requestAnimationFrame(() => {
    source.scrollTop = s;
    wysiwygPane.scrollTop = w;
  });
  saveSession();
  void checkExternalChange();
}

function activate(t: Tab) {
  if (t === cur || !tabs.includes(t)) return;
  captureCurrent();
  // 切り替えるタブに未保存の変更があれば、自動保存の対象なら先に保存しておく
  if (cur.dirty) void autosaveTab(cur);
  showTab(t);
}

function cycleTab(dir: number) {
  const i = tabs.indexOf(cur);
  activate(tabs[(i + dir + tabs.length) % tabs.length]);
}

// 何も書いていない無題のタブ (ファイルを開いたときに置き換えてよい)
function isPristine(t: Tab) {
  // 変更の通知は遅れて届くので、判定の前に直近の編集を取り込む
  if (t === cur) flush();
  return !t.doc.path && !t.dirty && (t.markdown === SAMPLE || t.markdown.trim() === '');
}

async function closeTab(t: Tab) {
  if (t === cur) flush();
  if (t.dirty) {
    if (autosave && t.doc.path && !t.externalConflict) await doSave(t, false, true);
    if (t.dirty && !(await confirmDialog(`「${t.doc.name}」の変更は保存されていません。閉じますか？`))) return;
  }
  window.clearTimeout(t.autosaveTimer);
  const index = tabs.indexOf(t);
  if (index < 0) return;
  tabs.splice(index, 1);
  if (!tabs.length) tabs.push(createTab({ path: null, name: UNTITLED }, ''));
  if (t === cur) showTab(tabs[Math.min(index, tabs.length - 1)]);
  else renderTabs();
  persistDrafts();
  saveSession();
}

function saveSession() {
  writeSession({
    files: tabs.flatMap((t) => (t.doc.path ? [t.doc.path] : [])),
    active: cur.doc.path,
    folder: fileTree.current,
  });
}

// ---- ファイル操作 ----

// タブの中身をファイルの内容で置き換える
function loadIntoTab(t: Tab, doc: Doc, content: string, keepScroll = false) {
  t.generation++;
  t.doc = doc;
  t.markdown = content;
  t.dirty = false;
  t.state = null;
  t.notice = null;
  t.externalContent = null;
  if (doc.path) renderRecent(addRecent(doc));
  rememberDisk(t, content);
  if (t !== cur) {
    renderTabs();
    return;
  }
  source.value = content;
  applyToEditor(true);
  updateDocUi();
  renderNotice();
  if (!keepScroll) {
    source.scrollTop = 0;
    wysiwygPane.scrollTop = 0;
  }
  onContentChanged();
  saveSession();
}

// 新しいタブで開く。同じファイルがすでに開いていればそのタブに切り替える。
// 何も書いていない無題のタブは、新しいタブを作らずに置き換える。
function openInTab(doc: Doc, content: string): Tab {
  const existing = doc.path ? tabs.find((t) => t.doc.path === doc.path) : undefined;
  if (existing) {
    activate(existing);
    return existing;
  }
  if (isPristine(cur)) {
    loadIntoTab(cur, doc, content);
    return cur;
  }
  captureCurrent();
  const t = createTab(doc, content);
  tabs.splice(tabs.indexOf(cur) + 1, 0, t);
  if (doc.path) renderRecent(addRecent(doc));
  rememberDisk(t, content);
  showTab(t);
  return t;
}

async function openPath(path: string) {
  const existing = tabs.find((t) => t.doc.path === path);
  if (existing) {
    activate(existing);
    return;
  }
  const opened = await readDoc(path);
  openInTab({ path: opened.path, name: opened.name }, opened.content);
}

async function doNew() {
  forgetBrowserHandle();
  if (isPristine(cur)) {
    loadIntoTab(cur, { path: null, name: UNTITLED }, '');
    return;
  }
  captureCurrent();
  const t = createTab({ path: null, name: UNTITLED }, '');
  tabs.splice(tabs.indexOf(cur) + 1, 0, t);
  showTab(t);
}

async function doOpen() {
  // ブラウザ版はファイルの場所を持てないので、1 つの文書だけを扱う
  if (!isTauri && !(await confirmDiscard(cur))) return;
  const opened = await openDoc(fileInput);
  if (opened) openInTab({ path: opened.path, name: opened.name }, opened.content);
}

async function confirmDiscard(t: Tab) {
  return !t.dirty || confirmDialog('保存されていない変更があります。破棄しますか？');
}

// silent=true は自動保存 (完了メッセージを控えめにする)
async function doSave(t: Tab = cur, saveAs = false, silent = false): Promise<boolean> {
  if (t.saving) return false;
  if (t === cur) flush();
  if (t.externalConflict && t.doc.path && !saveAs && !(await confirmDialog('他のアプリで変更されたファイルを上書きしますか？'))) return false;
  const content = t.markdown;
  const generation = t.generation;
  t.saving = true;
  window.clearTimeout(t.autosaveTimer);
  const wasWatching = t.watching;
  t.watching = false;
  let saved: Doc | null;
  try {
    saved = await saveDoc(content, t.doc, saveAs);
  } finally {
    if (generation === t.generation) t.watching = wasWatching;
    t.saving = false;
  }
  if (!saved) return false;
  if (generation !== t.generation) return true;
  if (t === cur) flush();
  t.doc = saved;
  if (saved.path) renderRecent(addRecent(saved));
  const hasNewEdits = t.markdown !== content;
  t.externalConflict = false;
  t.notice = null;
  if (t === cur) renderNotice();
  setDirty(t, hasNewEdits);
  if (t === cur) updateDocUi();
  persistDrafts();
  rememberDisk(t, content);
  saveSession();
  showStatus(silent ? '自動保存しました' : `保存しました: ${saved.path ?? saved.name}`);
  return true;
}

// ---- 他のアプリでの変更の検知 ----

function rememberDisk(t: Tab, content: string) {
  t.diskContent = content;
  t.externalConflict = false;
  t.watching = false;
  const path = t.doc.path;
  if (!path) return;
  fileStamp(path).then((st) => {
    if (t.doc.path !== path) return;
    t.diskStamp = st;
    t.watching = true;
  });
}

function setNotice(t: Tab, state: NoticeState | null) {
  t.notice = state;
  if (t === cur) renderNotice();
}

function renderNotice() {
  const state = cur.notice;
  notice.hidden = !state;
  if (!state) return;
  $('notice-text').textContent = state.text;
  $('notice-reload').hidden = !state.reload;
  $('notice-diff').hidden = !state.diff;
}

async function reloadFromDisk(t: Tab = cur) {
  if (!t.doc.path) return;
  const opened = await readDoc(t.doc.path);
  loadIntoTab(t, { path: opened.path, name: opened.name }, opened.content, true);
  persistDrafts();
  showStatus('他のアプリでの変更を読み込みました');
}

let checking = false;
async function checkExternalChange() {
  const t = cur;
  const path = t.doc.path;
  if (!path || !t.watching || checking) return;
  checking = true;
  try {
    const st = await fileStamp(path);
    if (t.doc.path !== path || st === t.diskStamp) return;
    t.diskStamp = st;
    if (st === null) {
      t.externalContent = null;
      t.externalConflict = true;
      setNotice(t, { text: 'ファイルが削除または移動されました。保存すると元の場所に作り直します。', reload: false, diff: false });
      return;
    }
    const content = (await readDoc(path)).content;
    if (t.doc.path !== path || !t.watching) return;
    // 更新日時だけ変わって中身が同じ場合や、自分が保存した内容の場合は何もしない
    if (content === t.diskContent || content === t.markdown) {
      t.diskContent = content;
      return;
    }
    t.diskContent = content;
    if (!t.dirty) {
      // こちらで編集していなければ、そのまま読み込み直す
      loadIntoTab(t, { path, name: t.doc.name }, content, true);
      showStatus('他のアプリでの変更を読み込みました');
      return;
    }
    t.externalContent = content;
    t.externalConflict = true;
    setNotice(t, {
      text: 'このファイルは他のアプリで変更されました。読み込み直すと、こちらの未保存の変更は失われます。',
      reload: true,
      diff: true,
    });
  } catch (e) {
    reportError(e);
  } finally {
    checking = false;
  }
}

function showExternalDiff() {
  if (cur.externalContent === null) return;
  flush();
  const content = $('diff-content');
  content.replaceChildren();
  for (const part of diffLines(cur.markdown, cur.externalContent)) {
    const line = document.createElement('span');
    line.className = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-unchanged';
    const lines = part.value.split('\n');
    if (lines.at(-1) === '') lines.pop();
    line.textContent = lines.map((text) => `${part.added ? '+' : part.removed ? '-' : ' '} ${text}\n`).join('');
    content.append(line);
  }
  diffDialog.showModal();
}

$('notice-reload').addEventListener('click', () => void reloadFromDisk().catch(reportError));
$('notice-dismiss').addEventListener('click', () => setNotice(cur, null));
$('notice-diff').addEventListener('click', showExternalDiff);
$('diff-close').addEventListener('click', () => diffDialog.close());
$('diff-reload').addEventListener('click', () => {
  diffDialog.close();
  void reloadFromDisk().catch(reportError);
});
window.setInterval(() => void checkExternalChange(), 1500);

// ---- フォルダ ----

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`);

const fileTree = new FileTree($('file-tree'), {
  open: (path) => void openPath(path).catch(reportError),
  // 名前を変えたファイル (フォルダならその中のファイル) を開いているタブは、新しい場所に付け替える
  renamed(oldPath, newPath) {
    for (const t of tabs) {
      if (!t.doc.path || !isUnder(t.doc.path, oldPath)) continue;
      const path = newPath + t.doc.path.slice(oldPath.length);
      removeRecent(t.doc.path);
      t.doc = { path, name: path.split(/[\\/]/).pop() ?? path };
      addRecent(t.doc);
      t.watching = false;
      void fileStamp(path).then((st) => {
        if (t.doc.path !== path) return;
        t.diskStamp = st;
        t.watching = true;
      });
    }
    updateDocUi();
    renderRecent();
    saveSession();
  },
  // ゴミ箱へ移したファイルのタブは閉じる。未保存の変更があるタブは残して知らせる
  deleted(path) {
    for (const t of [...tabs]) {
      if (!t.doc.path || !isUnder(t.doc.path, path)) continue;
      removeRecent(t.doc.path);
      if (!t.dirty) void closeTab(t).catch(reportError);
      else {
        t.externalConflict = true;
        setNotice(t, { text: 'このファイルはゴミ箱へ移動されました。保存すると元の場所に作り直します。', reload: false, diff: false });
      }
    }
    renderRecent();
  },
  confirm: confirmDialog,
  notify: (message, isError) => showStatus(message, isError),
});

function setPanel(panel: Panel) {
  panelButtons.forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
  $('panel-outline').hidden = panel !== 'outline';
  $('panel-files').hidden = panel !== 'files';
  savePref('panel', panel);
}

// reveal: サイドバーをファイル一覧に切り替えて表示する (起動時の復元では前回の表示のままにする)
async function openFolder(folder: string, expanded: string[] = [], reveal = true) {
  await fileTree.setFolder(folder, expanded);
  $('folder-name').textContent = fileTree.folderName;
  $('folder-name').title = folder;
  for (const id of ['btn-folder-refresh', 'btn-tree-new-file', 'btn-tree-new-folder']) $(id).hidden = false;
  fileTree.setActive(cur.doc.path);
  if (reveal) {
    setPanel('files');
    setSidebarVisible(true);
  }
  saveSession();
  savePref('expandedDirs', JSON.stringify(expanded));
}

async function doOpenFolder() {
  if (!isTauri) {
    showStatus('フォルダを開く機能はデスクトップ版で使えます');
    return;
  }
  const folder = await openFolderDialog();
  if (folder) await openFolder(folder);
}

$('file-tree').addEventListener('tree-change', () => savePref('expandedDirs', JSON.stringify(fileTree.expandedDirs)));

// ---- 目次 ----

function refreshOutline() {
  headings = parseHeadings(cur.markdown);
  renderOutline(outlineList, headings, jumpToHeading);
  updateCurrentHeading();
}

const previewHeadings = () => wysiwygPane.querySelectorAll<HTMLElement>('.ProseMirror :is(h1, h2, h3, h4, h5, h6)');

function topWithin(el: HTMLElement, container: HTMLElement) {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

function jumpToHeading(i: number) {
  if (mode === 'source') {
    const pos = headings[i].offset;
    source.focus();
    source.setSelectionRange(pos, pos);
    scrollToPos(source, pos);
    return;
  }
  const el = previewHeadings()[i];
  if (!el) return;
  wysiwygPane.scrollTo({ top: topWithin(el, wysiwygPane) - 16 });
  const v = view();
  const pos = v.posAtDOM(el, 0);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
  v.focus();
}

function updateCurrentHeading() {
  let current = -1;
  if (mode === 'source') {
    getSourceTops().forEach((t, i) => {
      if (t <= source.scrollTop + 8) current = i;
    });
  } else {
    previewHeadings().forEach((el, i) => {
      if (topWithin(el, wysiwygPane) <= wysiwygPane.scrollTop + 24) current = i;
    });
  }
  outlineList.querySelectorAll('.outline-item').forEach((el, i) => el.classList.toggle('current', i === current));
}

// ---- リンク ----

// #見出し のアンカーへ移動する。GitHub と同じく、同じ見出しが続くと -1, -2 … が付く
function jumpToAnchor(anchor: string) {
  headings = parseHeadings(cur.markdown);
  const wanted = slugify(anchor);
  const seen = new Map<string, number>();
  const index = headings.findIndex((h) => {
    const base = slugify(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return (n ? `${base}-${n}` : base) === wanted || h.text === anchor;
  });
  if (index < 0) {
    showStatus(`見出し「${anchor}」が見つかりません`, true);
    return;
  }
  jumpToHeading(index);
}

async function openLink(href: string) {
  const [pathPart, ...rest] = href.split('#');
  const fragment = rest.length ? decodeURIComponent(rest.join('#')) : '';
  if (!pathPart) {
    if (fragment) jumpToAnchor(fragment);
    return;
  }
  // http: / mailto: などのスキームがあれば外部のアプリで開く (file: はこのアプリで扱う)
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathPart) && !/^file:/i.test(pathPart)) {
    await openExternalUrl(href);
    return;
  }
  const local = /^file:/i.test(pathPart) ? decodeURI(new URL(pathPart).pathname) : decodeURI(pathPart);
  if (!isTauri) {
    showStatus('ファイルへのリンクはデスクトップ版で開けます');
    return;
  }
  const path = await resolveFromDoc(local, cur.doc.path);
  if (!path) {
    showStatus('相対パスのリンクは、ファイルを保存してから開けます', true);
    return;
  }
  if (!isMarkdownPath(path)) {
    await openWithSystem(path);
    return;
  }
  try {
    await openPath(path);
  } catch {
    showStatus(`リンク先のファイルが見つかりません: ${local}`, true);
    return;
  }
  // タブの切り替えでスクロール位置が戻された後に移動する
  if (fragment) window.setTimeout(() => jumpToAnchor(fragment), 80);
}

setupLinks($('editor'), source, (href) => void openLink(href).catch(reportError), (text) => {
  $('status-hint').textContent = text ?? '';
});

function setSidebarVisible(visible: boolean) {
  document.body.classList.toggle('outline-hidden', !visible);
  $('btn-outline').classList.toggle('active', visible);
  $('btn-outline').setAttribute('aria-expanded', String(visible));
  savePref('outline', visible ? 'shown' : 'hidden');
}

const toggleSidebar = () => setSidebarVisible(document.body.classList.contains('outline-hidden'));

// ---- 分割表示のスクロール同期 (見出し位置を目印に補間する) ----

let sourceTops: number[] | null = null;
function getSourceTops() {
  sourceTops ??= offsetTopsOf(
    source,
    headings.map((h) => h.offset),
  );
  return sourceTops;
}

function anchors(): [number, number][] {
  const src = getSourceTops();
  const prev = [...previewHeadings()].map((el) => topWithin(el, wysiwygPane));
  const n = Math.min(src.length, prev.length);
  const pairs: [number, number][] = [[0, 0]];
  for (let i = 0; i < n; i++) pairs.push([src[i], prev[i]]);
  pairs.push([source.scrollHeight - source.clientHeight, wysiwygPane.scrollHeight - wysiwygPane.clientHeight]);
  // 単調増加でない区間は補間できないので除く
  return pairs.filter((p, i) => i === 0 || (p[0] >= pairs[i - 1][0] && p[1] >= pairs[i - 1][1]));
}

function interpolate(value: number, pairs: [number, number][], from: 0 | 1) {
  const to = from === 0 ? 1 : 0;
  for (let i = 1; i < pairs.length; i++) {
    const a = pairs[i - 1];
    const b = pairs[i];
    if (value <= b[from] || i === pairs.length - 1) {
      const span = b[from] - a[from];
      const t = span > 0 ? (value - a[from]) / span : 0;
      return a[to] + Math.min(1, Math.max(0, t)) * (b[to] - a[to]);
    }
  }
  return 0;
}

// 相手側を動かしたことで起きるスクロールイベントには反応しない
let scrollLock: HTMLElement | null = null;
function syncScroll(from: HTMLElement) {
  if (mode !== 'split' || scrollLock === from) return;
  const to = from === source ? wysiwygPane : source;
  scrollLock = to;
  to.scrollTop = interpolate(from.scrollTop, anchors(), from === source ? 0 : 1);
  requestAnimationFrame(() => requestAnimationFrame(() => (scrollLock = null)));
}

source.addEventListener('scroll', () => {
  syncScroll(source);
  updateCurrentHeading();
});
wysiwygPane.addEventListener('scroll', () => {
  syncScroll(wysiwygPane);
  updateCurrentHeading();
});
new ResizeObserver(() => (sourceTops = null)).observe(source);

// ---- 貼り付け・ドロップ ----

// items は貼り付けられた画像か、ドロップされたファイルのパス
async function uploadAll(items: (File | string)[]) {
  const urls: string[] = [];
  for (const item of items) urls.push(await uploadImage(item, typeof item === 'string' ? undefined : item.name));
  return urls;
}

async function insertImagesIntoEditor(items: (File | string)[], at?: { x: number; y: number }) {
  const urls = await uploadAll(items);
  if (at) {
    const v = view();
    const hit = v.posAtCoords({ left: at.x, top: at.y });
    if (hit) v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, hit.pos)));
  }
  crepe.editor.action(insert(urls.map((u) => `![](${u})`).join('\n\n')));
}

async function insertImagesIntoSource(items: (File | string)[]) {
  const urls = await uploadAll(items);
  const { selectionStart: s, selectionEnd: e } = source;
  replaceRange(source, s, e, urls.map((u) => `![](${u})`).join('\n'));
}

const imageFiles = (list?: FileList | null) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));

// タブ区切りテキスト (Excel 等) は表に、画像は images/ に保存して挿入する。コードブロック内は対象外。
$('editor').addEventListener(
  'paste',
  (e) => {
    if ((e.target as HTMLElement).closest('.cm-editor')) return;
    const images = imageFiles(e.clipboardData?.files);
    if (images.length) {
      e.preventDefault();
      e.stopPropagation();
      insertImagesIntoEditor(images).catch(reportError);
      return;
    }
    // 表の中への貼り付けは表の処理 (セルへの流し込み) に任せる
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!looksLikeTsv(text) || selectionInTable(view().state)) return;
    e.preventDefault();
    e.stopPropagation();
    crepe.editor.action(insert(tsvToMarkdownTable(text)));
  },
  true,
);

source.addEventListener('paste', (e) => {
  const images = imageFiles(e.clipboardData?.files);
  if (!images.length) return;
  e.preventDefault();
  insertImagesIntoSource(images).catch(reportError);
});

// ブラウザ版のドロップ (Tauri ではネイティブのイベントで受ける)
for (const el of [wysiwygPane, source]) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    if (el === wysiwygPane) wysiwygPane.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => wysiwygPane.classList.remove('drop-target'));
  el.addEventListener(
    'drop',
    (e) => {
      wysiwygPane.classList.remove('drop-target');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const md = files.find((f) => isMarkdownPath(f.name));
      if (md) {
        confirmDiscard(cur)
          .then(async (ok) => {
            if (!ok) return;
            const content = await md.text();
            forgetBrowserHandle();
            loadIntoTab(cur, { path: null, name: md.name }, content);
          })
          .catch(reportError);
        return;
      }
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (!images.length) return;
      const task = el === source ? insertImagesIntoSource(images) : insertImagesIntoEditor(images, { x: e.clientX, y: e.clientY });
      task.catch(reportError);
    },
    true,
  );
}

onFileDrop(({ paths, x, y }) => {
  const mds = paths.filter(isMarkdownPath);
  if (mds.length) {
    (async () => {
      for (const md of mds) await openPath(md);
    })().catch(reportError);
    return;
  }
  const images = paths.filter(isImagePath);
  if (!images.length) return;
  const overSource = mode !== 'wysiwyg' && source.contains(document.elementFromPoint(x, y));
  const task = overSource ? insertImagesIntoSource(images) : insertImagesIntoEditor(images, { x, y });
  task.catch(reportError);
});

// ---- PDF ----

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function doExportPdf() {
  flush();
  // ソース表示で書いた内容も、プレビューの見た目で出力する
  if (editorBehind) applyToEditor();
  openExportSettings();
}

const pageSizeSelect = $<HTMLSelectElement>('page-size');
const pageMarginSelect = $<HTMLSelectElement>('page-margin');
const pageMargins: Record<string, number> = { normal: 15, narrow: 10, wide: 25 };
function applyPrintSettings() {
  let style = document.getElementById('print-page-settings') as HTMLStyleElement | null;
  if (!style) { style = document.createElement('style'); style.id = 'print-page-settings'; document.head.append(style); }
  style.textContent = `@page { size: ${pageSizeSelect.value}; margin: ${pageMargins[pageMarginSelect.value] ?? 15}mm; }`;
}
function openExportSettings() {
  pageSizeSelect.value = loadPref('pageSize', ['A4', 'A3', 'Letter'] as const, 'A4');
  pageMarginSelect.value = loadPref('pageMargin', ['normal', 'narrow', 'wide'] as const, 'normal');
  $<HTMLDialogElement>('export-settings').showModal();
}
function savePrintSettings() {
  savePref('pageSize', pageSizeSelect.value);
  savePref('pageMargin', pageMarginSelect.value);
  applyPrintSettings();
}
async function doPrintPreview() {
  flush();
  if (editorBehind) applyToEditor();
  savePrintSettings();
  $<HTMLDialogElement>('export-settings').close();
  await nextFrame();
  window.print();
}
async function doPdfExport() {
  flush();
  if (editorBehind) applyToEditor();
  savePrintSettings();
  if (!isTauri) { $<HTMLDialogElement>('export-settings').close(); await doPrintPreview(); return; }
  const path = await pickPdfPath(cur.doc);
  if (!path) return;
  $<HTMLDialogElement>('export-settings').close();
  showStatus('PDF を書き出しています…');
  // ダークテーマでも白い紙に出力する
  applyTheme('light');
  await nextFrame();
  await nextFrame();
  try {
    await exportPdf(path, pageSizeSelect.value, pageMargins[pageMarginSelect.value] ?? 15);
    showStatus(`PDF を書き出しました: ${path}`);
  } finally {
    applyTheme();
  }
}

function exportHtml() {
  flush();
  if (editorBehind) applyToEditor();
  const title = cur.doc.name.replace(/\.md$/i, '');
  const content = view().dom.innerHTML;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)}</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui,sans-serif;color:#222}img{max-width:100%}pre{overflow:auto;padding:1em;background:#f4f4f4}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.4em .7em}blockquote{border-left:3px solid #bbb;padding-left:1em;color:#555} @media print{body{max-width:none;margin:0;padding:0}}</style></head><body>${content}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `${title || 'document'}.html`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus('HTML を書き出しました');
}

// ---- 設定 ----

function setHardBreakEnter(value: boolean) {
  hardBreakEnter = value;
  savePref('hardBreakEnter', value ? 'on' : 'off');
}

function openSettings() {
  const rect = $('btn-settings').getBoundingClientRect();
  const check = (on: boolean) => (on ? '✓ ' : '　 ');
  showContextMenu(
    [
      {
        label: `${check(hardBreakEnter)}Enter で改行（行末に半角スペース 2 つ）`,
        run: () => {
          setHardBreakEnter(!hardBreakEnter);
          showStatus(hardBreakEnter ? 'Enter で改行します（2 回押すと段落を分けます）' : 'Enter で段落を分けます（Shift+Enter で改行）');
        },
      },
      {
        label: `${check(autosave)}自動保存`,
        run: () => {
          setAutosave(!autosave);
          showStatus(autosave ? '自動保存をオンにしました' : '自動保存をオフにしました');
        },
      },
      'separator',
      { label: `テーマ: ${THEME_LABEL[theme]}（クリックで切り替え）`, run: cycleTheme },
    ],
    rect.left,
    rect.bottom + 4,
  );
}

// ---- ボタン・ショートカット ----

const run = (fn: () => Promise<unknown>) => () => void fn().catch(reportError);

function openFind(withReplace: boolean) {
  const selected =
    mode === 'source' ? source.value.slice(source.selectionStart, source.selectionEnd) : (window.getSelection()?.toString() ?? '');
  findBar.open(withReplace, selected);
}

function cycleTheme() {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  savePref('theme', theme);
  applyTheme();
  showStatus(`テーマ: ${THEME_LABEL[theme]}`);
}

modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));
panelButtons.forEach((b) => b.addEventListener('click', () => setPanel(b.dataset.panel as Panel)));
$('btn-new').addEventListener('click', run(doNew));
$('btn-open').addEventListener('click', run(doOpen));
$('btn-open-folder').addEventListener('click', run(doOpenFolder));
$('btn-folder').addEventListener('click', run(doOpenFolder));
$('btn-folder-refresh').addEventListener('click', run(() => fileTree.refresh()));
$('btn-tree-new-file').addEventListener('click', run(() => fileTree.newFile()));
$('btn-tree-new-folder').addEventListener('click', run(() => fileTree.newFolder()));
recentButton.addEventListener('click', () => {
  if (recentMenu.hidden) {
    renderRecent();
    recentMenu.hidden = false;
    recentButton.setAttribute('aria-expanded', 'true');
  } else closeRecent();
});
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('#recent-wrap')) closeRecent();
});
$('btn-save').addEventListener('click', run(() => doSave()));
$('btn-save-as').addEventListener('click', run(() => doSave(cur, true)));
$('btn-find').addEventListener('click', () => openFind(true));
$('btn-outline').addEventListener('click', toggleSidebar);
themeButton.addEventListener('click', cycleTheme);
$('btn-pdf').addEventListener('click', run(doExportPdf));
$('btn-html').addEventListener('click', exportHtml);
$('btn-print').addEventListener('click', openExportSettings);
$('btn-shortcuts').addEventListener('click', () => $<HTMLDialogElement>('shortcuts-dialog').showModal());
$('shortcuts-close').addEventListener('click', () => $<HTMLDialogElement>('shortcuts-dialog').close());
$('export-settings-close').addEventListener('click', () => $<HTMLDialogElement>('export-settings').close());
$('print-preview').addEventListener('click', run(doPrintPreview));
$('export-pdf').addEventListener('click', run(doPdfExport));
pageSizeSelect.addEventListener('change', savePrintSettings);
pageMarginSelect.addEventListener('change', savePrintSettings);
$('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  openSettings();
});
autosaveButton.addEventListener('click', () => {
  setAutosave(!autosave);
  showStatus(autosave ? '自動保存をオンにしました' : '自動保存をオフにしました');
});

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  const actions: Record<string, (() => void) | undefined> = {
    s: run(() => doSave(cur, e.shiftKey)),
    p: run(doExportPdf),
    o: e.shiftKey ? run(doOpenFolder) : run(doOpen),
    n: run(doNew),
    w: run(() => closeTab(cur)),
    f: () => openFind(false),
    h: () => openFind(true),
    '/': () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]),
    e: e.shiftKey ? toggleSidebar : undefined,
    tab: () => cycleTab(e.shiftKey ? -1 : 1),
    pagedown: () => cycleTab(1),
    pageup: () => cycleTab(-1),
  };
  const fn = actions[key];
  if (!fn) return;
  e.preventDefault();
  fn();
});

// 他のアプリに切り替えるときは保存しておき、戻ってきたら変更を確認する
window.addEventListener('blur', () => void autosaveAll());
window.addEventListener('focus', () => {
  void checkExternalChange();
  void fileTree.refresh().catch(() => {});
});

window.addEventListener('beforeunload', (e) => {
  if (tabs.some((t) => t.dirty) && !isTauri) e.preventDefault();
});
window.addEventListener('pagehide', persistDrafts);

onCloseRequested(async () => {
  flush();
  await autosaveAll();
  const unsaved = tabs.filter((t) => t.dirty);
  const close =
    !unsaved.length ||
    (await confirmDialog(`保存されていない変更があります (${unsaved.map((t) => t.doc.name).join('、')})。閉じますか？`));
  if (close) writeDrafts([]);
  return close;
});

// ---- 起動 ----

setMode(mode);
setAutosave(autosave);
setPanel(loadPref('panel', ['outline', 'files'] as const, 'outline'));
const narrowScreen = window.matchMedia('(max-width: 720px)');
setSidebarVisible(!narrowScreen.matches && loadPref('outline', ['shown', 'hidden'] as const, 'shown') === 'shown');
narrowScreen.addEventListener('change', (event) => {
  if (event.matches) setSidebarVisible(false);
});
if (isTauri) {
  $('recent-wrap').hidden = false;
  $('btn-open-folder').hidden = false;
  renderRecent();
} else {
  $('tab-files').hidden = true;
  setPanel('outline');
}
updateDocUi();
refreshOutline();
updateCount();

const startupDrafts = readDrafts();

if (isTauri) {
  if (savedSession.folder) {
    let expanded: string[] = [];
    try {
      expanded = JSON.parse(loadPref('expandedDirs', null, '[]'));
    } catch {
      // 展開状態が読めなければ閉じた状態で開く
    }
    await openFolder(savedSession.folder, expanded, false).catch(() => fileTree.setFolder(null));
  }
  // 前回開いていたタブを開き直す (消えたファイルは飛ばす)
  const files = savedSession.files.length ? savedSession.files : lastFile ? [lastFile] : [];
  for (const path of files) await openPath(path).catch(() => {});
  const arg = await initialFile().catch(() => null);
  if (arg) await openPath(arg).catch(reportError);
  else {
    const active = tabs.find((t) => t.doc.path === savedSession.active);
    if (active) activate(active);
  }
  savePref('lastFile', '');
}

function showRecovery(drafts: Draft[]) {
  const dialog = $<HTMLDialogElement>('recovery-notice');
  const date = new Date(Math.max(...drafts.map((d) => d.updatedAt))).toLocaleString();
  const names = drafts.map((d) => d.name).join('、');
  $('recovery-text').textContent = `${names} の未保存の下書きがあります（${date}）。`;
  dialog.addEventListener('cancel', (e) => e.preventDefault());
  dialog.showModal();
  $('recovery-restore').addEventListener(
    'click',
    () => {
      forgetBrowserHandle();
      for (const draft of drafts) {
        const t = openInTab({ path: draft.path, name: draft.name }, draft.content);
        // ディスクの内容と比べるため、復元前の状態を基準にしておく
        if (t === cur) {
          cur.markdown = draft.content;
          source.value = draft.content;
          applyToEditor(true);
        }
        setDirty(t, true);
      }
      persistDrafts();
      dialog.close();
      showStatus('下書きを復元しました');
    },
    { once: true },
  );
  $('recovery-discard').addEventListener(
    'click',
    () => {
      writeDrafts([]);
      dialog.close();
      showStatus('下書きを破棄しました');
    },
    { once: true },
  );
}

// 開き直したファイルと同じ内容の下書きは不要なので捨てる
const pendingDrafts = startupDrafts.filter((d) => !tabs.some((t) => t.doc.path === d.path && t.markdown === d.content));
if (pendingDrafts.length) showRecovery(pendingDrafts);
else writeDrafts([]);
