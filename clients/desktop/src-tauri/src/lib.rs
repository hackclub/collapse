mod capture;
mod crop;
mod pipewire;
mod screencast;
mod tray;
#[cfg(target_os = "windows")]
mod windows_permissions;

#[cfg(target_os = "macos")]
use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFNumberType, CFString, CGRect};
#[cfg(target_os = "macos")]
use objc2_core_graphics::{
    CGDataProvider, CGImage, CGRectMakeWithDictionaryRepresentation, CGWindowImageOption,
    CGWindowListCopyWindowInfo, CGWindowListCreateImage, CGWindowListOption,
};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::sync::OnceLock;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
use tauri::http;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct CapturableWindowCacheEntry {
    is_capturable: bool,
    checked_at: Instant,
}

#[cfg(target_os = "macos")]
static CAPTURABLE_WINDOW_CACHE: OnceLock<Mutex<HashMap<u32, CapturableWindowCacheEntry>>> =
    OnceLock::new();

#[cfg(target_os = "macos")]
const CAPTURABLE_WINDOW_CACHE_TTL: Duration = Duration::from_secs(15);

/// App state shared across commands.
pub struct AppState {
    pub config: Mutex<Option<SessionConfig>>,
    pub cold_start_urls: Mutex<Option<Vec<String>>>,
    /// Maps PipeWire node_id -> the RawFd of the screencast session that owns it.
    /// This allows streams from different portal sessions to coexist (e.g. when
    /// the user incrementally adds sources via the "+" button).
    #[cfg(target_os = "linux")]
    pub pipewire_fds: Mutex<std::collections::HashMap<u32, std::os::fd::RawFd>>,
    /// App names whose windows should be blacked out in monitor captures.
    pub blacklisted_apps: Mutex<Vec<String>>,
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
        let _ = app.emit("lookout-deep-link", parsed);
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
    #[serde(rename = "pipewire")]
    PipeWire { id: u32 },
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

/// Info about an on-screen window, including its bounds for redaction.
struct OnScreenWindowRect {
    app_name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// List all on-screen windows (current space only) with their bounds.
/// Used for blacking out blacklisted app windows in monitor captures.
/// Filters out system chrome (Dock, menu bar, etc.) and tiny windows.
#[cfg(target_os = "macos")]
fn list_onscreen_window_rects() -> Vec<OnScreenWindowRect> {
    let Some(entries) = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        0,
    ) else {
        return Vec::new();
    };

    let mut rects = Vec::new();

    for i in 0..entries.count() {
        let dict_ref = unsafe { entries.value_at_index(i) } as *const CFDictionary;
        if dict_ref.is_null() {
            continue;
        }
        let dict = unsafe { &*dict_ref };

        let app_name = dict_string(dict, "kCGWindowOwnerName").unwrap_or_default();
        if app_name.is_empty() {
            continue;
        }

        let title = dict_string(dict, "kCGWindowName").unwrap_or_default();

        // Skip system chrome — these span the screen and would mask everything
        if should_exclude_window(&app_name, &title) {
            continue;
        }

        let Some(bounds) = window_bounds(dict) else {
            continue;
        };

        // Skip tiny windows (status bar items, badges, etc.)
        if bounds.size.width < 50.0 || bounds.size.height < 50.0 {
            continue;
        }

        // Only include windows that are on-screen
        let is_on_screen = dict_bool(dict, "kCGWindowIsOnscreen").unwrap_or(false);
        if !is_on_screen {
            continue;
        }

        rects.push(OnScreenWindowRect {
            app_name,
            x: bounds.origin.x,
            y: bounds.origin.y,
            width: bounds.size.width,
            height: bounds.size.height,
        });
    }

    rects
}

/// List all visible windows with their bounds (Windows/Linux).
/// Uses xcap::Window::all() which returns windows in z-order (front-to-back).
/// On Linux/Wayland without XWayland this will return an empty list.
#[cfg(not(target_os = "macos"))]
fn list_onscreen_window_rects() -> Vec<OnScreenWindowRect> {
    use xcap::Window;
    let windows = match Window::all() {
        Ok(w) => w,
        Err(_) => return Vec::new(),
    };

    let mut rects = Vec::new();
    for w in windows {
        let app_name = w.app_name().unwrap_or_default();
        if app_name.is_empty() || app_name == "Lookout" {
            continue;
        }
        let title = w.title().unwrap_or_default();
        if should_exclude_window(&app_name, &title) {
            continue;
        }
        if w.is_minimized().unwrap_or(false) {
            continue;
        }
        let width = w.width().unwrap_or(0) as f64;
        let height = w.height().unwrap_or(0) as f64;
        if width < 50.0 || height < 50.0 {
            continue;
        }
        let x = w.x().unwrap_or(0) as f64;
        let y = w.y().unwrap_or(0) as f64;
        rects.push(OnScreenWindowRect {
            app_name,
            x,
            y,
            width,
            height,
        });
    }
    rects
}

fn should_exclude_window(app_name: &str, title: &str) -> bool {
    let app_name_lower = app_name.to_ascii_lowercase();
    let title_lower = title.to_ascii_lowercase();

    const EXCLUDED_APP_NAMES: &[&str] = &[
        "dock",
        "control centre",
        "control center",
        "notification centre",
        "notification center",
        "window server",
        "systemuiserver",
        "spotlight",
        "loginwindow",
        "finder",
        "screencapture",
        "screenshot",
        "windows explorer",
        "raycast",
    ];

    const EXCLUDED_TITLES: &[&str] = &["statusindicator", "item-0", "item-1"];

    EXCLUDED_APP_NAMES
        .iter()
        .any(|excluded| app_name_lower == *excluded)
        || EXCLUDED_TITLES
            .iter()
            .any(|excluded| title_lower == *excluded)
}

#[cfg(target_os = "macos")]
fn get_cf_dictionary_get_value(cf_dictionary: &CFDictionary, key: &str) -> Option<*const c_void> {
    let cf_key = CFString::from_str(key);
    let cf_key_ref = cf_key.as_ref() as *const CFString;
    let value = unsafe { cf_dictionary.value(cf_key_ref.cast()) };
    if value.is_null() {
        return None;
    }
    Some(value)
}

#[cfg(target_os = "macos")]
fn dict_i32(dict: &CFDictionary, key: &str) -> Option<i32> {
    let cf_number = get_cf_dictionary_get_value(dict, key)? as *const CFNumber;
    let mut value: i32 = 0;
    let ok =
        unsafe { (*cf_number).value(CFNumberType::IntType, &mut value as *mut _ as *mut c_void) };
    if !ok {
        return None;
    }
    Some(value)
}

#[cfg(target_os = "macos")]
fn dict_string(dict: &CFDictionary, key: &str) -> Option<String> {
    let value_ref = get_cf_dictionary_get_value(dict, key)? as *const CFString;
    Some(unsafe { (*value_ref).to_string() })
}

#[cfg(target_os = "macos")]
fn dict_bool(dict: &CFDictionary, key: &str) -> Option<bool> {
    let value_ref = get_cf_dictionary_get_value(dict, key)? as *const CFBoolean;
    Some(unsafe { (*value_ref).value() })
}

#[cfg(target_os = "macos")]
fn window_bounds(dict: &CFDictionary) -> Option<CGRect> {
    let value_ref = get_cf_dictionary_get_value(dict, "kCGWindowBounds")? as *const CFDictionary;
    let mut rect = CGRect::default();
    let ok = unsafe { CGRectMakeWithDictionaryRepresentation(Some(&*value_ref), &mut rect) };
    if !ok {
        return None;
    }
    Some(rect)
}

#[cfg(target_os = "macos")]
fn window_is_capturable(window_id: u32, bounds: CGRect) -> bool {
    let cache = CAPTURABLE_WINDOW_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let now = Instant::now();

    if let Ok(cache_guard) = cache.lock() {
        if let Some(entry) = cache_guard.get(&window_id) {
            if now.duration_since(entry.checked_at) <= CAPTURABLE_WINDOW_CACHE_TTL {
                return entry.is_capturable;
            }
        }
    }

    let image = CGWindowListCreateImage(
        bounds,
        CGWindowListOption::OptionIncludingWindow,
        window_id,
        CGWindowImageOption::Default,
    );

    let Some(image) = image else {
        if let Ok(mut cache_guard) = cache.lock() {
            cache_guard.insert(
                window_id,
                CapturableWindowCacheEntry {
                    is_capturable: false,
                    checked_at: now,
                },
            );
        }
        return false;
    };

    let width = CGImage::width(Some(&image));
    let height = CGImage::height(Some(&image));
    let bytes_per_row = CGImage::bytes_per_row(Some(&image));
    let data_provider = CGImage::data_provider(Some(&image));
    let data = CGDataProvider::data(data_provider.as_deref());
    let is_capturable = width > 0
        && height > 0
        && bytes_per_row >= width * 4
        && data.as_ref().is_some_and(|bytes| !bytes.is_empty());

    if let Ok(mut cache_guard) = cache.lock() {
        cache_guard
            .retain(|_, entry| now.duration_since(entry.checked_at) <= CAPTURABLE_WINDOW_CACHE_TTL);
        cache_guard.insert(
            window_id,
            CapturableWindowCacheEntry {
                is_capturable,
                checked_at: now,
            },
        );
    }

    is_capturable
}

#[cfg(target_os = "macos")]
fn list_macos_windows_any_space() -> Vec<WindowInfo> {
    let Some(entries) = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionAll | CGWindowListOption::ExcludeDesktopElements,
        0,
    ) else {
        return Vec::new();
    };

    let mut windows = Vec::new();

    for i in 0..entries.count() {
        let dict_ref = unsafe { entries.value_at_index(i) } as *const CFDictionary;
        if dict_ref.is_null() {
            continue;
        }
        let dict = unsafe { &*dict_ref };

        let Some(id) = dict_i32(dict, "kCGWindowNumber") else {
            continue;
        };
        let Some(sharing_state) = dict_i32(dict, "kCGWindowSharingState") else {
            continue;
        };
        if sharing_state == 0 {
            continue;
        }

        let app_name = dict_string(dict, "kCGWindowOwnerName").unwrap_or_default();
        let title = dict_string(dict, "kCGWindowName").unwrap_or_default();
        let Some(bounds) = window_bounds(dict) else {
            continue;
        };
        let width = bounds.size.width;
        let height = bounds.size.height;

        if should_exclude_window(&app_name, &title) {
            continue;
        }
        if width < 50.0 || height < 50.0 {
            continue;
        }
        if title.is_empty() && app_name.is_empty() {
            continue;
        }
        if app_name == "Lookout" {
            continue;
        }
        if !window_is_capturable(id as u32, bounds) {
            continue;
        }

        let is_on_screen = dict_bool(dict, "kCGWindowIsOnscreen").unwrap_or(true);
        windows.push(WindowInfo {
            id: id as u32,
            app_name,
            title,
            width: width as u32,
            height: height as u32,
            is_minimized: !is_on_screen,
            is_focused: false,
        });
    }

    windows
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

/// Set the list of blacklisted app names (replaces current list).
#[tauri::command]
fn set_blacklisted_apps(apps: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let mut blacklist = state.blacklisted_apps.lock().map_err(|e| e.to_string())?;
    *blacklist = apps;
    Ok(())
}

/// Get the current list of blacklisted app names.
#[tauri::command]
fn get_blacklisted_apps(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let blacklist = state.blacklisted_apps.lock().map_err(|e| e.to_string())?;
    Ok(blacklist.clone())
}

/// List unique app names from all running windows (across all spaces).
/// Returns a sorted, deduplicated list of app names.
#[tauri::command]
fn list_running_apps() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let Some(entries) = CGWindowListCopyWindowInfo(
            CGWindowListOption::OptionAll | CGWindowListOption::ExcludeDesktopElements,
            0,
        ) else {
            return Vec::new();
        };

        let mut apps = std::collections::BTreeSet::new();
        for i in 0..entries.count() {
            let dict_ref = unsafe { entries.value_at_index(i) } as *const CFDictionary;
            if dict_ref.is_null() {
                continue;
            }
            let dict = unsafe { &*dict_ref };
            let app_name = dict_string(dict, "kCGWindowOwnerName").unwrap_or_default();
            if app_name.is_empty() || app_name == "Lookout" {
                continue;
            }
            let title = dict_string(dict, "kCGWindowName").unwrap_or_default();
            if should_exclude_window(&app_name, &title) {
                continue;
            }
            apps.insert(app_name);
        }
        apps.into_iter().collect()
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On non-macOS, return window app names from xcap
        use xcap::Window;
        let mut apps = std::collections::BTreeSet::new();
        if let Ok(windows) = Window::all() {
            for w in windows {
                if let Ok(name) = w.app_name() {
                    if !name.is_empty() && name != "Lookout" && !should_exclude_window(&name, &w.title().unwrap_or_default()) {
                        apps.insert(name);
                    }
                }
            }
        }
        apps.into_iter().collect()
    }
}

/// List available capture sources (monitors + windows).
#[tauri::command]
fn list_capture_sources() -> Result<CaptureSourceList, String> {
    // On Wayland (no X11), xcap cannot enumerate sources.
    // Return an empty list so the frontend falls through to the portal/Cast flow.
    #[cfg(target_os = "linux")]
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return Ok(CaptureSourceList {
            monitors: Vec::new(),
            windows: Vec::new(),
        });
    }

    use xcap::Monitor;
    #[cfg(not(target_os = "macos"))]
    use xcap::Window;

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
    #[cfg(target_os = "macos")]
    let windows: Vec<WindowInfo> = list_macos_windows_any_space();

    #[cfg(not(target_os = "macos"))]
    let windows: Vec<WindowInfo> = Window::all()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|w| {
            let title = w.title().ok().unwrap_or_default();
            let app_name = w.app_name().ok().unwrap_or_default();
            let width = w.width().ok()?;
            let height = w.height().ok()?;

            if should_exclude_window(&app_name, &title) {
                return None;
            }

            // Filter out tiny/invisible windows and our own app
            if width < 50 || height < 50 {
                return None;
            }
            if title.is_empty() && app_name.is_empty() {
                return None;
            }
            if app_name == "Lookout" {
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
    // Prevent unused variable warning on Linux
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = window;

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
    // Prevent unused variable warning on Linux
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = window;

    Ok(())
}

#[tauri::command]
fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
}

#[tauri::command]
async fn request_screencast(
    #[allow(unused_variables)] state: State<'_, AppState>,
) -> Result<Vec<crate::screencast::StreamInfo>, String> {
    #[cfg(target_os = "linux")]
    {
        crate::screencast::request_screencast(state).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("Screencast portal is only supported on Linux".into())
    }
}

#[tauri::command]
async fn add_screencast(
    #[allow(unused_variables)] state: State<'_, AppState>,
) -> Result<Vec<crate::screencast::StreamInfo>, String> {
    #[cfg(target_os = "linux")]
    {
        crate::screencast::add_screencast(state).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("Screencast portal is only supported on Linux".into())
    }
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
    #[allow(unused_variables)] state: State<'_, AppState>,
) -> Result<CaptureResult, String> {
    #[allow(unused_mut, unused_assignments)]
    let mut pipewire_fds = std::collections::HashMap::new();
    #[cfg(target_os = "linux")]
    if let Ok(guard) = state.pipewire_fds.lock() {
        pipewire_fds = guard.clone();
    }
    capture::take_screenshot(source, max_width, max_height, jpeg_quality, &pipewire_fds)
}

/// Shared upload-and-confirm pipeline: get presigned URL, PUT to R2, POST
/// confirmation. Used by both `capture_and_upload` (screen/window) and
/// `upload_frame` (camera).
async fn upload_and_confirm(
    jpeg_base64: &str,
    width: u32,
    height: u32,
    config: &SessionConfig,
    app: &AppHandle,
) -> Result<CaptureUploadResult, String> {
    let jpeg_bytes = base64_decode(jpeg_base64)?;
    let size_bytes = jpeg_bytes.len();

    // Step 1: Get presigned URL from server
    let _ = app.emit("capture-progress", "getting upload url from server...");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    let url_response = client
        .get(format!(
            "{}/api/sessions/{}/upload-url",
            config.api_base_url, config.token
        ))
        .send()
        .await
        .map_err(|e| format!("Failed to get upload URL: {e}"))?;
    let url_status = url_response.status();
    if !url_status.is_success() {
        let body = url_response.text().await.unwrap_or_default();
        return Err(format!(
            "Server rejected upload-url request (HTTP {url_status}): {body}"
        ));
    }
    let upload_url_resp: UploadUrlResponse = url_response
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

    // Step 2: Upload JPEG to R2
    let _ = app.emit(
        "capture-progress",
        format!("uploading {}KB to R2...", size_bytes / 1024),
    );
    client
        .put(&upload_url_resp.upload_url)
        .header("Content-Type", "image/jpeg")
        .body(jpeg_bytes)
        .send()
        .await
        .map_err(|e| format!("R2 upload failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("R2 upload rejected: {e}"))?;
    let _ = app.emit("capture-progress", "uploaded to R2 successfully");

    // Step 3: Confirm upload with server
    let _ = app.emit("capture-progress", "confirming upload with server...");
    let confirm_response = client
        .post(format!(
            "{}/api/sessions/{}/screenshots",
            config.api_base_url, config.token
        ))
        .json(&serde_json::json!({
            "screenshotId": upload_url_resp.screenshot_id,
            "width": width,
            "height": height,
            "fileSize": size_bytes,
        }))
        .send()
        .await
        .map_err(|e| format!("Confirmation failed: {e}"))?;
    let confirm_status = confirm_response.status();
    if !confirm_status.is_success() {
        let body = confirm_response.text().await.unwrap_or_default();
        return Err(format!(
            "Server rejected confirmation (HTTP {confirm_status}): {body}"
        ));
    }
    let confirm_resp: ConfirmResponse = confirm_response
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
        preview_base64: jpeg_base64.to_string(),
        preview_width: width,
        preview_height: height,
    })
}

/// Full capture-upload-confirm pipeline in Rust (no browser CORS issues).
/// Returns the confirm data AND the screenshot preview (base64) so the
/// frontend can display the captured frame without a separate IPC call.
#[tauri::command]
async fn capture_and_upload(
    sources: Vec<CaptureSource>,
    max_width: u32,
    max_height: u32,
    jpeg_quality: u8,
    #[allow(unused_variables)] state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CaptureUploadResult, String> {
    let config = {
        let guard = state.config.lock().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or("Not configured — call configure() first")?
    };

    // Read blacklisted apps
    let blacklisted = {
        let guard = state.blacklisted_apps.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    // Native screenshot
    let _ = app.emit("capture-progress", "capturing screen...");
    #[allow(unused_mut, unused_assignments)]
    let mut pipewire_fds = std::collections::HashMap::new();
    #[cfg(target_os = "linux")]
    if let Ok(guard) = state.pipewire_fds.lock() {
        pipewire_fds = guard.clone();
    }

    let screenshot = capture::take_stitched_screenshots_with_blacklist(
        &sources,
        max_width,
        max_height,
        jpeg_quality,
        &pipewire_fds,
        &blacklisted,
    )?;
    let _ = app.emit(
        "capture-progress",
        format!(
            "captured {}x{} ({}KB jpeg)",
            screenshot.width,
            screenshot.height,
            screenshot.size_bytes / 1024
        ),
    );

    upload_and_confirm(
        &screenshot.base64,
        screenshot.width,
        screenshot.height,
        &config,
        &app,
    )
    .await
}

/// Upload a pre-captured frame (e.g. from browser camera capture).
/// Accepts base64-encoded JPEG from the frontend, runs the upload pipeline.
#[tauri::command]
async fn upload_frame(
    base64: String,
    width: u32,
    height: u32,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CaptureUploadResult, String> {
    let config = {
        let guard = state.config.lock().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or("Not configured — call configure() first")?
    };

    let _ = app.emit(
        "capture-progress",
        format!("uploading camera frame {}x{}", width, height),
    );

    upload_and_confirm(&base64, width, height, &config, &app).await
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
    // Keep _sentry_guard alive for the lifetime of the app so events flush on exit.
    let _sentry_guard = option_env!("SENTRY_DSN").map(|dsn| {
        sentry::init((dsn, sentry::ClientOptions {
            release: sentry::release_name!(),
            environment: Some("desktop-tauri".into()),
            send_default_pii: true,
            sample_rate: 1.0,
            ..Default::default()
        }))
    });

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("lookout-preview", |app_handle, request, responder| {
            #[allow(unused_variables)]
            let app_handle = app_handle.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let uri = request.uri().to_string();
                let parsed_url = match url::Url::parse(&uri) {
                    Ok(u) => u,
                    Err(_) => {
                        responder.respond(http::Response::builder().status(400).body(Vec::new()).unwrap());
                        return;
                    }
                };

                let path = parsed_url.path().trim_start_matches('/');
                let segments: Vec<&str> = path.split('/').collect();
                if segments.len() != 2 {
                    responder.respond(http::Response::builder().status(400).body(Vec::new()).unwrap());
                    return;
                }

                let source_type = segments[0];
                let source_id: u32 = match segments[1].parse() {
                    Ok(id) => id,
                    Err(_) => {
                        responder.respond(http::Response::builder().status(400).body(Vec::new()).unwrap());
                        return;
                    }
                };

                let source = match source_type {
                    "monitor" => crate::CaptureSource::Monitor { id: source_id },
                    "window" => crate::CaptureSource::Window { id: source_id },
                    "pipewire" => crate::CaptureSource::PipeWire { id: source_id },
                    _ => {
                        responder.respond(http::Response::builder().status(400).body(Vec::new()).unwrap());
                        return;
                    }
                };

                let mut max_width = 854;
                let mut max_height = 480;
                let mut jpeg_quality = 85;

                for (k, v) in parsed_url.query_pairs() {
                    match k.as_ref() {
                        "maxWidth" => max_width = v.parse().unwrap_or(max_width),
                        "maxHeight" => max_height = v.parse().unwrap_or(max_height),
                        "jpegQuality" => jpeg_quality = v.parse().unwrap_or(jpeg_quality),
                        _ => {}
                    }
                }

                #[allow(unused_mut, unused_assignments)]
                let mut pipewire_fds = std::collections::HashMap::new();
                #[cfg(target_os = "linux")]
                if let Some(app_state) = app_handle.try_state::<AppState>() {
                    if let Ok(guard) = app_state.pipewire_fds.lock() {
                        pipewire_fds = guard.clone();
                    }
                }

                // Read blacklisted apps for redaction
                let blacklisted: Vec<String> = app_handle
                    .try_state::<AppState>()
                    .and_then(|s| s.blacklisted_apps.lock().ok().map(|g| g.clone()))
                    .unwrap_or_default();

                match crate::capture::take_screenshot_raw_with_blacklist(source, max_width, max_height, jpeg_quality, &pipewire_fds, &blacklisted) {
                    Ok(res) => responder.respond(
                        http::Response::builder()
                            .header("Content-Type", "image/jpeg")
                            .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                            .header("Access-Control-Allow-Origin", "*")
                            .status(200)
                            .body(res.data)
                            .unwrap()
                    ),
                    Err(e) => {
                        eprintln!("Preview capture failed: {}", e);
                        responder.respond(
                            http::Response::builder()
                                .status(500)
                                .body(e.into_bytes())
                                .unwrap()
                        );
                    }
                }
            });
        })
        // Single-instance MUST be first: on Windows/Linux, when a second
        // instance is launched (e.g. deep link click while app is running),
        // this detects it, forwards args to the running instance, and exits
        // before initializing any other plugins.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // On Windows/Linux, deep-link URLs arrive as CLI args when a second
            // instance is launched. Search all args for a lookout:// URL rather
            // than assuming a fixed position — installers and protocol handlers
            // may pass extra flags.
            eprintln!("[single-instance] args: {args:?}");
            let urls: Vec<String> = args
                .iter()
                .filter(|arg| arg.starts_with("lookout://"))
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
        .plugin(tauri_plugin_liquid_glass::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            config: Mutex::new(None),
            cold_start_urls: Mutex::new(None),
            #[cfg(target_os = "linux")]
            pipewire_fds: Mutex::new(std::collections::HashMap::new()),
            blacklisted_apps: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            list_capture_sources,
            configure,
            take_screenshot,
            capture_and_upload,
            upload_frame,
            get_cold_start_urls,
            enable_vibrancy,
            disable_vibrancy,
            is_wayland,
            request_screencast,
            add_screencast,
            set_blacklisted_apps,
            get_blacklisted_apps,
            list_running_apps,
            tray::show_tray,
            tray::update_tray_time,
            tray::hide_tray,
            tray::tray_action,
            tray::set_tray_state,
            tray::get_tray_state,
        ])
        .manage(tray::TrayStateMutex(std::sync::Mutex::new(tray::TrayState::default())))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // Disable App Nap so macOS doesn't throttle WebView timers when
                // the window is occluded or Low Power Mode is on.  The capture
                // loop runs entirely in JS, so throttled timers = missed screenshots.
                // The returned activity token is intentionally leaked (never ended)
                // so the assertion lasts for the lifetime of the process.
                {
                    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
                    let info = NSProcessInfo::processInfo();
                    let reason = NSString::from_str("Periodic screenshot capture must not be throttled");
                    let opts = NSActivityOptions::LatencyCritical
                        | NSActivityOptions::IdleSystemSleepDisabled;
                    let _activity = info.beginActivityWithOptions_reason(opts, &reason);
                    // Leak the token so the activity assertion persists.
                    std::mem::forget(_activity);
                    eprintln!("[power] App Nap suppression enabled");
                }

                use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

                let app_menu = Submenu::with_items(
                    app,
                    "Lookout",
                    true,
                    &[
                        &PredefinedMenuItem::about(
                            app,
                            Some("About Lookout"),
                            Some(AboutMetadata {
                                name: Some("Lookout".to_string()),
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
                        &PredefinedMenuItem::hide(app, Some("Hide Lookout"))?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, Some("Quit Lookout"))?,
                    ],
                )?;

                let start_timelapse_item = MenuItem::with_id(app, "start_timelapse", "Start Timelapse", true, Some("CmdOrControl+N"))?;
                let file_menu = Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[
                        &start_timelapse_item,
                    ],
                )?;

                let edit_menu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
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

                let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])?;
                app.set_menu(menu)?;

                app.on_menu_event(move |app_handle, event| {
                    if event.id().0 == "start_timelapse" {
                        let _ = app_handle.emit("lookout-navigate", "/add");
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.set_focus();
                        }
                    }
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
                            .open_url("https://github.com/hackclub/lookout/", None::<&str>);
                    }
                });

            }

            // On Windows/Linux, ensure the lookout:// protocol handler is
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

                // Auto-grant camera/microphone permissions on Windows so the
                // WebView2 native prompt never appears.
                #[cfg(target_os = "windows")]
                windows_permissions::register_permission_handler(&window);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
