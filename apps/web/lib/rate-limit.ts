import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = createRedis();
const localWindows = new Map<string, number[]>();

function shouldFailOpenRateLimit(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.RATE_LIMIT_FAIL_OPEN === "1";
}

export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<{ allowed: boolean; remaining: number; resetAtMs: number | null }> {
  try {
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetAtMs: result.reset,
    };
  } catch {
    if (shouldFailOpenRateLimit()) {
      if (process.env.NODE_ENV === "production") {
        console.warn("[rate-limit] Redis unavailable - failing open");
      }
      return { allowed: true, remaining: 0, resetAtMs: null };
    }
    console.error("[rate-limit] Redis unavailable - failing closed");
    return { allowed: false, remaining: 0, resetAtMs: null };
  }
}

export function checkLocalRateLimit(input: {
  key: string;
  maxRequests: number;
  windowMs: number;
}): { allowed: boolean; remaining: number; resetAtMs: number | null } {
  const now = Date.now();
  const cutoff = now - input.windowMs;
  const existing = localWindows.get(input.key) ?? [];
  const recent = existing.filter((timestamp) => timestamp > cutoff);
  recent.push(now);
  localWindows.set(input.key, recent);

  const allowed = recent.length <= input.maxRequests;
  const remaining = Math.max(0, input.maxRequests - recent.length);
  const oldestInWindow = recent[0] ?? now;
  const resetAtMs = oldestInWindow + input.windowMs;
  return {
    allowed,
    remaining,
    resetAtMs,
  };
}

export const chatRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "10 m"),
      prefix: "rl:chat",
      analytics: false,
    })
  : null;

export const passcodeRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(5, "5 m"),
      prefix: "rl:passcode",
      analytics: false,
    })
  : null;

export const recommendRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "10 m"),
      prefix: "rl:recommend",
      analytics: false,
    })
  : null;

export const inventoryReadRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, "10 m"),
      prefix: "rl:inventory:read",
      analytics: false,
    })
  : null;

export const inventoryWriteRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(30, "10 m"),
      prefix: "rl:inventory:write",
      analytics: false,
    })
  : null;
