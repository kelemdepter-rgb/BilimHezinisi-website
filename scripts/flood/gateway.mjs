#!/usr/bin/env node
/**
 * The local flood stack's stand-in for Supabase's API gateway (Kong):
 * `/rest/v1/*` on 127.0.0.1:54339 goes to the local PostgREST on :54330.
 *
 *   node scripts/flood/gateway.mjs
 *
 * LOCAL ONLY (scripts/flood/stack.mjs, docs/search-flood.md).
 *
 * It can also play the outage of 2026-10-05: `GET /__gw/blackhole/on` makes
 * it accept every connection and answer none — what a stalled API looks like
 * to the site — and `/__gw/blackhole/off` ends it. `BLACKHOLE=1` starts it
 * that way.
 */
import http from "node:http";

const PORT = Number(process.env.GW_PORT ?? 54339);
const UPSTREAM = { host: "127.0.0.1", port: Number(process.env.GW_UPSTREAM_PORT ?? 54330) };
let blackhole = process.env.BLACKHOLE === "1";

const server = http.createServer((request, response) => {
  if (request.url === "/__gw/blackhole/on") {
    blackhole = true;
    return response.end("on");
  }
  if (request.url === "/__gw/blackhole/off") {
    blackhole = false;
    return response.end("off");
  }
  if (blackhole) return; // hold the socket open and answer nothing
  if (!request.url?.startsWith("/rest/v1")) {
    response.writeHead(404, { "content-type": "application/json" });
    return response.end(JSON.stringify({ message: "not served by the local gateway" }));
  }
  const upstream = http.request(
    {
      ...UPSTREAM,
      method: request.method,
      path: request.url.slice("/rest/v1".length) || "/",
      headers: { ...request.headers, host: `${UPSTREAM.host}:${UPSTREAM.port}` },
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});
server.keepAliveTimeout = 65_000;
server.listen(PORT, "127.0.0.1", () =>
  console.log(`gateway on 127.0.0.1:${PORT} → PostgREST :${UPSTREAM.port}${blackhole ? " (blackhole)" : ""}`),
);
