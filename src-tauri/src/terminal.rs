//! 画面下のターミナル。ログインシェルを疑似端末 (PTY) で動かし、入出力を画面とやり取りする。

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{atomic::{AtomicU32, Ordering}, Mutex};
use tauri::{ipc::Channel, AppHandle, Manager, State, WebviewWindow, Window};

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

#[derive(Default)]
pub struct Terminals(Mutex<HashMap<u32, Term>>);

struct Term {
  // 開いたウィンドウ。ウィンドウを閉じたらシェルも終わらせる
  window: String,
  master: Box<dyn MasterPty + Send>,
  writer: Box<dyn Write + Send>,
  child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TermEvent {
  Output { data: String },
  Exit,
}

fn size(cols: u16, rows: u16) -> PtySize {
  PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
pub fn terminal_open(
  app: AppHandle,
  window: WebviewWindow,
  state: State<'_, Terminals>,
  cwd: Option<String>,
  cols: u16,
  rows: u16,
  on_event: Channel<TermEvent>,
) -> Result<u32, String> {
  let pty = native_pty_system().openpty(size(cols, rows)).map_err(|e| format!("端末を用意できませんでした: {e}"))?;
  let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/bash".into());
  let mut cmd = CommandBuilder::new(&shell);
  cmd.env("TERM", "xterm-256color");
  cmd.env("COLORTERM", "truecolor");
  let dir = cwd.filter(|d| Path::new(d).is_dir()).or_else(|| app.path().home_dir().ok().map(|p| p.to_string_lossy().into_owned()));
  if let Some(dir) = dir {
    cmd.cwd(dir);
  }
  let child = pty.slave.spawn_command(cmd).map_err(|e| format!("{shell} を起動できませんでした: {e}"))?;
  drop(pty.slave);
  let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
  let writer = pty.master.take_writer().map_err(|e| e.to_string())?;
  let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
  state.0.lock().unwrap().insert(id, Term { window: window.label().to_string(), master: pty.master, writer, child });

  std::thread::spawn(move || {
    let mut buf = [0u8; 16 * 1024];
    // UTF-8 の文字が読み込みの境目で切れたときの残り
    let mut pending: Vec<u8> = Vec::new();
    loop {
      let n = match reader.read(&mut buf) {
        Ok(0) | Err(_) => break,
        Ok(n) => n,
      };
      pending.extend_from_slice(&buf[..n]);
      let cut = match std::str::from_utf8(&pending) {
        Ok(_) => pending.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => pending.len(),
      };
      if cut == 0 {
        continue;
      }
      let data = String::from_utf8_lossy(&pending[..cut]).into_owned();
      pending.drain(..cut);
      if on_event.send(TermEvent::Output { data }).is_err() {
        break;
      }
    }
    let _ = on_event.send(TermEvent::Exit);
    let term = app.state::<Terminals>().0.lock().unwrap().remove(&id);
    if let Some(mut term) = term {
      let _ = term.child.wait();
    }
  });
  Ok(id)
}

#[tauri::command]
pub fn terminal_write(state: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
  let mut terms = state.0.lock().unwrap();
  let term = terms.get_mut(&id).ok_or("ターミナルは終了しています")?;
  term.writer.write_all(data.as_bytes()).and_then(|_| term.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
  if let Some(term) = state.0.lock().unwrap().get(&id) {
    term.master.resize(size(cols, rows)).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub fn terminal_close(state: State<'_, Terminals>, id: u32) {
  let term = state.0.lock().unwrap().remove(&id);
  if let Some(term) = term {
    end(term);
  }
}

// シェルを止め、終了を待って片付ける (待たないと終了したプロセスが残る)
fn end(mut term: Term) {
  let _ = term.child.kill();
  std::thread::spawn(move || {
    let _ = term.child.wait();
  });
}

/// ウィンドウを閉じたら、そのウィンドウで開いていたシェルを終わらせる
pub fn close_window(window: &Window) {
  let state = window.state::<Terminals>();
  let mut terms = state.0.lock().unwrap();
  let ids: Vec<u32> = terms.iter().filter(|(_, t)| t.window == window.label()).map(|(id, _)| *id).collect();
  for id in ids {
    if let Some(term) = terms.remove(&id) {
      end(term);
    }
  }
}
