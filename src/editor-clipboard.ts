// プレビュー編集のコピー・切り取り・貼り付け
//
// - Ctrl+Shift+C: 書式を付けずに文字だけコピーする (Markdown の記号や色の <span> を含めない)
// - Ctrl+Shift+V: 書式を解釈せずに文字のまま貼り付ける
// - 右クリックメニューからのコピー・貼り付けもここを通す

import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection } from '@milkdown/kit/prose/tables';

export interface ClipboardHandlers {
  // Markdown として解釈して貼り付ける (通常の貼り付け)
  pasteMarkdown(text: string): void;
  notify(message: string, isError?: boolean): void;
}

// コードブロックの言語ボタンなど、編集できない部品の上からドラッグで選択を始めると、WebKit では
// 選択の端がその部品の中に残り、見た目は選択できていても Ctrl+C / Ctrl+X が何もしない。
// (エディタ側の選択は正しいが、コードブロックの中の位置は表示上その部品の中に戻ってしまうため、
// 表示上の選択を直すことはできない) そのときはエディタの選択範囲を自分でクリップボードに書く
function inWidget(node: Node | null, root: HTMLElement) {
  for (let el = node instanceof Element ? node : node?.parentElement; el && el !== root; el = el.parentElement) {
    const editable = el.getAttribute('contenteditable');
    // コードブロックの中身 (CodeMirror) のように、部品の中にある編集できる部分は対象外
    if (editable === 'true') return false;
    if (editable === 'false' || el.tagName === 'BUTTON') return true;
  }
  return false;
}

const blob = (type: string, data: string) => new Blob([data], { type });

// 選択範囲の文字だけ (段落の区切りは改行)
export function plainTextOf(view: EditorView) {
  const { state } = view;
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    const rows: string[] = [];
    let row: string[] = [];
    let last = -1;
    sel.forEachCell((cell, pos) => {
      const rowStart = state.doc.resolve(pos).before();
      if (last !== -1 && rowStart !== last) {
        rows.push(row.join('\t'));
        row = [];
      }
      last = rowStart;
      row.push(cell.textContent);
    });
    rows.push(row.join('\t'));
    return rows.join('\n');
  }
  return state.doc.textBetween(sel.from, sel.to, '\n', (leaf) => (leaf.type.name === 'hardbreak' ? '\n' : leaf.isText ? leaf.text! : ''));
}

// 選択範囲をクリップボードに書く。plain なら文字だけ、そうでなければ通常のコピーと同じ形式 (Markdown と HTML)
export async function copySelection(view: EditorView, { plain = false, cut = false } = {}) {
  const { selection } = view.state;
  if (selection.empty) return;
  if (plain) {
    await navigator.clipboard.writeText(plainTextOf(view));
  } else {
    const { dom, text } = view.serializeForClipboard(selection.content());
    await navigator.clipboard
      .write([new ClipboardItem({ 'text/html': blob('text/html', dom.innerHTML), 'text/plain': blob('text/plain', text) })])
      .catch(() => navigator.clipboard.writeText(text));
  }
  if (cut && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
}

// 文字をそのまま入れる。複数行なら行ごとに段落にする (表のセルの中では改行にする)
export function insertPlainText(view: EditorView, text: string) {
  const { state } = view;
  const { schema, selection } = state;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const $from = selection.$from;
  let inCell = false;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.spec.tableRole) inCell = true;
  let tr = state.tr;
  if ($from.parent.type.spec.code || lines.length === 1) {
    tr = tr.insertText(lines.join('\n'));
  } else if (inCell) {
    const nodes = lines.flatMap((line, i) => [...(i ? [schema.nodes.hardbreak.create()] : []), ...(line ? [schema.text(line)] : [])]);
    tr = tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0));
  } else {
    const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
    tr = tr.replaceSelection(new Slice(Fragment.from(paragraphs), 1, 1));
  }
  view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'paste'));
}

export async function pasteFromClipboard(view: EditorView, handlers: ClipboardHandlers, plain: boolean) {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    // クリップボードの読み取りが許可されない環境ではキー操作を案内する
    handlers.notify(plain ? 'Ctrl+Shift+V で貼り付けてください' : 'Ctrl+V で貼り付けてください');
    return;
  }
  if (!text) {
    handlers.notify('貼り付ける内容がありません');
    return;
  }
  view.focus();
  if (plain || view.state.selection.$from.parent.type.spec.code) insertPlainText(view, text);
  else handlers.pasteMarkdown(text);
}

// 次の paste イベントを文字のまま貼り付けるか (Ctrl+Shift+V)。
// paste の処理 (表や画像の貼り付け) より先に確認できるよう外から参照する
let plainPastePending = false;
export function takePlainPaste() {
  const pending = plainPastePending;
  plainPastePending = false;
  return pending;
}

export function setupEditorClipboard(view: () => EditorView, handlers: ClipboardHandlers) {
  const dom = view().dom;
  dom.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const v = view();
      if (e.shiftKey && key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        if (v.state.selection.empty) return;
        copySelection(v, { plain: true })
          .then(() => handlers.notify('書式なしでコピーしました'))
          .catch(() => handlers.notify('コピーできませんでした', true));
        return;
      }
      if (e.shiftKey && key === 'v') {
        // 既定の貼り付けを生かし、paste イベントで中身を受け取る (クリップボードの読み取り許可が要らない)。
        // paste イベントが来ない環境では、クリップボードを読んで入れる
        plainPastePending = true;
        window.setTimeout(() => {
          if (!takePlainPaste()) return;
          void pasteFromClipboard(v, handlers, true);
        }, 300);
        return;
      }
      if (e.shiftKey || (key !== 'c' && key !== 'x')) return;
      const sel = window.getSelection();
      const { selection } = v.state;
      // 表のセル選択などは table-edit が扱う
      if (!sel || sel.isCollapsed || !(selection instanceof TextSelection) || selection.empty) return;
      if (!inWidget(sel.anchorNode, v.dom) && !inWidget(sel.focusNode, v.dom)) return;
      e.preventDefault();
      copySelection(v, { cut: key === 'x' }).catch(() => handlers.notify('コピーできませんでした', true));
    },
    true,
  );
}
