use tauri::{AppHandle, Manager};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};

pub fn test(app: &AppHandle) {
    let _t = TrayIconBuilder::with_id("test")
        .on_tray_icon_event(|app, event| match event {
            TrayIconEvent::Click { position, rect, .. } => {
                println!("clicked at {:?}", position);
            },
            _ => {}
        })
        .build(app);
}
