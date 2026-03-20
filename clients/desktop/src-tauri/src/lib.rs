mod capture;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

/// App state shared across commands.
pub struct AppState {
    pub config: Mutex<Option<SessionConfig>>,
    pub cold_start_urls: Mutex<Option<Vec<String>>>,
}

/// Central deep link handler. All deep link entry points (cold start, single
/// instance, macOS Apple Events) route through here. Stashes URLs for
/// cold-start polling AND emits them for the warm-start JS listener.
fn handle_deep_link_urls(app: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    eprintln!("[deep-link] handling urls: {urls:?}");

    // Stash for cold-start polling (get_cold_start_urls command)
    if let Ok(mut state) = app.state::<AppState>().cold_start_urls.lock() {
        *state = Some(urls.clone());
    }

    // Emit for warm-start JS listener (onOpenUrl)
    let parsed: Vec<url::Url> = urls
        .iter()
        .filter_map(|u| u.parse::<url::Url>().ok())
        .collect();
    if !parsed.is_empty() {
        let _ = app.emit("deep-link://new-url", parsed);
    }

    // Focus the window
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub token: String,
    pub api_base_url: String,
}

#[derive(Serialize)]
pub struct CaptureResult {
    /// Base64-encoded JPEG bytes
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CaptureSource {
    #[serde(rename = "monitor")]
    Monitor { id: u32 },
    #[serde(rename = "window")]
    Window { id: u32 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub is_builtin: bool,
    pub scale_factor: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub is_minimized: bool,
    pub is_focused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSourceList {
    pub monitors: Vec<MonitorInfo>,
    pub windows: Vec<WindowInfo>,
}

#[derive(Serialize, Deserialize)]
pub struct UploadUrlResponse {
    #[serde(rename = "uploadUrl")]
    pub upload_url: String,
    #[serde(rename = "r2Key")]
    pub r2_key: String,
    #[serde(rename = "screenshotId")]
    pub screenshot_id: String,
    #[serde(rename = "minuteBucket")]
    pub minute_bucket: i32,
    #[serde(rename = "nextExpectedAt")]
    pub next_expected_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct ConfirmResponse {
    pub confirmed: bool,
    #[serde(rename = "trackedSeconds")]
    pub tracked_seconds: i64,
    #[serde(rename = "nextExpectedAt")]
    pub next_expected_at: String,
}

/// Result returned to the frontend from capture_and_upload.
/// Includes the server confirm data AND the screenshot preview.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureUploadResult {
    pub confirmed: bool,
    pub tracked_seconds: i64,
    pub next_expected_at: String,
    /// Base64-encoded JPEG of the captured frame (same image that was uploaded)
    pub preview_base64: String,
    pub preview_width: u32,
    pub preview_height: u32,
}

/// Return the deep link URLs from cold start (if any), then clear them.
#[tauri::command]
fn get_cold_start_urls(state: State<'_, AppState>) -> Vec<String> {
    let mut urls = state
        .cold_start_urls
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    urls.take().unwrap_or_default()
}

/// List available capture sources (monitors + windows).
#[tauri::command]
fn list_capture_sources() -> Result<CaptureSourceList, String> {
    use xcap::{Monitor, Window};

    let monitors: Vec<MonitorInfo> = Monitor::all()
        .map_err(|e| format!("Failed to list monitors: {e}"))?
        .into_iter()
        .filter_map(|m| {
            Some(MonitorInfo {
                id: m.id().ok()?,
                name: m.friendly_name().or_else(|_| m.name()).unwrap_or_default(),
                width: m.width().ok()?,
                height: m.height().ok()?,
                is_primary: m.is_primary().unwrap_or(false),
                is_builtin: m.is_builtin().unwrap_or(false),
                scale_factor: m.scale_factor().unwrap_or(1.0),
            })
        })
        .collect();

    // Window enumeration can fail on some platforms — treat as empty list, not error
    let windows: Vec<WindowInfo> = Window::all()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|w| {
            let title = w.title().ok().unwrap_or_default();
            let app_name = w.app_name().ok().unwrap_or_default();
            let width = w.width().ok()?;
            let height = w.height().ok()?;
            // Filter out tiny/invisible windows and our own app
            if width < 50 || height < 50 {
                return None;
            }
            if title.is_empty() && app_name.is_empty() {
                return None;
            }
            if app_name == "Collapse" {
                return None;
            }
            Some(WindowInfo {
                id: w.id().ok()?,
                app_name,
                title,
                width,
                height,
                is_minimized: w.is_minimized().unwrap_or(false),
                is_focused: w.is_focused().unwrap_or(false),
            })
        })
        .collect();

    Ok(CaptureSourceList { monitors, windows })
}

#[tauri::command]
fn enable_vibrancy(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        apply_vibrancy(
            &window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::Active),
            Some(16.0),
        )
        .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_mica;
        apply_mica(&window, None).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn disable_vibrancy(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::clear_vibrancy;
        clear_vibrancy(&window).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::clear_mica;
        clear_mica(&window).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Initialize the session config so Rust knows where the server is.
#[tauri::command]
fn configure(
    token: String,
    api_base_url: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    *config = Some(SessionConfig {
        token,
        api_base_url,
    });
    Ok(())
}

/// Take a native screenshot, encode as JPEG, return base64.
#[tauri::command]
fn take_screenshot(
    source: CaptureSource,
    max_width: u32,
    max_height: u32,
    jpeg_quality: u8,
) -> Result<CaptureResult, String> {
    capture::take_screenshot(source, max_width, max_height, jpeg_quality)
}

/// Full capture-upload-confirm pipeline in Rust (no browser CORS issues).
/// Returns the confirm data AND the screenshot preview (base64) so the
/// frontend can display the captured frame without a separate IPC call.
#[tauri::command]
async fn capture_and_upload(
    source: CaptureSource,
    max_width: u32,
    max_height: u32,
    jpeg_quality: u8,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CaptureUploadResult, String> {
    let config = {
        let guard = state.config.lock().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or("Not configured — call configure() first")?
    };

    // Step 1: Native screenshot
    let _ = app.emit("capture-progress", "capturing screen...");
    let screenshot = capture::take_screenshot(source, max_width, max_height, jpeg_quality)?;
    let jpeg_bytes = base64_decode(&screenshot.base64)?;
    let _ = app.emit(
        "capture-progress",
        format!(
            "captured {}x{} ({}KB jpeg)",
            screenshot.width,
            screenshot.height,
            jpeg_bytes.len() / 1024
        ),
    );

    // Step 2: Get presigned URL from server
    let _ = app.emit("capture-progress", "getting upload url from server...");
    let client = reqwest::Client::new();
    let upload_url_resp: UploadUrlResponse = client
        .get(format!(
            "{}/api/sessions/{}/upload-url",
            config.api_base_url, config.token
        ))
        .send()
        .await
        .map_err(|e| format!("Failed to get upload URL: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse upload URL response: {e}"))?;
    let _ = app.emit(
        "capture-progress",
        format!(
            "got upload url, screenshot id: {}",
            upload_url_resp.screenshot_id
        ),
    );

    // Step 3: Upload JPEG to R2
    let _ = app.emit(
        "capture-progress",
        format!("uploading {}KB to R2...", jpeg_bytes.len() / 1024),
    );
    client
        .put(&upload_url_resp.upload_url)
        .header("Content-Type", "image/jpeg")
        .body(jpeg_bytes.clone())
        .send()
        .await
        .map_err(|e| format!("R2 upload failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("R2 upload rejected: {e}"))?;
    let _ = app.emit("capture-progress", "uploaded to R2 successfully");

    // Step 4: Confirm upload with server
    let _ = app.emit("capture-progress", "confirming upload with server...");
    let confirm_resp: ConfirmResponse = client
        .post(format!(
            "{}/api/sessions/{}/screenshots",
            config.api_base_url, config.token
        ))
        .json(&serde_json::json!({
            "screenshotId": upload_url_resp.screenshot_id,
            "width": screenshot.width,
            "height": screenshot.height,
            "fileSize": screenshot.size_bytes,
        }))
        .send()
        .await
        .map_err(|e| format!("Confirmation failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse confirmation: {e}"))?;
    let _ = app.emit(
        "capture-progress",
        format!(
            "confirmed! tracked {}s, next expected at {}",
            confirm_resp.tracked_seconds, confirm_resp.next_expected_at
        ),
    );

    Ok(CaptureUploadResult {
        confirmed: confirm_resp.confirmed,
        tracked_seconds: confirm_resp.tracked_seconds,
        next_expected_at: confirm_resp.next_expected_at,
        // Return the same base64 we already have — no extra work
        preview_base64: screenshot.base64,
        preview_width: screenshot.width,
        preview_height: screenshot.height,
    })
}

fn base64_decode(b64: &str) -> Result<Vec<u8>, String> {
    use base64_engine::*;
    ENGINE
        .decode(b64)
        .map_err(|e| format!("Base64 decode failed: {e}"))
}

mod base64_engine {
    pub use base64::engine::general_purpose::STANDARD as ENGINE;
    pub use base64::Engine;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be first: on Windows/Linux, when a second
        // instance is launched (e.g. deep link click while app is running),
        // this detects it, forwards args to the running instance, and exits
        // before initializing any other plugins.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // On Windows/Linux, deep-link URLs arrive as CLI args when a second
            // instance is launched. Search all args for a collapse:// URL rather
            // than assuming a fixed position — installers and protocol handlers
            // may pass extra flags.
            eprintln!("[single-instance] args: {args:?}");
            let urls: Vec<String> = args
                .iter()
                .filter(|arg| arg.starts_with("collapse://"))
                .cloned()
                .collect();
            handle_deep_link_urls(app, urls);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            config: Mutex::new(None),
            cold_start_urls: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            list_capture_sources,
            configure,
            take_screenshot,
            capture_and_upload,
            get_cold_start_urls,
            enable_vibrancy,
            disable_vibrancy,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

                let app_menu = Submenu::with_items(
                    app,
                    "Collapse",
                    true,
                    &[
                        &PredefinedMenuItem::about(
                            app,
                            Some("About Collapse"),
                            Some(AboutMetadata {
                                name: Some("Collapse".to_string()),
                                version: app.config().version.clone(),
                                authors: Some(vec!["Hack Club".to_string()]),
                                copyright: Some("© 2026 Hack Club, A 501(c)(3) nonprofit project for student makers.".to_string()),
                                license: Some("MIT".to_string()),
                                website: Some("https://fallout.hackclub.com".to_string()),
                                website_label: Some("Hack Club Fallout".to_string()),
                                ..Default::default()
                            }),
                        )?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, Some("Hide Collapse"))?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, Some("Quit Collapse"))?,
                    ],
                )?;

                let window_menu = Submenu::with_items(
                    app,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app, None)?,
                        &PredefinedMenuItem::maximize(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::close_window(app, None)?,
                    ],
                )?;

                let docs_item = MenuItem::with_id(app, "docs", "Fallout Docs", true, None::<&str>)?;
                let guide_item = MenuItem::with_id(app, "guide", "How to Timelapse?", true, None::<&str>)?;
                let gh_item = MenuItem::with_id(app, "github", "GitHub Repo", true, None::<&str>)?;
                let help_menu = Submenu::with_items(app, "Help", true, &[&docs_item, &guide_item, &gh_item])?;

                let menu = Menu::with_items(app, &[&app_menu, &window_menu, &help_menu])?;
                app.set_menu(menu)?;

                app.on_menu_event(move |app_handle, event| {
                    if event.id().0 == "docs" {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app_handle
                            .opener()
                            .open_url("https://fallout.hackclub.com/docs", None::<&str>);
                    }
                    if event.id().0 == "guide" {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app_handle
                            .opener()
                            .open_url("https://fallout.hackclub.com/docs/project-resources/how-to-timelapse", None::<&str>);
                    }
                    if event.id().0 == "github" {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app_handle
                            .opener()
                            .open_url("https://github.com/hackclub/collapse/", None::<&str>);
                    }
                });

            }

            // On Windows/Linux, ensure the collapse:// protocol handler is
            // registered even if the installer didn't do it (dev builds,
            // portable installs, AppImages).
            #[cfg(desktop)]
            {
                let _ = app.deep_link().register_all();
                eprintln!("[deep-link] registered protocol handler");
            }

            // Cold start: check if the app was launched via a deep link
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let url_strings: Vec<String> = urls.into_iter().map(|u| u.to_string()).collect();
                handle_deep_link_urls(app.handle(), url_strings);
            }

            // macOS: Apple Events can deliver deep links after setup completes
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let url_strings: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                handle_deep_link_urls(&handle, url_strings);
            });

            // Disable maximize/fullscreen controls on all platforms.
            if let Some(window) = app.get_webview_window("main") {
                window.set_maximizable(false)?;
                window.set_fullscreen(false)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
