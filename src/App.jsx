import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Full character/party dashboard (static, bundled ledger.json), with
// Wounds / Strain / Destiny overlaid live via this site's own /live proxy
// (a Cloudflare Worker route — see worker/index.js). The proxy fetches
// data/live.json from this repo using an authenticated GitHub token
// (5,000 req/hour) and edge-caches for 10s, so the browser never hits
// GitHub's 60/hour unauthenticated limit directly, no matter how many
// viewers or tabs are open. Poll interval matches the cache TTL.
//
// Matching: each ledger character can carry an optional "liveId" field.
// If it matches a key in the live board's wounds/strain maps, that
// character's current Wounds/Strain are overridden with the live value.
// Destiny is party-wide: if the live fetch succeeds, its destiny value
// replaces every character's destiny uniformly.
//
// If the live fetch fails or a character has no liveId, everything falls
// back to the static ledger.json values — the page never breaks, it just
// stops being "live" for that piece of data.
// ---------------------------------------------------------------------------
const LIVE_POLL_MS = 10_000;

const DEMO_LEDGER = {
  campaign: "Ghosts in Hyperspace",
  characters: [
    {
      name: "Kessa Vantar",
      liveId: null,
      career: "Smuggler — Pilot",
      species: "Twi'lek",
      updated: "2026-07-29T14:20:00Z",
      vitals: {
        wounds: { current: 6, threshold: 14 },
        strain: { current: 9, threshold: 12 },
        soak: 4,
        criticalInjuries: [],
      },
      destiny: { light: 2, dark: 1 },
      xp: { available: 8, total: 45 },
      credits: 1350,
      inventory: [{ name: "Heavy Blaster Pistol", note: "Mod: +1 crit rating" }],
      motivationObligation: {
        motivation: "Freedom — flying her own ship, on her own terms",
        obligation: { type: "Debt", value: 15, note: "Owed to Hylo Bassiro" },
      },
      characteristics: { brawn: 2, agility: 4, intellect: 2, cunning: 3, willpower: 2, presence: 3 },
      skills: [{ name: "Piloting: Space", rank: 3, career: true }],
      talents: [{ name: "Skilled Jockey", rank: 2, tier: 2, description: "Add Boost per rank to Piloting checks." }],
      weapons: [{ name: "Heavy Blaster Pistol", skill: "Ranged: Light", damage: 7, crit: 3, range: "Medium", special: "—" }],
      armor: { name: "Armored Flight Suit", soakBonus: 1, defenseBonus: 0 },
    },
  ],
};

const SAMPLE_SCHEMA = `{
  "campaign": "string",
  "characters": [
    {
      "name": "string", "liveId": "string (optional, matches live.json key)",
      "career": "string", "species": "string",
      "updated": "ISO 8601 timestamp",
      "vitals": {
        "wounds": { "current": 0, "threshold": 0 },
        "strain": { "current": 0, "threshold": 0 },
        "soak": 0,
        "criticalInjuries": ["string", "..."]
      },
      "destiny": { "light": 0, "dark": 0 },
      "xp": { "available": 0, "total": 0 },
      "credits": 0,
      "inventory": [{ "name": "string", "note": "string (optional)" }],
      "motivationObligation": {
        "motivation": "string",
        "obligation": { "type": "string", "value": 0, "note": "string" }
      },
      "characteristics": { "brawn": 0, "agility": 0, "intellect": 0, "cunning": 0, "willpower": 0, "presence": 0 },
      "skills": [{ "name": "string", "rank": 0, "career": true }],
      "talents": [{ "name": "string", "rank": 0, "tier": 1, "description": "string (effect/rules text, optional)" }],
      "weapons": [{ "name": "string", "skill": "string", "damage": 0, "crit": 0, "range": "string", "special": "string" }],
      "armor": { "name": "string", "soakBonus": 0, "defenseBonus": 0 }
    }
  ]
}`;

// ---------------------------------------------------------------------------

const FULL_SKILL_LIST = [
  { name: "Astrogation", char: "intellect", group: "General" },
  { name: "Athletics", char: "brawn", group: "General" },
  { name: "Charm", char: "presence", group: "General" },
  { name: "Coercion", char: "willpower", group: "General" },
  { name: "Computers", char: "intellect", group: "General" },
  { name: "Cool", char: "presence", group: "General" },
  { name: "Coordination", char: "agility", group: "General" },
  { name: "Deception", char: "cunning", group: "General" },
  { name: "Discipline", char: "willpower", group: "General" },
  { name: "Leadership", char: "presence", group: "General" },
  { name: "Mechanics", char: "intellect", group: "General" },
  { name: "Medicine", char: "intellect", group: "General" },
  { name: "Negotiation", char: "presence", group: "General" },
  { name: "Perception", char: "cunning", group: "General" },
  { name: "Piloting: Planetary", char: "agility", group: "General" },
  { name: "Piloting: Space", char: "agility", group: "General" },
  { name: "Resilience", char: "brawn", group: "General" },
  { name: "Skulduggery", char: "cunning", group: "General" },
  { name: "Stealth", char: "agility", group: "General" },
  { name: "Streetwise", char: "cunning", group: "General" },
  { name: "Survival", char: "cunning", group: "General" },
  { name: "Vigilance", char: "willpower", group: "General" },
  { name: "Brawl", char: "brawn", group: "Combat" },
  { name: "Gunnery", char: "agility", group: "Combat" },
  { name: "Lightsaber", char: "brawn", group: "Combat" },
  { name: "Melee", char: "brawn", group: "Combat" },
  { name: "Ranged: Light", char: "agility", group: "Combat" },
  { name: "Ranged: Heavy", char: "agility", group: "Combat" },
  { name: "Knowledge: Core Worlds", char: "intellect", group: "Knowledge" },
  { name: "Knowledge: Education", char: "intellect", group: "Knowledge" },
  { name: "Knowledge: Lore", char: "intellect", group: "Knowledge" },
  { name: "Knowledge: Outer Rim", char: "intellect", group: "Knowledge" },
  { name: "Knowledge: Underworld", char: "intellect", group: "Knowledge" },
  { name: "Knowledge: Warfare", char: "intellect", group: "Knowledge" },
  { name: "Knowledge: Xenology", char: "intellect", group: "Knowledge" },
];

function normalizeSkillName(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}

function buildSkills(character) {
  const chars = character?.characteristics || {};
  const rawSkills = character?.skills || [];
  const skillMap = new Map(rawSkills.map((s) => [normalizeSkillName(s.name), s]));
  return FULL_SKILL_LIST.map((canon) => {
    const match = skillMap.get(normalizeSkillName(canon.name));
    return {
      name: canon.name,
      group: canon.group,
      char: canon.char,
      rank: match?.rank ?? 0,
      career: match?.career ?? false,
      characteristic: chars[canon.char] ?? 0,
    };
  });
}

function PipRow({ current, threshold, colorClass, size = "normal" }) {
  const pips = Array.from({ length: threshold }, (_, i) => i < current);
  const dim = size === "small" ? "w-3 h-3" : "w-4 h-4";
  return (
    <div className="flex flex-wrap gap-1.5">
      {pips.map((filled, i) => (
        <span
          key={i}
          className={`${dim} border transition-colors duration-300`}
          style={{
            borderColor: filled ? colorClass : "#3a3f42",
            background: filled ? colorClass : "transparent",
            boxShadow: filled ? `0 0 6px ${colorClass}99` : "none",
          }}
        />
      ))}
    </div>
  );
}

function SkillPips({ rank, characteristic }) {
  const total = Math.max(rank, characteristic);
  const yellow = Math.min(rank, characteristic);
  if (total === 0) return <span className="text-[11px]" style={{ color: "#3a3f42" }}>—</span>;
  return (
    <span className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="w-2.5 h-2.5 border"
          style={{
            borderColor: i < yellow ? "#f5c518" : "#6fae60",
            background: i < yellow ? "#f5c518" : "#6fae60",
            boxShadow: i < yellow ? "0 0 4px #f5c51899" : "0 0 4px #6fae6099",
          }}
        />
      ))}
    </span>
  );
}

function Stat({ label, live, children }) {
  return (
    <div className="mb-4">
      <div
        className="text-[11px] tracking-[0.2em] uppercase mb-1.5 flex items-center gap-1.5"
        style={{ color: "#8a8f93", fontFamily: "'Rajdhani', sans-serif" }}
      >
        {label}
        {live && (
          <span
            className="w-1.5 h-1.5 rounded-full inline-block"
            style={{ background: "#6fae60", boxShadow: "0 0 4px #6fae6099" }}
            title="Live-updated"
          />
        )}
      </div>
      {children}
    </div>
  );
}

function severityColor(current, threshold) {
  if (!threshold) return "#e7e2d2";
  const pct = current / threshold;
  if (pct > 0.75) return "#c23b3b";
  if (pct > 0.5) return "#ffb000";
  return "#e7e2d2";
}

function applyLiveOverlay(character, live) {
  const liveId = character.liveId;
  const hasLive = !!live && live.status === "ok";
  const w = hasLive && liveId && live.wounds && live.wounds[liveId] != null ? live.wounds[liveId] : null;
  const s = hasLive && liveId && live.strain && live.strain[liveId] != null ? live.strain[liveId] : null;
  const d = hasLive && live.destiny ? live.destiny : null;

  const vitals = character.vitals || {};
  const staticWounds = vitals.wounds || { current: 0, threshold: 0 };
  const staticStrain = vitals.strain || { current: 0, threshold: 0 };
  const staticDestiny = character.destiny || { light: 0, dark: 0 };

  return {
    wounds: { current: w != null ? w : staticWounds.current, threshold: staticWounds.threshold },
    strain: { current: s != null ? s : staticStrain.current, threshold: staticStrain.threshold },
    destiny: d || staticDestiny,
    woundsLive: w != null,
    strainLive: s != null,
    destinyLive: !!d,
  };
}

export default function CampaignDashboard() {
  const [ledger, setLedger] = useState(DEMO_LEDGER);
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewMode, setViewMode] = useState("character");
  const [tab, setTab] = useState("overview");
  const [booted, setBooted] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [loadState, setLoadState] = useState({ status: "idle", msg: "" });
  const bootTimer = useRef(null);

  const [live, setLive] = useState({ status: "idle" });
  const [rateLimit, setRateLimit] = useState(null);
  const [secondsToNext, setSecondsToNext] = useState(LIVE_POLL_MS / 1000);
  const liveTimer = useRef(null);
  const countdownTimer = useRef(null);

  useEffect(() => {
    bootTimer.current = setTimeout(() => setBooted(true), 650);
    fetch("/data/ledger.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((data) => {
        setLedger(data);
        setActiveIdx(0);
        setLoadState({ status: "ok", msg: "Loaded /data/ledger.json" });
      })
      .catch(() => {
        setLoadState({ status: "idle", msg: "" });
      });
    return () => clearTimeout(bootTimer.current);
  }, []);

  const fetchLiveOverlay = async () => {
    try {
      const url = `/live?_=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      const remaining = res.headers.get("x-ratelimit-remaining");
      const limit = res.headers.get("x-ratelimit-limit");
      if (remaining != null) setRateLimit({ remaining: Number(remaining), limit: Number(limit) });

      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      const parsed = JSON.parse(text);
      setLive({ status: "ok", ...parsed, fetchedAt: new Date() });
    } catch (err) {
      setLive((prev) => ({ ...prev, status: "error", errorMsg: err.message }));
    }
    setSecondsToNext(LIVE_POLL_MS / 1000);
  };

  useEffect(() => {
    fetchLiveOverlay();
    liveTimer.current = setInterval(fetchLiveOverlay, LIVE_POLL_MS);
    countdownTimer.current = setInterval(() => {
      setSecondsToNext((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      clearInterval(liveTimer.current);
      clearInterval(countdownTimer.current);
    };
  }, []);

  function reload() {
    setLoadState({ status: "loading", msg: "" });
    fetch(`/data/ledger.json?t=${Date.now()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((data) => {
        setLedger(data);
        setActiveIdx(0);
        setLoadState({ status: "ok", msg: "Reloaded." });
        setBooted(false);
        setTimeout(() => setBooted(true), 500);
      })
      .catch((err) => setLoadState({ status: "error", msg: `Could not reload — ${err.message}` }));
    fetchLiveOverlay();
  }

  function handlePasteLoad() {
    try {
      const data = JSON.parse(pasteText);
      setLedger(data);
      setActiveIdx(0);
      setLoadState({ status: "ok", msg: "Ledger parsed." });
      setBooted(false);
      setTimeout(() => setBooted(true), 500);
    } catch (err) {
      setLoadState({ status: "error", msg: `Invalid JSON — ${err.message}` });
    }
  }

  const party = ledger.characters || [];
  const active = party[activeIdx] || {};
  const overlay = applyLiveOverlay(active, live);

  const v = active.vitals || {};
  const wounds = overlay.wounds;
  const strain = overlay.strain;
  const destiny = overlay.destiny;
  const xp = active.xp || { available: 0, total: 0 };
  const crits = v.criticalInjuries || [];
  const inv = active.inventory || [];
  const mo = active.motivationObligation || {};
  const obligation = mo.obligation || {};
  const chars = active.characteristics || {};
  const skills = buildSkills(active);
  const talents = [...(active.talents || [])].sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99));
  const weapons = active.weapons || [];
  const armor = active.armor || {};

  const CHAR_LABELS = [
    ["brawn", "BR"], ["agility", "AG"], ["intellect", "INT"],
    ["cunning", "CUN"], ["willpower", "WIL"], ["presence", "PR"],
  ];

  const partySkillSets = party.map((p) => buildSkills(p));
  const partySkillNames = FULL_SKILL_LIST.filter((canon) =>
    partySkillSets.some((set) => (set.find((s) => s.name === canon.name)?.rank ?? 0) > 0)
  );
  const partyOverlays = party.map((p) => applyLiveOverlay(p, live));
  const partyDestiny = partyOverlays.find((o) => o.destinyLive)?.destiny || party[0]?.destiny || { light: 0, dark: 0 };
  const anyLive = live.status === "ok";

  return (
    <div
      className="min-h-screen w-full flex items-start justify-center p-4 sm:p-8"
      style={{ background: "radial-gradient(circle at 50% 0%, #1b1f22 0%, #101315 70%)", fontFamily: "'JetBrains Mono', monospace" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
        @keyframes scan { 0% { transform: translateY(-100%); opacity: 0.9; } 100% { transform: translateY(2200%); opacity: 0; } }
        @keyframes flicker { 0%,100% { opacity: 1; } 92% { opacity: 1; } 93% { opacity: 0.4; } 94% { opacity: 1; } }
        @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        .boot-scan { position: absolute; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, transparent, #5ec8d8, transparent); animation: scan 0.65s ease-out forwards; pointer-events: none; }
        .flicker-in { animation: flicker 1.4s ease-out; }
        .mono-num { font-variant-numeric: tabular-nums; }
        .live-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
      `}</style>

      <div className="w-full max-w-3xl">
        <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full inline-block live-dot"
              style={{ background: anyLive ? "#6fae60" : "#c23b3b" }}
              title={anyLive ? "Live overlay connected" : "Live overlay unavailable — showing static ledger data"}
            />
            <span className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "#5ec8d8", fontFamily: "'Rajdhani', sans-serif" }}>
              {ledger.campaign || "Untitled Campaign"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reload}
              className="text-[11px] tracking-[0.15em] uppercase px-3 py-1.5 border transition-colors"
              style={{ color: "#8a8f93", borderColor: "#3a3f42", fontFamily: "'Rajdhani', sans-serif" }}
            >
              Reload ↻
            </button>
            <button
              onClick={() => setShowSource((s) => !s)}
              className="text-[11px] tracking-[0.15em] uppercase px-3 py-1.5 border transition-colors"
              style={{ color: "#8a8f93", borderColor: "#3a3f42", fontFamily: "'Rajdhani', sans-serif" }}
            >
              {showSource ? "Hide test data ▲" : "Test data ▼"}
            </button>
          </div>
        </div>

        {party.length > 0 && (
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {party.map((p, i) => (
              <button
                key={i}
                onClick={() => { setActiveIdx(i); setViewMode("character"); }}
                className="text-[12px] tracking-wide px-3 py-1.5 border transition-colors"
                style={{
                  color: viewMode === "character" && activeIdx === i ? "#101315" : "#e7e2d2",
                  background: viewMode === "character" && activeIdx === i ? "#5ec8d8" : "transparent",
                  borderColor: viewMode === "character" && activeIdx === i ? "#5ec8d8" : "#3a3f42",
                  fontFamily: "'Rajdhani', sans-serif", fontWeight: 600,
                }}
              >
                {p.name || `Character ${i + 1}`}
              </button>
            ))}
            {party.length > 1 && (
              <button
                onClick={() => setViewMode("party")}
                className="text-[12px] tracking-wide px-3 py-1.5 border transition-colors"
                style={{
                  color: viewMode === "party" ? "#101315" : "#e7e2d2",
                  background: viewMode === "party" ? "#ffb000" : "transparent",
                  borderColor: viewMode === "party" ? "#ffb000" : "#3a3f42",
                  fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
                }}
              >
                ⚔ Party View
              </button>
            )}
          </div>
        )}

        {showSource && (
          <div className="mb-4 p-4 border text-sm" style={{ borderColor: "#3a3f42", background: "#16191b" }}>
            <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#8a8f93" }}>
              Loads <code style={{ color: "#e7e2d2" }}>/data/ledger.json</code> at build time, and polls this site's own{" "}
              <code style={{ color: "#e7e2d2" }}>/live</code> route every 10s for live Wounds/Strain/Destiny — a Cloudflare
              Worker that fetches GitHub with an authenticated token server-side, so this browser never talks to GitHub directly.
              Live status: <span style={{ color: anyLive ? "#6fae60" : "#c23b3b" }}>{anyLive ? "connected" : (live.errorMsg || "not yet connected")}</span>.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={SAMPLE_SCHEMA}
              rows={8}
              className="w-full bg-transparent border px-2 py-1.5 text-[12px]"
              style={{ borderColor: "#3a3f42", color: "#e7e2d2" }}
            />
            <button
              onClick={handlePasteLoad}
              className="mt-2 text-[11px] tracking-wide uppercase px-3 py-1.5"
              style={{ background: "#ffb000", color: "#101315", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
            >
              Parse & load
            </button>
            {loadState.msg && (
              <p className="mt-2 text-[12px]" style={{ color: loadState.status === "error" ? "#c23b3b" : "#5ec8d8" }}>
                {loadState.msg}
              </p>
            )}
          </div>
        )}

        {viewMode === "party" ? (
          <div className="relative overflow-hidden border" style={{ borderColor: "#3a3f42", background: "#16191b", boxShadow: "0 0 30px rgba(255,176,0,0.06)" }}>
            <div className="p-5 sm:p-7">
              <div className="text-[11px] tracking-[0.25em] uppercase mb-1" style={{ color: "#ffb000" }}>
                PARTY SKILL COMPARISON
              </div>
              <h1 className="text-2xl sm:text-3xl uppercase tracking-wide mb-4" style={{ color: "#e7e2d2", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
                {ledger.campaign || "The Party"}
              </h1>

              <div className="border p-3 mb-4 flex items-center gap-6 flex-wrap" style={{ borderColor: "#ffb00055", background: "#ffb00009" }}>
                <div className="text-[11px] tracking-[0.2em] uppercase flex items-center gap-1.5" style={{ color: "#ffb000" }}>
                  Party Destiny Pool
                  {partyOverlays.some((o) => o.destinyLive) && (
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#6fae60" }} />
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <PipRow current={partyDestiny.light} threshold={partyDestiny.light} colorClass="#8fd3f4" />
                  <span className="text-[11px]" style={{ color: "#8a8f93" }}>light</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <PipRow current={partyDestiny.dark} threshold={partyDestiny.dark} colorClass="#c23b3b" />
                  <span className="text-[11px]" style={{ color: "#8a8f93" }}>dark</span>
                </div>
              </div>

              <div className="flex items-center gap-4 mb-4 text-[11px]" style={{ color: "#8a8f93" }}>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 inline-block" style={{ background: "#f5c518" }} /> proficiency dice
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 inline-block" style={{ background: "#6fae60" }} /> ability dice
                </span>
                <span style={{ color: "#5ec8d8" }}>career skill</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[12px]" style={{ color: "#e7e2d2", minWidth: `${280 + party.length * 110}px` }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2a2e31" }}>
                      <th className="text-left font-normal pb-2" style={{ color: "#5a5f62" }}>Skill</th>
                      {party.map((p, i) => (
                        <th key={i} className="text-left font-normal pb-2 px-2" style={{ color: "#8a8f93", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
                          {p.name || `Character ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="pt-2 pb-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Wounds</td>
                      {partyOverlays.map((o, i) => (
                        <td key={i} className="pt-2 pb-1 px-2 mono-num" style={{ color: severityColor(o.wounds.current, o.wounds.threshold) }}>
                          {o.wounds.current} / {o.wounds.threshold}{o.woundsLive && <span className="ml-1" style={{ color: "#6fae60" }}>●</span>}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Strain</td>
                      {partyOverlays.map((o, i) => (
                        <td key={i} className="py-1 px-2 mono-num" style={{ color: severityColor(o.strain.current, o.strain.threshold) }}>
                          {o.strain.current} / {o.strain.threshold}{o.strainLive && <span className="ml-1" style={{ color: "#6fae60" }}>●</span>}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Soak</td>
                      {party.map((p, i) => (
                        <td key={i} className="py-1 px-2 mono-num" style={{ color: "#e7e2d2" }}>{p.vitals?.soak ?? "—"}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Defense</td>
                      {party.map((p, i) => (
                        <td key={i} className="py-1 px-2 mono-num" style={{ color: "#e7e2d2" }}>{p.armor?.defenseBonus ?? 0}</td>
                      ))}
                    </tr>
                    <tr style={{ borderBottom: "1px solid #2a2e31" }}>
                      <td className="py-1 pb-2 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Critical Injuries</td>
                      {party.map((p, i) => {
                        const n = (p.vitals?.criticalInjuries || []).length;
                        return (
                          <td key={i} className="py-1 pb-2 px-2">
                            {n === 0 ? (
                              <span style={{ color: "#3a3f42" }}>—</span>
                            ) : (
                              <span className="flex items-center gap-1">
                                {Array.from({ length: Math.min(n, 5) }, (_, k) => (
                                  <span key={k} className="w-2 h-2 inline-block" style={{ background: "#c23b3b" }} />
                                ))}
                                {n > 5 && <span className="text-[10px] mono-num" style={{ color: "#c23b3b" }}>+{n - 5}</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {["General", "Combat", "Knowledge"].map((group) => {
                      const rows = partySkillNames.filter((s) => s.group === group);
                      if (rows.length === 0) return null;
                      return (
                        <>
                          <tr key={`${group}-header`}>
                            <td colSpan={party.length + 1} className="pt-3 pb-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>
                              {group}
                            </td>
                          </tr>
                          {rows.map((skillDef, i) => (
                            <tr key={i} style={{ borderTop: "1px solid #2a2e31" }}>
                              <td className="py-1.5 pr-3">{skillDef.name}</td>
                              {partySkillSets.map((set, ci) => {
                                const s = set.find((x) => x.name === skillDef.name);
                                return (
                                  <td key={ci} className="py-1.5 px-2">
                                    <SkillPips rank={s?.rank ?? 0} characteristic={s?.characteristic ?? 0} />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </>
                      );
                    })}
                    <tr style={{ borderTop: "1px solid #2a2e31" }}>
                      <td className="pt-3 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Unspent XP</td>
                      {party.map((p, i) => (
                        <td key={i} className="pt-3 px-2 mono-num" style={{ color: "#e7e2d2" }}>{p.xp?.available ?? 0}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
        <div
          className="relative overflow-hidden border"
          style={{ borderColor: "#3a3f42", background: "#16191b", boxShadow: "0 0 30px rgba(94,200,216,0.06)" }}
        >
          {!booted && <div className="boot-scan" />}

          <div className={`p-5 sm:p-7 ${booted ? "flicker-in" : ""}`}>
            <div className="flex items-start justify-between border-b pb-4 mb-5" style={{ borderColor: "#2a2e31" }}>
              <div>
                <div className="text-[11px] tracking-[0.25em] uppercase mb-1" style={{ color: "#5ec8d8" }}>PERSONNEL FILE</div>
                <h1 className="text-2xl sm:text-3xl uppercase tracking-wide" style={{ color: "#e7e2d2", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
                  {active.name || "Unknown"}
                </h1>
                <div className="text-[13px] mt-0.5" style={{ color: "#8a8f93" }}>
                  {active.career || "—"} {active.species ? `· ${active.species}` : ""}
                </div>
              </div>
              <div className="text-right text-[11px]" style={{ color: "#5a5f62" }}>
                <div>LAST UPDATE</div>
                <div className="mono-num" style={{ color: "#8a8f93" }}>
                  {active.updated ? new Date(active.updated).toLocaleString() : "—"}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mb-5">
              {[["overview", "Overview"], ["sheet", "Character Sheet"]].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className="text-[11px] tracking-[0.15em] uppercase px-4 py-2 border transition-colors"
                  style={{
                    color: tab === key ? "#101315" : "#8a8f93",
                    background: tab === key ? "#5ec8d8" : "transparent",
                    borderColor: tab === key ? "#5ec8d8" : "#3a3f42",
                    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <>
                <div className="grid sm:grid-cols-2 gap-x-8">
                  <div>
                    <Stat label={`Wounds — ${wounds.current} / ${wounds.threshold}`} live={overlay.woundsLive}>
                      <PipRow current={wounds.current} threshold={wounds.threshold} colorClass="#c23b3b" />
                    </Stat>
                    <Stat label={`Strain — ${strain.current} / ${strain.threshold}`} live={overlay.strainLive}>
                      <PipRow current={strain.current} threshold={strain.threshold} colorClass="#ffb000" />
                    </Stat>
                    <Stat label="Soak">
                      <span className="text-xl mono-num" style={{ color: "#e7e2d2" }}>{v.soak ?? "—"}</span>
                    </Stat>
                  </div>
                  <div>
                    <Stat label="Destiny Pool (party)" live={overlay.destinyLive}>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <PipRow current={destiny.light} threshold={destiny.light} colorClass="#8fd3f4" size="small" />
                          <span className="text-[11px]" style={{ color: "#8a8f93" }}>light</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <PipRow current={destiny.dark} threshold={destiny.dark} colorClass="#c23b3b" size="small" />
                          <span className="text-[11px]" style={{ color: "#8a8f93" }}>dark</span>
                        </div>
                      </div>
                    </Stat>
                    <Stat label="Experience — unspent">
                      <span className="text-xl mono-num" style={{ color: "#e7e2d2" }}>{xp.available}</span>
                    </Stat>
                    <Stat label="Credits">
                      <span className="text-xl mono-num" style={{ color: "#ffb000" }}>{(active.credits ?? 0).toLocaleString()}</span>
                    </Stat>
                  </div>
                </div>

                {crits.length > 0 && (
                  <div className="mt-2 mb-5 p-3 border" style={{ borderColor: "#c23b3b44", background: "#c23b3b11" }}>
                    <div className="text-[11px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#c23b3b" }}>Critical Injuries</div>
                    <ul className="text-[13px] space-y-1" style={{ color: "#e7e2d2" }}>
                      {crits.map((crit, i) => <li key={i}>▸ {crit}</li>)}
                    </ul>
                  </div>
                )}

                <div className="pt-4 border-t" style={{ borderColor: "#2a2e31" }}>
                  <div className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{ color: "#8a8f93" }}>Gear &amp; Inventory</div>
                  <div className="space-y-2">
                    {inv.length === 0 && <span className="text-[13px]" style={{ color: "#5a5f62" }}>No items recorded.</span>}
                    {inv.map((item, i) => (
                      <div key={i} className="text-[13px] pb-2" style={{ borderBottom: i < inv.length - 1 ? "1px solid #2a2e31" : "none" }}>
                        <div style={{ color: "#e7e2d2" }}>{item.name}</div>
                        {item.note && <div style={{ color: "#5ec8d8" }} className="text-[12px] mt-0.5">{item.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === "sheet" && (
              <>
                {(mo.motivation || obligation.type) && (
                  <div className="space-y-3 mb-5 pb-5 border-b" style={{ borderColor: "#2a2e31" }}>
                    {mo.motivation && (
                      <Stat label="Motivation"><span className="text-[13px]" style={{ color: "#e7e2d2" }}>{mo.motivation}</span></Stat>
                    )}
                    {obligation.type && (
                      <Stat label="Obligation">
                        <span className="text-[13px]" style={{ color: "#e7e2d2" }}>
                          {obligation.type} <span className="mono-num" style={{ color: "#ffb000" }}>({obligation.value})</span>
                          {obligation.note ? ` — ${obligation.note}` : ""}
                        </span>
                      </Stat>
                    )}
                  </div>
                )}

                <div className="mb-5 pb-5 border-b" style={{ borderColor: "#2a2e31" }}>
                  <div className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{ color: "#8a8f93" }}>Characteristics</div>
                  <div className="overflow-x-auto">
                    <div className="grid grid-cols-6 gap-1.5 min-w-[360px]">
                      {CHAR_LABELS.map(([key, abbr]) => (
                        <div key={key} className="text-center border py-2" style={{ borderColor: "#2a2e31" }}>
                          <div className="text-[10px] tracking-widest" style={{ color: "#5a5f62" }}>{abbr}</div>
                          <div className="text-xl mono-num" style={{ color: "#e7e2d2" }}>{chars[key] ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mb-5 pb-5 border-b" style={{ borderColor: "#2a2e31" }}>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-y-1">
                    <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "#8a8f93" }}>Skills</div>
                    <div className="text-[11px] flex items-center gap-3">
                      <span className="flex items-center gap-1" style={{ color: "#8a8f93" }}>
                        <span className="w-2.5 h-2.5 inline-block" style={{ background: "#f5c518" }} /> proficiency
                      </span>
                      <span className="flex items-center gap-1" style={{ color: "#8a8f93" }}>
                        <span className="w-2.5 h-2.5 inline-block" style={{ background: "#6fae60" }} /> ability
                      </span>
                      <span style={{ color: "#5ec8d8" }}>career skill</span>
                    </div>
                  </div>
                  {["General", "Combat", "Knowledge"].map((group) => (
                    <div key={group} className="mb-3 last:mb-0">
                      <div className="text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#5a5f62" }}>{group}</div>
                      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                        {skills.filter((s) => s.group === group).map((s, i) => (
                          <div key={i} className="text-[13px] flex items-center justify-between gap-3">
                            <span style={{ color: s.career ? "#5ec8d8" : "#e7e2d2" }}>{s.name}</span>
                            <SkillPips rank={s.rank} characteristic={s.characteristic} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mb-5 pb-5 border-b" style={{ borderColor: "#2a2e31" }}>
                  <div className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{ color: "#8a8f93" }}>Talents</div>
                  {talents.length === 0 ? (
                    <span className="text-[13px]" style={{ color: "#5a5f62" }}>No talents recorded.</span>
                  ) : (
                    <div className="space-y-2.5">
                      {talents.map((t, i) => (
                        <div key={i} className="text-[13px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              {t.tier != null && (
                                <span className="text-[10px] tracking-wide px-1.5 py-0.5" style={{ background: "#2a2e31", color: "#8fd3f4", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
                                  T{t.tier}
                                </span>
                              )}
                              <span style={{ color: "#e7e2d2", fontWeight: 600 }}>{t.name}</span>
                            </span>
                            {t.rank > 1 && <span className="mono-num" style={{ color: "#8fd3f4" }}>×{t.rank}</span>}
                          </div>
                          {t.description && (
                            <div className="text-[12px] leading-snug mt-0.5" style={{ color: "#8a8f93" }}>{t.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{ color: "#8a8f93" }}>Weapons</div>
                  {weapons.length === 0 ? (
                    <span className="text-[13px]" style={{ color: "#5a5f62" }}>No weapons recorded.</span>
                  ) : (
                    <div className="overflow-x-auto mb-4">
                      <table className="w-full text-[12px]" style={{ color: "#e7e2d2" }}>
                        <thead>
                          <tr style={{ color: "#5a5f62" }}>
                            <th className="text-left font-normal pb-1">Name</th>
                            <th className="text-left font-normal pb-1">Skill</th>
                            <th className="text-left font-normal pb-1">Dmg</th>
                            <th className="text-left font-normal pb-1">Crit</th>
                            <th className="text-left font-normal pb-1">Range</th>
                            <th className="text-left font-normal pb-1">Special</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weapons.map((w, i) => (
                            <tr key={i} style={{ borderTop: "1px solid #2a2e31" }}>
                              <td className="py-1.5 pr-2">{w.name}</td>
                              <td className="py-1.5 pr-2" style={{ color: "#8a8f93" }}>{w.skill}</td>
                              <td className="py-1.5 pr-2 mono-num">{w.damage}</td>
                              <td className="py-1.5 pr-2 mono-num">{w.crit}</td>
                              <td className="py-1.5 pr-2">{w.range}</td>
                              <td className="py-1.5" style={{ color: "#5ec8d8" }}>{w.special}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {armor.name && (
                    <>
                      <div className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{ color: "#8a8f93" }}>Armor</div>
                      <div className="text-[13px] flex justify-between">
                        <span style={{ color: "#e7e2d2" }}>{armor.name}</span>
                        <span style={{ color: "#8a8f93" }}>+{armor.soakBonus ?? 0} Soak · +{armor.defenseBonus ?? 0} Defense</span>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        )}

        <p className="mt-3 text-[11px] text-center" style={{ color: "#5a5f62" }}>
          Static data from <code style={{ color: "#8a8f93" }}>/data/ledger.json</code> ·{" "}
          <span style={{ color: "#6fae60" }}>●</span> = live-sourced value
        </p>
        <p className="mt-1 text-[11px] text-center" style={{ color: "#5a5f62" }}>
          {live.fetchedAt ? `Fetched ${live.fetchedAt.toLocaleTimeString()}` : "—"}
          {" · "}Next auto-refresh in {secondsToNext}s
          {rateLimit && ` · GitHub API: ${rateLimit.remaining}/${rateLimit.limit} remaining`}
        </p>
      </div>
    </div>
  );
}
