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

  // Check if the session is still recordable before showing source picker
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${token}/status`);
        if (!res.ok) {
          setCheckError(`HTTP ${res.status} ${await res.text().catch(() => "")}`);
          setSessionCheck("error");
          return;
        }
        const data = await res.json();
        setSessionStatus(data.status);
        if (["stopped", "compiling", "complete", "failed"].includes(data.status)) {
          setSessionCheck("finished");
        } else {
          setSessionCheck("ok");
        }
      } catch (err: any) {
        setCheckError(err.message || String(err));
        setSessionCheck("error");
      }
    })();
  }, [token]);

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await fetch(`${API_BASE}/api/sessions/${token}/stop`, { method: "POST" });
    } catch {}
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
          action={{ label: "\u2190 Gallery", onClick: onBack }}
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
      <div>
        <PageContainer maxWidth={480} style={{ paddingBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Button variant="secondary" size="sm" onClick={onBack}>
            &larr; Gallery
          </Button>
          <Button variant="danger" size="md" loading={stopping} onClick={handleStop}>
            Stop Session
          </Button>
        </PageContainer>
        <SourcePicker
          onSelect={setCaptureSource}
          submitLabel={sessionStatus === "active" || sessionStatus === "paused" ? "Resume Session" : "Start Capture"}
        />
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
