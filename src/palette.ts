// 名前の一部を打って候補から選ぶ小さな窓 (クイックオープンとファイルへのリンクの挿入で使う)

export interface PaletteItem {
  label: string;
  detail?: string;
}

export interface PaletteOptions<T extends PaletteItem> {
  placeholder: string;
  items: Promise<T[]>;
  emptyText: string;
  pick(item: T): void;
  // 選ばずに閉じたとき
  cancel?(): void;
}

const MAX_SHOWN = 60;

// 打った文字が順に含まれていれば候補にする。続けて一致する、区切りの直後で一致する、ほど高い点にする
function fuzzyScore(text: string, query: string): number | null {
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of query) {
    const i = text.indexOf(ch, from);
    if (i < 0) return null;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || '/ -_.'.includes(text[i - 1])) score += 2;
    last = i;
    from = i + 1;
  }
  return score;
}

function scoreItem(item: PaletteItem, words: string[]) {
  const label = item.label.toLowerCase();
  const full = `${item.detail ?? ''}/${item.label}`.toLowerCase();
  let total = 0;
  for (const word of words) {
    // ファイル名での一致を優先し、なければフォルダ名も含めて探す
    const inLabel = fuzzyScore(label, word);
    const s = inLabel !== null ? inLabel * 2 + (label.includes(word) ? 10 : 0) : fuzzyScore(full, word);
    if (s === null) return null;
    total += s;
  }
  return total - full.length * 0.01;
}

let dialog: HTMLDialogElement | null = null;

export function openPalette<T extends PaletteItem>(options: PaletteOptions<T>) {
  dialog?.close();
  const d = document.createElement('dialog');
  d.className = 'palette';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = options.placeholder;
  input.spellcheck = false;
  const list = document.createElement('ul');
  list.className = 'palette-list';
  list.setAttribute('role', 'listbox');
  d.append(input, list);
  document.body.append(d);
  dialog = d;

  let all: T[] | null = null;
  let shown: T[] = [];
  let active = 0;
  let picked = false;

  const message = (text: string) => {
    const li = document.createElement('li');
    li.className = 'palette-empty';
    li.textContent = text;
    list.replaceChildren(li);
  };

  const render = () => {
    if (!all) return;
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = words.length
      ? all
          .map((item) => ({ item, score: scoreItem(item, words) }))
          .filter((x): x is { item: T; score: number } => x.score !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_SHOWN)
          .map((x) => x.item)
      : all.slice(0, MAX_SHOWN);
    active = 0;
    if (!shown.length) {
      message(all.length ? '一致するものがありません' : options.emptyText);
      return;
    }
    list.replaceChildren(
      ...shown.map((item, i) => {
        const li = document.createElement('li');
        li.className = 'palette-item';
        li.setAttribute('role', 'option');
        const label = document.createElement('span');
        label.className = 'palette-label';
        label.textContent = item.label;
        li.append(label);
        if (item.detail) {
          const detail = document.createElement('span');
          detail.className = 'palette-detail';
          detail.textContent = item.detail;
          li.append(detail);
        }
        // クリックで入力欄のフォーカスが外れないようにする
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => choose(i));
        li.addEventListener('mousemove', () => highlight(i));
        return li;
      }),
    );
    highlight(0);
  };

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll('.palette-item').forEach((el, j) => {
      el.classList.toggle('active', j === i);
      el.setAttribute('aria-selected', String(j === i));
      if (j === i) el.scrollIntoView({ block: 'nearest' });
    });
  };

  const choose = (i: number) => {
    const item = shown[i];
    if (!item) return;
    picked = true;
    d.close();
    options.pick(item);
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) highlight((active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      // WebKit では dialog の既定の Esc で閉じないことがあるので自分で閉じる
      e.preventDefault();
      d.close();
    }
  });
  // 外側 (背景) をクリックしたら閉じる
  d.addEventListener('mousedown', (e) => {
    if (e.target === d) d.close();
  });
  d.addEventListener('close', () => {
    d.remove();
    if (dialog === d) dialog = null;
    if (!picked) options.cancel?.();
  });

  d.showModal();
  input.focus();
  message('読み込んでいます…');
  options.items.then(
    (items) => {
      all = items;
      if (d.open) render();
    },
    () => message('一覧を読み込めませんでした'),
  );
}
