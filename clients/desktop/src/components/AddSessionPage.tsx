import { useState, useRef, useEffect } from "react";
import {
  Button,
  colors,
  spacing,
  fontSize,
  fontWeight,
  radii,
} from "@collapse/react";

import { extractToken } from "../utils.js";
import { PageLayout } from "./PageLayout.js";

interface AddSessionPageProps {
  onBack: () => void;
  onStart: (token: string) => void;
}

export function AddSessionPage({ onBack, onStart }: AddSessionPageProps) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleStart = () => {
    const trimmed = link.trim();
    if (!trimmed) return;
    const token = extractToken(trimmed);
    if (!token) {
      setError("Couldn't find a valid session token in that link.");
      return;
    }
    setError(null);
    setLoading(true);
    onStart(token);
  };

  return (
    <PageLayout
      onBack={onBack}
      icon={undefined}
      title="Timelapses need to be started from Hack Club sites"
      subtitle="Open Collapse from a Hack Club site, or paste in a link below"
      actions={<>
        {error && (
          <p style={{ fontSize: fontSize.sm, color: colors.status.danger, margin: 0, textAlign: "center" }}>
            {error}
          </p>
        )}
        <input
          ref={inputRef}
          type="text"
          value={link}
          onChange={(e) => { setLink(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleStart(); }}
          placeholder="Paste a collapse:// link here"
          disabled={loading}
          style={{
            width: "100%",
            padding: `${spacing.md}px ${spacing.lg}px`,
            fontSize: fontSize.lg,
            fontWeight: fontWeight.medium,
            color: colors.text.primary,
            background: colors.bg.sunken,
            border: `1px solid ${error ? colors.status.danger : colors.border.default}`,
            borderRadius: radii.lg,
            outline: "none",
            boxSizing: "border-box",
            height: 48,
            opacity: loading ? 0.5 : 1,
          }}
        />
        <Button variant="primary" size="lg" fullWidth disabled={!link.trim() || loading} loading={loading} onClick={handleStart}>
          Start
        </Button>
      </>}
    />
  );
}
