/**
 * Unit tests for processor.resolveRawText()
 *
 * Tests the text-resolution strategy: rawText → rawPath → error.
 * Uses real temp files on disk; no DB or Redis needed.
 */

import { writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveRawText } from "../processor.js";

const tmpDir = path.join(os.tmpdir(), `atlas-worker-test-${Date.now()}`);

beforeAll(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("resolveRawText — rawText in DB", () => {
  it("returns rawText directly when present", async () => {
    const result = await resolveRawText({ rawText: "Hello world", rawPath: null });
    expect(result).toBe("Hello world");
  });

  it("prefers rawText over rawPath", async () => {
    // rawPath points at a non-existent file — should not be accessed
    const result = await resolveRawText({
      rawText: "DB text wins",
      rawPath: "/does/not/exist.txt",
    });
    expect(result).toBe("DB text wins");
  });
});

describe("resolveRawText — rawPath on disk", () => {
  it("reads a .txt file from disk", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await writeFile(filePath, "Impact\nService down.", "utf-8");

    const result = await resolveRawText({ rawText: null, rawPath: filePath });
    expect(result).toContain("Impact");
  });

  it("reads a .md file from disk", async () => {
    const filePath = path.join(tmpDir, "test.md");
    await writeFile(filePath, "## Impact\nService down.", "utf-8");

    const result = await resolveRawText({ rawText: null, rawPath: filePath });
    expect(result).toContain("Impact");
  });

  it("throws PermanentError for .pdf extension", async () => {
    const filePath = path.join(tmpDir, "test.pdf");
    await writeFile(filePath, "%PDF-1.4 fake", "utf-8");

    await expect(
      resolveRawText({ rawText: null, rawPath: filePath })
    ).rejects.toMatchObject({ permanent: true, message: /PDF/i });
  });

  it("throws PermanentError when no rawText and no rawPath", async () => {
    await expect(
      resolveRawText({ rawText: null, rawPath: null })
    ).rejects.toMatchObject({ permanent: true });
  });

  it("throws (transient) Error for missing file", async () => {
    const missing = path.join(tmpDir, "missing.txt");
    await expect(
      resolveRawText({ rawText: null, rawPath: missing })
    ).rejects.toThrow(/Failed to read file/);
  });
});
