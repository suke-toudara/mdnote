// ```mermaid のコードブロックを図として表示する (Crepe のコードブロックのプレビュー欄に出す)。
// 図は印刷・PDF でも同じ見た目になるよう、テーマにかかわらず白地に描く。

import type { Editor } from '@milkdown/kit/core';
import { codeBlockConfig } from '@milkdown/kit/component/code-block';

type MermaidApi = typeof import('mermaid').default;

let loading: Promise<MermaidApi> | null = null;
// mermaid は大きいので、図が初めて出てきたときに読み込む
function loadMermaid() {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', suppressErrorRendering: true });
    return mermaid;
  });
  return loading;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// 同じ内容は描き直さない (入力のたびにプレビューが更新されるため)
const cache = new Map<string, string>();
let nextId = 0;

async function render(content: string): Promise<string> {
  const cached = cache.get(content);
  if (cached) return cached;
  const mermaid = await loadMermaid();
  let html: string;
  try {
    // mermaid は描画を順番に処理するので、入力中に何度呼んでも結果は呼んだ順に返る
    const { svg } = await mermaid.render(`mdnote-mermaid-${nextId++}`, content);
    html = `<div class="mermaid-diagram">${svg}</div>`;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    html = `<pre class="mermaid-error">図を描けませんでした\n${escapeHtml(message)}</pre>`;
  }
  if (cache.size > 50) cache.clear();
  cache.set(content, html);
  return html;
}

export function setupMermaid(editor: Editor) {
  editor.config((ctx) => {
    ctx.update(codeBlockConfig.key, (prev) => ({
      ...prev,
      renderPreview: (language, content, applyPreview) => {
        if (language.toLowerCase() !== 'mermaid') return prev.renderPreview(language, content, applyPreview);
        if (!content.trim()) return null;
        const cached = cache.get(content);
        if (cached) return cached;
        void render(content).then(applyPreview);
        // undefined を返すと、描き終わるまで「読み込み中」を表示する
        return undefined;
      },
    }));
  });
}
