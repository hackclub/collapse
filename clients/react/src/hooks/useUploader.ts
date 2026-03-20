import { useRef, useCallback, useState } from "react";
import { useCollapseContext } from "../CollapseProvider.js";
import type { CaptureResult, UploadState } from "../types.js";

async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delays: number[],
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise((r) => setTimeout(r, delays[i] ?? delays[delays.length - 1]));
    }
  }
  throw new Error("Unreachable");
}

export interface UploaderResult {
  /** Add a capture to the upload queue. */
  enqueue: (capture: CaptureResult) => void;
  /** Current upload queue state. */
  uploads: UploadState;
  /** Server-reported tracked seconds after latest confirmation. */
  trackedSeconds: number;
  /** Object URL of last successfully uploaded screenshot. */
  lastScreenshotUrl: string | null;
  /** ISO timestamp: when the server expects the next screenshot. */
  nextExpectedAt: string | null;
  /** Last upload error message, if any. */
  lastError: string | null;
}

export function useUploader(): UploaderResult {
  const { client, config } = useCollapseContext();
  const { maxRetries, retryDelays, maxPendingBuffer } = config.retry;

  const [uploads, setUploads] = useState<UploadState>({
    pending: 0,
    completed: 0,
    failed: 0,
  });
  const [trackedSeconds, setTrackedSeconds] = useState(0);
  const [lastScreenshotUrl, setLastScreenshotUrl] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const nextExpectedAtRef = useRef<string | null>(null);
  const bufferRef = useRef<CaptureResult[]>([]);
  const processingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (bufferRef.current.length > 0) {
      const capture = bufferRef.current.shift()!;
      setUploads((s) => ({ ...s, pending: s.pending - 1 }));

      try {
        const { uploadUrl, screenshotId, nextExpectedAt } = await retry(
          () => client.getUploadUrl(),
          maxRetries,
          retryDelays,
        );
        nextExpectedAtRef.current = nextExpectedAt;

        await retry(
          () => client.uploadToR2(uploadUrl, capture.blob),
          maxRetries,
          retryDelays,
        );

        const result = await retry(
          () =>
            client.confirmScreenshot({
              screenshotId,
              width: capture.width,
              height: capture.height,
              fileSize: capture.blob.size,
            }),
          maxRetries,
          retryDelays,
        );

        setTrackedSeconds(result.trackedSeconds);
        nextExpectedAtRef.current = result.nextExpectedAt;
        setLastScreenshotUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(capture.blob);
        });
        setUploads((s) => ({ ...s, completed: s.completed + 1 }));
        config.callbacks.onUploadSuccess?.({
          screenshotId,
          trackedSeconds: result.trackedSeconds,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setLastError(msg);
        setUploads((s) => ({ ...s, failed: s.failed + 1 }));
        config.callbacks.onUploadFailure?.(err instanceof Error ? err : new Error(msg));
      }
    }

    processingRef.current = false;
  }, [client, maxRetries, retryDelays]);

  const enqueue = useCallback(
    (capture: CaptureResult) => {
      if (bufferRef.current.length >= maxPendingBuffer) {
        bufferRef.current.shift();
        setUploads((s) => ({ ...s, pending: s.pending - 1, failed: s.failed + 1 }));
      }
      bufferRef.current.push(capture);
      setUploads((s) => ({ ...s, pending: s.pending + 1 }));
      processQueue();
    },
    [maxPendingBuffer, processQueue],
  );

  return {
    enqueue,
    uploads,
    trackedSeconds,
    lastScreenshotUrl,
    nextExpectedAt: nextExpectedAtRef.current,
    lastError,
  };
}
