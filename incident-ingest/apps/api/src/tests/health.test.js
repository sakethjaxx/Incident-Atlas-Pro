import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildApp } from "../app.js";

const app = buildApp();

describe("GET /health", () => {
  it("returns {ok: true} with 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.ts).toBe("string");
  });

  it("allows both localhost and 127.0.0.1 local dev origins", async () => {
    const localhostRes = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");

    const loopbackRes = await request(app)
      .get("/health")
      .set("Origin", "http://127.0.0.1:5173");

    expect(localhostRes.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(loopbackRes.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });
});

describe("404 handler", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/not-a-real-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});
