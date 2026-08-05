// This project deploys as a Cloudflare Worker with static assets (not a
// classic Pages project), so custom routes like /live can't use the
// `functions/` folder convention. This is the actual Worker entry point
// (see "main" in wrangler.jsonc): it handles /live itself and falls back to
// serving the built static site (via the ASSETS binding) for everything else.

const OWNER = "AusRabbit";
const REPO = "SWRPG_The_Emperors_Expendables_Dashboard";
const PATH = "data/live.json";
const CACHE_SECONDS = 10;

async function handleLive(request, env, ctx) {
  const cache = caches.default;
  // Cache key must be unique per deployment — on workers.dev, caches.default
  // is not reliably zone-scoped, so using the same literal key across
  // multiple Workers can cause one Worker to read/overwrite another's
  // cached response. Embedding OWNER/REPO/PATH guarantees no collisions.
  const cacheKey = new Request(`https://internal-cache.local/live-overlay/${OWNER}/${REPO}/${PATH}`, request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const token = env.GITHUB_TOKEN;
  if (!token) {
    return new Response(
      JSON.stringify({ error: "GITHUB_TOKEN not configured on this Worker (Settings > Variables and Secrets)" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let upstream;
  try {
    upstream = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw",
          "User-Agent": "swrpg-live-dashboard-proxy",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Upstream fetch failed: ${err.message}` }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `GitHub API returned ${upstream.status}` }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const body = await upstream.text();
  const response = new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "access-control-allow-origin": "*",
      "x-ratelimit-remaining": upstream.headers.get("x-ratelimit-remaining") || "",
      "x-ratelimit-limit": upstream.headers.get("x-ratelimit-limit") || "",
      "x-proxy-source": "cloudflare-worker",
    },
  });

  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// --- Shared dice roller log -------------------------------------------------
// Ephemeral, separate from the campaign ledger entirely. Backed by a KV
// namespace (binding ROLLS_KV — same "SWRPG Dashboard Dice Roller" namespace
// shared with the Test Game dashboard, just a different key) holding a
// single JSON array (most recent roll first, trimmed to ROLL_LOG_MAX
// entries) under this campaign's key. Players' browsers POST a roll after
// computing it client-side, and everyone viewing the dashboard polls
// GET /rolls every 1.5s, so a roll shows up for the whole table within a
// couple seconds.
//
// This never reads or writes data/live.json or ledger.json — Wounds/Strain/
// Destiny/XP stay entirely under the GM's control via the ledger repo.
// One-time setup required before this works: bind the same KV namespace
// used by the Test Game dashboard to this Worker too (Settings > Bindings >
// Add > KV Namespace, variable name ROLLS_KV), or create a new one and add
// its id to the kv_namespaces block in wrangler.jsonc, then redeploy.

const ROLLS_KEY = "rolls:emperors-expendables";
const ROLL_LOG_MAX = 40;
const CORS_HEADERS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type" };

async function handleRollsGet(request, env) {
  if (!env.ROLLS_KV) {
    return new Response(JSON.stringify({ error: "ROLLS_KV not bound on this Worker yet — see setup note in worker/index.js", rolls: [] }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
    });
  }
  const raw = await env.ROLLS_KV.get(ROLLS_KEY);
  const rolls = raw ? JSON.parse(raw) : [];
  return new Response(JSON.stringify({ rolls }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}

async function handleRollsPost(request, env) {
  if (!env.ROLLS_KV) {
    return new Response(JSON.stringify({ error: "ROLLS_KV not bound on this Worker yet — create a KV namespace and add it to wrangler.jsonc" }), {
      status: 500,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } });
  }

  const entry = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    player: String(body?.player ?? "Unknown").slice(0, 40),
    poolLabel: String(body?.poolLabel ?? "").slice(0, 200),
    netSuccess: Number.isFinite(body?.netSuccess) ? body.netSuccess : 0,
    netAdvantage: Number.isFinite(body?.netAdvantage) ? body.netAdvantage : 0,
    triumph: Number.isFinite(body?.triumph) ? body.triumph : 0,
    despair: Number.isFinite(body?.despair) ? body.despair : 0,
  };

  const raw = await env.ROLLS_KV.get(ROLLS_KEY);
  const rolls = raw ? JSON.parse(raw) : [];
  rolls.unshift(entry);
  await env.ROLLS_KV.put(ROLLS_KEY, JSON.stringify(rolls.slice(0, ROLL_LOG_MAX)));

  return new Response(JSON.stringify({ ok: true, entry }), {
    status: 200,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function handleRollsDelete(request, env) {
  if (!env.ROLLS_KV) {
    return new Response(JSON.stringify({ error: "ROLLS_KV not bound on this Worker yet — create a KV namespace and add it to wrangler.jsonc" }), {
      status: 500,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }
  await env.ROLLS_KV.put(ROLLS_KEY, JSON.stringify([]));
  return new Response(JSON.stringify({ ok: true, rolls: [] }), {
    status: 200,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/live") {
      return handleLive(request, env, ctx);
    }
    if (url.pathname === "/rolls") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (request.method === "GET") return handleRollsGet(request, env);
      if (request.method === "POST") return handleRollsPost(request, env);
      if (request.method === "DELETE") return handleRollsDelete(request, env);
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }
    return env.ASSETS.fetch(request);
  },
};
