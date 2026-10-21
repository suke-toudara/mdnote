// プレビュー編集で表を Excel のように扱う。
//
// - セルをクリックするとセル全体が選択される (まだ編集できない)
// - F2 / Enter / ダブルクリックで編集を始める。選択中に文字を打つと中身を置き換えて編集を始める
// - ドラッグや Shift+クリックで複数のセルを範囲選択する
// - 矢印キー・Tab でセル間を移動する。編集中の Enter は下のセル、Tab は次のセルへ
// - Esc で編集を終えてセル選択に戻る
// - Ctrl+A はセルの中身だけを全選択する。もう一度押すと表全体を選択する
// - 編集中の Alt+Enter / Shift+Enter でセルの中で改行する (Markdown では <br> として保存する)
// - セル選択中のコピーは Excel と同じ形式 (タブ区切り + HTML の表) で書き出す
// - タブ区切りのテキストを選択セルに貼ると、そのセルを左上として流し込む

import type { Node } from '@milkdown/kit/prose/model';
import { type EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import { CellSelection, TableMap, deleteCellSelection, selectedRect } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose, $remark } from '@milkdown/kit/utils';

// 値は編集中のセルの位置 (セルノードの直前)。編集中でなければ null。
const key = new PluginKey<number | null>('excel-like-table');

const isCell = (node: Node) => {
  const role = node.type.spec.tableRole;
  return role === 'cell' || role === 'header_cell';
};

// 選択位置を含むセルの位置
export function cellAround(state: EditorState, pos: number): number | null {
  const $pos = state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if (isCell($pos.node(d))) return $pos.before(d);
  }
  return null;
}

function editingCell(state: EditorState) {
  return key.getState(state) ?? null;
}

function selectCell(tr: Transaction, cellPos: number) {
  return tr.setSelection(CellSelection.create(tr.doc, cellPos)).setMeta(key, null);
}

// 編集を始める。where: 'end' は末尾にカーソル、'all' は中身を全選択、数値はその位置
function editCell(tr: Transaction, cellPos: number, where: 'end' | 'all' | number) {
  const cell = tr.doc.nodeAt(cellPos)!;
  const start = cellPos + 2;
  const end = cellPos + cell.nodeSize - 2;
  const sel =
    where === 'all'
      ? TextSelection.create(tr.doc, start, end)
      : TextSelection.near(tr.doc.resolve(where === 'end' ? end : where));
  return tr.setSelection(sel).setMeta(key, cellPos);
}

// セルから (dRow, dCol) 先のセル。表の上下を越えたら表の外へ出る
function moveFrom(tr: Transaction, cellPos: number, dRow: number, dCol: number, wrap = false) {
  const $cell = tr.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  const rect = map.findCell(cellPos - tableStart);
  let row = rect.top + dRow;
  let col = rect.left + dCol;

  if (wrap) {
    if (col >= map.width) {
      col = 0;
      row++;
    } else if (col < 0) {
      col = map.width - 1;
      row--;
    }
  }
  col = Math.min(Math.max(col, 0), map.width - 1);

  if (row < 0) return tr.setSelection(Selection.near(tr.doc.resolve(tableStart - 1), -1)).setMeta(key, null);
  if (row >= map.height) {
    if (wrap) return selectCell(tr, cellPos);
    return tr.setSelection(Selection.near(tr.doc.resolve(tableStart - 1 + table.nodeSize), 1)).setMeta(key, null);
  }
  return selectCell(tr, tableStart + map.positionAt(row, col, table));
}

function selectWholeTable(tr: Transaction, cellPos: number) {
  const $cell = tr.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  const first = tableStart + map.map[0];
  const last = tableStart + map.map[map.map.length - 1];
  return tr.setSelection(CellSelection.create(tr.doc, first, last)).setMeta(key, null);
}

function clearCell(tr: Transaction, cellPos: number) {
  const cell = tr.doc.nodeAt(cellPos)!;
  const paragraph = cell.type.schema.nodes.paragraph.create();
  return tr.replaceWith(cellPos + 1, cellPos + cell.nodeSize - 1, paragraph);
}

const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function onKeyDown(view: EditorView, e: KeyboardEvent): boolean {
  const { state } = view;
  const sel = state.selection;
  const mod = e.ctrlKey || e.metaKey;
  const run = (tr: Transaction) => {
    view.dispatch(tr.scrollIntoView());
    return true;
  };

  if (sel instanceof CellSelection) {
    const cellPos = sel.$headCell.pos;
    if (e.key === 'F2' || (e.key === 'Enter' && !mod)) return run(editCell(state.tr, cellPos, 'end'));
    if (mod && e.key.toLowerCase() === 'a') {
      const single = sel.$anchorCell.pos === sel.$headCell.pos;
      return run(single ? editCell(state.tr, cellPos, 'all') : selectWholeTable(state.tr, cellPos));
    }
    if (MOVES[e.key] && !mod && !e.shiftKey) {
      const [dr, dc] = MOVES[e.key];
      return run(moveFrom(state.tr, cellPos, dr, dc));
    }
    if (e.key === 'Tab' && !mod) return run(moveFrom(state.tr, cellPos, 0, e.shiftKey ? -1 : 1, true));
    // 文字入力 (日本語入力の開始も含む) は中身を置き換えて編集を始める。既定動作で文字が入る
    const typing = (e.key.length === 1 && !mod && !e.altKey) || e.key === 'Process' || e.keyCode === 229;
    if (typing && sel.$anchorCell.pos === sel.$headCell.pos) {
      view.dispatch(editCell(clearCell(state.tr, cellPos), cellPos, 'end'));
      return false;
    }
    return false;
  }

  const editing = editingCell(state);
  if (editing === null || e.isComposing) return false;

  if (e.key === 'Escape') return run(selectCell(state.tr, editing));
  // セルの中での改行 (Excel と同じ Alt+Enter と、Shift+Enter)
  if (e.key === 'Enter' && !mod && (e.altKey || e.shiftKey)) {
    return run(state.tr.replaceSelectionWith(state.schema.nodes.hardbreak.create()));
  }
  if (e.key === 'Enter' && !mod && !e.shiftKey) return run(moveFrom(state.tr, editing, 1, 0, true));
  if (e.key === 'Tab' && !mod) return run(moveFrom(state.tr, editing, 0, e.shiftKey ? -1 : 1, true));
  if (mod && e.key.toLowerCase() === 'a') {
    const cell = state.doc.nodeAt(editing)!;
    const allSelected = !sel.empty && state.doc.textBetween(sel.from, sel.to) === cell.textContent;
    return run(allSelected ? selectWholeTable(state.tr, editing) : editCell(state.tr, editing, 'all'));
  }
  return false;
}

function cellAtPoint(view: EditorView, x: number, y: number) {
  const hit = view.posAtCoords({ left: x, top: y });
  return hit ? { cell: cellAround(view.state, hit.inside >= 0 ? hit.inside + 1 : hit.pos), pos: hit.pos } : null;
}

// セル上でのマウス操作: クリックでセル選択、ダブルクリックで編集、ドラッグ・Shift+クリックで範囲選択
function onMouseDown(view: EditorView, e: MouseEvent): boolean {
  if (e.button !== 0 || !view.editable) return false;
  const target = e.target as HTMLElement;
  if (!target.closest('td, th') || target.closest('button, .cell-handle, .line-handle')) return false;
  const hit = cellAtPoint(view, e.clientX, e.clientY);
  if (!hit || hit.cell === null) return false;
  const { state } = view;
  const cell = hit.cell;

  if (e.detail >= 2) {
    view.dispatch(editCell(state.tr, cell, hit.pos));
    view.focus();
    return true;
  }
  // 編集中のセル内のクリックはカーソル移動として通常どおり扱う
  if (editingCell(state) === cell) return false;

  const sel = state.selection;
  const anchor = e.shiftKey && sel instanceof CellSelection ? sel.$anchorCell.pos : cell;
  view.dispatch(state.tr.setSelection(CellSelection.create(state.doc, anchor, cell)).setMeta(key, null));
  view.focus();

  const onMove = (ev: MouseEvent) => {
    const over = cellAtPoint(view, ev.clientX, ev.clientY);
    if (!over || over.cell === null) return;
    const current = view.state.selection;
    if (current instanceof CellSelection && current.$headCell.pos === over.cell) return;
    try {
      view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, anchor, over.cell)));
    } catch {
      // 別の表のセルには広げない
    }
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return true;
}

// ---- コピー・貼り付け ----

// Excel のタブ区切り形式に合わせ、タブ・改行・引用符を含む値は "..." で囲む
function tsvValue(text: string) {
  return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function selectedGrid(state: EditorState): string[][] {
  const rect = selectedRect(state);
  const rows: string[][] = [];
  for (let row = rect.top; row < rect.bottom; row++) {
    const cells: string[] = [];
    for (let col = rect.left; col < rect.right; col++) {
      const pos = rect.map.map[row * rect.map.width + col];
      cells.push(rect.table.nodeAt(pos)?.textContent ?? '');
    }
    rows.push(cells);
  }
  return rows;
}

function onCopy(view: EditorView, e: ClipboardEvent, cut: boolean): boolean {
  if (!(view.state.selection instanceof CellSelection) || !e.clipboardData) return false;
  const grid = selectedGrid(view.state);
  const tsv = grid.map((r) => r.map(tsvValue).join('\t')).join('\n');
  const html = `<table>${grid.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  e.clipboardData.setData('text/plain', tsv);
  e.clipboardData.setData('text/html', html);
  if (cut) deleteCellSelection(view.state, view.dispatch);
  return true;
}

// Excel 形式のタブ区切りテキストを 2 次元配列にする (引用符で囲まれた改行・タブも扱う)
function parseTsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') {
      rows[rows.length - 1].push(cell);
      cell = '';
    } else if (c === '\n') {
      rows[rows.length - 1].push(cell);
      rows.push([]);
      cell = '';
    } else cell += c;
  }
  rows[rows.length - 1].push(cell);
  return rows;
}

function gridFromHtml(html: string): string[][] | null {
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table) return null;
  return [...table.rows].map((r) => [...r.cells].map((c) => c.textContent?.trim() ?? ''));
}

// 選択範囲の左上から grid を流し込む。表からはみ出す分は行・列を足す
function fillCells(view: EditorView, grid: string[][]) {
  const { state } = view;
  const rect = selectedRect(state);
  const { table, tableStart, map } = rect;
  const schema = state.schema;
  const height = Math.max(map.height, rect.top + grid.length);
  const width = Math.max(map.width, rect.left + Math.max(...grid.map((r) => r.length)));

  const headerRow = table.child(0);
  const bodyRowType = table.childCount > 1 ? table.child(1).type : schema.nodes.table_row;
  const headerCellType = headerRow.child(0).type;
  const bodyCellType = schema.nodes.table_cell;
  const existing = (row: number, col: number) =>
    row < map.height && col < map.width ? table.nodeAt(map.map[row * map.width + col]) : null;
  // 新しく足すセルは、その列 (新しい列なら最後の列) の見出しセルの配置を引き継ぐ
  const columnAttrs = (col: number) => existing(0, Math.min(col, map.width - 1))?.attrs ?? {};
  // 値の中の改行はセル内の改行にする
  const paragraph = (text: string) => {
    const parts = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n');
    const inline = parts.flatMap((part, i) => [
      ...(i ? [schema.nodes.hardbreak.create()] : []),
      ...(part ? [schema.text(part)] : []),
    ]);
    return schema.nodes.paragraph.create(null, inline);
  };

  const rows = [];
  for (let row = 0; row < height; row++) {
    const cellType = row === 0 ? headerCellType : bodyCellType;
    const cells = [];
    for (let col = 0; col < width; col++) {
      const old = existing(row, col);
      const value = grid[row - rect.top]?.[col - rect.left];
      if (value !== undefined) cells.push(cellType.create(old?.attrs ?? columnAttrs(col), paragraph(value)));
      else cells.push(old ?? cellType.create(columnAttrs(col), paragraph('')));
    }
    rows.push((row === 0 ? headerRow.type : bodyRowType).create(null, cells));
  }

  const tablePos = tableStart - 1;
  const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, table.type.create(table.attrs, rows));
  // 貼り付けた範囲を選択状態にする
  const newTable = tr.doc.nodeAt(tablePos)!;
  const newMap = TableMap.get(newTable);
  const bottom = Math.min(rect.top + grid.length, newMap.height) - 1;
  const right = Math.min(rect.left + Math.max(...grid.map((r) => r.length)), newMap.width) - 1;
  const at = (row: number, col: number) => tablePos + 1 + newMap.map[row * newMap.width + col];
  tr.setSelection(CellSelection.create(tr.doc, at(rect.top, rect.left), at(bottom, right))).setMeta(key, null);
  view.dispatch(tr.scrollIntoView());
}

// 右クリックメニューの「貼り付け」用
export function pasteTextIntoCells(view: EditorView, text: string) {
  if (!(view.state.selection instanceof CellSelection) || !text) return false;
  fillCells(view, parseTsv(text));
  return true;
}

// セル選択中の貼り付けは、選択範囲の左上から Excel のように流し込む
function onPaste(view: EditorView, e: ClipboardEvent): boolean {
  if (!(view.state.selection instanceof CellSelection) || !e.clipboardData) return false;
  const text = e.clipboardData.getData('text/plain');
  const grid = text ? parseTsv(text) : gridFromHtml(e.clipboardData.getData('text/html'));
  if (!grid || !grid.length) return false;
  fillCells(view, grid);
  return true;
}

// ---- セル内の改行 ----

type MdastNode = { type: string; value?: string; children?: MdastNode[] };

// Markdown の表のセルは 1 行で書くので、セル内の改行は <br> で表す。
// 読み込むときに、セルの中の <br> を改行に戻す (書き出しは main.ts の改行の書き方で <br> にする)
export const brInTableCells = $remark('brInTableCells', () => () => (tree: unknown) => {
  const walk = (node: MdastNode, inCell: boolean) => {
    if (!node.children) return;
    const cell = inCell || node.type === 'tableCell';
    node.children = node.children.map((child) =>
      cell && child.type === 'html' && /^<br\s*\/?>$/i.test(child.value ?? '') ? { type: 'break' } : child,
    );
    for (const child of node.children) walk(child, cell);
  };
  walk(tree as MdastNode, false);
});

// ---- ちらつき対策 ----

type NodeViewLike = { node: Node; update?: (node: Node, ...rest: unknown[]) => boolean };
const patched = new WeakSet<object>();

// Crepe の表のノードビューは、中身が同じでも update で false を返すため、
// セル選択の表示が変わるたびに表全体が作り直されて画面がちらつく。
// 中身が変わっていないときは作り直さずに、そのまま使うようにする。
function patchTableNodeView(view: EditorView) {
  const dom = view.dom.querySelector('.milkdown-table-block') as (HTMLElement & { pmViewDesc?: { spec?: object } }) | null;
  const spec = dom?.pmViewDesc?.spec;
  if (!spec) return;
  const proto = Object.getPrototypeOf(spec) as NodeViewLike;
  if (patched.has(proto) || typeof proto.update !== 'function') return;
  patched.add(proto);
  const original = proto.update;
  proto.update = function (this: NodeViewLike, node: Node, ...rest: unknown[]) {
    if (node.type === this.node.type && node.sameMarkup(this.node) && node.content.eq(this.node.content)) {
      this.node = node;
      return true;
    }
    return original.call(this, node, ...rest);
  };
}

export const excelLikeTable = $prose(
  () =>
    new Plugin<number | null>({
      key,
      state: {
        init: () => null,
        apply(tr, value) {
          const meta = tr.getMeta(key);
          if (meta !== undefined) return meta;
          if (value === null) return null;
          const mapped = tr.mapping.mapResult(value);
          return mapped.deleted ? null : mapped.pos;
        },
      },
      // 編集中のセル以外にカーソルが入ったら、セル選択に置き換える (クリック・矢印キーなど)
      appendTransaction(_trs, _old, state) {
        const sel = state.selection;
        const editing = editingCell(state);
        if (sel instanceof CellSelection) {
          return editing === null ? null : state.tr.setMeta(key, null);
        }
        const cell = cellAround(state, sel.from);
        if (cell === null) return editing === null ? null : state.tr.setMeta(key, null);
        if (cell === editing && cellAround(state, sel.to) === cell) return null;
        // クリックではセル内の段落がノード選択になることもあるので、テキスト以外も置き換える
        return selectCell(state.tr, cell);
      },
      view(view) {
        // 表の既定のキー操作・クリック処理より先に処理するため、キャプチャ段階で受け取る
        const keyHandler = (e: KeyboardEvent) => {
          if (onKeyDown(view, e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        const mouseHandler = (e: MouseEvent) => {
          if (onMouseDown(view, e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        const clipboardHandler = (e: ClipboardEvent) => {
          const handled = e.type === 'paste' ? onPaste(view, e) : onCopy(view, e, e.type === 'cut');
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        const listeners: [string, EventListener][] = [
          ['keydown', keyHandler as EventListener],
          ['mousedown', mouseHandler as EventListener],
          ['copy', clipboardHandler as EventListener],
          ['cut', clipboardHandler as EventListener],
          ['paste', clipboardHandler as EventListener],
        ];
        for (const [type, fn] of listeners) view.dom.addEventListener(type, fn, true);
        patchTableNodeView(view);
        return {
          // 表が後から追加された場合に備えて、更新のたびに確認する (一度当てれば以後は何もしない)
          update: (v) => patchTableNodeView(v),
          destroy: () => {
            for (const [type, fn] of listeners) view.dom.removeEventListener(type, fn, true);
          },
        };
      },
    }),
);

// 選択がいま表の中にあるか (貼り付け処理の切り替え用)
export function selectionInTable(state: EditorState) {
  return state.selection instanceof CellSelection || cellAround(state, state.selection.from) !== null;
}
