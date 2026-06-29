import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MIN_RESPONSE_MS = 800;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function finish(startedAt: number, status: number, body: unknown, extraHeaders = {}) {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await sleep(remaining);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, ...extraHeaders },
  });
}

function clientIp(req: Request) {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direct) return direct.slice(0, 128);
  const forwarded = req.headers.get("x-forwarded-for") || "unknown";
  const parts = forwarded.split(",");
  return (parts[parts.length - 1] || "unknown").trim().slice(0, 128);
}

async function bucketHash(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function serviceRpc(name: string, body: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function consumeLimit(hash: string, maxAttempts: number) {
  const response = await serviceRpc("consume_username_login_attempt", {
    p_bucket_hash: hash,
    p_max_attempts: maxAttempts,
    p_window_seconds: 600,
    p_block_seconds: 900,
  });
  if (!response.ok) throw new Error(`rate-limit service failed (${response.status})`);
  return (await response.json()) === true;
}

async function userIdForUsername(username: string) {
  const response = await serviceRpc("user_id_for_login_username", { p_username: username });
  if (!response.ok) throw new Error(`username service failed (${response.status})`);
  const value = await response.json();
  return typeof value === "string" && value ? value : null;
}

async function emailForUserId(userId: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) throw new Error(`auth lookup failed (${response.status})`);
  const user = await response.json();
  return typeof user?.email === "string" && user.email ? user.email : null;
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const invalid = () => finish(startedAt, 400, { message: "Invalid username or password." });

  if (req.method !== "POST") {
    return finish(startedAt, 405, { message: "Method not allowed." }, { Allow: "POST" });
  }

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return finish(startedAt, 503, { message: "Nulqor sign-in is temporarily unavailable." });
  }

  if (req.headers.get("x-nulqor-client") !== "forge-studio") {
    return finish(startedAt, 400, { message: "Invalid client." });
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 4096) {
    return finish(startedAt, 413, { message: "Request is too large." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return finish(startedAt, 400, { message: "Invalid request." });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!USERNAME_RE.test(username) || password.length < 1 || password.length > 1024) {
    return invalid();
  }

  try {
    const ip = clientIp(req);
    const normalizedUsername = username.toLowerCase();
    const [ipHash, identityHash] = await Promise.all([
      bucketHash(`ip:${ip}`),
      bucketHash(`identity:${ip}\u0000${normalizedUsername}`),
    ]);
    const [ipAllowed, identityAllowed] = await Promise.all([
      consumeLimit(ipHash, 25),
      consumeLimit(identityHash, 6),
    ]);

    if (!ipAllowed || !identityAllowed) {
      return finish(
        startedAt,
        429,
        { message: "Too many sign-in attempts. Try again later." },
        { "Retry-After": "900" },
      );
    }

    const userId = await userIdForUsername(normalizedUsername);
    if (!userId) return invalid();

    const email = await emailForUserId(userId);
    if (!email) return invalid();

    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    const authData = await authResponse.json().catch(() => null);
    if (!authResponse.ok || !authData?.access_token || !authData?.user?.id) return invalid();

    return finish(startedAt, 200, authData);
  } catch (error) {
    console.error(
      "[username-login] request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return finish(startedAt, 503, { message: "Nulqor sign-in is temporarily unavailable." });
  }
});
