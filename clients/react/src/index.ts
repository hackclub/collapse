// Provider
export { CollapseProvider } from "./CollapseProvider.js";
export type { CollapseProviderProps } from "./CollapseProvider.js";

// Drop-in widget
export { CollapseRecorder } from "./components/CollapseRecorder.js";

// Sub-components
export { StatusBar } from "./components/StatusBar.js";
export type { StatusBarProps } from "./components/StatusBar.js";
export { RecordingControls } from "./components/RecordingControls.js";
export type { RecordingControlsProps } from "./components/RecordingControls.js";
export { ScreenPreview } from "./components/ScreenPreview.js";
export type { ScreenPreviewProps } from "./components/ScreenPreview.js";
export { CameraSelector } from "./components/CameraSelector.js";
export type { CameraSelectorProps } from "./components/CameraSelector.js";
export { CameraPreview } from "./components/CameraPreview.js";
export type { CameraPreviewProps } from "./components/CameraPreview.js";
export { ResultView } from "./components/ResultView.js";
export type { ResultViewProps } from "./components/ResultView.js";
export { ProcessingState } from "./components/ProcessingState.js";
export type { ProcessingStateProps } from "./components/ProcessingState.js";

// Gallery components
export { Gallery } from "./components/Gallery.js";
export type { GalleryProps } from "./components/Gallery.js";
export { SessionCard } from "./components/SessionCard.js";
export type { SessionCardProps } from "./components/SessionCard.js";
export { SessionDetail } from "./components/SessionDetail.js";
export type { SessionDetailProps } from "./components/SessionDetail.js";

// Headless hooks
export { useCollapse } from "./hooks/useCollapse.js";
export { useScreenCapture } from "./hooks/useScreenCapture.js";
export { useCameraCapture } from "./hooks/useCameraCapture.js";
export { useUploader } from "./hooks/useUploader.js";
export { useSession } from "./hooks/useSession.js";
export { useSessionTimer, formatTime, formatTrackedTime } from "./hooks/useSessionTimer.js";

// Gallery hooks
export { useTokenStore } from "./hooks/useTokenStore.js";
export type { TokenEntry, UseTokenStore } from "./hooks/useTokenStore.js";
export { useGallery } from "./hooks/useGallery.js";
export type { UseGalleryOptions, UseGallery as UseGalleryReturn } from "./hooks/useGallery.js";
export { useHashRouter } from "./hooks/useHashRouter.js";
export type { Route } from "./hooks/useHashRouter.js";

// API client (no React dependency)
export { createCollapseClient } from "./api/client.js";
export type { CollapseClient, CreateClientOptions } from "./api/client.js";

// Types
export type {
  CollapseConfig,
  CollapseState,
  CollapseActions,
  CollapseCallbacks,
  CaptureSettings,
  CaptureMode,
  CameraSettings,
  RetrySettings,
  UploadState,
  CaptureResult,
  RecorderStatus,
  TokenProvider,
  ResolvedConfig,
} from "./types.js";

// Re-export shared types consumers need
export type { SessionStatus, SessionSummary } from "@collapse/shared";
export { SESSION_STATUSES } from "@collapse/shared";

// UI primitives
export * from "./ui/index.js";
