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

// --- Shared dice roller log (Durable Object) --------------------------------
// Ephemeral, separate from the campaign ledger entirely. Previously backed by
// a KV namespace, which had two real problems in play: KV writes here were a
// non-atomic read-modify-write (GET the whole array, mutate in JS, PUT the
// whole array back), so two rolls posted within the same second or two could
// race — whichever PUT landed second silently overwrote the first, no merge,
// so one roll would just vanish. And KV reads are only *eventually*
// consistent across Cloudflare's edge, so a fresh roll could take anywhere
// up to ~60-120s to show up for someone polling from a different colo.
//
// A Durable Object fixes both. Every request for a given DO id is routed to
// one specific instance, and that instance handles requests strictly one at
// a time — true serialization, so the unshift/trim/persist below can never
// interleave with another POST the way the KV version's read-modify-write
// could. Its storage is also strongly consistent: a write is visible on the
// very next read, anywhere, with no propagation delay. We always route to
// one fixed instance (idFromName below), so there's exactly one
// always-current copy of the log, not a per-colo cache of it.
//
// Players' browsers still POST a roll after computing it client-side, and
// everyone viewing the dashboard still polls GET /rolls every 1.5s — the
// client-facing API is unchanged, only the storage underneath it.
//
// This never reads or writes data/live.json or ledger.json — Wounds/Strain/
// Destiny/XP stay entirely under the GM's control via the ledger repo.
//
// Setup: the RollLog class below is declared in the `migrations` block of
// wrangler.jsonc using `new_sqlite_classes`, which provisions it on Durable
// Objects' SQLite storage backend — available on the Workers Free plan
// (the older KV-backed Durable Object storage needs Workers Paid). No KV
// namespace is required for this anymore; the old ROLLS_KV binding can be
// removed once this is deployed and confirmed working.

const ROLL_LOG_MAX = 40;
const CORS_HEADERS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type" };
// Dice pool breakdown (per die type, e.g. { proficiency: 2, difficulty: 3,
// setback: 2, ... }) — stored alongside the summarised result so the shared
// log can render the actual pool as icons, not just the outcome. Sanitized
// to known die-type keys, non-negative integers, capped at a sane per-die
// maximum so a malformed/malicious body can't bloat a stored entry.
const POOL_KEYS = ["proficiency", "ability", "boost", "challenge", "difficulty", "setback", "force"];

export class RollLog {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.rolls = [];
    // Hydrate from durable storage once, before this instance handles its
    // first request. blockConcurrencyWhile holds off every incoming request
    // until the callback resolves, so nothing can observe a half-loaded
    // this.rolls.
    this.ctx.blockConcurrencyWhile(async () => {
      this.rolls = (await this.ctx.storage.get("rolls")) || [];
    });
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({ rolls: this.rolls }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
      });
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } });
      }

      const pool = {};
      POOL_KEYS.forEach((key) => {
        const n = Number(body?.pool?.[key]);
        pool[key] = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : 0;
      });

      const entry = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        player: String(body?.player ?? "Unknown").slice(0, 40),
        poolLabel: String(body?.poolLabel ?? "").slice(0, 200),
        pool,
        netSuccess: Number.isFinite(body?.netSuccess) ? body.netSuccess : 0,
        netAdvantage: Number.isFinite(body?.netAdvantage) ? body.netAdvantage : 0,
        triumph: Number.isFinite(body?.triumph) ? body.triumph : 0,
        despair: Number.isFinite(body?.despair) ? body.despair : 0,
      };

      // A Durable Object instance processes one request to completion before
      // starting the next, so this read-modify-write is safe from the race
      // that affected the KV version — no other POST can interleave here.
      this.rolls.unshift(entry);
      this.rolls = this.rolls.slice(0, ROLL_LOG_MAX);
      await this.ctx.storage.put("rolls", this.rolls);

      return new Response(JSON.stringify({ ok: true, entry }), {
        status: 200,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
      });
    }

    if (request.method === "DELETE") {
      this.rolls = [];
      await this.ctx.storage.put("rolls", []);
      return new Response(JSON.stringify({ ok: true, rolls: [] }), {
        status: 200,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/live") {
      return handleLive(request, env, ctx);
    }
    if (url.pathname === "/rolls") {
      if (!env.ROLL_LOG) {
        return new Response(JSON.stringify({ error: "ROLL_LOG Durable Object not bound on this Worker yet — see setup note in worker/index.js", rolls: [] }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
        });
      }
      // Fixed name -> always the same single DO instance, so the whole
      // campaign shares exactly one authoritative roll log.
      const id = env.ROLL_LOG.idFromName("shared-roll-log");
      const stub = env.ROLL_LOG.get(id);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
