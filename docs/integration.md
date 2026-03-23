# Lookout Integration Guide

Lookout is a screen recording timelapse service. It has two distinct API surfaces:

1. **Internal API** — server-to-server, protected by API key. Used by your trusted backend to create/manage sessions.
2. **Client API** — browser-facing, authenticated by session token. Used by the user's browser to record and upload screenshots.

## Architecture Overview

```
┌─────────────────────┐         ┌───────────────────────┐
│  Your Backend       │         │  Lookout Server      │
│  (trusted server)   │────────>│  (internal API)       │
│                     │  POST   │                       │
│  Creates sessions,  │  /api/  │  Creates session,     │
│  manages lifecycle  │  internal│  returns token       │
└─────────┬───────────┘         └───────────────────────┘
          │                               │
          │ Passes token to browser       │
          │ (URL param, redirect, etc.)   │
          v                               │
┌─────────────────────┐         ┌───────────────────────┐
│  User's Browser     │         │  Lookout Server      │
│  (untrusted client) │────────>│  (client API)         │
│                     │  token  │                       │
│  Screen capture,    │  based  │  Presigned URLs,      │
│  upload screenshots │         │  timing validation    │
└─────────┬───────────┘         └───────────────────────┘
          │
          │ Direct upload via presigned URL
          v
┌─────────────────────┐
│  Cloudflare R2      │
│  (screenshot store) │
└─────────────────────┘
```

## Part 1: Server-to-Server (Internal API)

Your trusted backend is the only entity that can create sessions. All internal
API calls require the `X-API-Key` header.

### Create a session

```bash
curl -X POST https://lookout.hackclub.com/api/internal/sessions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"metadata": {"userId": "user_123", "projectId": "proj_456"}}'
```

Response:
```json
{
  "token": "5b70dd22...64-char-hex-string",
  "sessionId": "137c9b2f-3e74-4c25-a295-b41bd4d2c5d1",
  "sessionUrl": "https://lookout.hackclub.com/session?token=5b70dd22..."
}
```

- `token` — the session credential. Give this to the user's browser, and **store it on your server** associated with the user so you can look up the session later.
- `sessionId` — the server-side ID.
- `sessionUrl` — a convenience URL you can redirect the user to.
- `metadata` — any JSON you want to associate with the session (user info, project, etc.)

### Get session info

```bash
curl https://lookout.hackclub.com/api/internal/sessions/SESSION_ID \
  -H "X-API-Key: your-api-key"
```

Response:
```json
{
  "session": {
    "id": "137c9b2f-3e74-4c25-a295-b41bd4d2c5d1",
    "token": "5b70dd22...64-char-hex-string",
    "name": "My timelapse",
    "metadata": {"userId": "user_123", "projectId": "proj_456"},
    "status": "active",
    "startedAt": "2024-01-01T12:00:00.000Z",
    "totalActiveSeconds": 300,
    "videoUrl": null,
    "videoWebmUrl": null,
    "thumbnailUrl": null,
    "createdAt": "2024-01-01T11:50:00.000Z"
  },
  "trackedSeconds": 123,
  "screenshotCount": 45
}
```

- `trackedSeconds` — tamper-proof tracked time (= distinct confirmed minute buckets × 60)
- `screenshotCount` — number of confirmed screenshots

### Force-stop a session

```bash
curl -X POST https://lookout.hackclub.com/api/internal/sessions/SESSION_ID/stop \
  -H "X-API-Key: your-api-key"
```

### Recompile a failed session

```bash
curl -X POST https://lookout.hackclub.com/api/internal/sessions/SESSION_ID/recompile \
  -H "X-API-Key: your-api-key"
```

## Part 2: Client (Browser) Flow

If you're using React, the [`@lookout/react` SDK](../clients/react/API.md) handles
all of this for you with a drop-in `<LookoutRecorder>` component or the `useLookout()` hook.

The browser receives the token and uses it for all operations. **The client is
untrusted** — all timing and time tracking is validated server-side.

### Typical client flow

```
1. Get token from URL:  /session?token=abc123
2. GET /api/sessions/:token          → check session status
3. User clicks "Start Recording"
4. Call navigator.mediaDevices.getDisplayMedia() to share screen
5. LOOP every ~60 seconds:
   a. Capture canvas screenshot (JPEG, max 1080p)
   b. GET /api/sessions/:token/upload-url → { uploadUrl, screenshotId, nextExpectedAt }
      (First call activates the session: pending → active)
   c. PUT blob to uploadUrl (presigned R2 URL)
   d. POST /api/sessions/:token/screenshots { screenshotId, width, height, fileSize }
      → server verifies R2 upload via HeadObject, then confirms
   e. Schedule next capture at nextExpectedAt
6. User clicks "Pause"  → POST /api/sessions/:token/pause
7. User clicks "Resume" → POST /api/sessions/:token/resume → restart loop
8. User clicks "Stop"   → POST /api/sessions/:token/stop → token becomes read-only
9. Poll GET /api/sessions/:token/status for compilation progress
10. GET /api/sessions/:token/video → presigned URL for the timelapse MP4
```

### Client API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions/:token` | Session status (for recovery after refresh) |
| GET | `/api/sessions/:token/upload-url` | Get presigned PUT URL. Activates session on first call. Rate limited: 3/min. |
| POST | `/api/sessions/:token/screenshots` | Confirm upload. Body: `{ screenshotId, width, height, fileSize }`. Server verifies R2 object exists. |
| POST | `/api/sessions/:token/pause` | Pause session |
| POST | `/api/sessions/:token/resume` | Resume session |
| POST | `/api/sessions/:token/stop` | Stop session, trigger compilation |
| GET | `/api/sessions/:token/status` | Poll compilation status |
| GET | `/api/sessions/:token/video` | Get presigned video URL |

### Upload resilience

The client should handle network failures gracefully:

1. **Retry each step** — presigned URL request, R2 PUT, confirmation POST — up to 3 times with exponential backoff (2s, 4s, 8s).
2. **Hedge on failure** — if an R2 PUT fails after all retries, take a fresh screenshot and start the upload flow again. The server accepts multiple screenshots per minute bucket and picks the best one at compilation time.
3. **Offline detection** — if `navigator.onLine` is false, pause the upload queue and buffer captures (up to 5). Resume when the `online` event fires.
4. **Idempotent confirmation** — confirming an already-confirmed screenshot is a no-op, so retries are safe.

### Session recovery after page refresh

On page load, read the token from the URL and call `GET /api/sessions/:token`:

- `pending` → show "Start Recording" button
- `active` → prompt user to re-share screen (the session is still going)
- `paused` → show "Resume" button
- `stopped` / `compiling` → show progress indicator, poll status
- `complete` → show video player
- `failed` → show error message

The `totalActiveSeconds` and `trackedSeconds` fields let you restore the timer display.

### Screen capture implementation

```javascript
// Request screen share (max 1080p, low framerate to save CPU)
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 1 } },
  audio: false,
});

// Listen for user stopping share via browser UI
stream.getVideoTracks()[0].addEventListener('ended', onShareStopped);

// Create hidden video element
const video = document.createElement('video');
video.srcObject = stream;
video.muted = true;
await video.play();

// Capture a screenshot
function captureScreenshot(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1920 / video.videoWidth, 1080 / video.videoHeight, 1);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85);
  });
}
```

## Part 3: Get Info About a Session (After Recording)

Once a session is complete (or at any point), use the token you stored in Part 1
to fetch session details.

```bash
curl https://lookout.hackclub.com/api/sessions/TOKEN
```

Response:
```json
{
  "status": "complete",
  "trackedSeconds": 3540,
  "screenshotCount": 59,
  "startedAt": "2024-01-01T12:00:00.000Z",
  "totalActiveSeconds": 3600,
  "createdAt": "2024-01-01T11:50:00.000Z",
  "thumbnailUrl": "https://...",
  "videoUrl": "https://...",
  "videoWebmUrl": "https://...",
  "metadata": {"userId": "user_123", "projectId": "proj_456"}
}
```

Key fields for your backend:
- `trackedSeconds` — tamper-proof tracked time (= distinct confirmed minute buckets × 60). Use this for time verification.
- `screenshotCount` — number of confirmed screenshots
- `videoUrl` / `videoWebmUrl` — presigned URLs to the compiled timelapse (MP4 and WebM)
- `thumbnailUrl` — presigned URL for the session thumbnail
- `metadata` — the metadata you attached when creating the session

**Note:** To fetch multiple sessions at once, use `POST /api/sessions/batch` with a `{"tokens": ["token1", "token2", ...]}` body (max 100).

## Trust Model

| What | Trusted? | Why |
|------|----------|-----|
| Session creation | Yes — server-to-server with API key | Only your backend can create sessions |
| Capture timestamps | No — server records its own timestamp when `GET /upload-url` is called | Client can't fake when a screenshot was taken |
| Upload verification | No — server calls `HeadObject` on R2 to verify the file exists | Client can't claim uploads it didn't make |
| Time tracking | No — `trackedSeconds = distinct confirmed minute buckets × 60` | Computed server-side from server timestamps |
| Pause/resume | Partially trusted | Server auto-pauses after 5 min without uploads, auto-stops after 30 min |
| Rate limiting | Server-enforced | Max 3 upload-url requests per minute, max 720 confirmed screenshots per session |