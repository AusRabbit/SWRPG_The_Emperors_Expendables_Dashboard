# SWRPG Live Vitals Board

A deliberately tiny, single-purpose companion to the main campaign dashboard.
It shows only **Wounds, Strain, and Destiny** — the numbers that change every
few minutes during a session — and refreshes itself automatically by polling
this repo's `data/live.json` directly through the **GitHub REST API** (not
through raw.githubusercontent.com, which is CDN-cached and can lag).

This only works because this repo is **public**. The GitHub Contents API is
free for public repos, but unauthenticated requests are rate-limited to
**60 requests/hour per client IP**. The app polls every 90 seconds by default
deliberately — that's ~40 requests/hour, leaving headroom for manual refreshes
and multiple players sharing a network. The current rate-limit usage returned
by GitHub is shown at the bottom of the page so you can see it isn't a problem
in practice.

## Updating during a session
Edit `data/live.json` directly on GitHub (click the file → pencil icon → edit
→ commit). No build, no redeploy needed — the page picks up the change on its
next poll (or immediately via the Refresh Now button).

Schema:
```json
{
  "campaign": "string",
  "updated": "ISO 8601 timestamp",
  "characters": [
    {
      "name": "string",
      "wounds": { "current": 0, "threshold": 0 },
      "strain": { "current": 0, "threshold": 0 },
      "destiny": { "light": 0, "dark": 0 }
    }
  ]
}
```

## Local dev
```
npm install
npm run dev
```

## Deploy on Cloudflare Pages
dash.cloudflare.com → Workers & Pages → Create application → Connect GitHub →
select this repo → Framework preset: **Vite** → Build command `npm run build`
→ Output directory `dist` → Deploy.

Every push to `main` (including a `data/live.json` edit) triggers a rebuild,
but you don't actually need a rebuild for data updates — the app fetches
`data/live.json` live from the GitHub API at runtime, not from its own bundle.
Redeploys only matter if you change the code itself.
