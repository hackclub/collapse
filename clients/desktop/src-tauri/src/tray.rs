use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayState {
    pub display_seconds: u32,
    pub screenshot_count: u32,
    pub control_mode: String,
    pub updated_at: u64,
}

impl Default for TrayState {
    fn default() -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        Self {
            display_seconds: 0,
            screenshot_count: 0,
            control_mode: "recording".to_string(),
            updated_at: now,
        }
    }
}

pub struct TrayStateMutex(pub Mutex<TrayState>);

#[tauri::command]
pub fn show_tray(time_text: String, app: AppHandle) -> Result<(), String> {
    if app.tray_by_id("timelapse_tray").is_some() {
        return Ok(());
    }

    let icon_bytes = include_bytes!("../icons/timelapse_template.png");
    let icon = Image::from_bytes(icon_bytes).map_err(|e| e.to_string())?;

    let _tray = TrayIconBuilder::with_id("timelapse_tray")
        .title(&time_text)
        .icon(icon)
        .icon_as_template(true)
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                rect,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    toggle_tray_window(tray.app_handle(), rect);
                }
            }
        })
        .build(&app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn toggle_tray_window(app: &AppHandle, rect: tauri::Rect) {
    if let Some(window) = app.get_webview_window("tray") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = position_and_show_window(&window, rect);
            let _ = window.set_focus();
            let _ = window.emit("tray-opened", ());
        }
    } else {
        // Create it
        let mut builder = WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("#/tray".into()))
            .title("Tray")
            .inner_size(300.0, 50.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .transparent(true)
            .skip_taskbar(true)
            .focused(true)
            .visible(false);

        #[cfg(target_os = "macos")]
        {
            builder = builder.visible_on_all_workspaces(true);
        }

        if let Ok(window) = builder.build() {
            // Hide on blur
            let w = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = w.hide();
                }
            });

            let _ = position_and_show_window(&window, rect);
            let _ = window.emit("tray-opened", ());
        }
    }
}

fn position_and_show_window(
    window: &tauri::WebviewWindow,
    tray_rect: tauri::Rect,
) -> Result<(), tauri::Error> {
    // Attempt to position it horizontally centered below the tray icon
    let monitor = window
        .current_monitor()?
        .unwrap_or_else(|| window.primary_monitor().unwrap().unwrap());
    let scale_factor = monitor.scale_factor();
    let window_size = window.outer_size()?;

    let tray_logical_pos = tray_rect.position.to_logical::<f64>(scale_factor);
    let tray_logical_size = tray_rect.size.to_logical::<f64>(scale_factor);

    let window_logical_size = window_size.to_logical::<f64>(scale_factor);
    let monitor_logical_size = monitor.size().to_logical::<f64>(scale_factor);
    let monitor_logical_pos = monitor.position().to_logical::<f64>(scale_factor);

    let mut x =
        tray_logical_pos.x + (tray_logical_size.width / 2.0) - (window_logical_size.width / 2.0);

    // Default to below the tray icon
    let mut y = tray_logical_pos.y + tray_logical_size.height;

    // Windows taskbar is usually at the bottom. If the popup goes off the bottom of the screen, place it above the icon!
    if y + window_logical_size.height > monitor_logical_pos.y + monitor_logical_size.height {
        y = tray_logical_pos.y - window_logical_size.height;
    }

    // Prevent rendering off-screen horizontally
    if x + window_logical_size.width > monitor_logical_pos.x + monitor_logical_size.width {
        x = monitor_logical_pos.x + monitor_logical_size.width - window_logical_size.width;
    }
    if x < monitor_logical_pos.x {
        x = monitor_logical_pos.x;
    }

    window.set_position(LogicalPosition::new(x, y))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[tauri::command]
pub fn update_tray_time(time_text: String, _is_paused: bool, app: AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("timelapse_tray") {
        let _ = tray.set_title(Some(time_text));
    }
    Ok(())
}

#[tauri::command]
pub fn hide_tray(app: AppHandle) -> Result<(), String> {
    app.remove_tray_by_id("timelapse_tray");
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
pub fn tray_action(action: String, app: AppHandle) -> Result<(), String> {
    // Only hide tray for terminal/interactive actions, not for simple events
    if action != "ready" {
        if let Some(w) = app.get_webview_window("tray") {
            let _ = w.hide();
        }
    }

    if action == "ready" {
        let _ = app.emit("tray-ready", ());
    } else {
        let _ = app.emit("tray-action", action.clone());
    }

    if action == "stop" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_tray_state(
    state: TrayState,
    state_mutex: tauri::State<'_, TrayStateMutex>,
) -> Result<(), String> {
    if let Ok(mut s) = state_mutex.0.lock() {
        *s = state;
    }
    Ok(())
}

#[tauri::command]
pub fn get_tray_state(state_mutex: tauri::State<'_, TrayStateMutex>) -> Result<TrayState, String> {
    if let Ok(s) = state_mutex.0.lock() {
        Ok(s.clone())
    } else {
        Ok(TrayState::default())
    }
}
