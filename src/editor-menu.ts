// プレビュー編集の本文の右クリックメニュー (表のセルは table-menu、コードブロックは CodeMirror の既定のまま)

import type { EditorView } from '@milkdown/kit/prose/view';
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import { type MenuEntry, showContextMenu } from './context-menu';
import { type ClipboardHandlers, copySelection, pasteFromClipboard } from './editor-clipboard';
import { setImageAlign } from './image-size';

export interface EditorMenuHandlers extends ClipboardHandlers {
  bold(): void;
  italic(): void;
  strike(): void;
  code(): void;
  color(): void;
  openLink(href: string): void;
  // 開いているフォルダのファイルへのリンクを入れる (フォルダを開いているときだけ使える)
  canInsertFileLink(): boolean;
  insertFileLink(): void;
}

export function setupEditorMenu(view: () => EditorView, handlers: EditorMenuHandlers) {
  document.addEventListener('contextmenu', (e) => {
    // 表のセルの右クリックは table-menu が先に扱っている
    if (e.defaultPrevented) return;
    const v = view();
    const target = e.target as HTMLElement;
    if (!v.dom.contains(target) || target.closest('.cm-editor')) return;
    e.preventDefault();

    // 選択範囲の外を右クリックしたら、その位置にカーソルを移す (選択の上なら選択を保つ)
    const hit = v.posAtCoords({ left: e.clientX, top: e.clientY });
    const { from, to } = v.state.selection;
    if (hit && (hit.pos < from || hit.pos > to)) {
      v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(hit.pos))));
    }
    v.focus();

    const empty = v.state.selection.empty;
    const editable = v.editable;
    const fail = () => handlers.notify('コピーできませんでした', true);
    const href = target.closest('a[href]')?.getAttribute('href');
    const items: MenuEntry[] = [
      { label: '切り取り', shortcut: 'Ctrl+X', disabled: empty || !editable, run: () => void copySelection(view(), { cut: true }).catch(fail) },
      { label: 'コピー', shortcut: 'Ctrl+C', disabled: empty, run: () => void copySelection(view()).catch(fail) },
      { label: '貼り付け', shortcut: 'Ctrl+V', disabled: !editable, run: () => void pasteFromClipboard(view(), handlers, false) },
      'separator',
      { label: '書式なしでコピー', shortcut: 'Ctrl+Shift+C', disabled: empty, run: () => void copySelection(view(), { plain: true }).catch(fail) },
      { label: '書式なしで貼り付け', shortcut: 'Ctrl+Shift+V', disabled: !editable, run: () => void pasteFromClipboard(view(), handlers, true) },
      'separator',
      { label: '太字', shortcut: 'Ctrl+B', disabled: empty || !editable, run: handlers.bold },
      { label: '斜体', shortcut: 'Ctrl+I', disabled: empty || !editable, run: handlers.italic },
      { label: '取り消し線', disabled: empty || !editable, run: handlers.strike },
      { label: 'インラインコード', shortcut: 'Ctrl+E', disabled: empty || !editable, run: handlers.code },
      { label: '文字の色…', disabled: empty || !editable, run: handlers.color },
    ];
    const imageBlock = target.closest<HTMLElement>('.milkdown-image-block');
    if (imageBlock) {
      items.push(
        'separator',
        { label: '画像を左寄せ', disabled: !editable, run: () => setImageAlign(view(), imageBlock, 'left') },
        { label: '画像を中央に', disabled: !editable, run: () => setImageAlign(view(), imageBlock, 'center') },
        { label: '画像を右寄せ', disabled: !editable, run: () => setImageAlign(view(), imageBlock, 'right') },
      );
    }
    const fileLink = handlers.canInsertFileLink();
    if (fileLink || href) items.push('separator');
    if (fileLink) items.push({ label: 'ファイルへのリンクを挿入…', shortcut: '[[', disabled: !editable, run: handlers.insertFileLink });
    if (href) items.push({ label: 'リンクを開く', shortcut: 'Ctrl+クリック', run: () => handlers.openLink(href) });
    items.push('separator', {
      label: 'すべて選択',
      shortcut: 'Ctrl+A',
      run: () => {
        const cur = view();
        cur.dispatch(cur.state.tr.setSelection(new AllSelection(cur.state.doc)));
      },
    });
    showContextMenu(items, e.clientX, e.clientY, () => view().focus());
  });
}
