import React, { useState, useEffect, useCallback } from "react";
import {
  CollapseProvider,
  Button,
  ErrorDisplay,
  PageContainer,
  RecordPageSkeleton,
  colors,
  spacing,
  fontSize,
  fontWeight,
} from "@collapse/react";
import type { CaptureSource } from "../hooks/useNativeCapture.js";
import { SourcePicker } from "./SourcePicker.js";
import { DesktopRecorder } from "./DesktopRecorder.js";
import { NamingModal } from "./NamingModal.js";

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
    setIsPrompting(false);
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
    onBack();
  }, [token, onBack]);

  if (sessionCheck === "loading") {
    return <RecordPageSkeleton />;
  }

  if (sessionCheck === "error") {
    return (
      <PageContainer centered>
        <ErrorDisplay
          variant="page"
          title="Session Error"
          error={checkError || "Unknown error"}
          action={{ label: "← Gallery", onClick: onBack }}
        />
      </PageContainer>
    );
  }

  if (sessionCheck === "finished") {
    const label = sessionStatus === "complete" ? "Complete" : sessionStatus === "compiling" ? "Compiling" : sessionStatus === "failed" ? "Failed" : "Stopped";
    return (
      <PageContainer centered>
        <h2 style={{ fontSize: fontSize.heading, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.sm }}>
          Session Already {label}
        </h2>
        <p style={{ fontSize: fontSize.lg, color: colors.text.secondary, marginBottom: spacing.xl, textAlign: "center" }}>
          This session is no longer recordable.
        </p>
        <div style={{ display: "flex", gap: spacing.md }}>
          <Button variant="primary" size="md" onClick={() => onViewSession(token)}>
            View Timelapse
          </Button>
          <Button variant="secondary" size="sm" onClick={onBack}>
            &larr; Gallery
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (!captureSource) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PageContainer maxWidth={480} style={{ paddingBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, width: "100%" }}>
          <Button variant="secondary" size="sm" onClick={onBack}>
            &larr; Gallery
          </Button>
          {sessionStatus !== "pending" && (
            <Button variant="danger" size="md" loading={stopping} onClick={handleStopClick}>
              Stop Session
            </Button>
          )}
        </PageContainer>
        <div style={{ flex: 1, minHeight: 0 }}>
          <SourcePicker
            onSelect={setCaptureSource}
            submitLabel={sessionStatus === "active" || sessionStatus === "paused" ? "Resume Session" : "Start Capture"}
          />
        </div>
        {isPrompting && <NamingModal loading={stopping} onConfirm={handleConfirmStop} />}
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
      />
    </CollapseProvider>
  );
}
