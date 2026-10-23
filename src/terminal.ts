// 画面下のターミナル (デスクトップ版のみ)。シェルは Rust 側の疑似端末で動かす。
//
// - Ctrl+J / Ctrl+` で表示を切り替える。閉じてもシェルは動いたままで、開き直すと続きから使える
// - 開いたフォルダ (なければ文書のあるフォルダ) で起動する
// - Ctrl+Shift+C / Ctrl+Shift+V でコピー・貼り付け

import { Channel, invoke } from '@tauri-apps/api/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

type TermEvent = { type: 'output'; data: string } | { type: 'exit' };

export interface TerminalOptions {
  panel: HTMLElement;
  // 起動するフォルダ
  cwd: () => Promise<string | null>;
  onToggle?: (shown: boolean) => void;
}

const HEIGHT_KEY = 'terminalHeight';

export function setupTerminal({ panel, cwd, onToggle }: TerminalOptions) {
  const host = panel.querySelector<HTMLElement>('.terminal-host')!;
  const title = panel.querySelector<HTMLElement>('.terminal-cwd')!;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let id: number | null = null;
  let exited = false;

  try {
    const h = Number(localStorage.getItem(HEIGHT_KEY));
    if (h >= 80) panel.style.height = `${h}px`;
  } catch {
    // 既定の高さで開く
  }

  // 本文と同じ配色にする
  const theme = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      background: v('--source-bg') || v('--bg'),
      foreground: v('--fg'),
      cursor: v('--caret') || v('--fg'),
      cursorAccent: v('--source-bg') || v('--bg'),
      selectionBackground: v('--mark') || 'rgba(128, 128, 128, 0.35)',
    };
  };
  new MutationObserver(() => {
    if (term) term.options.theme = theme();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  async function start() {
    if (!term) {
      term = new Terminal({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK JP", monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        theme: theme(),
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      term.onData((data) => {
        if (exited) {
          if (data === '\r') void restart();
          return;
        }
        if (id !== null) void invoke('terminal_write', { id, data }).catch(() => {});
      });
      term.onResize(({ cols, rows }) => {
        if (id !== null) void invoke('terminal_resize', { id, cols, rows }).catch(() => {});
      });
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
        const key = e.key.toLowerCase();
        if (key === 'c') {
          const text = term?.getSelection();
          if (text) void navigator.clipboard.writeText(text).catch(() => {});
          return false;
        }
        if (key === 'v') {
          void navigator.clipboard.readText().then((text) => term?.paste(text)).catch(() => {});
          return false;
        }
        return true;
      });
      // xterm.js は日本語入力の確定文字を、隠れた入力欄の中身の差分から取り出す。WebKitGTK では
      // 半角の入力が欄に残るため差分がずれ、確定した文字が二重に送られる。
      // 変換中でないキー入力のたびに欄を空にして、差分が確定した文字だけになるようにする
      let composing = false;
      host.addEventListener('compositionstart', () => { composing = true; }, true);
      host.addEventListener('compositionend', () => { composing = false; }, true);
      host.addEventListener('keydown', (e) => {
        if (!composing && !e.isComposing && term?.textarea) term.textarea.value = '';
      }, true);
      new ResizeObserver(() => {
        if (!panel.hidden) fit?.fit();
      }).observe(host);
    }
    fit!.fit();
    const dir = await cwd().catch(() => null);
    // 長いパスは先頭を省くため右寄せ (rtl) で表示している。記号が逆側に回らないよう左から右の印を付ける
    title.textContent = `\u200e${dir ?? '~'}`;
    title.title = dir ?? '';
    const channel = new Channel<TermEvent>();
    channel.onmessage = (event) => {
      if (event.type === 'output') term?.write(event.data);
      else {
        exited = true;
        id = null;
        term?.write('\r\n\x1b[2m[プロセスが終了しました。Enter で新しく開きます]\x1b[0m\r\n');
      }
    };
    exited = false;
    id = await invoke<number>('terminal_open', { cwd: dir, cols: term!.cols, rows: term!.rows, onEvent: channel });
  }

  async function restart() {
    if (id !== null) await invoke('terminal_close', { id }).catch(() => {});
    id = null;
    term?.reset();
    await start();
  }

  function show(visible: boolean) {
    panel.hidden = !visible;
    onToggle?.(visible);
    if (!visible) return;
    if (!term || (id === null && !exited)) {
      void start().catch((e) => {
        term?.write(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
      });
    } else {
      fit?.fit();
    }
    requestAnimationFrame(() => term?.focus());
  }

  // 上端をドラッグして高さを変える
  const resizer = panel.querySelector<HTMLElement>('.terminal-resizer')!;
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = panel.offsetHeight;
    const move = (ev: PointerEvent) => {
      const max = Math.max(120, (panel.parentElement?.clientHeight ?? window.innerHeight) - 120);
      panel.style.height = `${Math.min(max, Math.max(80, startH + startY - ev.clientY))}px`;
    };
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      try {
        localStorage.setItem(HEIGHT_KEY, String(panel.offsetHeight));
      } catch {
        // 高さを覚えられなくても使える
      }
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up, { once: true });
  });

  panel.querySelector('.terminal-restart')!.addEventListener('click', () => void restart().catch(() => {}));
  panel.querySelector('.terminal-close')!.addEventListener('click', () => show(false));

  return {
    toggle: () => show(!!panel.hidden),
    show,
    get shown() {
      return !panel.hidden;
    },
  };
}
