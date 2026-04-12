import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  IS_PRODUCTION,
  UPSTASH_REDIS_REST_TOKEN,
  UPSTASH_REDIS_REST_URL,
} from "@/lib/config";

function createRedis(): Redis {
  return new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  });
}

const redis = createRedis();
const localWindows = new Map<string, number[]>();

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
    if (!IS_PRODUCTION) {
      console.warn(
        "[rate-limit] Redis unavailable in non-production - allowing request",
        { identifier }
      );
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAtMs: null };
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

export const chatRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  prefix: "rl:chat",
  analytics: false,
});

export const passcodeRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(5, "5 m"),
  prefix: "rl:passcode",
  analytics: false,
});

export const recommendRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  prefix: "rl:recommend",
  analytics: false,
});

export const inventoryReadRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(600, "10 m"),
  prefix: "rl:inventory:read",
  analytics: false,
});

export const inventoryIntakeRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(800, "10 m"),
  prefix: "rl:inventory:intake",
  analytics: false,
});

export const inventoryRugWriteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(60, "10 m"),
  prefix: "rl:inventory:rug:write",
  analytics: false,
});
