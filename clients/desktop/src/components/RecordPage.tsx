import { useState, useEffect, useCallback } from "react";
import {
  CollapseProvider,
  Button,
  Skeleton,
  colors,
  spacing,
  radii,
} from "@collapse/react";
import type { CaptureSource } from "../hooks/useNativeCapture.js";
import { SourcePicker } from "./SourcePicker.js";
import { DesktopRecorder } from "./DesktopRecorder.js";
import { NamingModal } from "./NamingModal.js";
import { PageLayout, cardButtonStyle } from "./PageLayout.js";

const API_BASE = "https://collapse.b.selfhosted.hackclub.com";

interface RecordPageProps {
  token: string;
  onBack: () => void;
  onViewSession: (token: string) => void;
}

export function RecordPage({ token, onBack, onViewSession }: RecordPageProps) {
  const [captureSource, setCaptureSource] = useState<CaptureSource | null>(null);
  const [stopping, setStopping] = useState(false);
  const [sessionCheck, setSessionCheck] = useState<"loading" | "ok" | "finished" | "error">("loading");
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [isPrompting, setIsPrompting] = useState(false);

  // Check if the session is still recordable before showing source picker
  useEffect(() => {
    (async () => {
      console.log(`[record] checking session status for token: ${token.slice(0, 8)}...`);
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${token}/status`);
        if (!res.ok) {
          const errText = `HTTP ${res.status} ${await res.text().catch(() => "")}`;
          console.error(`[record] session check failed: ${errText}`);
          setCheckError(errText);
          setSessionCheck("error");
          return;
        }
        const data = await res.json();
        console.log(`[record] session status: ${data.status}`);
        setSessionStatus(data.status);
        if (["stopped", "compiling", "complete", "failed"].includes(data.status)) {
          setSessionCheck("finished");
        } else {
          setSessionCheck("ok");
        }
      } catch (err: any) {
        console.error("[record] session check error:", err);
        setCheckError(err.message || String(err));
        setSessionCheck("error");
      }
    })();
  }, [token]);

  const handleStopClick = useCallback(() => {
    setIsPrompting(true);
  }, []);

  const handleConfirmStop = useCallback(async (name: string | null) => {
    setStopping(true);
    console.log(`[record] stopping session, name: ${name?.trim() || "(none)"}`);
    if (name && name.trim()) {
      try {
        await fetch(`${API_BASE}/api/sessions/${token}/name`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
      } catch (e) {
        console.warn("[record] rename failed:", e);
      }
    }
    try {
      await fetch(`${API_BASE}/api/sessions/${token}/stop`, { method: "POST" });
      console.log("[record] session stopped");
    } catch (e) {
      console.error("[record] stop failed:", e);
    }
    onViewSession(token);
  }, [token, onViewSession]);

  const handleResumeFromModal = useCallback(() => {
    setIsPrompting(false);
  }, []);

  // Loading skeleton that matches the SourcePicker layout
  if (sessionCheck === "loading") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: spacing.lg, width: "100%", boxSizing: "border-box", flexShrink: 0 }}>
          <Skeleton width={80} height={32} borderRadius={radii.lg} />
        </div>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: spacing.lg, paddingTop: 0, flex: 1, width: "100%", boxSizing: "border-box" }}>
          <Skeleton width="60%" height={20} style={{ marginBottom: spacing.md, marginLeft: "auto", marginRight: "auto" }} />
          <Skeleton aspectRatio="16/9" borderRadius={radii.lg} style={{ marginBottom: spacing.lg }} />
          <Skeleton height={36} borderRadius={radii.md} style={{ marginBottom: spacing.md }} />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={48} borderRadius={radii.md} style={{ marginBottom: spacing.xs }} />
          ))}
          <Skeleton height={48} borderRadius={radii.lg} style={{ marginTop: spacing.lg }} />
        </div>
      </div>
    );
  }

  if (sessionCheck === "error") {
    return (
      <PageLayout
        onBack={onBack}
        icon={
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.status.danger} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        }
        title="Session Error"
        subtitle={checkError || "Unknown error"}
      />
    );
  }

  if (sessionCheck === "finished") {
    const label = sessionStatus === "complete" ? "Complete" : sessionStatus === "compiling" ? "Compiling" : sessionStatus === "failed" ? "Failed" : "Stopped";
    return (
      <PageLayout
        onBack={onBack}
        icon={
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        }
        title={`Session Already ${label}`}
        subtitle="This session is no longer recordable."
        actions={
          <Button variant="primary" size="lg" fullWidth onClick={() => onViewSession(token)}>
            View Timelapse
          </Button>
        }
      />
    );
  }

  if (!captureSource) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: spacing.lg, paddingBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, width: "100%", boxSizing: "border-box" }}>
          <Button variant="secondary" size="sm" onClick={onBack} style={cardButtonStyle}>
            &larr; Gallery
          </Button>
          {sessionStatus !== "pending" && (
            <Button variant="danger" size="md" loading={stopping} onClick={handleStopClick}>
              Stop Session
            </Button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <SourcePicker
            onSelect={setCaptureSource}
            submitLabel={sessionStatus === "active" || sessionStatus === "paused" ? "Resume Session" : "Start Capture"}
          />
        </div>
        {isPrompting && (
          <NamingModal
            loading={stopping}
            onConfirm={handleConfirmStop}
            onResume={handleResumeFromModal}
          />
        )}
      </div>
    );
  }

  return (
    <CollapseProvider token={token} apiBaseUrl={API_BASE}>
      <DesktopRecorder
        token={token}
        source={captureSource}
        onChangeSource={() => setCaptureSource(null)}
        onBack={onBack}
        onViewSession={onViewSession}
      />
    </CollapseProvider>
  );
}
