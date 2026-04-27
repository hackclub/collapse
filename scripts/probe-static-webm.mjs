// Boots a minimal fastify with the same registration order as
// packages/server/src/index.ts and verifies that /please-update.webm is
// served as the actual file (not the SPA index.html fallback).
//
// Run:  node scripts/probe-static-webm.mjs

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "packages/server/public");

const app = Fastify({ logger: false });

// Mirror the order in packages/server/src/index.ts:
//   1. /api/* routes (we register a stub)
//   2. fastify-static with prefix:"/" wildcard:false
//   3. setNotFoundHandler that serves index.html for non-/api/ paths
app.get("/api/health", async () => ({ ok: true }));

await app.register(fastifyStatic, {
  root: publicDir,
  prefix: "/",
  wildcard: false,
});

app.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith("/api/")) {
    return reply.code(404).send({ error: "Not found" });
  }
  return reply.sendFile("index.html");
});

await app.ready();

// Probe.
const res = await app.inject({ method: "GET", url: "/please-update.webm" });

const expectedSize = statSync(join(publicDir, "please-update.webm")).size;
const head = res.rawPayload.subarray(0, 4);
const isEbml = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;

console.log(`status:        ${res.statusCode}`);
console.log(`content-type:  ${res.headers["content-type"]}`);
console.log(`content-length: ${res.headers["content-length"]}`);
console.log(`body bytes:    ${res.rawPayload.length} (file on disk: ${expectedSize})`);
console.log(`EBML header:   ${isEbml ? "yes (it's a real WebM)" : "NO — likely got index.html instead"}`);

assert.equal(res.statusCode, 200, "expected 200");
assert.match(String(res.headers["content-type"] || ""), /webm|video/i, "content-type should indicate webm");
assert.equal(res.rawPayload.length, expectedSize, "served bytes should equal file size");
assert.ok(isEbml, "first bytes must be the WebM/EBML magic 0x1A 0x45 0xDF 0xA3");

console.log("\n✓ /please-update.webm is served as the real file, not the SPA fallback");

// Also verify a 404 for a missing static file falls through to the SPA handler
// (so legacy clients hitting some other unknown path don't accidentally get a webm).
const miss = await app.inject({ method: "GET", url: "/does-not-exist.webm" });
console.log(`\nmissing-file probe: status=${miss.statusCode} content-type=${miss.headers["content-type"]}`);
assert.equal(miss.statusCode, 200, "SPA fallback returns 200 with index.html");
assert.match(String(miss.headers["content-type"] || ""), /html/i);
console.log("✓ unrelated paths still hit the SPA fallback (no webm leakage)");

await app.close();
