use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct StreamInfo {
    pub node_id: u32,
}

#[cfg(target_os = "linux")]
pub async fn request_screencast(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<StreamInfo>, String> {
    use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
    use ashpd::desktop::PersistMode;
    use ashpd::WindowIdentifier;
    use std::os::fd::IntoRawFd;

    // Connect to the screencast portal
    let proxy = Screencast::new()
        .await
        .map_err(|e| format!("Failed to connect to screencast portal: {}", e))?;

    // Create a new session
    let session = proxy
        .create_session()
        .await
        .map_err(|e| format!("Failed to create screencast session: {}", e))?;

    // Ask user to select sources (multiple selection enabled)
    proxy
        .select_sources(
            &session,
            CursorMode::Hidden,
            SourceType::Monitor | SourceType::Window,
            true,
            None,
            PersistMode::DoNot,
        )
        .await
        .map_err(|e| format!("Failed to select sources: {}", e))?;

    // Start the screencast session and get the response containing streams
    let response = proxy
        .start(&session, &WindowIdentifier::default())
        .await
        .map_err(|e| format!("Failed to start screencast: {}", e))?
        .response()
        .map_err(|e| format!("Failed to get screencast response: {}", e))?;

    // Get the pipewire file descriptor
    let fd = proxy
        .open_pipe_wire_remote(&session)
        .await
        .map_err(|e| format!("Failed to open pipewire remote: {}", e))?;

    let mut streams = Vec::new();
    for stream in response.streams() {
        streams.push(StreamInfo {
            node_id: stream.pipe_wire_node_id(),
        });
    }

    // Save the fd into AppState so we can use it in capture.rs
    // We intentionally don't store `session` because zbus connection is cached
    // and the screencast portal won't close until the D-Bus connection drops (app exit)
    if let Ok(mut fd_guard) = state.pipewire_fd.lock() {
        *fd_guard = Some(fd.into_raw_fd());
    }

    Ok(streams)
}
