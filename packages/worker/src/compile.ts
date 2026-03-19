import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "./schema.js";

const execFileAsync = promisify(execFile);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable must be set");
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || "collapse";
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN || "";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function compileTimelapse(sessionId: string): Promise<{
  videoUrl: string;
  videoR2Key: string;
  thumbnailUrl: string;
  thumbnailR2Key: string;
}> {
  // Validate sessionId is a proper UUID to prevent path traversal
  if (!UUID_RE.test(sessionId)) {
    throw new Error(`Invalid sessionId format: ${sessionId}`);
  }

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });

  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Atomically claim the compilation (concurrency guard)
  const [claimed] = await db
    .update(schema.sessions)
    .set({ status: "compiling", updatedAt: new Date() })
    .where(and(eq(schema.sessions.id, sessionId), sql`${schema.sessions.status} != 'compiling'`))
    .returning({ id: schema.sessions.id });

  if (!claimed) {
    throw new Error(`Session ${sessionId} is already being compiled`);
  }

  const tmpDir = `/tmp/compile-${sessionId}`;
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    // Step 1: Sample selection — pick best screenshot per minute bucket
    // Using raw SQL for DISTINCT ON which Drizzle doesn't support directly
    const sampledScreenshots = await db.execute<{
      id: string;
      r2_key: string;
      minute_bucket: number;
      requested_at: Date;
    }>(sql`
      SELECT DISTINCT ON (minute_bucket) id, r2_key, minute_bucket, requested_at
      FROM screenshots
      WHERE session_id = ${sessionId} AND confirmed = true
      ORDER BY minute_bucket,
        ABS(EXTRACT(EPOCH FROM (requested_at - (
          ${session.startedAt!}::timestamptz
          + (minute_bucket * interval '1 minute')
          + interval '30 seconds'
        ))))
    `);

    if (sampledScreenshots.rows.length === 0) {
      // No screenshots — mark complete with no video
      await db
        .update(schema.sessions)
        .set({ status: "complete", updatedAt: new Date() })
        .where(eq(schema.sessions.id, sessionId));
      return { videoUrl: "", videoR2Key: "", thumbnailUrl: "", thumbnailR2Key: "" };
    }

    // Mark sampled screenshots
    const sampledIds = sampledScreenshots.rows.map((s) => s.id);
    for (const id of sampledIds) {
      await db
        .update(schema.screenshots)
        .set({ sampled: true })
        .where(eq(schema.screenshots.id, id));
    }

    // Step 2: Download sampled screenshots from R2
    const total = sampledScreenshots.rows.length;
    for (let i = 0; i < total; i++) {
      const ss = sampledScreenshots.rows[i];
      const response = await r2Client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: ss.r2_key }),
      );
      const body = await response.Body!.transformToByteArray();
      const filePath = path.join(
        tmpDir,
        `${String(i + 1).padStart(5, "0")}.jpg`,
      );
      await fs.writeFile(filePath, body);
    }

    // Step 3: Run ffmpeg
    const outputPath = path.join(tmpDir, "timelapse.mp4");
    await execFileAsync("ffmpeg", [
      "-framerate", "1",
      "-i", path.join(tmpDir, "%05d.jpg"),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "23",
      "-r", "30",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-y",
      outputPath,
    ], { timeout: 600_000 });

    // Step 4: Verify output
    // Check file exists and size > 0
    const stat = await fs.stat(outputPath);
    if (stat.size === 0) throw new Error("ffmpeg produced empty output");

    // Verify with ffprobe
    const { stdout: frameCountStr } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-count_frames",
      "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames",
      "-of", "csv=p=0",
      outputPath,
    ], { timeout: 30_000 });

    const frameCount = parseInt(frameCountStr.trim(), 10);
    const expectedFrames = total * 30; // 1 input fps → 30 output fps
    const tolerance = Math.max(30, Math.round(expectedFrames * 0.02));
    if (
      isNaN(frameCount) ||
      Math.abs(frameCount - expectedFrames) > tolerance
    ) {
      throw new Error(
        `Frame count mismatch: expected ~${expectedFrames} (±${tolerance}), got ${frameCount}`,
      );
    }

    // Step 4.5: Extract thumbnail from first frame
    const thumbnailPath = path.join(tmpDir, "thumbnail.jpg");
    await execFileAsync("ffmpeg", [
      "-i", outputPath,
      "-vframes", "1",
      "-vf", "scale=480:-1",
      "-q:v", "5",
      "-y",
      thumbnailPath,
    ], { timeout: 30_000 });

    // Upload thumbnail to R2
    const thumbnailR2Key = `timelapses/${sessionId}/thumbnail.jpg`;
    const thumbnailBytes = await fs.readFile(thumbnailPath);
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: thumbnailR2Key,
        Body: thumbnailBytes,
        ContentType: "image/jpeg",
      }),
    );

    const thumbnailUrl = R2_PUBLIC_DOMAIN
      ? `https://${R2_PUBLIC_DOMAIN}/${thumbnailR2Key}`
      : thumbnailR2Key;

    // Step 5: Upload video to R2
    const videoR2Key = `timelapses/${sessionId}/timelapse.mp4`;
    const videoBytes = await fs.readFile(outputPath);

    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: videoR2Key,
        Body: videoBytes,
        ContentType: "video/mp4",
      }),
    );

    // Verify R2 upload
    const headResponse = await r2Client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: videoR2Key }),
    );
    if (headResponse.ContentLength !== stat.size) {
      throw new Error(
        `R2 upload size mismatch: expected ${stat.size}, got ${headResponse.ContentLength}`,
      );
    }

    // Step 6: Mark complete
    const videoUrl = R2_PUBLIC_DOMAIN
      ? `https://${R2_PUBLIC_DOMAIN}/${videoR2Key}`
      : videoR2Key;

    await db
      .update(schema.sessions)
      .set({
        status: "complete",
        videoUrl,
        videoR2Key,
        thumbnailUrl,
        thumbnailR2Key,
        updatedAt: new Date(),
      })
      .where(eq(schema.sessions.id, sessionId));

    // Step 7: Cleanup unsampled screenshots from R2
    const unsampled = await db
      .select({ r2Key: schema.screenshots.r2Key, id: schema.screenshots.id })
      .from(schema.screenshots)
      .where(
        and(
          eq(schema.screenshots.sessionId, sessionId),
          eq(schema.screenshots.confirmed, true),
          eq(schema.screenshots.sampled, false),
        ),
      );

    for (const ss of unsampled) {
      try {
        await r2Client.send(
          new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: ss.r2Key }),
        );
      } catch {
        // Non-fatal: orphaned R2 objects can be cleaned up later
      }
    }

    // Delete unconfirmed screenshot records
    await db
      .delete(schema.screenshots)
      .where(
        and(
          eq(schema.screenshots.sessionId, sessionId),
          eq(schema.screenshots.confirmed, false),
        ),
      );

    return { videoUrl, videoR2Key, thumbnailUrl, thumbnailR2Key };
  } finally {
    // Always clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
