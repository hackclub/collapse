import type { SessionStatus } from "@collapse/shared";

// ─── Token Provider ──────────────────────────────────────

/** Returns the session token. Accepts a static string, sync getter, or async getter. */
export type TokenProvider =
  | string
  | (() => string)
  | (() => Promise<string>);

// ─── Capture Settings ────────────────────────────────────

export interface CaptureSettings {
  /** Screenshot interval in ms. Default: 60000 */
  intervalMs?: number;
  /** JPEG quality 0–1. Default: 0.85 */
  jpegQuality?: number;
  /** Max capture width. Default: 1920 */
  maxWidth?: number;
  /** Max capture height. Default: 1080 */
  maxHeight?: number;
  /** Override getDisplayMedia constraints (merged with defaults). */
  displayMediaConstraints?: DisplayMediaStreamOptions;
}

// ─── Retry Settings ──────────────────────────────────────

export interface RetrySettings {
  /** Max retries per upload step. Default: 3 */
  maxRetries?: number;
  /** Backoff delays in ms per attempt. Default: [2000, 4000, 8000] */
  retryDelays?: number[];
  /** Max screenshots buffered in memory. Default: 5 */
  maxPendingBuffer?: number;
}

// ─── Capture Result ──────────────────────────────────────

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
}

// ─── Upload State ────────────────────────────────────────

export interface UploadState {
  pending: number;
  completed: number;
  failed: number;
}

// ─── Recorder Status ─────────────────────────────────────

/** SessionStatus + client-only states */
export type RecorderStatus =
  | SessionStatus
  | "loading"
  | "no-token"
  | "error";

// ─── Callbacks ───────────────────────────────────────────

export interface CollapseCallbacks {
  /** Screen sharing started. */
  onShareStart?: () => void;
  /** Screen sharing ended. */
  onShareStop?: () => void;
  /** Screenshot captured (before upload). */
  onCapture?: (capture: CaptureResult) => void;
  /** Screenshot uploaded and confirmed. */
  onUploadSuccess?: (info: {
    screenshotId: string;
    trackedSeconds: number;
  }) => void;
  /** Screenshot upload failed after all retries. */
  onUploadFailure?: (error: Error) => void;
  /** Session paused. */
  onPause?: (info: { totalActiveSeconds: number }) => void;
  /** Session resumed. */
  onResume?: () => void;
  /** Session stopped, compilation enqueued. */
  onStop?: (info: {
    trackedSeconds: number;
    totalActiveSeconds: number;
  }) => void;
  /** Compilation complete, video ready. */
  onComplete?: (info: { videoUrl: string }) => void;
  /** Compilation failed. */
  onCompilationFailed?: () => void;
  /** Any non-fatal error. */
  onError?: (error: Error, context: string) => void;
  /** Status transition. */
  onStatusChange?: (prev: RecorderStatus, next: RecorderStatus) => void;
}

// ─── Main Config ─────────────────────────────────────────

export interface CollapseConfig {
  /** Session token. Required. */
  token: TokenProvider;
  /** API base URL. Default: "" (same origin). */
  apiBaseUrl?: string;
  /** Capture settings. */
  capture?: CaptureSettings;
  /** Retry/buffer settings. */
  retry?: RetrySettings;
  /** Lifecycle callbacks. */
  callbacks?: CollapseCallbacks;
  /** Compilation status poll interval in ms. Default: 3000 */
  statusPollIntervalMs?: number;
  /** Auto-start screen sharing on mount. Default: false */
  autoStart?: boolean;
}

// ─── Resolved Config (all fields required) ───────────────

export interface ResolvedConfig {
  token: TokenProvider;
  apiBaseUrl: string;
  capture: Required<Omit<CaptureSettings, "displayMediaConstraints">> & {
    displayMediaConstraints?: DisplayMediaStreamOptions;
  };
  retry: Required<RetrySettings>;
  callbacks: CollapseCallbacks;
  statusPollIntervalMs: number;
  autoStart: boolean;
}

// ─── Collapse State ──────────────────────────────────────

export interface CollapseState {
  /** Current recorder status. */
  status: RecorderStatus;
  /** Whether getDisplayMedia is active. */
  isSharing: boolean;
  /** True when actively capturing (sharing + pending/active). Convenience for UI logic. */
  isRecording: boolean;
  /** Best-known tracked seconds (max of server, upload confirms, and local estimate). */
  trackedSeconds: number;
  /** Client-interpolated display seconds (smooth ticking, monotonic). */
  displaySeconds: number;
  /** Number of confirmed screenshots. */
  screenshotCount: number;
  /** Upload queue state. */
  uploads: UploadState;
  /** Object URL of the latest captured screenshot. */
  lastScreenshotUrl: string | null;
  /** Video URL when complete. */
  videoUrl: string | null;
  /** Error message when status is "error". */
  error: string | null;
}

// ─── Collapse Actions ────────────────────────────────────

export interface CollapseActions {
  /** Start screen sharing and begin capturing. */
  startSharing: () => Promise<void>;
  /** Stop screen share without stopping session (auto-pauses). */
  stopSharing: () => void;
  /** Pause the session. */
  pause: () => Promise<void>;
  /** Resume a paused session. */
  resume: () => Promise<void>;
  /** Stop the session (triggers compilation). Optionally name the timelapse before stopping. */
  stop: (options?: { name?: string }) => Promise<void>;
}
