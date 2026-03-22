import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
  checkCameraPermission,
} from "tauri-plugin-macos-permissions-api";
import { Button, PageContainer, Spinner, colors, spacing, fontSize } from "@collapse/react";
import { PageLayout } from "./PageLayout.js";

type PermissionStatus = "checking" | "granted" | "denied";

type PermissionType = "screen" | "camera";

const PERMISSION_CONFIG: Record<PermissionType, {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  hint: string;
  checkingLabel: string;
  check: () => Promise<boolean>;
  request: () => Promise<unknown>;
}> = {
  screen: {
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: "Screen Recording Permission",
    subtitle: "Collapse needs screen recording access to capture screenshots of your work. Your screen is captured locally and only periodic screenshots are uploaded.",
    hint: 'After enabling "Collapse" in System Settings > Privacy > Screen Recording, quit and reopen the app. If it still doesn\'t work, remove Collapse from the list entirely, restart the app, and grant permission again.',
    checkingLabel: "Checking screen recording permission...",
    check: checkScreenRecordingPermission,
    request: requestScreenRecordingPermission,
  },
  camera: {
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
    title: "Camera Permission",
    subtitle: "Collapse uses your camera to capture periodic photos of your work for timelapses. Photos are taken locally and only periodic snapshots are uploaded.",
    hint: 'After enabling "Collapse" in System Settings > Privacy > Camera, quit and reopen the app. If it still doesn\'t work, remove Collapse from the list entirely, restart the app, and grant permission again.',
    checkingLabel: "Checking camera permission...",
    check: checkCameraPermission,
    // The plugin's requestCameraPermission passes a null completionHandler to
    // AVCaptureDevice, which silently no-ops. Use getUserMedia instead — it
    // triggers the real macOS camera permission prompt from WKWebView.
    request: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // User denied or no camera — either way the prompt was shown
      }
    },
  },
};

interface PermissionScreenProps {
  type: PermissionType;
  onGranted: () => void;
}

export function PermissionScreen({ type, onGranted }: PermissionScreenProps) {
  const config = PERMISSION_CONFIG[type];
  const [status, setStatus] = useState<PermissionStatus>("checking");
  const [requested, setRequested] = useState(false);

  // Stabilize onGranted via ref to avoid re-running the check effect
  // when the parent passes a new inline arrow each render.
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        console.log(`[permissions] checking ${type} permission...`);
        const granted = await config.check();
        if (cancelled) return;
        console.log(`[permissions] ${type} permission: ${granted ? "granted" : "denied"}`);
        if (granted) {
          setStatus("granted");
          onGrantedRef.current();
        } else {
          setStatus("denied");
        }
      } catch {
        if (cancelled) return;
        // Plugin unavailable (non-macOS) — assume permission granted
        console.log(`[permissions] ${type} check unavailable (non-macOS?), assuming granted`);
        setStatus("granted");
        onGrantedRef.current();
      }
    })();
    return () => { cancelled = true; };
  }, [type, config]);

  const handleRequest = useCallback(async () => {
    console.log(`[permissions] requesting ${type} permission...`);
    setRequested(true);
    await config.request();
    console.log(`[permissions] ${type} permission request sent (opened System Settings)`);
  }, [type, config]);

  if (status === "checking") {
    return (
      <PageContainer centered>
        <Spinner size="md" />
        <p style={{ fontSize: fontSize.lg, color: colors.text.secondary, marginTop: spacing.md }}>
          {config.checkingLabel}
        </p>
      </PageContainer>
    );
  }

  return (
    <PageLayout
      icon={config.icon}
      title={config.title}
      subtitle={config.subtitle}
      hint={config.hint}
      actions={<>
        <Button variant="primary" size="lg" fullWidth onClick={handleRequest} disabled={requested}>
          {requested ? "Opened System Settings" : "Grant Permission"}
        </Button>
        <Button variant="secondary" size="lg" fullWidth onClick={onGranted}>
          Skip
        </Button>
      </>}
    />
  );
}
