/**
 * Shared Redis connection factory.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the ioredis connection so it
 * never throws "Command timed out" errors on blocking calls (BRPOP / XREAD).
 *
 * This module is imported by BOTH the API (to create/add jobs to the Queue)
 * and the worker (to process jobs).  It reads REDIS_URL from the environment
 * so both processes can configure it via their own .env file.
 */

import "dotenv/config";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Parse a redis:// URL into the ioredis options object expected by BullMQ.
 * Supports: redis://[user:pass@]host[:port][/db]
 *
 * @param {string} url
 * @returns {import('ioredis').RedisOptions}
 */
export function parseRedisUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  };
}

export const redisConnection = parseRedisUrl(redisUrl);

/** The name of the parse queue shared between API and worker. */
export const PARSE_QUEUE_NAME = "parse";
