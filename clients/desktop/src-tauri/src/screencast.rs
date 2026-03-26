use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct StreamInfo {
    pub node_id: u32,
}

/// Close unique file descriptors in the map. Multiple nodes may share the same
/// fd (from a single portal session), so we deduplicate before closing.
#[cfg(target_os = "linux")]
fn close_unique_fds(fds: &std::collections::HashMap<u32, std::os::fd::RawFd>) {
    use std::collections::HashSet;
    use std::os::fd::FromRawFd;
    let unique: HashSet<std::os::fd::RawFd> = fds.values().copied().collect();
    for fd in unique {
        // Wrapping in OwnedFd will close the fd on drop
        drop(unsafe { std::os::fd::OwnedFd::from_raw_fd(fd) });
    }
}

/// Helper: run the XDG screencast portal flow and return (streams, raw_fd).
#[cfg(target_os = "linux")]
async fn portal_select_sources() -> Result<(Vec<StreamInfo>, std::os::fd::RawFd), String> {
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

    Ok((streams, fd.into_raw_fd()))
}

/// Replace all existing screencast sources with a fresh portal session.
#[cfg(target_os = "linux")]
pub async fn request_screencast(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<StreamInfo>, String> {
    let (streams, raw_fd) = portal_select_sources().await?;

    // Replace all existing fds with the new session's streams.
    // Close old fds first to avoid leaking file descriptors.
    if let Ok(mut fds) = state.pipewire_fds.lock() {
        close_unique_fds(&fds);
        fds.clear();
        for s in &streams {
            fds.insert(s.node_id, raw_fd);
        }
    }

    Ok(streams)
}

/// Add sources from a new portal session to the existing set (does not remove
/// previously selected streams). This lets users incrementally build up their
/// source list even on DEs where the portal dialog doesn't support multi-select.
#[cfg(target_os = "linux")]
pub async fn add_screencast(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<StreamInfo>, String> {
    let (streams, raw_fd) = portal_select_sources().await?;

    // Append — keep existing fds, add the new ones
    if let Ok(mut fds) = state.pipewire_fds.lock() {
        for s in &streams {
            fds.insert(s.node_id, raw_fd);
        }
    }

    Ok(streams)
}
