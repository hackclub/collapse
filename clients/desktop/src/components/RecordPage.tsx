import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  CollapseProvider,
  Button,
  Card,
  ErrorDisplay,
  PageContainer,
  RecordPageSkeleton,
  colors,
  spacing,
  fontSize,
  fontWeight,
  radii,
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
  const [showNamingPrompt, setShowNamingPrompt] = useState(false);
  const [timelapseName, setTimelapseName] = useState("");
  const [stopAction, setStopAction] = useState<"save" | "skip" | null>(null);
  const [sessionCheck, setSessionCheck] = useState<"loading" | "ok" | "finished" | "error">("loading");
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

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
    console.log("[record] stop clicked, showing naming prompt");
    setShowNamingPrompt(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const handleConfirmStop = useCallback(async (name: string | null) => {
    console.log(`[record] stopping session, name: ${name?.trim() || "(none)"}`);
    setStopping(true);
    if (name && name.trim()) {
      try {
        await fetch(`${API_BASE}/api/sessions/${token}/name`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
      } catch (e) {
        console.warn("[record] rename failed (non-fatal):", e);
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
    if (showNamingPrompt) {
      return (
        <PageContainer centered maxWidth={480}>
          <Card padding={spacing.xxl} style={{ textAlign: "center", width: "100%" }}>
            <h3 style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary, margin: 0, marginBottom: spacing.sm }}>
              Name your timelapse
            </h3>
            <p style={{ fontSize: fontSize.md, color: colors.text.secondary, margin: 0, marginBottom: spacing.lg }}>
              Give it a name, or skip to use the default.
            </p>
            <input
              ref={nameInputRef}
              type="text"
              value={timelapseName}
              onChange={(e) => setTimelapseName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirmStop(timelapseName); }}
              placeholder="My timelapse"
              maxLength={255}
              disabled={stopping}
              style={{
                width: "100%", padding: `${spacing.md}px ${spacing.lg}px`,
                fontSize: fontSize.lg, fontWeight: fontWeight.medium,
                color: colors.text.primary, background: colors.bg.sunken,
                border: `1px solid ${colors.border.default}`, borderRadius: radii.md,
                outline: "none", boxSizing: "border-box", marginBottom: spacing.lg,
                opacity: stopping ? 0.5 : 1,
              }}
            />
            <div style={{ display: "flex", gap: spacing.md }}>
              <Button variant="primary" size="lg" fullWidth loading={stopping && stopAction === "save"} disabled={stopping}
                onClick={() => { setStopAction("save"); handleConfirmStop(timelapseName); }}>
                Save &amp; Stop
              </Button>
              <Button variant="secondary" size="lg" fullWidth loading={stopping && stopAction === "skip"} disabled={stopping}
                onClick={() => { setStopAction("skip"); handleConfirmStop(null); }}>
                Skip
              </Button>
            </div>
          </Card>
        </PageContainer>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <PageContainer maxWidth={480} style={{ paddingBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <Button variant="secondary" size="sm" onClick={onBack}>
            &larr; Gallery
          </Button>
          <Button variant="danger" size="md" onClick={handleStopClick}>
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
