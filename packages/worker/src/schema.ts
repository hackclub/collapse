// Re-export the DB schema from server package.
// In production the schema is shared; for the worker we duplicate the definition
// to avoid a direct dependency on the server package.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sessionStatusEnum = pgEnum("session_status", [
  "pending",
  "active",
  "paused",
  "stopped",
  "compiling",
  "complete",
  "failed",
]);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    status: sessionStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    lastScreenshotAt: timestamp("last_screenshot_at", { withTimezone: true }),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    totalActiveSeconds: integer("total_active_seconds").notNull().default(0),
    trackedSeconds: integer("tracked_seconds"),
    videoUrl: text("video_url"),
    videoR2Key: text("video_r2_key"),
    videoWebmUrl: text("video_webm_url"),
    videoWebmR2Key: text("video_webm_r2_key"),
    thumbnailUrl: text("thumbnail_url"),
    thumbnailR2Key: text("thumbnail_r2_key"),
    compileAttempts: integer("compile_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_sessions_status").on(table.status),
    index("idx_sessions_active_last_screenshot")
      .on(table.lastScreenshotAt)
      .where(sql`status IN ('active', 'paused')`),
  ],
);

export const screenshots = pgTable(
  "screenshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    minuteBucket: integer("minute_bucket").notNull(),
    confirmed: boolean("confirmed").notNull().default(false),
    width: integer("width"),
    height: integer("height"),
    fileSizeBytes: integer("file_size_bytes"),
    sampled: boolean("sampled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_screenshots_session_id").on(table.sessionId),
    index("idx_screenshots_session_bucket").on(
      table.sessionId,
      table.minuteBucket,
    ),
    index("idx_screenshots_unconfirmed")
      .on(table.sessionId)
      .where(sql`confirmed = false`),
  ],
);
