// リンクを開く操作。編集中の誤操作を避けるため、本文中のリンクは Ctrl+クリック (Mac は Cmd) で開く
// (VS Code と同じ)。リンクのツールチップなど本文の外にあるリンクは普通のクリックで開く。

const LINK_PATTERNS = [
  // [テキスト](URL "タイトル") / ![画像](URL)
  /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
  // <https://...>
  /<((?:https?|mailto):[^>\s]+)>/g,
  // 裸の URL
  /\b(https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"])/g,
];

// ソース上の文字位置 pos にあるリンクの URL
export function linkAt(text: string, pos: number): string | null {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const end = text.indexOf('\n', pos);
  const line = text.slice(start, end === -1 ? text.length : end);
  const col = pos - start;
  for (const re of LINK_PATTERNS) {
    for (const m of line.matchAll(re)) {
      if (col >= m.index! && col <= m.index! + m[0].length) return m[1];
    }
  }
  return null;
}

// GitHub と同じ規則で見出しをアンカー名にする
export function slugify(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

// hint: 本文中のリンクにマウスを乗せたとき、行き先と操作の案内を出す (離れたら null)
export function setupLinks(
  editorRoot: HTMLElement,
  source: HTMLTextAreaElement,
  open: (href: string) => void,
  hint: (text: string | null) => void,
) {
  const mod = (e: MouseEvent | KeyboardEvent) => e.ctrlKey || e.metaKey;

  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement).closest?.('a[href]');
      if (!a) return;
      const inEditor = editorRoot.contains(a) && !!a.closest('.ProseMirror');
      // 本文中のリンクは、普通のクリックならカーソルを置くだけにする
      if (inEditor && !mod(e)) return;
      e.preventDefault();
      e.stopPropagation();
      open(a.getAttribute('href')!);
    },
    true,
  );

  // 中クリックでの遷移も止める (WebView の中で別ページに移ってしまわないように)
  document.addEventListener('auxclick', (e) => {
    if ((e.target as HTMLElement).closest?.('a[href]')) e.preventDefault();
  });

  source.addEventListener('click', (e) => {
    if (!mod(e)) return;
    const href = linkAt(source.value, source.selectionStart);
    if (!href) return;
    e.preventDefault();
    open(href);
  });

  // Ctrl を押している間はリンクを「押せる」見た目にする
  const update = (e: KeyboardEvent | MouseEvent) => document.body.classList.toggle('link-mod', mod(e));
  window.addEventListener('keydown', update);
  window.addEventListener('keyup', update);
  window.addEventListener('mousemove', update, { passive: true });
  window.addEventListener('blur', () => document.body.classList.remove('link-mod'));

  // 要素に title を付けるとエディタがリンクのタイトルとして読み取ってしまうので、案内は外に出す
  let hovered: Element | null = null;
  editorRoot.addEventListener('mouseover', (e) => {
    const a = (e.target as HTMLElement).closest?.('.ProseMirror a[href]') ?? null;
    if (a === hovered) return;
    hovered = a;
    hint(a ? `${a.getAttribute('href')} — Ctrl+クリックで開く` : null);
  });
  editorRoot.addEventListener('mouseleave', () => {
    hovered = null;
    hint(null);
  });
}
