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
});

describe("404 handler", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/not-a-real-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});
