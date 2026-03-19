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
} from "@collapse/shared";

// ── Shared schema fragments ─────────────────────────────────

const tokenParamSchema = {
  type: "object" as const,
  properties: {
    token: { type: "string" as const, pattern: "^[0-9a-fA-F]{64}$" },
  },
  required: ["token"] as const,
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
  return Number(count) * 60;
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

      const trackedSeconds = await getTrackedSeconds(session.id);
      const screenshotCount = await getScreenshotCount(session.id);

      return {
        status: session.status,
        trackedSeconds,
        screenshotCount,
        startedAt: session.startedAt?.toISOString() ?? null,
        totalActiveSeconds: session.totalActiveSeconds,
        createdAt: session.createdAt.toISOString(),
        thumbnailUrl: session.thumbnailUrl ?? null,
        videoUrl: session.videoUrl ?? null,
        metadata: session.metadata ?? {},
      };
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

      // If activating, set started_at
      if (isActivating) {
        await db
          .update(schema.sessions)
          .set({
            status: "active",
            startedAt: now,
            lastScreenshotAt: now,
            updatedAt: now,
          })
          .where(eq(schema.sessions.id, session.id));
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

      // Accumulate active time
      const activeFrom =
        session.resumedAt || session.startedAt!;
      const additionalSeconds = Math.floor(
        (Date.now() - activeFrom.getTime()) / 1000,
      );

      await db
        .update(schema.sessions)
        .set({
          status: "paused",
          pausedAt: new Date(),
          totalActiveSeconds: session.totalActiveSeconds + additionalSeconds,
          updatedAt: new Date(),
        })
        .where(eq(schema.sessions.id, session.id));

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

      await db
        .update(schema.sessions)
        .set({
          status: "active",
          pausedAt: null,
          resumedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.sessions.id, session.id));

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

      await db
        .update(schema.sessions)
        .set({
          status: "stopped",
          stoppedAt: now,
          totalActiveSeconds,
          updatedAt: now,
        })
        .where(eq(schema.sessions.id, session.id));

      // Enqueue compilation
      const screenshotCount = await getScreenshotCount(session.id);
      if (screenshotCount > 0) {
        await boss.send(COMPILE_JOB, { sessionId: session.id });
      } else {
        // No screenshots — mark complete immediately with no video
        await db
          .update(schema.sessions)
          .set({ status: "complete", updatedAt: now })
          .where(eq(schema.sessions.id, session.id));
      }

      const trackedSeconds = await getTrackedSeconds(session.id);

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

      const trackedSeconds = await getTrackedSeconds(session.id);

      return {
        status: session.status,
        videoUrl: session.videoUrl ?? undefined,
        trackedSeconds,
      };
    },
  );

  // Get video presigned URL
  app.get<{ Params: { token: string } }>(
    "/api/sessions/:token/video",
    {
      schema: { params: tokenParamSchema },
    },
    async (request, reply) => {
      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      if (session.status !== "complete" || !session.videoR2Key) {
        return reply.code(404).send({ error: "Video not available" });
      }

      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: session.videoR2Key,
      });
      const videoUrl = await getSignedUrl(r2Client, command, {
        expiresIn: 3600,
      });

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
      const session = await findSession(request.params.token);
      if (!session) return reply.code(404).send({ error: "Session not found" });

      if (!session.thumbnailR2Key) {
        return reply.code(404).send({ error: "Thumbnail not available" });
      }

      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: session.thumbnailR2Key,
      });
      const thumbnailUrl = await getSignedUrl(r2Client, command, {
        expiresIn: 3600,
      });

      return { thumbnailUrl };
    },
  );

  // Batch get sessions — gallery endpoint
  app.post<{ Body: { tokens: string[] } }>(
    "/api/sessions/batch",
    async (request, reply) => {
      const { tokens } = request.body;

      if (!Array.isArray(tokens) || tokens.length === 0) {
        return reply.code(400).send({ error: "tokens array is required" });
      }
      if (tokens.length > 100) {
        return reply.code(400).send({ error: "Max 100 tokens per batch" });
      }

      // Validate all tokens are hex strings
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
            trackedSeconds: Number(c.trackedSeconds) * 60,
            screenshotCount: Number(c.screenshotCount),
          },
        ]),
      );

      // Generate presigned thumbnail URLs
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const sessions = await Promise.all(
        rows.map(async (s) => {
          const c = countMap.get(s.id) ?? { trackedSeconds: 0, screenshotCount: 0 };
          let thumbnailUrl: string | null = null;
          if (s.thumbnailR2Key) {
            const cmd = new GetObjectCommand({
              Bucket: R2_BUCKET,
              Key: s.thumbnailR2Key,
            });
            thumbnailUrl = await getSignedUrl(r2Client, cmd, { expiresIn: 3600 });
          }
          return {
            token: s.token,
            status: s.status,
            trackedSeconds: c.trackedSeconds,
            screenshotCount: c.screenshotCount,
            startedAt: s.startedAt?.toISOString() ?? null,
            createdAt: s.createdAt.toISOString(),
            totalActiveSeconds: s.totalActiveSeconds,
            thumbnailUrl,
            videoUrl: s.videoUrl ?? null,
            metadata: s.metadata ?? {},
          };
        }),
      );

      // Sort newest first
      sessions.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return { sessions };
    },
  );
}
