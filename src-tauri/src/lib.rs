/// 起動時の引数で渡された Markdown ファイルのパス（「このアプリで開く」用）
#[tauri::command]
fn initial_file() -> Option<String> {
  std::env::args()
    .skip(1)
    .find(|a| !a.starts_with('-'))
    .and_then(|a| std::fs::canonicalize(a).ok())
    .map(|p| p.to_string_lossy().into_owned())
}

/// ファイルやフォルダをゴミ箱へ移す (完全には消さないので、あとから戻せる)
#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
  trash::delete(&path).map_err(|e| e.to_string())
}

/// 表示中の文書を、印刷ダイアログを出さずに PDF ファイルへ書き出す (印刷用の CSS が使われる)
#[cfg(target_os = "linux")]
fn print_to_pdf(
  window: &tauri::WebviewWindow,
  path: String,
  page_size: String,
  margin_mm: f64,
) -> Result<std::sync::mpsc::Receiver<Result<(), String>>, String> {
  use std::sync::{mpsc, Arc, Mutex};
  use webkit2gtk::PrintOperationExt;

  let uri = glib::filename_to_uri(&path, None).map_err(|e| e.to_string())?.to_string();
  let (tx, rx) = mpsc::channel();
  // 完了と失敗のどちらか先に来た方だけを返す
  let tx = Arc::new(Mutex::new(Some(tx)));
  let send = move |result: Result<(), String>| {
    if let Some(tx) = tx.lock().unwrap().take() {
      let _ = tx.send(result);
    }
  };

  window
    .with_webview(move |platform| {
      let op = webkit2gtk::PrintOperation::new(&platform.inner());
      let settings = gtk::PrintSettings::new();
      // 「ファイルに出力」プリンタ。名前は GTK の言語設定で翻訳されている
      settings.set_printer(glib::dgettext(Some("gtk30"), "Print to File").as_str());
      settings.set("output-file-format", Some("pdf"));
      settings.set("output-uri", Some(&uri));
      op.set_print_settings(&settings);
      let setup = gtk::PageSetup::new();
      let paper = match page_size.as_str() { "A3" => "iso_a3", "Letter" => "na_letter", _ => "iso_a4" };
      setup.set_paper_size(&gtk::PaperSize::new(Some(paper)));
      // WebKitGTK は CSS の @page の余白を使わないので、ここで指定する
      let margin = margin_mm.clamp(5.0, 40.0);
      setup.set_top_margin(margin, gtk::Unit::Mm);
      setup.set_bottom_margin(margin, gtk::Unit::Mm);
      setup.set_left_margin(margin, gtk::Unit::Mm);
      setup.set_right_margin(margin, gtk::Unit::Mm);
      op.set_page_setup(&setup);
      let done = send.clone();
      op.connect_finished(move |_| done(Ok(())));
      let failed = send.clone();
      op.connect_failed(move |_, err| failed(Err(err.to_string())));
      op.print();
    })
    .map_err(|e| e.to_string())?;
  Ok(rx)
}

#[tauri::command]
async fn export_pdf(window: tauri::WebviewWindow, path: String, page_size: String, margin_mm: f64) -> Result<(), String> {
  #[cfg(target_os = "linux")]
  {
    let rx = print_to_pdf(&window, path, page_size, margin_mm)?;
    tauri::async_runtime::spawn_blocking(move || {
      rx.recv_timeout(std::time::Duration::from_secs(120))
        .map_err(|_| "PDF の書き出しが終わりませんでした".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
  }
  #[cfg(not(target_os = "linux"))]
  {
    let _ = (window, path, page_size, margin_mm);
    Err("この OS では PDF の直接書き出しに対応していません".into())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![initial_file, move_to_trash, export_pdf])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
