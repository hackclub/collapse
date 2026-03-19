import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { internalRoutes } from "./routes/internal.js";
import { sessionRoutes } from "./routes/sessions.js";
import { boss } from "./lib/queue.js";
import { registerTimeoutJobs } from "./lib/timeouts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: (origin, cb) => {
    // Allow: no origin (server-to-server), *.hackclub.com, localhost dev, tauri app
    if (!origin || origin.startsWith("tauri://")) {
      cb(null, true);
      return;
    }
    try {
      const hostname = new URL(origin).hostname;
      if (
        /\.hackclub\.com$/.test(hostname) ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin)
      ) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    } catch {
      cb(new Error("Not allowed by CORS"), false);
    }
  },
});

// Security headers
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "0");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
});

// Register API routes
await app.register(internalRoutes);
await app.register(sessionRoutes);

// Serve React SPA in production
const publicDir = join(__dirname, "..", "public");
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    wildcard: false,
  });

  // SPA fallback — serve index.html for non-API routes
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
} else {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.code(200).send({ message: "Collapse API is running. Frontend not built yet." });
  });
}

// Start pgBoss and periodic jobs
await boss.start();
await registerTimeoutJobs();

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: "0.0.0.0" });

// Graceful shutdown
const shutdown = async () => {
  app.log.info("Shutting down...");
  await app.close();
  await boss.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
