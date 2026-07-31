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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/live") {
      return handleLive(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
