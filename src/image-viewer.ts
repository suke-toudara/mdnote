// 文書だけの表示 (F5) で画像をクリックすると、画面いっぱいに大きく見せる。
// クリックするか Esc で元に戻る。通常の編集中は、画像をクリックしてブロックを選ぶ操作を邪魔しないよう何もしない。

let viewer: HTMLElement | null = null;

function close() {
  viewer?.remove();
  viewer = null;
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  close();
}

function open(src: string, alt: string) {
  close();
  const box = document.createElement('div');
  box.className = 'image-viewer';
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  box.append(img);
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
  viewer = box;
}

export function setupImageViewer() {
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('document-only')) return;
    const img = (e.target as HTMLElement).closest?.<HTMLImageElement>('.milkdown-image-block img[data-type="image-block"]');
    if (img) open(img.src, img.alt);
  });
}
