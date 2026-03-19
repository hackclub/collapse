import React, { useState, useEffect, useCallback } from "react";
import {
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import { Button, Card, PageContainer, Spinner, colors, spacing, fontSize, fontWeight } from "@collapse/react";

type PermissionStatus = "checking" | "granted" | "denied";

export function PermissionScreen({ onGranted }: { onGranted: () => void }) {
  const [status, setStatus] = useState<PermissionStatus>("checking");

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
    <PageContainer centered>
      <Card padding={32} style={{ maxWidth: 360, textAlign: "center" }}>
        <div style={{ marginBottom: spacing.lg }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={colors.status.warning} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <h2 style={{ fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.md }}>
          Screen Recording Permission
        </h2>
        <p style={{ fontSize: fontSize.md, color: colors.text.secondary, lineHeight: 1.6, marginBottom: spacing.xl }}>
          Collapse needs screen recording access to capture screenshots of your work.
          Your screen is captured locally and only periodic screenshots are uploaded.
        </p>
        <Button variant="primary" size="lg" fullWidth onClick={handleRequest}>
          Grant Permission
        </Button>
        <p style={{ color: colors.status.warning, marginTop: spacing.md, fontSize: fontSize.xs, lineHeight: 1.5 }}>
          After enabling "Collapse" in System Settings &gt; Privacy &gt; Screen Recording, quit and reopen the app.
          If it still doesn't work, remove Collapse from the list entirely, restart the app, and grant permission again.
        </p>
        <Button variant="secondary" size="sm" fullWidth onClick={onGranted} style={{ marginTop: spacing.lg, color: colors.text.tertiary }}>
          Skip (proceed anyway)
        </Button>
      </Card>
    </PageContainer>
  );
}
