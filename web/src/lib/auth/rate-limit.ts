const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_KEY = 5;
const MAX_FAILURES_GLOBAL = 30;

type Attempt = {
  key: string;
  at: number;
};

const failures: Attempt[] = [];

function prune(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (failures.length && failures[0].at < cutoff) failures.shift();
}

function keyFor(username: string, ip: string): string {
  return `${username.toLowerCase()}:${ip}`;
}

export type LoginRateLimit = {
  limited: boolean;
  retryAfterSeconds: number;
};

export function checkLoginRateLimit(username: string, ip: string, now = Date.now()): LoginRateLimit {
  prune(now);
  const key = keyFor(username, ip);
  const keyed = failures.filter((attempt) => attempt.key === key);
  const globalRetryAt = failures[0]?.at ? failures[0].at + WINDOW_MS : now;
  const keyedRetryAt = keyed[0]?.at ? keyed[0].at + WINDOW_MS : now;
  const limited = keyed.length >= MAX_FAILURES_PER_KEY || failures.length >= MAX_FAILURES_GLOBAL;
  const retryAfterSeconds = Math.max(1, Math.ceil((Math.max(globalRetryAt, keyedRetryAt) - now) / 1000));
  return { limited, retryAfterSeconds };
}

export function recordFailedLogin(username: string, ip: string, now = Date.now()): void {
  prune(now);
  failures.push({ key: keyFor(username, ip), at: now });
}

export function recordSuccessfulLogin(username: string, ip: string, now = Date.now()): void {
  prune(now);
  const key = keyFor(username, ip);
  for (let i = failures.length - 1; i >= 0; i -= 1) {
    if (failures[i]?.key === key) failures.splice(i, 1);
  }
}

