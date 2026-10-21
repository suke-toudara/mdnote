use std::sync::Mutex;
use tauri::State;

const SERVICE: &str = "mdnote";
const ACCOUNT: &str = "claude-api-key";

#[derive(Clone)]
enum ActiveKey {
  Saved(String),
  Session(String),
}

#[derive(Default)]
pub struct ClaudeKey(Mutex<Option<ActiveKey>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeKeyStatus {
  source: &'static str,
  keychain_error: bool,
}

fn entry() -> Result<keyring::Entry, String> {
  keyring::Entry::new(SERVICE, ACCOUNT)
    .map_err(|_| "システムキーチェーンに接続できません。ロック解除や設定を確認してください".to_string())
}

fn read_saved() -> Result<Option<String>, String> {
  match entry()?.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(_) => Err("システムキーチェーンからキーを読み取れません。ロック解除を確認してください".into()),
  }
}

fn write_saved(key: &str) -> Result<(), String> {
  entry()?.set_password(key)
    .map_err(|_| "システムキーチェーンに保存できません。一時利用を選ぶか、キーチェーンの設定を確認してください".into())
}

fn delete_saved() -> Result<(), String> {
  match entry()?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(_) => Err("システムキーチェーンからキーを削除できません。ロック解除を確認してください".into()),
  }
}

fn environment_key() -> Option<String> {
  std::env::var("ANTHROPIC_API_KEY").ok().filter(|key| !key.trim().is_empty())
}

pub async fn resolve_key(state: &ClaudeKey) -> Result<String, String> {
  if let Some(key) = state.0.lock().map_err(|_| "API キーを読み込めませんでした".to_string())?.as_ref() {
    return Ok(match key { ActiveKey::Saved(value) | ActiveKey::Session(value) => value.clone() });
  }
  let saved = tauri::async_runtime::spawn_blocking(read_saved).await
    .map_err(|_| "システムキーチェーンを確認できませんでした".to_string())?;
  match saved {
    Ok(Some(key)) if !key.trim().is_empty() => Ok(key),
    Ok(_) => environment_key().ok_or("先に設定から API キーを登録してください".into()),
    Err(error) => environment_key().ok_or(error),
  }
}

#[tauri::command]
pub async fn claude_key_status(state: State<'_, ClaudeKey>) -> Result<ClaudeKeyStatus, String> {
  if let Ok(guard) = state.0.lock() {
    if let Some(active) = guard.as_ref() {
      return Ok(ClaudeKeyStatus { source: match active { ActiveKey::Saved(_) => "keychain", ActiveKey::Session(_) => "session" }, keychain_error: false });
    }
  }
  let saved = tauri::async_runtime::spawn_blocking(read_saved).await;
  Ok(match saved {
    Ok(Ok(Some(key))) if !key.trim().is_empty() => ClaudeKeyStatus { source: "keychain", keychain_error: false },
    Ok(Ok(_)) => ClaudeKeyStatus { source: if environment_key().is_some() { "environment" } else { "none" }, keychain_error: false },
    _ => ClaudeKeyStatus { source: if environment_key().is_some() { "environment" } else { "none" }, keychain_error: true },
  })
}

#[tauri::command]
pub async fn set_claude_key(state: State<'_, ClaudeKey>, key: String, persist: bool) -> Result<(), String> {
  let key = key.trim().to_owned();
  if !key.starts_with("sk-ant-") { return Err("Claude の API キーを入力してください".into()); }
  if persist {
    let to_save = key.clone();
    tauri::async_runtime::spawn_blocking(move || write_saved(&to_save)).await
      .map_err(|_| "システムキーチェーンに保存できませんでした".to_string())??;
  }
  let mut active = state.0.lock().map_err(|_| "API キーを設定できませんでした".to_string())?;
  *active = Some(if persist { ActiveKey::Saved(key) } else { ActiveKey::Session(key) });
  Ok(())
}

#[tauri::command]
pub async fn clear_claude_key(state: State<'_, ClaudeKey>) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(delete_saved).await
    .map_err(|_| "システムキーチェーンを確認できませんでした".to_string())??;
  *state.0.lock().map_err(|_| "API キーを削除できませんでした".to_string())? = None;
  Ok(())
}
