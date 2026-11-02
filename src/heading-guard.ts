// 見出しを使っていないのに本文が見出しの大きさに変わってしまうのを防ぐ。
//
// - 見出しのすぐ下の段落の先頭で Backspace を押すと、ProseMirror は段落を見出しにくっつけるので、
//   本文が見出しになる。くっつけずに見出しの末尾へカーソルを移すだけにする (見出しが空なら見出しを消す)
// - 同じく見出しの末尾で Delete を押すと下の段落が見出しに吸い込まれるので、くっつけない
// - 見出しの先頭から下の段落の途中までを選んで消す・打ち替えると、残りが見出しになる。
//   見出しを丸ごと消したのだから、残りは段落に戻す
// - Markdown の「文の次の行に --- や ===」は見出し (Setext 記法) になるが、区切り線のつもりで
//   書くことが多いので見出しとして読まない (見出しは「#」で書く)

import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose, $remark } from '@milkdown/kit/utils';

const isHeading = (node: Node | null | undefined) => node?.type.name === 'heading';
const isParagraph = (node: Node | null | undefined) => node?.type.name === 'paragraph';

const backspace: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  if (!isParagraph($from.parent) || $from.parentOffset !== 0 || $from.parent.content.size === 0) return false;
  const before = state.doc.resolve($from.before()).nodeBefore;
  if (!isHeading(before)) return false;
  if (dispatch) {
    const headingStart = $from.before() - before!.nodeSize;
    if (before!.content.size === 0) {
      dispatch(state.tr.delete(headingStart, $from.before()).scrollIntoView());
    } else {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.before() - 1)).scrollIntoView());
    }
  }
  return true;
};

const del: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  if (!isHeading($from.parent) || $from.parentOffset !== $from.parent.content.size) return false;
  const after = state.doc.resolve($from.after()).nodeAfter;
  if (!isParagraph(after) || after!.content.size === 0) return false;
  if (dispatch && $from.parent.content.size === 0) {
    // 空の見出しなら見出しを消して、下の段落の先頭へ
    const tr = state.tr.delete($from.before(), $from.after());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1)).scrollIntoView());
  }
  return true;
};

// 見出しの先頭から下の段落の中までを選んで消したら、残った見出しを段落に戻す
function fixMergedHeading(transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) {
  const sel = oldState.selection;
  if (sel.empty || !transactions.some((tr) => tr.docChanged)) return null;
  const $from = sel.$from;
  const $to = sel.$to;
  if (!isHeading($from.parent) || $from.parentOffset !== 0 || !isParagraph($to.parent)) return null;
  let from = sel.from;
  let to = sel.to;
  for (const tr of transactions) {
    from = tr.mapping.map(from, -1);
    to = tr.mapping.map(to, 1);
  }
  const $newFrom = newState.doc.resolve(from);
  const $newTo = newState.doc.resolve(to);
  // 見出しと段落が 1 つにまとまったときだけ (選んだ所が消えずに残る操作は対象外)
  if (!isHeading($newFrom.parent) || $newFrom.parent !== $newTo.parent || $newFrom.depth !== $newTo.depth) return null;
  return newState.tr.setBlockType($newFrom.before() + 1, $newFrom.before() + 1, newState.schema.nodes.paragraph);
}

export const headingGuard = $prose(() => new Plugin({ appendTransaction: fixMergedHeading }));

// Backspace / Delete は ProseMirror の既定の動き (くっつける) より先に見る必要があるので、
// エディタの keydown を捕捉段階で受けて呼ぶ
export function guardHeadingKey(view: EditorView, e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
  const command = e.key === 'Backspace' ? backspace : e.key === 'Delete' ? del : null;
  if (command && command(view.state, view.dispatch)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// Setext 記法の見出し (文の次の行の --- / ===) を読まない
export const noSetextHeading = $remark('noSetextHeading', () => function (this: { data(): object }) {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push({ disable: { null: ['setextUnderline'] } });
});
