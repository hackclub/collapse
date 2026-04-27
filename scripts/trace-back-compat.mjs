// Simulates OLD client behavior (the `-` lines from `git diff`) calling
// the NEW server (the `+` lines). Each step asserts the old client gets
// something it can use — never a missing field, never a 404 it didn't already
// handle.
//
// Run:  node scripts/trace-back-compat.mjs
//
// This isn't an HTTP test — it inlines the OLD client's URL+parse logic and
// the NEW server's deterministic return shapes (rate limits / DB lookups
// elided), so we can trace flows without booting a database. For wire-level
// confidence run it against a live server with the curl block at the bottom.

import assert from "node:assert/strict";

const BASE_URL = "https://lookout.example.com";
const TOKEN = "a".repeat(64);
const SESSION_ID = "11111111-2222-3333-4444-555555555555";

// ─── NEW server: response builders for the routes the OLD client hits ──────
// Mirrors the actual `+` code in packages/server/src/routes/sessions.ts.

function newServer_GET_session({ status, videoR2Key, thumbnailR2Key }) {
  // /api/sessions/:token (lines 109-128 of new sessions.ts)
  return {
    name: "test",
    status,
    trackedSeconds: 0,
    screenshotCount: 0,
    startedAt: null,
    totalActiveSeconds: 0,
    createdAt: new Date().toISOString(),
    thumbnailUrl: thumbnailR2Key ? `${BASE_URL}/api/media/${SESSION_ID}/thumbnail.jpg` : null,
    videoUrl: videoR2Key ? `${BASE_URL}/api/media/${SESSION_ID}/video.mp4` : null,
    videoWebmUrl: videoR2Key ? `${BASE_URL}/please-update.webm` : null,
    metadata: {},
  };
}

function newServer_GET_status({ status, videoR2Key }) {
  // /api/sessions/:token/status (lines 633-651 of new sessions.ts)
  return {
    status,
    videoUrl: videoR2Key ? `${BASE_URL}/api/media/${SESSION_ID}/video.mp4` : undefined,
    videoWebmUrl: videoR2Key ? `${BASE_URL}/please-update.webm` : undefined,
    trackedSeconds: 0,
  };
}

function newServer_GET_video({ status, videoR2Key, format }) {
  // /api/sessions/:token/video (lines 670-696 of new sessions.ts)
  if (status !== "complete" || !videoR2Key) {
    return { httpStatus: 404, body: { error: "Video not available" } };
  }
  if (format === "webm") {
    return { httpStatus: 200, body: { videoUrl: `${BASE_URL}/please-update.webm` } };
  }
  return { httpStatus: 200, body: { videoUrl: `${BASE_URL}/api/media/${SESSION_ID}/video.mp4` } };
}

function newServer_GET_media_video_webm() {
  // /api/media/:sessionId/video.webm (lines 903-919 of new sessions.ts)
  return { httpStatus: 302, location: `${BASE_URL}/please-update.webm` };
}

// ─── OLD client logic, copied from `git diff` `-` lines ────────────────────

function oldClient_pickFormat(userAgent) {
  // From clients/react/src/components/ResultView.tsx (deleted block) +
  // clients/web/src/components/Result.tsx (deleted block) +
  // clients/react/src/components/SessionDetail.tsx (deleted block).
  let format = "mp4";
  const ua = (userAgent || "").toLowerCase();
  if (ua.includes("linux") && !ua.includes("android")) format = "webm";
  return format;
}

function oldClient_buildVideoUrl(format) {
  // From clients/react/src/api/client.ts (deleted body).
  const q = format ? `?format=${format}` : "";
  return `${BASE_URL}/api/sessions/${TOKEN}/video${q}`;
}

function oldClient_handleVideoResponse(data) {
  // From ResultView/Result `.then((data) => setVideoUrl(data.videoUrl))`.
  if (data.videoUrl && !data.videoUrl.startsWith("https://")) {
    throw new Error("Invalid video URL: must be HTTPS.");
  }
  return data.videoUrl;
}

// ─── Trace 1: old Linux client, full happy path ────────────────────────────

console.log("─── Trace 1: old Linux client, full happy path ───────────────");
{
  const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";
  const format = oldClient_pickFormat(ua);
  assert.equal(format, "webm", "Linux UA should pick webm");

  // Step A: poll status until complete (we jump to complete state).
  const status = newServer_GET_status({ status: "complete", videoR2Key: "x" });
  assert.equal(status.status, "complete");
  assert.ok(status.videoWebmUrl, "old Linux client keys off videoWebmUrl");
  assert.match(status.videoWebmUrl, /please-update\.webm$/);
  console.log(`  status.videoWebmUrl = ${status.videoWebmUrl}  ✓ truthy, signals ready`);

  // Step B: fetch /video?format=webm.
  const videoUrl = oldClient_buildVideoUrl(format);
  assert.equal(videoUrl, `${BASE_URL}/api/sessions/${TOKEN}/video?format=webm`);
  const res = newServer_GET_video({ status: "complete", videoR2Key: "x", format });
  assert.equal(res.httpStatus, 200, "format=webm must NOT 404 anymore");
  const url = oldClient_handleVideoResponse(res.body);
  assert.match(url, /please-update\.webm$/);
  console.log(`  getVideo({format:webm}).videoUrl = ${url}  ✓ playable, shows upgrade prompt`);
}

// ─── Trace 2: old Linux client that uses videoWebmUrl directly from /status

console.log("\n─── Trace 2: old Linux client uses status.videoWebmUrl directly");
{
  const status = newServer_GET_status({ status: "complete", videoR2Key: "x" });
  // Old SessionDetail (and similar) sometimes set <video src={videoWebmUrl}>.
  const src = status.videoWebmUrl;
  assert.ok(src, "videoWebmUrl must still be present on complete sessions");
  assert.equal(src, `${BASE_URL}/please-update.webm`);
  console.log(`  <video src="${src}">  ✓ resolves to static file`);
}

// ─── Trace 3: old non-Linux client (Mac), unchanged path ───────────────────

console.log("\n─── Trace 3: old non-Linux client (Mac) ──────────────────────");
{
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
  const format = oldClient_pickFormat(ua);
  assert.equal(format, "mp4");

  const res = newServer_GET_video({ status: "complete", videoR2Key: "x", format });
  assert.equal(res.httpStatus, 200);
  const url = oldClient_handleVideoResponse(res.body);
  assert.match(url, /\/video\.mp4$/);
  console.log(`  getVideo({format:mp4}).videoUrl = ${url}  ✓ MP4 unchanged`);
}

// ─── Trace 4: old client hits /api/media/:sessionId/video.webm directly ───
console.log("\n─── Trace 4: legacy direct media URL ─────────────────────────");
{
  const r = newServer_GET_media_video_webm();
  assert.equal(r.httpStatus, 302);
  assert.match(r.location, /please-update\.webm$/);
  console.log(`  302 → ${r.location}  ✓ browser follows, plays upgrade message`);
}

// ─── Trace 5: in-progress session (status=compiling) ───────────────────────

console.log("\n─── Trace 5: in-progress session ─────────────────────────────");
{
  const status = newServer_GET_status({ status: "compiling", videoR2Key: null });
  assert.equal(status.videoUrl, undefined, "no MP4 URL while compiling");
  assert.equal(status.videoWebmUrl, undefined, "no WebM URL while compiling — same as before");
  console.log(`  status.videoWebmUrl = undefined  ✓ old client keeps polling`);

  const session = newServer_GET_session({ status: "compiling", videoR2Key: null, thumbnailR2Key: null });
  assert.equal(session.videoWebmUrl, null, "/sessions/:token returns null until complete");
  console.log(`  session.videoWebmUrl = null      ✓ matches old shape`);
}

// ─── Trace 6: failed session ───────────────────────────────────────────────

console.log("\n─── Trace 6: failed session ──────────────────────────────────");
{
  const status = newServer_GET_status({ status: "failed", videoR2Key: null });
  assert.equal(status.videoWebmUrl, undefined);
  console.log(`  status.videoWebmUrl = undefined  ✓ old client shows error UI`);

  const res = newServer_GET_video({ status: "failed", videoR2Key: null, format: "webm" });
  assert.equal(res.httpStatus, 404, "failed sessions still 404 — old client expects this");
  console.log(`  getVideo() → 404                 ✓ old client treats as load failure`);
}

// ─── Trace 7: old session that completed BEFORE migration (had webmR2Key) ─

console.log("\n─── Trace 7: pre-migration completed session, post-migration server ──");
{
  // Migration drops video_webm_r2_key. Before migration this session had
  // both videoR2Key + videoWebmR2Key set. After migration, only videoR2Key
  // remains. New server doesn't read videoWebmR2Key at all.
  const status = newServer_GET_status({ status: "complete", videoR2Key: "x" });
  assert.match(status.videoWebmUrl, /please-update\.webm$/);
  console.log(`  status.videoWebmUrl = ${status.videoWebmUrl}  ✓ old client gets upgrade message`);
  console.log(`  (orphan WebM in R2 is unreachable — acceptable, we want them on MP4)`);
}

console.log("\n✅ All traces pass — old clients see the upgrade message instead of breaking.");
