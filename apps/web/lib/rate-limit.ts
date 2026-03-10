import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = createRedis();

export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const result = await limiter.limit(identifier);
    return { allowed: result.success, remaining: result.remaining };
  } catch {
    if (process.env.NODE_ENV === "production") {
      console.warn("[rate-limit] Redis unavailable - failing open");
    }
    return { allowed: true, remaining: 0 };
  }
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
