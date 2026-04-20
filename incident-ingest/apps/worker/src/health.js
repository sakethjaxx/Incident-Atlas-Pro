/**
 * Heartbeat-based liveness probe for the worker process.
 *
 * Writes a small JSON file to HEALTH_FILE_PATH every HEARTBEAT_INTERVAL_MS.
 * Docker / process supervisors can check the file's mtime to detect zombies.
 *
 * Usage: call startHeartbeat() at worker startup, stopHeartbeat() on shutdown.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const HEALTH_FILE_PATH =
  process.env.WORKER_HEALTH_FILE ?? join(os.tmpdir(), "worker-heartbeat.json");

const HEARTBEAT_INTERVAL_MS = 10_000; // 10 s

let _timer = null;

async function writeHeartbeat() {
  try {
    await writeFile(
      HEALTH_FILE_PATH,
      JSON.stringify({ ok: true, ts: new Date().toISOString(), pid: process.pid }),
      "utf-8"
    );
  } catch (err) {
    console.warn("[worker:health] Failed to write heartbeat:", err.message);
  }
}

export function startHeartbeat() {
  writeHeartbeat(); // write immediately on start
  _timer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  _timer.unref(); // don't prevent process exit
  console.log(`[worker:health] Heartbeat writing to ${HEALTH_FILE_PATH} every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
}

export function stopHeartbeat() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

export { HEALTH_FILE_PATH };
