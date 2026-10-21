// 見出しの一覧 (目次) を Markdown から作る

export interface Heading {
  level: number;
  text: string;
  // ソース中の見出し行の先頭位置
  offset: number;
}

function plain(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

export function parseHeadings(md: string): Heading[] {
  const headings: Heading[] = [];
  let fence: string | null = null;
  let offset = 0;
  const lines = md.split('\n');
  lines.forEach((line, i) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const mark = fenceMatch[1];
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
    } else if (!fence) {
      const atx = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
      const next = lines[i + 1];
      if (atx) {
        headings.push({ level: atx[1].length, text: plain(atx[2]), offset });
      } else if (line.trim() && next !== undefined && /^\s{0,3}(=+|-+)\s*$/.test(next) && !/^\s*([-*+]|\d+\.)\s/.test(line)) {
        headings.push({ level: next.trim()[0] === '=' ? 1 : 2, text: plain(line), offset });
      }
    }
    offset += line.length + 1;
  });
  return headings;
}

export function renderOutline(list: HTMLElement, headings: Heading[], onSelect: (index: number) => void) {
  list.replaceChildren();
  if (!headings.length) {
    const empty = document.createElement('li');
    empty.className = 'outline-empty';
    empty.textContent = '見出しがありません';
    list.append(empty);
    return;
  }
  const minLevel = Math.min(...headings.map((h) => h.level));
  headings.forEach((h, i) => {
    const li = document.createElement('li');
    const a = document.createElement('button');
    a.textContent = h.text || '(無題)';
    a.title = h.text;
    a.style.paddingLeft = `${8 + (h.level - minLevel) * 14}px`;
    a.className = `outline-item level-${h.level}`;
    a.addEventListener('click', () => onSelect(i));
    li.append(a);
    list.append(li);
  });
}
