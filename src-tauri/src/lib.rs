//! Tauri shell: exposes the pll-core Engine through one `rpc` command.

use pll_core::Engine;
use serde_json::Value;
use std::sync::Mutex;
use tauri::Manager;

struct AppState(Mutex<Engine>);

/// Runs on Tauri's async pool so slow hardware I/O never blocks the UI thread.
#[tauri::command]
async fn rpc(state: tauri::State<'_, AppState>, cmd: String, args: Value) -> Result<Value, String> {
    let mut engine = state.0.lock().map_err(|_| "engine poisoned".to_string())?;
    engine.handle(&cmd, args).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(&path, text).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
async fn load_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
}

fn validate_url(url: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "Некорректная ссылка".to_string())?;
    if !(url.starts_with("http://") || url.starts_with("https://"))
        || !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || url.chars().any(char::is_control)
    {
        return Err("Разрешены только ссылки HTTP/HTTPS".into());
    }
    Ok(())
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    validate_url(&url)?;
    // Arguments are passed directly; URL contents never become shell source.
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("powershell.exe");
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        command.args(["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:PLL_STUDIO_OPEN_URL"]);
        command.env("PLL_STUDIO_OPEN_URL", &url);
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = std::process::Command::new("xdg-open");
    #[cfg(not(target_os = "windows"))]
    cmd.arg(&url);
    let status = cmd.status().map_err(|e| format!("Не удалось открыть браузер: {e}"))?;
    if !status.success() {
        return Err(format!("Команда открытия браузера завершилась с ошибкой: {status}"));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let cfg = app.path().app_config_dir().ok().map(|d| d.join("pll-studio.json"));
            app.manage(AppState(Mutex::new(Engine::new(cfg))));
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&pll_core::about::title())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc, save_text, load_text, open_url])
        .run(tauri::generate_context!())
        .expect("error while running PLL Studio");
}

#[cfg(test)]
mod tests {
    #[test]
    fn external_urls_require_http_and_a_host() {
        for url in ["https://github.com/maximkurein/PLL-Studio", "http://100.64.0.12:3000/mxm/PLL-Studio", "https://example.org/?q=a&b=2"] {
            assert!(super::validate_url(url).is_ok());
        }
        for url in ["file:///etc/passwd", "javascript:alert(1)", "https://", "https://example.org/\n", "not a URL"] {
            assert!(super::validate_url(url).is_err(), "{url}");
        }
    }
}
