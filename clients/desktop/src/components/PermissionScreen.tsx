import { useState, useEffect, useCallback } from "react";
import {
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-shell";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { Button, PageContainer, Spinner, colors, spacing, fontSize, fontWeight } from "@collapse/react";

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
    // Attempt to trigger the native macOS dialog, which sometimes silently fails if previously denied.
    // So we also explicitly open System Settings to the right pane.
    requestScreenRecordingPermission().catch(() => {});
    await open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").catch(() => {});
    // Fallback for macOS Ventura/Sonoma format if the first fails/doesn't exist
    await open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").catch(() => {});

    const shouldRestart = await confirm(
      "After adding Collapse in System Settings, you'll need to restart the app for the permission to take effect.",
      {
        title: "Restart Required",
        kind: "info",
        okLabel: "Restart, I've granted permission",
        cancelLabel: "No, I still need to add it",
      },
    );

    if (shouldRestart) {
      await relaunch();
    }
  }, []);

  if (status === "checking") {
    return (
      <PageContainer centered>
        <Spinner size="md" />
        <p style={{ fontSize: fontSize.lg, color: colors.text.primary, opacity: 0.6, marginTop: spacing.md }}>
          Checking screen recording permission...
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer centered>
      <div style={{ width: "100%", maxWidth: 520, textAlign: "center", padding: 24 }}>
        <h2 style={{ fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.md }}>
          Screen Recording Permission
        </h2>
        <p style={{ fontSize: fontSize.md, color: colors.text.primary, opacity: 0.6, lineHeight: 1.6, marginBottom: spacing.lg }}>
          Collapse needs screen recording access to capture screenshots of your work.
          Your screen is captured locally and only periodic screenshots are uploaded.
        </p>
        <p style={{ color: colors.text.primary, opacity: 0.4, fontSize: fontSize.sm, lineHeight: 1.5, marginBottom: spacing.xl }}>
          Open System Settings, enable Collapse under Privacy &amp; Security &gt; Screen Recording, then restart the app.
        </p>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={handleRequest}
          style={{
            borderRadius: 999,
            background: colors.text.primary,
            color: "var(--color-bg-body, #000)", // Inverse text color for primary button
            border: "none",
            fontWeight: 600,
          }}
        >
          Grant Permission
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onGranted}
          style={{
            marginTop: spacing.xl,
            borderRadius: 999,
            background: colors.bg.surface,
            color: colors.text.secondary,
            border: "none",
            display: "inline-flex",
            padding: "8px 24px",
            fontWeight: 500,
          }}
        >
          Skip (proceed anyway)
        </Button>
      </div>
    </PageContainer>
  );
}
