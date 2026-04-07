import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: "worker",
  sendDefaultPii: true,
  tracesSampleRate: 0.2,
});

import PgBoss from "pg-boss";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { compileTimelapse } from "./compile.js";
import * as schema from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable must be set");
}

const COMPILE_JOB = "compile-timelapse";
const RETRY_LIMIT = 3;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

const boss = new PgBoss({
  connectionString: DATABASE_URL,
});

await boss.start();

console.log("Worker started, listening for compilation jobs...");

await boss.work<{ sessionId: string }>(
  COMPILE_JOB,
  async (jobs) => {
    for (const job of jobs) {
      const { sessionId } = job.data;
      console.log(`Compiling timelapse for session ${sessionId}...`);

      try {
        const result = await compileTimelapse(sessionId);
        console.log(
          `Compilation complete for session ${sessionId}: ${result.videoR2Key}`,
        );
      } catch (error) {
        console.error(
          `Compilation failed for session ${sessionId}:`,
          error,
        );
        // On final retry, mark session as failed immediately
        // instead of waiting for the 60-min stuck-compiling timeout
        const retryCount = ((job as unknown as Record<string, unknown>).retrycount as number) ?? 0;
        if (retryCount >= RETRY_LIMIT - 1) {
          console.error(`Final retry exhausted for session ${sessionId}, marking as failed`);
          await db
            .update(schema.sessions)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(schema.sessions.id, sessionId))
            .catch((e) => console.error("Failed to mark session as failed:", e));
        }
        throw error; // pgBoss will retry (or complete if final)
      }
    }
  },
);

// Uptime ping — runs as a scheduled pgBoss job so it also validates the job system is healthy
const UPTIME_PING_JOB = "uptime-ping";
const uptimePushUrl = process.env.UPTIME_PUSH_URL;
if (uptimePushUrl) {
  await boss.createQueue(UPTIME_PING_JOB);
  await boss.schedule(UPTIME_PING_JOB, "* * * * *");
  await boss.work(UPTIME_PING_JOB, async () => {
    await fetch(uptimePushUrl);
  });
}

// Graceful shutdown
const shutdown = async () => {
  console.log("Worker shutting down...");
  await boss.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
