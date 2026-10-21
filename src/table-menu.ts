// 表のセルの右クリックメニュー (行・列の挿入と削除、配置、コピー・貼り付け)

import { CellSelection, addColumnAfter, addColumnBefore, deleteColumn, deleteRow, deleteTable, selectedRect } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import { type MenuEntry, showContextMenu } from './context-menu';
import { cellAround, pasteTextIntoCells } from './table-edit';

type Alignment = 'left' | 'center' | 'right';

// 行を index の位置に挿入する。新しいセルは各列の見出しの配置を引き継ぐ
function insertRow(view: EditorView, index: number) {
  const { state } = view;
  const { table, tableStart, map } = selectedRect(state);
  let pos = tableStart;
  for (let i = 0; i < index; i++) pos += table.child(i).nodeSize;
  const { table_row, table_cell } = state.schema.nodes;
  const cells = Array.from({ length: map.width }, (_, col) =>
    table_cell.createAndFill({ alignment: table.nodeAt(map.map[col])?.attrs.alignment })!,
  );
  const tr = state.tr.insert(pos, table_row.create(null, cells));
  // 挿入した行の先頭セルを選択する
  tr.setSelection(CellSelection.create(tr.doc, pos + 1));
  view.dispatch(tr.scrollIntoView());
}

// 選択中の列すべてのセルの配置を変える (Markdown では列単位で揃えるため)
function setAlignment(view: EditorView, alignment: Alignment) {
  const { state } = view;
  const { table, tableStart, map, left, right } = selectedRect(state);
  const tr = state.tr;
  for (let row = 0; row < map.height; row++) {
    for (let col = left; col < right; col++) {
      const pos = tableStart + map.map[row * map.width + col];
      const cell = table.nodeAt(map.map[row * map.width + col]);
      if (cell) tr.setNodeMarkup(pos, null, { ...cell.attrs, alignment });
    }
  }
  view.dispatch(tr);
}

export function setupTableMenu(view: () => EditorView, notify: (message: string) => void) {
  const items = (v: EditorView): MenuEntry[] => {
    const rect = selectedRect(v.state);
    const run = (cmd: typeof deleteRow) => () => cmd(v.state, v.dispatch);
    const allCols = rect.left === 0 && rect.right === rect.map.width;
    const headerSelected = rect.top === 0;
    return [
      { label: '切り取り', shortcut: 'Ctrl+X', run: () => document.execCommand('cut') },
      { label: 'コピー', shortcut: 'Ctrl+C', run: () => document.execCommand('copy') },
      {
        label: '貼り付け',
        shortcut: 'Ctrl+V',
        run: () => {
          // クリップボードの読み取りが許可されない環境ではキー操作を案内する
          navigator.clipboard
            ?.readText()
            .then((text) => pasteTextIntoCells(v, text) || notify('貼り付ける内容がありません'))
            .catch(() => notify('Ctrl+V で貼り付けてください'));
        },
      },
      'separator',
      // Markdown の表は先頭行が見出しなので、その上には行を入れられず、見出し行は消せない
      { label: '上に行を挿入', disabled: headerSelected, run: () => insertRow(v, rect.top) },
      { label: '下に行を挿入', run: () => insertRow(v, rect.bottom) },
      { label: '左に列を挿入', run: run(addColumnBefore) },
      { label: '右に列を挿入', run: run(addColumnAfter) },
      'separator',
      { label: '行を削除', disabled: headerSelected, run: run(deleteRow) },
      { label: '列を削除', disabled: allCols, run: run(deleteColumn) },
      'separator',
      { label: '左揃え', run: () => setAlignment(v, 'left') },
      { label: '中央揃え', run: () => setAlignment(v, 'center') },
      { label: '右揃え', run: () => setAlignment(v, 'right') },
      'separator',
      { label: '表を削除', run: run(deleteTable) },
    ];
  };

  const onContextMenu = (e: MouseEvent) => {
    const v = view();
    const target = e.target as HTMLElement;
    if (!v.dom.contains(target) || !target.closest('td, th')) return;
    const hit = v.posAtCoords({ left: e.clientX, top: e.clientY });
    const cell = hit && cellAround(v.state, hit.inside >= 0 ? hit.inside + 1 : hit.pos);
    if (cell === null || cell === undefined) return;
    e.preventDefault();
    // 右クリックしたセルが選択範囲の外なら、そのセルを選び直す
    const sel = v.state.selection;
    let inside = false;
    if (sel instanceof CellSelection) sel.forEachCell((_, pos) => (inside ||= pos === cell));
    if (!inside) v.dispatch(v.state.tr.setSelection(CellSelection.create(v.state.doc, cell)));
    showContextMenu(items(v), e.clientX, e.clientY, () => v.focus());
  };

  document.addEventListener('contextmenu', onContextMenu, true);
}
