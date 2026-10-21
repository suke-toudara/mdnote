// 右クリックメニュー (表とファイル一覧で共通)

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

export type MenuEntry = MenuItem | 'separator';

const menu = document.getElementById('context-menu') as HTMLElement;

export function closeContextMenu() {
  menu.hidden = true;
}

// beforeRun: 項目を選んだ直後、実行の前に呼ぶ (エディタにフォーカスを戻すなど)
export function showContextMenu(items: MenuEntry[], x: number, y: number, beforeRun?: () => void) {
  menu.replaceChildren();
  for (const item of items) {
    if (item === 'separator') {
      menu.append(Object.assign(document.createElement('hr'), { className: 'menu-separator' }));
      continue;
    }
    const button = document.createElement('button');
    button.className = 'menu-item';
    button.disabled = !!item.disabled;
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(label);
    if (item.shortcut) {
      const key = document.createElement('kbd');
      key.textContent = item.shortcut;
      button.append(key);
    }
    button.addEventListener('click', () => {
      closeContextMenu();
      beforeRun?.();
      item.run();
    });
    menu.append(button);
  }
  menu.hidden = false;
  // 画面からはみ出さないように位置を調整する
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!menu.contains(e.target as Node)) closeContextMenu();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeContextMenu());
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);
document.addEventListener('scroll', closeContextMenu, true);
