import type { FastifyInstance } from "fastify";
import { eq, sql, and, inArray } from "drizzle-orm";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/index.js";
import { r2Client, R2_BUCKET } from "../config/r2.js";
import { boss, COMPILE_JOB } from "../lib/queue.js";
import { computeMinuteBucket, checkRateLimit, checkGenericRateLimit } from "../lib/timing.js";
import {
  SCREENSHOT_INTERVAL_MS,
  PRESIGNED_URL_EXPIRY_SECONDS,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS_PER_SESSION,
  MAX_UPLOAD_REQUESTS_PER_SESSION,
} from "@lookout/shared";

// ── Shared schema fragments ─────────────────────────────────

const tokenParamSchema = {
  type: "object" as const,
  properties: {
    token: { type: "string" as const, pattern: "^[0-9a-fA-F]{64}$" },
  },
  required: ["token"] as const,
};

const sessionIdParamSchema = {
  type: "object" as const,
  properties: {
    sessionId: { type: "string" as const, format: "uuid" },
  },
  required: ["sessionId"] as const,
};

/** Helper to look up session by token */
async function findSession(token: string) {
  return db.query.sessions.findFirst({
    where: eq(schema.sessions.token, token),
  });
}

/** Count distinct confirmed minute buckets for a session */
async function getTrackedSeconds(sessionId: string): Promise<number> {
  const [{ count }] = await db
    .select({
      count: sql<number>`count(distinct ${schema.screenshots.minuteBucket})`,
    })
    .from(schema.screenshots)
    .where(
      and(
        eq(schema.screenshots.sessionId, sessionId),
        eq(schema.screenshots.confirmed, true),
      ),
    );
  return Math.max(0, (Number(count) - 1) * 60);
}

/** Count total confirmed screenshots */
async function getScreenshotCount(sessionId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.screenshots)
    .where(
      and(
        eq(schema.screenshots.sessionId, sessionId),
        eq(schema.screenshots.confirmed, true),
      ),
    );
  return Number(count);
}

/** Count total upload-url requests (confirmed + unconfirmed) */
async function getTotalUploadRequests(sessionId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.screenshots)
    .where(eq(schema.screenshots.sessionId, sessionId));
  return Number(count);
}

export async function sessionRoutes(app: FastifyInstance) {
  // Get session status (used for recovery after refresh)
  app.get<{ Params: { token: string } }>(
    "/api/sessions/:token",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      // Rate limit: 60 req/min per token (status polling)
      const rl = checkGenericRateLimit("session-get", request.params.token, 60);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      const liveTrackedSeconds = await getTrackedSeconds(session.id);
      const screenshotCount = await getScreenshotCount(session.id);
      // Prefer stored value (survives screenshot cleanup), fall back to live count
      const trackedSeconds = session.trackedSeconds ?? liveTrackedSeconds;

      const baseUrl = process.env.BASE_URL || "http://localhost:3000";
      return {
        name: session.name,
        status: session.status,
        trackedSeconds,
        screenshotCount,
        startedAt: session.startedAt?.toISOString() ?? null,
        totalActiveSeconds: session.totalActiveSeconds,
        createdAt: session.createdAt.toISOString(),
        thumbnailUrl: session.thumbnailR2Key
          ? `${baseUrl}/api/media/${session.id}/thumbnail.jpg`
          : null,
        videoUrl: session.videoR2Key
          ? `${baseUrl}/api/media/${session.id}/video.mp4`
          : null,
        videoWebmUrl: session.videoWebmR2Key
          ? `${baseUrl}/api/media/${session.id}/video.webm`
          : null,
        metadata: session.metadata ?? {},
      };
    },
  );

  // Rename session
  app.patch<{
    Params: { token: string };
    Body: { name: string };
  }>(
    "/api/sessions/:token/name",
    {
      schema: {
        params: tokenParamSchema,
        body: {
          type: "object" as const,
          required: ["name"] as const,
          properties: {
            name: { type: "string" as const, minLength: 1, maxLength: 255 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const rl = checkGenericRateLimit("session-rename", request.params.token, 20);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      await db
        .update(schema.sessions)
        .set({ name: request.body.name, updatedAt: new Date() })
        .where(eq(schema.sessions.id, session.id));

      return { name: request.body.name };
    },
  );

  // Get presigned upload URL — this is where server timestamps capture time
  app.get<{ Params: { token: string } }>(
    "/api/sessions/:token/upload-url",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      // Activate pending sessions on first upload-url request
      const isActivating = session.status === "pending";
      if (!isActivating && session.status !== "active") {
        return reply
          .code(409)
          .send({ error: `Session is ${session.status}, cannot upload` });
      }

      // Rate limiting
      const rl = checkRateLimit(session.id);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      // Session-level hard cap
      const totalRequests = await getTotalUploadRequests(session.id);
      if (totalRequests >= MAX_UPLOAD_REQUESTS_PER_SESSION) {
        return reply
          .code(429)
          .send({ error: "Max upload requests per session exceeded" });
      }

      const now = new Date();

      // If activating, set started_at (with optimistic locking)
      if (isActivating) {
        const [updated] = await db
          .update(schema.sessions)
          .set({
            status: "active",
            startedAt: now,
            lastScreenshotAt: now,
            updatedAt: now,
          })
          .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.status, "pending")))
          .returning({ id: schema.sessions.id });
        if (!updated) {
          // Another request already activated; re-fetch and continue
          const refreshed = await findSession(request.params.token);
          if (!refreshed || (refreshed.status !== "active" && refreshed.status !== "pending")) {
            return reply.code(409).send({ error: `Session is ${refreshed?.status ?? "unknown"}, cannot upload` });
          }
        }
      } else {
        await db
          .update(schema.sessions)
          .set({ lastScreenshotAt: now, updatedAt: now })
          .where(eq(schema.sessions.id, session.id));
      }

      const startedAt = isActivating ? now : session.startedAt!;
      const minuteBucket = computeMinuteBucket(now, startedAt);
      const screenshotId = randomUUID();
      const r2Key = `screenshots/${session.id}/${screenshotId}.jpg`;

      // Create screenshot record (unconfirmed)
      await db.insert(schema.screenshots).values({
        id: screenshotId,
        sessionId: session.id,
        r2Key,
        requestedAt: now,
        minuteBucket,
        confirmed: false,
      });

      // Generate presigned PUT URL
      // Note: Don't set ContentLength — it signs an exact size and rejects
      // anything different. Size is validated at confirmation via HeadObject.
      // Orphaned uploads are cleaned up by the unconfirmed cleanup job.
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        ContentType: "image/jpeg",
      });

      const uploadUrl = await getSignedUrl(r2Client, command, {
        expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
      });

      const nextExpectedAt = new Date(
        now.getTime() + SCREENSHOT_INTERVAL_MS,
      ).toISOString();

      return {
        uploadUrl,
        r2Key,
        screenshotId,
        minuteBucket,
        nextExpectedAt,
      };
    },
  );

  // Confirm screenshot upload
  app.post<{
    Params: { token: string };
    Body: {
      screenshotId: string;
      width: number;
      height: number;
      fileSize: number;
    };
  }>(
    "/api/sessions/:token/screenshots",
    {
      schema: {
        params: tokenParamSchema,
        body: {
          type: "object" as const,
          required: ["screenshotId", "width", "height", "fileSize"] as const,
          properties: {
            screenshotId: { type: "string" as const, format: "uuid" },
            width: { type: "integer" as const, minimum: 1 },
            height: { type: "integer" as const, minimum: 1 },
            fileSize: { type: "integer" as const, minimum: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      // Rate limit: 10 req/min per token (screenshot confirmation)
      const rl = checkGenericRateLimit(
        "screenshot-confirm",
        request.params.token,
        10,
      );
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      if (session.status !== "active" && session.status !== "pending") {
        return reply
          .code(409)
          .send({ error: `Session is ${session.status}, cannot confirm` });
      }

      const { screenshotId, width, height, fileSize } = request.body;

      // Validate screenshot belongs to this session and isn't already confirmed
      const screenshot = await db.query.screenshots.findFirst({
        where: and(
          eq(schema.screenshots.id, screenshotId),
          eq(schema.screenshots.sessionId, session.id),
        ),
      });

      if (!screenshot) {
        return reply.code(404).send({ error: "Screenshot not found" });
      }

      // Idempotent: already confirmed
      if (screenshot.confirmed) {
        const trackedSeconds = await getTrackedSeconds(session.id);
        const nextExpectedAt = new Date(
          Date.now() + SCREENSHOT_INTERVAL_MS,
        ).toISOString();
        return { confirmed: true, trackedSeconds, nextExpectedAt };
      }

      // Verify the object actually exists in R2 and is within size limits
      try {
        const head = await r2Client.send(
          new HeadObjectCommand({ Bucket: R2_BUCKET, Key: screenshot.r2Key }),
        );

        // Validate ContentType is image/jpeg
        if (head.ContentType !== "image/jpeg") {
          return reply
            .code(400)
            .send({ error: "Invalid content type — expected image/jpeg" });
        }

        // Validate file size is within limits
        if (head.ContentLength && head.ContentLength > MAX_SCREENSHOT_BYTES) {
          return reply.code(400).send({ error: "Uploaded object is too large" });
        }
      } catch {
        return reply
          .code(400)
          .send({ error: "Screenshot not found in storage — upload may have failed" });
      }

      // Check confirmed screenshot cap
      const confirmedCount = await getScreenshotCount(session.id);
      if (confirmedCount >= MAX_SCREENSHOTS_PER_SESSION) {
        return reply
          .code(429)
          .send({ error: "Max screenshots per session exceeded" });
      }

      // Mark confirmed
      await db
        .update(schema.screenshots)
        .set({
          confirmed: true,
          width,
          height,
          fileSizeBytes: fileSize,
        })
        .where(eq(schema.screenshots.id, screenshotId));

      // Update session's last_screenshot_at
      await db
        .update(schema.sessions)
        .set({ lastScreenshotAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.sessions.id, session.id));

      const trackedSeconds = await getTrackedSeconds(session.id);
      const nextExpectedAt = new Date(
        Date.now() + SCREENSHOT_INTERVAL_MS,
      ).toISOString();

      return { confirmed: true, trackedSeconds, nextExpectedAt };
    },
  );

  // Pause session
  app.post<{ Params: { token: string } }>(
    "/api/sessions/:token/pause",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      // Rate limit: 10 req/min per token (actions)
      const rl = checkGenericRateLimit("session-pause", request.params.token, 10);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      // Pending sessions: no active time to accumulate, return no-op
      if (session.status === "pending") {
        return { status: "paused" as const, totalActiveSeconds: 0 };
      }

      // Already paused: idempotent
      if (session.status === "paused") {
        return {
          status: "paused" as const,
          totalActiveSeconds: session.totalActiveSeconds,
        };
      }

      if (session.status !== "active") {
        return reply
          .code(409)
          .send({ error: `Session is ${session.status}, cannot pause` });
      }

      // Accumulate active time (with optimistic locking)
      const activeFrom =
        session.resumedAt || session.startedAt!;
      const additionalSeconds = Math.floor(
        (Date.now() - activeFrom.getTime()) / 1000,
      );

      const [updated] = await db
        .update(schema.sessions)
        .set({
          status: "paused",
          pausedAt: new Date(),
          totalActiveSeconds: session.totalActiveSeconds + additionalSeconds,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.status, "active")))
        .returning({ id: schema.sessions.id });

      if (!updated) {
        return reply.code(409).send({ error: "Session state changed concurrently, please retry" });
      }

      return {
        status: "paused" as const,
        totalActiveSeconds: session.totalActiveSeconds + additionalSeconds,
      };
    },
  );

  // Resume session
  app.post<{ Params: { token: string } }>(
    "/api/sessions/:token/resume",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      // Rate limit: 10 req/min per token (actions)
      const rl = checkGenericRateLimit("session-resume", request.params.token, 10);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      if (session.status !== "paused") {
        return reply
          .code(409)
          .send({ error: `Session is ${session.status}, cannot resume` });
      }

      const now = new Date();

      const [updated] = await db
        .update(schema.sessions)
        .set({
          status: "active",
          pausedAt: null,
          resumedAt: now,
          lastScreenshotAt: now,
          updatedAt: now,
        })
        .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.status, "paused")))
        .returning({ id: schema.sessions.id });

      if (!updated) {
        return reply.code(409).send({ error: "Session state changed concurrently, please retry" });
      }

      const nextExpectedAt = new Date(
        now.getTime() + SCREENSHOT_INTERVAL_MS,
      ).toISOString();

      return { status: "active" as const, nextExpectedAt };
    },
  );

  // Stop session
  app.post<{ Params: { token: string } }>(
    "/api/sessions/:token/stop",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      // Rate limit: 10 req/min per token (actions)
      const rl = checkGenericRateLimit("session-stop", request.params.token, 10);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      if (
        session.status !== "active" &&
        session.status !== "paused" &&
        session.status !== "pending"
      ) {
        return reply
          .code(409)
          .send({ error: `Session is ${session.status}, cannot stop` });
      }

      // Accumulate remaining active time
      let totalActiveSeconds = session.totalActiveSeconds;
      if (session.status === "active" && session.startedAt) {
        const activeFrom =
          session.resumedAt || session.startedAt;
        totalActiveSeconds += Math.floor(
          (Date.now() - activeFrom.getTime()) / 1000,
        );
      }

      const now = new Date();

      // Compute tracked seconds before stopping (screenshots may be cleaned up later)
      const trackedSeconds = await getTrackedSeconds(session.id);

      const [updated] = await db
        .update(schema.sessions)
        .set({
          status: "stopped",
          stoppedAt: now,
          totalActiveSeconds,
          trackedSeconds,
          updatedAt: now,
        })
        .where(and(
          eq(schema.sessions.id, session.id),
          sql`${schema.sessions.status} IN ('active', 'paused', 'pending')`,
        ))
        .returning({ id: schema.sessions.id });

      if (!updated) {
        return reply.code(409).send({ error: "Session state changed concurrently, please retry" });
      }

      // Enqueue compilation
      const screenshotCount = await getScreenshotCount(session.id);
      if (screenshotCount > 0) {
        await boss.send(COMPILE_JOB, { sessionId: session.id });
      } else {
        // No screenshots — mark failed (no video possible)
        await db
          .update(schema.sessions)
          .set({ status: "failed", updatedAt: now })
          .where(eq(schema.sessions.id, session.id));
      }

      return {
        status: "stopped" as const,
        trackedSeconds,
        totalActiveSeconds,
      };
    },
  );

  // Poll compilation status
  app.get<{ Params: { token: string } }>(
    "/api/sessions/:token/status",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      // Rate limit: 60 req/min per token (status polling)
      const rl = checkGenericRateLimit("session-status", request.params.token, 60);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      const liveTrackedSeconds = await getTrackedSeconds(session.id);
      const trackedSeconds = session.trackedSeconds ?? liveTrackedSeconds;

      const baseUrl = process.env.BASE_URL || "http://localhost:3000";
      return {
        status: session.status,
        videoUrl: session.videoR2Key
          ? `${baseUrl}/api/media/${session.id}/video.mp4`
          : undefined,
        videoWebmUrl: session.videoWebmR2Key
          ? `${baseUrl}/api/media/${session.id}/video.webm`
          : undefined,
        trackedSeconds,
      };
    },
  );

  // Get video presigned URL (supports ?format=mp4|webm, default mp4)
  app.get<{ Params: { token: string }; Querystring: { format?: string } }>(
    "/api/sessions/:token/video",
    {
      schema: {
        params: tokenParamSchema,
        querystring: {
          type: "object" as const,
          properties: {
            format: { type: "string" as const, enum: ["mp4", "webm"] as const },
          },
        },
      },
    },
    async (request, reply) => {
      // Rate limit: 30 req/min per token
      const rl = checkGenericRateLimit("session-video", request.params.token, 30);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      if (session.status !== "complete" || !session.videoR2Key) {
        return reply.code(404).send({ error: "Video not available" });
      }

      const format = request.query.format === "webm" ? "webm" : "mp4";
      const r2Key = format === "webm" ? session.videoWebmR2Key : session.videoR2Key;

      if (!r2Key) {
        return reply.code(404).send({ error: `${format.toUpperCase()} video not available` });
      }

      const baseUrl = process.env.BASE_URL || "http://localhost:3000";
      const ext = format === "webm" ? "video.webm" : "video.mp4";
      const videoUrl = `${baseUrl}/api/media/${session.id}/${ext}`;

      return { videoUrl };
    },
  );

  // Get thumbnail presigned URL
  app.get<{ Params: { token: string } }>(
    "/api/sessions/:token/thumbnail",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      // Rate limit: 30 req/min per token
      const rl = checkGenericRateLimit("session-thumbnail", request.params.token, 30);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      if (!session.thumbnailR2Key) {
        return reply.code(404).send({ error: "Thumbnail not available" });
      }

      const baseUrl = process.env.BASE_URL || "http://localhost:3000";
      const thumbnailUrl = `${baseUrl}/api/media/${session.id}/thumbnail.jpg`;

      return { thumbnailUrl };
    },
  );

  // Batch get sessions — gallery endpoint
  app.post<{ Body: { tokens: string[] } }>(
    "/api/sessions/batch",
    {
      schema: {
        body: {
          type: "object" as const,
          required: ["tokens"] as const,
          properties: {
            tokens: {
              type: "array" as const,
              items: { type: "string" as const, pattern: "^[0-9a-fA-F]{64}$" },
              minItems: 1,
              maxItems: 100,
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      // Rate limit: 30 req/min per IP
      const ip = request.ip;
      const rl = checkGenericRateLimit("batch", ip, 30);
      if (!rl.allowed) {
        reply.header(
          "Retry-After",
          String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
        );
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const { tokens } = request.body;

      // All tokens are already validated by schema
      const validTokens = tokens.filter((t) =>
        typeof t === "string" && /^[a-f0-9]{64}$/i.test(t),
      );

      if (validTokens.length === 0) {
        return { sessions: [] };
      }

      const rows = await db
        .select()
        .from(schema.sessions)
        .where(inArray(schema.sessions.token, validTokens));

      // Get screenshot counts for all sessions in one query
      const sessionIds = rows.map((r) => r.id);
      const counts =
        sessionIds.length > 0
          ? await db
              .select({
                sessionId: schema.screenshots.sessionId,
                trackedSeconds: sql<number>`count(distinct ${schema.screenshots.minuteBucket})`,
                screenshotCount: sql<number>`count(*)`,
              })
              .from(schema.screenshots)
              .where(
                and(
                  inArray(schema.screenshots.sessionId, sessionIds),
                  eq(schema.screenshots.confirmed, true),
                ),
              )
              .groupBy(schema.screenshots.sessionId)
          : [];

      const countMap = new Map(
        counts.map((c) => [
          c.sessionId,
          {
            trackedSeconds: Math.max(0, (Number(c.trackedSeconds) - 1) * 60),
            screenshotCount: Number(c.screenshotCount),
          },
        ]),
      );

      // Generate permanent thumbnail URLs via redirect endpoint
      const baseUrl = process.env.BASE_URL || "http://localhost:3000";
      const sessions = rows.map((s) => {
          const c = countMap.get(s.id) ?? { trackedSeconds: 0, screenshotCount: 0 };
          const thumbnailUrl = s.thumbnailR2Key
            ? `${baseUrl}/api/media/${s.id}/thumbnail.jpg`
            : null;
          // Prefer stored trackedSeconds (survives screenshot cleanup),
          // fall back to live screenshot count for active sessions
          const trackedSeconds = s.trackedSeconds ?? c.trackedSeconds;
          return {
            token: s.token,
            name: s.name,
            status: s.status,
            trackedSeconds,
            screenshotCount: c.screenshotCount,
            startedAt: s.startedAt?.toISOString() ?? null,
            createdAt: s.createdAt.toISOString(),
            totalActiveSeconds: s.totalActiveSeconds,
            thumbnailUrl,
            videoUrl: s.videoR2Key
              ? `${baseUrl}/api/media/${s.id}/video.mp4`
              : null,
            videoWebmUrl: s.videoWebmR2Key
              ? `${baseUrl}/api/media/${s.id}/video.webm`
              : null,
            metadata: s.metadata ?? {},
          };
        });

      // Sort newest first
      sessions.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return { sessions };
    },
  );

  // ── Public media redirect endpoints ─────────────────────────
  // Permanent URLs that redirect to short-lived presigned R2 URLs.
  // Use session ID (public, unguessable UUID) instead of token (secret).

  app.get<{ Params: { sessionId: string } }>(
    "/api/media/:sessionId/thumbnail.jpg",
    { schema: { params: sessionIdParamSchema } },
    async (request, reply) => {
      const rl = checkGenericRateLimit("media-thumbnail", request.params.sessionId, 60);
      if (!rl.allowed) {
        reply.header("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)));
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await db.query.sessions.findFirst({
        where: eq(schema.sessions.id, request.params.sessionId),
      });
      if (!session || !session.thumbnailR2Key) {
        return reply.code(404).send({ error: "Thumbnail not available" });
      }

      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const url = await getSignedUrl(r2Client, new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: session.thumbnailR2Key,
      }), { expiresIn: 3600 });

      reply.header("Cache-Control", "public, max-age=1800");
      return reply.redirect(url);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/media/:sessionId/video.mp4",
    { schema: { params: sessionIdParamSchema } },
    async (request, reply) => {
      const rl = checkGenericRateLimit("media-video", request.params.sessionId, 30);
      if (!rl.allowed) {
        reply.header("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)));
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await db.query.sessions.findFirst({
        where: eq(schema.sessions.id, request.params.sessionId),
      });
      if (!session || session.status !== "complete" || !session.videoR2Key) {
        return reply.code(404).send({ error: "Video not available" });
      }

      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const url = await getSignedUrl(r2Client, new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: session.videoR2Key,
      }), { expiresIn: 3600 });

      reply.header("Cache-Control", "public, max-age=1800");
      return reply.redirect(url);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/media/:sessionId/video.webm",
    { schema: { params: sessionIdParamSchema } },
    async (request, reply) => {
      const rl = checkGenericRateLimit("media-video-webm", request.params.sessionId, 30);
      if (!rl.allowed) {
        reply.header("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)));
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const session = await db.query.sessions.findFirst({
        where: eq(schema.sessions.id, request.params.sessionId),
      });
      if (!session || session.status !== "complete" || !session.videoWebmR2Key) {
        return reply.code(404).send({ error: "WebM video not available" });
      }

      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const url = await getSignedUrl(r2Client, new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: session.videoWebmR2Key,
      }), { expiresIn: 3600 });

      reply.header("Cache-Control", "public, max-age=1800");
      return reply.redirect(url);
    },
  );
}
