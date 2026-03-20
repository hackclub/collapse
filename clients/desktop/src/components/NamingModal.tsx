import React, { useRef, useEffect, useState, useCallback } from "react";
import { Button, Card, colors, spacing, radii, fontSize, fontWeight } from "@collapse/react";

interface NamingModalProps {
  loading: boolean;
  onConfirm: (name: string | null) => void;
}

export function NamingModal({ loading, onConfirm }: NamingModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the input when modal opens
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: navigator.userAgent.toLowerCase().includes("windows") ? "linear-gradient(to bottom, transparent 0%, var(--color-modal-backdrop, rgba(0,0,0,0.8)) 100%)" : "var(--color-modal-backdrop, rgba(0,0,0,0.8))",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: spacing.xl,
    }}>
      <Card padding={spacing.xxl} style={{ width: "100%", maxWidth: 400, height: "auto", background: "var(--color-bg-panel)", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
        <h3 style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary, margin: 0, marginBottom: spacing.sm }}>
          Name your timelapse
        </h3>
        <p style={{ fontSize: fontSize.md, color: colors.text.secondary, margin: 0, marginBottom: spacing.lg }}>
          Give it a name, or skip to use the default.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(name);
          }}
          placeholder="My timelapse"
          maxLength={255}
          disabled={loading}
          style={{
            width: "100%",
            padding: `${spacing.md}px ${spacing.lg}px`,
            fontSize: fontSize.lg,
            fontWeight: fontWeight.medium,
            color: colors.text.primary,
            background: colors.bg.sunken,
            border: `1px solid ${colors.border.default}`,
            borderRadius: radii.md,
            outline: "none",
            boxSizing: "border-box",
            marginBottom: spacing.lg,
            opacity: loading ? 0.5 : 1,
          }}
        />
        <div style={{ display: "flex", gap: spacing.md }}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            disabled={loading}
            onClick={() => onConfirm(name)}
          >
            Save &amp; Stop
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={loading}
            onClick={() => onConfirm(null)}
          >
            Skip
          </Button>
        </div>
      </Card>
    </div>
  );
}
