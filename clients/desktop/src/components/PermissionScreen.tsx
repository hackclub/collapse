import { useState, useEffect, useCallback } from "react";
import {
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import { Button, PageContainer, Spinner, colors, spacing, fontSize } from "@collapse/react";
import { PageLayout } from "./PageLayout.js";

type PermissionStatus = "checking" | "granted" | "denied";

const monitorIcon = (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export function PermissionScreen({ onGranted }: { onGranted: () => void }) {
  const [status, setStatus] = useState<PermissionStatus>("checking");
  const [requested, setRequested] = useState(false);

  const checkPermission = useCallback(async () => {
    try {
      const granted = await checkScreenRecordingPermission();
      if (granted) {
        setStatus("granted");
        onGranted();
      } else {
        setStatus("denied");
      }
    } catch {
      // Plugin unavailable (non-macOS) — assume permission granted
      setStatus("granted");
      onGranted();
    }
  }, [onGranted]);

  useEffect(() => { checkPermission(); }, [checkPermission]);

  const handleRequest = useCallback(async () => {
    setRequested(true);
    await requestScreenRecordingPermission();
  }, []);

  if (status === "checking") {
    return (
      <PageContainer centered>
        <Spinner size="md" />
        <p style={{ fontSize: fontSize.lg, color: colors.text.secondary, marginTop: spacing.md }}>
          Checking screen recording permission...
        </p>
      </PageContainer>
    );
  }

  return (
    <PageLayout
      icon={monitorIcon}
      title="Screen Recording Permission"
      subtitle="Collapse needs screen recording access to capture screenshots of your work. Your screen is captured locally and only periodic screenshots are uploaded."
      hint={'After enabling "Collapse" in System Settings > Privacy > Screen Recording, quit and reopen the app. If it still doesn\'t work, remove Collapse from the list entirely, restart the app, and grant permission again.'}
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
