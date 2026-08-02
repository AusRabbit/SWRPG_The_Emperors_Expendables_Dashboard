import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Full character/party dashboard (static, bundled ledger.json), with
// Wounds / Strain / Destiny overlaid live via this site's own /live proxy
// (a Cloudflare Worker route — see worker/index.js). The proxy fetches
// data/live.json from this repo using an authenticated GitHub token
// (5,000 req/hour) and edge-caches for 10s, so the browser never hits
// GitHub's 60/hour unauthenticated limit directly, no matter how many
// viewers or tabs are open. Poll interval matches the cache TTL — polling
// faster than the cache refreshes wouldn't get fresher data anyway.
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
//
// Talent-granted skill boosts: a talent may carry "boostsSkills": ["Skill
// Name", ...] to represent a "add Boost die per rank to X checks" effect.
// buildSkills() sums matching talent ranks per skill and attaches it as
// `boost`, rendered as a small triangle badge next to that skill's dice pips.
//
// Live-change highlight: whenever Wounds/Strain/Destiny change via the live
// overlay, the affected pip/token row gets a one-shot directional "sweep" —
// bottom-to-top in the stat's own color when the number goes UP, top-to-
// bottom in green when it goes DOWN. See lastChangeRef / SWEEP_MS below.
// ---------------------------------------------------------------------------
const LIVE_POLL_MS = 10_000;
const SWEEP_MS = 950;
const PULSE_MS = 2400;

const BLUE_TOKEN_B64 =
  "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" +
  "TRo0aM2f/9k=";
const RED_TOKEN_B64 =
  "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" +
  "Sq9KgwxsCekZBOWK5J0WCd4AZV2OcyvIPCu+Qin+ulgoameRR9E4Z6iOMjPWyLwp7AIxBOecY17v9Dt28Xult22KX+w26Py6iueQt9bIOWc89PSOeQACM+3SB233cdbu/wA2itFC1rtrZM8kkmaipBJyZXPCg5+3tzgltD4HoLRZ3ldP+nKxQMhKvcHH8EeeRH/M/wAc" +
  "dyF0BJbpXeUIgT8l2w7eYP3VLBHa4EaMmeqdZqfJIMVMoZQcY58xiT+BEDj1A6mluvrp7lWS1dSwaWU5OBgD2AAHYAYAHsBqasReVcTKutNjlz3nPrbT1EtLKssEjI69iP8Ab8j8ampo4qFaK8hE6I5foXYjqXo66eQ/JTun6rn8Aa6WVa5C89FHMR2ejmWUHnH2Eh11" +
  "NTSHpU6yuri7U0ByPuZhszdfostzYn+H6OUn/bGiS2CsgRHazS0isc+dcpUo4cZ98nqPcdj76mppQpXOspPH2Y6QB6E5K6+UVJGY/PS6TAgrDEjRUcf69nkPt2Uflh3Xrjc6u7VP1FZMZHwFUYAVFHZVUcKo9gABqamqUQKMCZ9lr2HLnM5dTU1NHFz/2Q==";
const BLUE_TOKEN = "data:image/jpeg;base64," + BLUE_TOKEN_B64;
const RED_TOKEN = "data:image/jpeg;base64," + RED_TOKEN_B64;

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
        criticalInjuries: ["Grazed — minor bleeding (Easy check to stop)"],
      },
      destiny: { light: 2, dark: 1 },
      xp: { available: 8, total: 45 },
      credits: 1350,
      inventory: [
        { name: "Heavy Blaster Pistol", note: "Mod: +1 crit rating" },
        { name: "Armored Flight Suit", note: "+1 Soak" },
        { name: "Comlink (encrypted)" },
        { name: "Stimpack ×2" },
      ],
      motivationObligation: {
        motivation: "Freedom — flying her own ship, on her own terms",
        obligation: { type: "Debt", value: 15, note: "Owed to Hylo Bassiro" },
      },
      characteristics: { brawn: 2, agility: 4, intellect: 2, cunning: 3, willpower: 2, presence: 3 },
      skills: [
        { name: "Piloting: Space", rank: 3, career: true },
        { name: "Piloting: Planetary", rank: 2, career: true },
        { name: "Gunnery", rank: 2, career: true },
        { name: "Streetwise", rank: 2, career: true },
        { name: "Perception", rank: 1, career: false },
        { name: "Cool", rank: 2, career: true },
        { name: "Ranged (Light)", rank: 2, career: false },
        { name: "Mechanics", rank: 1, career: false },
        { name: "Deception", rank: 1, career: false },
      ],
      talents: [
        { name: "Skilled Jockey", rank: 2, tier: 2, description: "Add Boost per rank to Piloting checks when in silhouette 3 or smaller vehicle." },
        { name: "Dodge", rank: 1, tier: 1, description: "Suffer strain equal to ranks to upgrade difficulty of an incoming combat check once per rank." },
        { name: "Full Throttle", rank: 1, tier: 1, description: "Increase a piloted vehicle's speed by 1 as a maneuver; costs 2 strain." },
        { name: "Quick Draw", rank: 1, tier: 1, description: "Draw or holster an easily accessible weapon/item as an incidental once per round." },
        { name: "Grit", rank: 1, tier: 1, description: "Increase strain threshold by 1 per rank." },
      ],
      weapons: [
        { name: "Heavy Blaster Pistol", skill: "Ranged (Light)", damage: 7, crit: 3, range: "Medium", special: "—" },
        { name: "Vibroknife", skill: "Melee", damage: 4, crit: 2, range: "Engaged", special: "Pierce 2" },
      ],
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
      "talents": [{ "name": "string", "rank": 0, "tier": 1, "description": "string (effect/rules text, optional)", "boostsSkills": ["Skill Name, ... (optional — for talents that grant Boost dice per rank to specific skills)"] }],
      "weapons": [{ "name": "string", "skill": "string", "damage": 0, "crit": 0, "range": "string", "special": "string" }],
      "armor": { "name": "string", "soakBonus": 0, "rangedDefense": 0, "meleeDefense": 0, "defenseBonus": "0 (legacy single value, used for both if rangedDefense/meleeDefense absent)" }
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

  const boostMap = new Map();
  (character?.talents || []).forEach((t) => {
    if (Array.isArray(t.boostsSkills)) {
      t.boostsSkills.forEach((skillName) => {
        const key = normalizeSkillName(skillName);
        boostMap.set(key, (boostMap.get(key) || 0) + (t.rank || 1));
      });
    }
  });

  return FULL_SKILL_LIST.map((canon) => {
    const match = skillMap.get(normalizeSkillName(canon.name));
    return {
      name: canon.name,
      group: canon.group,
      char: canon.char,
      rank: match?.rank ?? 0,
      career: match?.career ?? false,
      characteristic: chars[canon.char] ?? 0,
      boost: boostMap.get(normalizeSkillName(canon.name)) || 0,
    };
  });
}

function getDefense(character) {
  const armor = character?.armor || {};
  const ranged = armor.rangedDefense ?? armor.defenseBonus ?? 0;
  const melee = armor.meleeDefense ?? armor.defenseBonus ?? 0;
  return { ranged, melee };
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

// One-shot directional highlight: sweeps bottom-to-top in `color` on an
// increase, top-to-bottom in green on a decrease. Renders nothing when idle.
function SweepOverlay({ active, dir, color }) {
  if (!active) return null;
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        background: dir === "down" ? "#6fae6066" : `${color}66`,
        animation: `${dir === "down" ? "sweepDown" : "sweepUp"} 0.9s ease-out 1`,
      }}
    />
  );
}

function DestinyTokens({ count, src, alt, sweepActive, sweepDir, sweepColor }) {
  return (
    <div className="relative flex gap-1">
      <div className="flex gap-1">
        {Array.from({ length: count }, (_, i) => (
          <img
            key={i}
            src={src}
            alt={alt}
            style={{ width: 33, height: 33, display: "block", filter: "drop-shadow(0 0 3px rgba(0,0,0,0.5))" }}
          />
        ))}
      </div>
      <SweepOverlay active={sweepActive} dir={sweepDir} color={sweepColor} />
    </div>
  );
}

function SkillPips({ rank, characteristic, boost = 0 }) {
  const total = Math.max(rank, characteristic);
  const yellow = Math.min(rank, characteristic);
  return (
    <span className="flex items-center gap-1">
      {total === 0 ? (
        <span className="text-[11px]" style={{ color: "#3a3f42" }}>—</span>
      ) : (
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
      )}
      {boost > 0 && (
        <span
          className="text-[10px] leading-none"
          style={{ color: "#5ec8d8" }}
          title={`+${boost} Boost die from talents`}
        >
          ▲{boost > 1 ? `×${boost}` : ""}
        </span>
      )}
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

  // Tracks when each live value last changed (and which direction), purely
  // to drive the one-shot sweep highlight — never affects displayed values.
  const lastChangeRef = useRef({ wounds: {}, strain: {}, woundsDir: {}, strainDir: {}, destinyLightTs: 0, destinyLightDir: null, destinyDarkTs: 0, destinyDarkDir: null });
  const ledgerRef = useRef(ledger);
  useEffect(() => { ledgerRef.current = ledger; }, [ledger]);
  const [, forceTick] = useState(0);
  const scheduleSweepClear = () => {
    setTimeout(() => forceTick((t) => t + 1), SWEEP_MS + 100);
    setTimeout(() => forceTick((t) => t + 1), PULSE_MS + 100);
  };

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

  useEffect(() => {
    document.title = ledger.campaign ? `${ledger.campaign} — Character Sheets` : "Character Sheets";
  }, [ledger.campaign]);

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

      setLive((prev) => {
        const now = Date.now();
        const lc = lastChangeRef.current;
        const party = ledgerRef.current.characters || [];
        const prevForOverlay = prev.status === "ok" ? prev : { status: "idle" };

        party.filter((p) => p.liveId).forEach((p) => {
          const oldOverlay = applyLiveOverlay(p, prevForOverlay);
          const newWounds = parsed.wounds && parsed.wounds[p.liveId] != null ? parsed.wounds[p.liveId] : oldOverlay.wounds.current;
          const newStrain = parsed.strain && parsed.strain[p.liveId] != null ? parsed.strain[p.liveId] : oldOverlay.strain.current;
          if (newWounds !== oldOverlay.wounds.current) {
            lc.wounds[p.liveId] = now;
            lc.woundsDir[p.liveId] = newWounds > oldOverlay.wounds.current ? "up" : "down";
          }
          if (newStrain !== oldOverlay.strain.current) {
            lc.strain[p.liveId] = now;
            lc.strainDir[p.liveId] = newStrain > oldOverlay.strain.current ? "up" : "down";
          }
        });

        const oldDestiny = prevForOverlay.destiny || party[0]?.destiny || { light: 0, dark: 0 };
        if (parsed.destiny) {
          if (parsed.destiny.light !== oldDestiny.light) {
            lc.destinyLightTs = now;
            lc.destinyLightDir = parsed.destiny.light > oldDestiny.light ? "up" : "down";
          }
          if (parsed.destiny.dark !== oldDestiny.dark) {
            lc.destinyDarkTs = now;
            lc.destinyDarkDir = parsed.destiny.dark > oldDestiny.dark ? "up" : "down";
          }
        }

        scheduleSweepClear();
        return { status: "ok", ...parsed, fetchedAt: new Date() };
      });
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
  const activeDefense = getDefense(active);

  const CHAR_LABELS = [
    ["brawn", "BR"], ["agility", "AG"], ["intellect", "INT"],
    ["cunning", "CUN"], ["willpower", "WIL"], ["presence", "PR"],
  ];

  const partySkillSets = party.map((p) => buildSkills(p));
  const partySkillNames = FULL_SKILL_LIST;
  const partyOverlays = party.map((p) => applyLiveOverlay(p, live));
  const partyDestiny = partyOverlays.find((o) => o.destinyLive)?.destiny || party[0]?.destiny || { light: 0, dark: 0 };
  const anyLive = live.status === "ok";

  const now = Date.now();
  const lc = lastChangeRef.current;
  const woundsSweepOn = !!active.liveId && (now - (lc.wounds[active.liveId] || 0)) < SWEEP_MS;
  const woundsDir = lc.woundsDir[active.liveId];
  const strainSweepOn = !!active.liveId && (now - (lc.strain[active.liveId] || 0)) < SWEEP_MS;
  const strainDir = lc.strainDir[active.liveId];
  const destinyLightSweepOn = (now - (lc.destinyLightTs || 0)) < SWEEP_MS;
  const destinyDarkSweepOn = (now - (lc.destinyDarkTs || 0)) < SWEEP_MS;

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
        @keyframes sweepUp { 0% { clip-path: inset(100% 0 0 0); opacity: 1; } 55% { clip-path: inset(0 0 0 0); opacity: 1; } 100% { clip-path: inset(0 0 0 0); opacity: 0; } }
        @keyframes sweepDown { 0% { clip-path: inset(0 0 100% 0); opacity: 1; } 55% { clip-path: inset(0 0 0 0); opacity: 1; } 100% { clip-path: inset(0 0 0 0); opacity: 0; } }
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
              Parse &amp; load
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
                  <DestinyTokens count={partyDestiny.light} src={BLUE_TOKEN} alt="Light Side Destiny Point" sweepActive={destinyLightSweepOn} sweepDir={lc.destinyLightDir} sweepColor="#8fd3f4" />
                  <span className="text-[11px]" style={{ color: "#8a8f93" }}>light</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <DestinyTokens count={partyDestiny.dark} src={RED_TOKEN} alt="Dark Side Destiny Point" sweepActive={destinyDarkSweepOn} sweepDir={lc.destinyDarkDir} sweepColor="#c23b3b" />
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
                <span className="flex items-center gap-1" style={{ color: "#5ec8d8" }}>▲ talent boost die</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[12px]" style={{ color: "#e7e2d2", minWidth: `${280 + party.length * 110}px` }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2a2e31" }}>
                      <th className="text-left font-normal pb-2" style={{ color: "#5a5f62" }}></th>
                      {party.map((p, i) => (
                        <th key={i} className="text-left font-normal pb-2 px-2 text-[14px]" style={{ color: "#8a8f93", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
                          {p.name || `Character ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="pt-2 pb-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Wounds</td>
                      {partyOverlays.map((o, i) => {
                        const liveId = party[i]?.liveId;
                        const sweepOn = !!liveId && (now - (lc.wounds[liveId] || 0)) < SWEEP_MS;
                        return (
                          <td key={i} className="relative pt-2 pb-1 px-2 mono-num text-[14px]" style={{ color: severityColor(o.wounds.current, o.wounds.threshold) }}>
                            {o.wounds.current} / {o.wounds.threshold}{o.woundsLive && <span className="ml-1" style={{ color: "#6fae60" }}>●</span>}
                            <SweepOverlay active={sweepOn} dir={lc.woundsDir[liveId]} color="#c23b3b" />
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="py-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Strain</td>
                      {partyOverlays.map((o, i) => {
                        const liveId = party[i]?.liveId;
                        const sweepOn = !!liveId && (now - (lc.strain[liveId] || 0)) < SWEEP_MS;
                        return (
                          <td key={i} className="relative py-1 px-2 mono-num text-[14px]" style={{ color: severityColor(o.strain.current, o.strain.threshold) }}>
                            {o.strain.current} / {o.strain.threshold}{o.strainLive && <span className="ml-1" style={{ color: "#6fae60" }}>●</span>}
                            <SweepOverlay active={sweepOn} dir={lc.strainDir[liveId]} color="#ffb000" />
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="py-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Soak</td>
                      {party.map((p, i) => (
                        <td key={i} className="py-1 px-2 mono-num text-[14px]" style={{ color: "#e7e2d2" }}>{p.vitals?.soak ?? "—"}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Defense (R/M)</td>
                      {party.map((p, i) => {
                        const d = getDefense(p);
                        return <td key={i} className="py-1 px-2 mono-num text-[14px]" style={{ color: "#e7e2d2" }}>{d.ranged}/{d.melee}</td>;
                      })}
                    </tr>
                    <tr style={{ borderBottom: "1px solid #2a2e31" }}>
                      <td className="py-1 pb-2 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>Critical Injuries</td>
                      {party.map((p, i) => {
                        const n = (p.vitals?.criticalInjuries || []).length;
                        return (
                          <td key={i} className="py-1 pb-2 px-2 text-[14px]">
                            {n === 0 ? (
                              <span style={{ color: "#3a3f42" }}>—</span>
                            ) : (
                              <span className="flex items-center gap-1">
                                {Array.from({ length: Math.min(n, 5) }, (_, k) => (
                                  <span key={k} className="w-2.5 h-2.5 inline-block" style={{ background: "#c23b3b" }} />
                                ))}
                                {n > 5 && <span className="text-[12px] mono-num" style={{ color: "#c23b3b" }}>+{n - 5}</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td colSpan={party.length + 1} className="pt-3 pb-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>
                        Skill
                      </td>
                    </tr>
                    {["General", "Combat", "Knowledge"].flatMap((group) => {
                      const rows = partySkillNames.filter((s) => s.group === group);
                      if (rows.length === 0) return [];
                      return [
                        <tr key={`${group}-header`}>
                          <td colSpan={party.length + 1} className="pt-3 pb-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: "#5a5f62" }}>
                            {group}
                          </td>
                        </tr>,
                        ...rows.map((skillDef) => (
                          <tr key={`${group}-${skillDef.name}`} style={{ borderTop: "1px solid #2a2e31" }}>
                            <td className="py-1.5 pr-3">{skillDef.name}</td>
                            {partySkillSets.map((set, ci) => {
                              const s = set.find((x) => x.name === skillDef.name);
                              return (
                                <td key={ci} className="py-1.5 px-2">
                                  <SkillPips rank={s?.rank ?? 0} characteristic={s?.characteristic ?? 0} boost={s?.boost ?? 0} />
                                </td>
                              );
                            })}
                          </tr>
                        )),
                      ];
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
                      <div className="relative">
                        <PipRow current={wounds.current} threshold={wounds.threshold} colorClass="#c23b3b" />
                        <SweepOverlay active={woundsSweepOn} dir={woundsDir} color="#c23b3b" />
                      </div>
                    </Stat>
                    <Stat label={`Strain — ${strain.current} / ${strain.threshold}`} live={overlay.strainLive}>
                      <div className="relative">
                        <PipRow current={strain.current} threshold={strain.threshold} colorClass="#ffb000" />
                        <SweepOverlay active={strainSweepOn} dir={strainDir} color="#ffb000" />
                      </div>
                    </Stat>
                    <Stat label="Soak">
                      <span className="text-xl mono-num" style={{ color: "#e7e2d2" }}>{v.soak ?? "—"}</span>
                    </Stat>
                  </div>
                  <div>
                    <Stat label="Destiny Pool (party)" live={overlay.destinyLive}>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <DestinyTokens count={destiny.light} src={BLUE_TOKEN} alt="Light Side Destiny Point" sweepActive={destinyLightSweepOn} sweepDir={lc.destinyLightDir} sweepColor="#8fd3f4" />
                          <span className="text-[11px]" style={{ color: "#8a8f93" }}>light</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <DestinyTokens count={destiny.dark} src={RED_TOKEN} alt="Dark Side Destiny Point" sweepActive={destinyDarkSweepOn} sweepDir={lc.destinyDarkDir} sweepColor="#c23b3b" />
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
                      <span style={{ color: "#5ec8d8" }}>▲ talent boost</span>
                    </div>
                  </div>
                  {["General", "Combat", "Knowledge"].map((group) => (
                    <div key={group} className="mb-3 last:mb-0">
                      <div className="text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#5a5f62" }}>{group}</div>
                      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                        {skills.filter((s) => s.group === group).map((s, i) => (
                          <div key={i} className="text-[13px] flex items-center justify-between gap-3">
                            <span style={{ color: s.career ? "#5ec8d8" : "#e7e2d2" }}>{s.name}</span>
                            <SkillPips rank={s.rank} characteristic={s.characteristic} boost={s.boost} />
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
                        <span style={{ color: "#8a8f93" }}>+{armor.soakBonus ?? 0} Soak · Defense (R/M) {activeDefense.ranged}/{activeDefense.melee}</span>
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
