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
const LIVE_POLL_MS = 5_000;
const SWEEP_MS = 950;
const PULSE_MS = 2400;

const BLUE_TOKEN = "/images/blue-token.png";
const RED_TOKEN = "/images/red-token.png";

const BOOST_ICON = "/images/boost-icon.png";

const YELLOW_ICON = "/images/yellow-icon.png";
const GREEN_ICON = "/images/green-icon.png";

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
  ],
  "npcs": [
    {
      "name": "string", "role": "string", "species": "string (or 'Not specified in ledger')",
      "gender": "string (or 'Not specified in ledger')", "status": "string, e.g. 'Present — ...' or 'Off-screen — ...'",
      "summary": "string (1-line, player-facing)", "whatPartyKnows": "string (no GM-only secrets)"
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

// ---------------------------------------------------------------------------
// Shared dice roller — exact FFG face tables (see FFG Dice Tables reference
// in the GM project knowledge). Rolls are computed client-side with
// Math.random(), never fudged or approximated. Results are posted to a small
// shared log (Cloudflare Worker /rolls route, backed by a KV namespace) that
// every viewer of this dashboard polls, so a roll one player makes shows up
// for everyone within a couple seconds. This log is entirely separate from
// the campaign ledger/live overlay above — it never reads or writes Wounds,
// Strain, Destiny, or any character-sheet field.
// ---------------------------------------------------------------------------
// Custom blank die-face artwork (Cameron's own designs) — one PNG per die
// type, dropped in public/images/ with these filenames.
const DIE_TYPES = [
  { key: "ability", label: "Ability", sides: 8, img: "/images/die-ability.png",
    faces: { 1: [], 2: ["s"], 3: ["s"], 4: ["a"], 5: ["a"], 6: ["s", "a"], 7: ["a", "a"], 8: ["s", "s"] } },
  { key: "proficiency", label: "Proficiency", sides: 12, img: "/images/die-proficiency.png",
    faces: { 1: [], 2: ["tr"], 3: ["s"], 4: ["s"], 5: ["a"], 6: ["s", "a"], 7: ["s", "a"], 8: ["s", "a"], 9: ["s", "s"], 10: ["s", "s"], 11: ["a", "a"], 12: ["a", "a"] } },
  { key: "boost", label: "Boost", sides: 6, img: "/images/die-boost.png",
    faces: { 1: [], 2: [], 3: ["s"], 4: ["a"], 5: ["a", "a"], 6: ["s", "a"] } },
  { key: "difficulty", label: "Difficulty", sides: 8, img: "/images/die-difficulty.png",
    faces: { 1: [], 2: ["f"], 3: ["t"], 4: ["t"], 5: ["t"], 6: ["f", "f"], 7: ["f", "t"], 8: ["t", "t"] } },
  { key: "challenge", label: "Challenge", sides: 12, img: "/images/die-challenge.png",
    faces: { 1: [], 2: ["d"], 3: ["f"], 4: ["f"], 5: ["t"], 6: ["t"], 7: ["f", "f"], 8: ["f", "f"], 9: ["t", "t"], 10: ["t", "t"], 11: ["t", "f"], 12: ["t", "f"] } },
  { key: "setback", label: "Setback", sides: 6, img: "/images/die-setback.png",
    faces: { 1: [], 2: [], 3: ["f"], 4: ["f"], 5: ["t"], 6: ["t"] } },
  { key: "force", label: "Force", sides: 12, img: "/images/die-force.png",
    faces: { 1: ["lp"], 2: ["lp"], 3: ["lp", "lp"], 4: ["lp", "lp"], 5: ["lp", "lp"], 6: ["dp"], 7: ["dp"], 8: ["dp"], 9: ["dp"], 10: ["dp"], 11: ["dp"], 12: ["dp", "dp"] } },
];

function DieFaceIcon({ img, label, size = 20 }) {
  return (
    <img
      src={img}
      alt={label}
      title={label}
      style={{ width: size, height: size, display: "block", flexShrink: 0, objectFit: "contain" }}
    />
  );
}

// Custom symbol artwork (Cameron's own designs) — one PNG per FFG dice
// symbol, dropped in public/images/ with these filenames.
const SYMBOL_META = {
  s: { label: "Success", img: "/images/symbol-success.png" },
  f: { label: "Failure", img: "/images/symbol-failure.png" },
  a: { label: "Advantage", img: "/images/symbol-advantage.png" },
  t: { label: "Threat", img: "/images/symbol-threat.png" },
  tr: { label: "Triumph", img: "/images/symbol-triumph.png" },
  d: { label: "Despair", img: "/images/symbol-despair.png" },
  lp: { label: "Light Side Point", img: "/images/symbol-light-side.png" },
  dp: { label: "Dark Side Point", img: "/images/symbol-dark-side.png" },
};

function SymbolIcon({ sym, size = 16 }) {
  const meta = SYMBOL_META[sym];
  if (!meta) return null;
  return (
    <img
      src={meta.img}
      alt={meta.label}
      title={meta.label}
      style={{ width: size, height: size, display: "inline-block", verticalAlign: "middle" }}
    />
  );
}

// "N <icon>" for a symbol tally — renders nothing if count is 0/falsy.
function SymbolTally({ sym, count, size = 15, withLabel = false, fontSize }) {
  if (!count) return null;
  const meta = SYMBOL_META[sym];
  return (
    <span className="inline-flex items-center gap-2 mono-num" style={fontSize ? { fontSize } : undefined}>
      {count}
      <SymbolIcon sym={sym} size={size} />
      {withLabel && meta && <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 600 }}>{meta.label}</span>}
    </span>
  );
}

function rollDie(dieType) {
  const face = Math.floor(Math.random() * dieType.sides) + 1;
  return { face, symbols: dieType.faces[face] || [] };
}

function rollPool(pool) {
  const rolls = [];
  DIE_TYPES.forEach((dt) => {
    const count = pool[dt.key] || 0;
    for (let i = 0; i < count; i++) {
      const r = rollDie(dt);
      rolls.push({ die: dt.key, label: dt.label, img: dt.img, face: r.face, symbols: r.symbols });
    }
  });

  let success = 0, failure = 0, advantage = 0, threat = 0, triumph = 0, despair = 0, lightPoint = 0, darkPoint = 0;
  rolls.forEach((r) => {
    r.symbols.forEach((sym) => {
      if (sym === "s") success += 1;
      if (sym === "f") failure += 1;
      if (sym === "a") advantage += 1;
      if (sym === "t") threat += 1;
      if (sym === "tr") { triumph += 1; success += 1; }
      if (sym === "d") { despair += 1; failure += 1; }
      if (sym === "lp") lightPoint += 1;
      if (sym === "dp") darkPoint += 1;
    });
  });

  return { rolls, netSuccess: success - failure, netAdvantage: advantage - threat, triumph, despair, lightPoint, darkPoint };
}

function poolLabel(pool) {
  const parts = DIE_TYPES.filter((dt) => (pool[dt.key] || 0) > 0).map((dt) => `${pool[dt.key]} ${dt.label}`);
  return parts.length ? parts.join(", ") : "No dice selected";
}

// Custom "new roll landed in the shared log" sound — Cameron's own uploaded
// clips (a set of saber-strike variants), one picked at random each time so
// a busy table doesn't hear the identical clip back-to-back.
const ROLL_SOUNDS = [
  "/sounds/dice-roll-a.wav",
  "/sounds/dice-roll-b.wav",
  "/sounds/dice-roll-c.wav",
  "/sounds/dice-roll-d.wav",
  "/sounds/dice-roll-e.wav",
  "/sounds/dice-roll-f.wav",
];

function playRandomRollSound() {
  const src = ROLL_SOUNDS[Math.floor(Math.random() * ROLL_SOUNDS.length)];
  const audio = new Audio(src);
  audio.volume = 0.1;
  audio.play().catch(() => { /* blocked until a user gesture unlocks audio — see handleRoll */ });
}

// Mandatory Despair sting (Cameron's own uploaded clip) — plays whenever a
// new shared-log entry carries a Despair result, regardless of the mute
// toggle below. This is deliberately not gated on soundOnRef: a Despair is
// meant to be heard by the whole table. It replaces the ambient roll chime
// for that entry rather than layering on top of it.
const DESPAIR_SOUND = "/sounds/despair-scream.wav";

function playDespairSound() {
  const audio = new Audio(DESPAIR_SOUND);
  audio.volume = 0.6;
  audio.play().catch(() => { /* blocked until a user gesture unlocks audio — see handleRoll */ });
}

// Mandatory Triumph sting (Cameron's own uploaded clip) — plays whenever a
// new shared-log entry carries a Triumph result, regardless of the mute
// toggle below. Same treatment as Despair: a Triumph is meant to be heard by
// the whole table, and replaces the ambient roll chime for that entry.
const TRIUMPH_SOUND = "/sounds/triumph-sound.wav";

function playTriumphSound() {
  const audio = new Audio(TRIUMPH_SOUND);
  audio.volume = 0.6;
  audio.play().catch(() => { /* blocked until a user gesture unlocks audio — see handleRoll */ });
}

// Icon + description readout of the current pool — sits next to Roll/Clear
// pool so players can see exactly what's selected without reading a plain
// count string.
function SelectedDiceSummary({ pool, size = 18 }) {
  const active = DIE_TYPES.filter((dt) => (pool[dt.key] || 0) > 0);
  if (active.length === 0) {
    return <span className="text-[12px]" style={{ color: "#5a5f62" }}>No dice selected</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {active.map((dt) => (
        <span key={dt.key} className="flex items-center gap-1.5 text-[12px]" style={{ color: "#e7e2d2" }}>
          <DieFaceIcon img={dt.img} label={dt.label} size={size} />
          {pool[dt.key]} {dt.label}
        </span>
      ))}
    </span>
  );
}

// Icons-only dice pool readout — no spelled-out labels, just each active die
// type's icon with an ×N count. Used in the shared roll log so a scan of the
// table shows what was rolled before the summarised result underneath it.
function PoolIconStrip({ pool, size = 16 }) {
  const active = DIE_TYPES.filter((dt) => (pool?.[dt.key] || 0) > 0);
  if (active.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-2.5">
      {active.map((dt) => (
        <span key={dt.key} className="flex items-center gap-1">
          <DieFaceIcon img={dt.img} label={dt.label} size={size} />
          <span className="text-[11px] mono-num" style={{ color: "#8a8f93" }}>×{pool[dt.key]}</span>
        </span>
      ))}
    </span>
  );
}

// Per-die results readout for the shared roll log — one icon per die that
// was actually rolled, immediately followed by the symbols it landed on.
// Deliberately omits the numeric face value (e.g. "7:") — that level of
// detail is accurate but more than a glance at the log needs; the symbols
// are what matter at the table. Falls back to PoolIconStrip for older log
// entries posted before this field existed (they only have entry.pool).
function RollResultsStrip({ rolls, size = 16 }) {
  if (!rolls || rolls.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-3">
      {rolls.map((r, i) => {
        const dt = DIE_TYPES.find((d) => d.key === r.die);
        if (!dt) return null;
        return (
          <span key={i} className="flex items-center gap-1">
            <DieFaceIcon img={dt.img} label={dt.label} size={size} />
            {r.symbols && r.symbols.length ? (
              r.symbols.map((s, si) => <SymbolIcon key={si} sym={s} size={size - 1} />)
            ) : (
              <span style={{ color: "#5a5f62" }}>—</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

// Difficulty tier readout: Challenge dice count toward the same tier as
// Difficulty dice (both represent the check's base difficulty — Challenge
// is just Difficulty "upgraded" per FFG's dice-upgrade rule), so the tier
// name is derived from Difficulty + Challenge combined, then flagged
// "(Upgraded)" whenever any Challenge dice are in the pool.
const DIFFICULTY_TIER_NAMES = { 1: "Easy", 2: "Average", 3: "Hard", 4: "Daunting", 5: "Formidable" };

function difficultyTierLabel(pool) {
  const difficultyCount = pool.difficulty || 0;
  const challengeCount = pool.challenge || 0;
  const total = difficultyCount + challengeCount;
  if (total <= 0) return null;
  const tierName = DIFFICULTY_TIER_NAMES[Math.min(total, 5)];
  const upgraded = challengeCount > 0;
  return `${total} Difficulty (${tierName})${upgraded ? " (Upgraded)" : ""}`;
}

function DiceCounter({ dieType, count, onChange }) {
  return (
    <div className="flex items-center justify-between border px-3 py-2" style={{ borderColor: "#2a2e31" }}>
      <span className="flex items-center gap-2 text-[13px]" style={{ color: "#e7e2d2" }}>
        <DieFaceIcon img={dieType.img} label={dieType.label} size={22} />
        {dieType.label}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(0, count - 1))}
          className="w-6 h-6 border text-[13px] leading-none"
          style={{ borderColor: "#3a3f42", color: "#8a8f93" }}
        >
          −
        </button>
        <span className="w-5 text-center mono-num" style={{ color: "#e7e2d2" }}>{count}</span>
        <button
          onClick={() => onChange(count + 1)}
          className="w-6 h-6 border text-[13px] leading-none"
          style={{ borderColor: "#3a3f42", color: "#8a8f93" }}
        >
          +
        </button>
      </div>
    </div>
  );
}

const EMPTY_POOL = { proficiency: 0, ability: 0, boost: 0, challenge: 0, difficulty: 0, setback: 0, force: 0 };

function DiceRollerPanel({ playerName, setPlayerName, preset, partyDestiny }) {
  const [pool, setPool] = useState(() => preset?.pool || EMPTY_POOL);
  const [loadedLabel, setLoadedLabel] = useState(preset?.label || null);
  // Tracks which of the 9 purple difficulty buttons (Quick difficulty +
  // Add range/melee difficulty) is currently "selected" — they're a single
  // mutually-exclusive group now, not stackable. Cleared (deselected)
  // whenever the pool's Difficulty/Challenge dice change some other way
  // (manual counter edit, Clear pool, or loading a skill's dice), since at
  // that point the pool no longer reflects any one preset. NOT cleared by
  // the Difficulty → Challenge upgrade button, since upgrading is treated
  // as intensifying the same selected tier rather than changing it — see
  // upgradeDifficultyToChallenge below.
  const [selectedDifficultyPreset, setSelectedDifficultyPreset] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [log, setLog] = useState([]);
  const [logStatus, setLogStatus] = useState({ status: "idle" });
  const pollRef = useRef(null);

  // Chime on new shared-log entries. soundOn is mirrored into a ref because
  // fetchLog's setInterval closure is created once on mount and would
  // otherwise only ever see the initial value of the state variable.
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem("swrpg-dice-sound") !== "off"; } catch { return true; }
  });
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
    try { localStorage.setItem("swrpg-dice-sound", soundOn ? "on" : "off"); } catch { /* ignore */ }
  }, [soundOn]);
  const hasFetchedRef = useRef(false);
  const prevTopIdRef = useRef(undefined);

  const fetchLog = async () => {
    try {
      const res = await fetch(`/rolls?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const rolls = Array.isArray(data.rolls) ? data.rolls : [];
      const newest = rolls[0];
      const newestId = newest?.id;
      if (hasFetchedRef.current && newestId && newestId !== prevTopIdRef.current) {
        if (newest.despair > 0) {
          playDespairSound();
        } else if (newest.triumph > 0) {
          playTriumphSound();
        } else if (soundOnRef.current) {
          playRandomRollSound();
        }
      }
      hasFetchedRef.current = true;
      prevTopIdRef.current = newestId;
      setLog(rolls);
      setLogStatus({ status: "ok" });
    } catch (err) {
      setLogStatus({ status: "error", msg: err.message });
    }
  };

  useEffect(() => {
    fetchLog();
    pollRef.current = setInterval(fetchLog, 1500);
    return () => clearInterval(pollRef.current);
  }, []);

  // Clicking a skill's dice pips (Character Sheet tab or Party View) seeds
  // this pool with that skill's Proficiency/Ability/talent-Boost dice —
  // never Difficulty/Challenge/Setback/Force, since those are scene- and
  // GM-judgment-dependent, not part of the character's fixed dice pool.
  // Keyed on preset.nonce (not the pool object itself) so clicking the same
  // skill twice in a row still re-applies it.
  useEffect(() => {
    if (preset) {
      setPool(preset.pool);
      setLoadedLabel(preset.label || null);
      setSelectedDifficultyPreset(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce]);

  function updateDie(key, value) {
    setPool((p) => ({ ...p, [key]: value }));
    // A manual edit to Difficulty or Challenge means the pool no longer
    // reflects any one of the 9 preset buttons — deselect.
    if (key === "difficulty" || key === "challenge") {
      setSelectedDifficultyPreset(null);
    }
  }

  // The 9 purple difficulty buttons (5 Quick difficulty tiers + 4 range/
  // melee presets) are a single mutually-exclusive group: picking one sets
  // the Difficulty pool to exactly what it represents (clearing any prior
  // Challenge-die upgrade, since that belonged to whichever tier was
  // selected before) and marks it as the selected button.
  function selectDifficultyPreset(id, count) {
    setPool((p) => ({ ...p, difficulty: count, challenge: 0 }));
    setSelectedDifficultyPreset(id);
  }

  // Maneuver quick-adds — Aim/Called Shot stack on top of whatever's
  // already in the pool (unlike the difficulty presets, these aren't
  // mutually exclusive with each other or with a selected difficulty tier).
  function addBoost(n) {
    setPool((p) => ({ ...p, boost: (p.boost || 0) + n }));
  }
  function addSetback(n) {
    setPool((p) => ({ ...p, setback: (p.setback || 0) + n }));
  }

  // FFG "upgrade" rule: converts one Ability die into a Proficiency die.
  function upgradeAbilityToProficiency() {
    setPool((p) => {
      if ((p.ability || 0) <= 0) return p;
      return { ...p, ability: p.ability - 1, proficiency: (p.proficiency || 0) + 1 };
    });
  }

  // FFG "upgrade" rule: converts one Difficulty die into a Challenge die.
  function upgradeDifficultyToChallenge() {
    setPool((p) => {
      if ((p.difficulty || 0) <= 0) return p;
      return { ...p, difficulty: p.difficulty - 1, challenge: (p.challenge || 0) + 1 };
    });
  }

  async function handleRoll() {
    // Clicking Roll is a user gesture, so use it to "unlock" playback —
    // browsers block audio.play() until one has occurred on the page. Play
    // silently and immediately pause so a viewer who only ever clicks Roll
    // (never anything else) still gets sound for everyone else's rolls too.
    try {
      const primer = new Audio(ROLL_SOUNDS[0]);
      primer.volume = 0;
      primer.play().then(() => primer.pause()).catch(() => {});
    } catch { /* ignore */ }
    const result = rollPool(pool);
    setLastResult(result);
    const entry = {
      player: (playerName || "Unnamed").slice(0, 40),
      poolLabel: poolLabel(pool),
      pool: { ...pool },
      rolls: result.rolls.map((r) => ({ die: r.die, symbols: r.symbols })),
      netSuccess: result.netSuccess,
      netAdvantage: result.netAdvantage,
      triumph: result.triumph,
      despair: result.despair,
    };
    try {
      const res = await fetch("/rolls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLogStatus({ status: "error", msg: data.error || `Could not post roll (${res.status})` });
      } else {
        fetchLog();
      }
    } catch (err) {
      setLogStatus({ status: "error", msg: err.message });
    }
  }

  async function handleClearLog() {
    if (!window.confirm("Clear the shared roll log for everyone? This can't be undone.")) return;
    try {
      const res = await fetch("/rolls", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLogStatus({ status: "error", msg: data.error || `Could not clear log (${res.status})` });
        return;
      }
      setLog([]);
      setLogStatus({ status: "ok" });
    } catch (err) {
      setLogStatus({ status: "error", msg: err.message });
    }
  }

  const forceDie = DIE_TYPES.find((d) => d.key === "force");
  const mainDice = DIE_TYPES.filter((d) => d.key !== "force");

  return (
    <div className="relative overflow-hidden border" style={{ borderColor: "#3a3f42", background: "#16191b", boxShadow: "0 0 30px rgba(94,200,216,0.06)" }}>
      <div className="p-5 sm:p-7">
        {partyDestiny && (
          <div className="flex items-center gap-6 flex-wrap mb-4 pb-3 border-b" style={{ borderColor: "#2a2e31" }}>
            <div className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "#ffb000" }}>Party Destiny Pool</div>
            <div className="flex items-center gap-1.5">
              <img src={BLUE_TOKEN} alt="Light Side Destiny Point" style={{ width: 22, height: 22 }} />
              <span className="text-[13px] mono-num" style={{ color: "#e7e2d2" }}>{partyDestiny.light}</span>
              <span className="text-[11px]" style={{ color: "#8a8f93" }}>light</span>
            </div>
            <div className="flex items-center gap-1.5">
              <img src={RED_TOKEN} alt="Dark Side Destiny Point" style={{ width: 22, height: 22 }} />
              <span className="text-[13px] mono-num" style={{ color: "#e7e2d2" }}>{partyDestiny.dark}</span>
              <span className="text-[11px]" style={{ color: "#8a8f93" }}>dark</span>
            </div>
          </div>
        )}

        <div className="text-[11px] tracking-[0.25em] uppercase mb-1" style={{ color: "#5ec8d8" }}>SHARED SESSION TOOL</div>
        <h1 className="text-2xl sm:text-3xl uppercase tracking-wide mb-4" style={{ color: "#e7e2d2", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
          Dice Roller
        </h1>

        <div className="mb-4">
          <label className="text-[11px] tracking-[0.2em] uppercase block mb-1.5" style={{ color: "#8a8f93" }}>
            Your name (shown in the shared log)
          </label>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="e.g. Kess"
            className="w-full sm:w-64 bg-transparent border px-2 py-1.5 text-[13px]"
            style={{ borderColor: "#3a3f42", color: "#e7e2d2" }}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-2 mb-2">
          {mainDice.map((dt) => (
            <DiceCounter key={dt.key} dieType={dt} count={pool[dt.key]} onChange={(v) => updateDie(dt.key, v)} />
          ))}
        </div>
        <div className="mb-4">
          <DiceCounter dieType={forceDie} count={pool.force} onChange={(v) => updateDie("force", v)} />
        </div>

        <div className="mb-3">
          <div className="text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#5a5f62" }}>Quick difficulty</div>
          <div className="flex items-center gap-2 flex-wrap">
            {[1, 2, 3, 4, 5].map((n) => {
              const id = `quick-${n}`;
              const active = selectedDifficultyPreset === id;
              return (
                <button
                  key={n}
                  onClick={() => selectDifficultyPreset(id, n)}
                  className="text-[11px] tracking-[0.1em] uppercase px-3 py-1.5 border transition-colors"
                  style={active
                    ? { background: "#8a5ec8", color: "#101315", borderColor: "#8a5ec8", fontWeight: 700 }
                    : { color: "#8a5ec8", borderColor: "#8a5ec866" }}
                >
                  {n} · {DIFFICULTY_TIER_NAMES[n]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-3">
          <div className="text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#5a5f62" }}>Range/melee difficulty</div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { n: 2, label: "Melee" },
              { n: 1, label: "Short Range" },
              { n: 2, label: "Medium Range" },
              { n: 3, label: "Long Range" },
            ].map(({ n, label }) => {
              const id = `range-${label}`;
              const active = selectedDifficultyPreset === id;
              return (
                <button
                  key={label}
                  onClick={() => selectDifficultyPreset(id, n)}
                  className="text-[11px] tracking-[0.1em] uppercase px-3 py-1.5 border transition-colors"
                  style={active
                    ? { background: "#8a5ec8", color: "#101315", borderColor: "#8a5ec8", fontWeight: 700 }
                    : { color: "#8a5ec8", borderColor: "#8a5ec866" }}
                >
                  {n} · {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-5">
          <div className="text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#5a5f62" }}>Maneuvers</div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { fn: () => addBoost(1), label: "Aim", color: "#5ec8d8" },
              { fn: () => addBoost(2), label: "Double Aim", color: "#5ec8d8" },
              { fn: () => addSetback(2), label: "Called Shot", color: "#8a8f93" },
              { fn: () => addSetback(1), label: "Double Called Shot", color: "#8a8f93" },
            ].map(({ fn, label, color }) => (
              <button
                key={label}
                onClick={fn}
                className="text-[11px] tracking-[0.1em] uppercase px-3 py-1.5 border transition-colors"
                style={{ color, borderColor: `${color}66` }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <div className="text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#5a5f62" }}>Upgrade dice</div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={upgradeAbilityToProficiency}
              disabled={(pool.ability || 0) <= 0}
              className="text-[11px] tracking-[0.1em] uppercase px-3 py-1.5"
              style={{
                background: "linear-gradient(90deg, #6fae60 0%, #6fae60 50%, #e8c547 50%, #e8c547 100%)",
                color: "#101315",
                opacity: (pool.ability || 0) <= 0 ? 0.4 : 1,
                cursor: (pool.ability || 0) <= 0 ? "not-allowed" : "pointer",
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
              }}
            >
              Spend Light Side Destiny Point (Ability → Proficiency)
            </button>
            <button
              onClick={upgradeDifficultyToChallenge}
              disabled={(pool.difficulty || 0) <= 0}
              className="text-[11px] tracking-[0.1em] uppercase px-3 py-1.5"
              style={{
                background: "linear-gradient(90deg, #8a5ec8 0%, #8a5ec8 50%, #c23b3b 50%, #c23b3b 100%)",
                color: "#f5f5f0",
                opacity: (pool.difficulty || 0) <= 0 ? 0.4 : 1,
                cursor: (pool.difficulty || 0) <= 0 ? "not-allowed" : "pointer",
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
              }}
            >
              Spend Dark Side Destiny Point (Difficulty → Challenge)
            </button>
          </div>
        </div>

        <div className="flex items-start gap-4 mb-5 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleRoll}
              className="text-[12px] tracking-[0.15em] uppercase px-5 py-2"
              style={{ background: "#ffb000", color: "#101315", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
            >
              Roll
            </button>
            <button
              onClick={() => { setPool(EMPTY_POOL); setLoadedLabel(null); setSelectedDifficultyPreset(null); }}
              className="text-[11px] tracking-[0.15em] uppercase px-4 py-2 border"
              style={{ color: "#8a8f93", borderColor: "#3a3f42" }}
            >
              Clear pool
            </button>
          </div>
          <SelectedDiceSummary pool={pool} />
        </div>

        {loadedLabel && (
          <div className="mb-4 -mt-3 text-[11px]" style={{ color: "#5ec8d8" }}>
            Loaded from {loadedLabel} — add Difficulty/Setback for the check, then Roll.
          </div>
        )}

        {difficultyTierLabel(pool) && (
          <div className="mb-5 -mt-3 text-[13px]" style={{ color: "#8a5ec8", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
            {difficultyTierLabel(pool)}
          </div>
        )}

        <div className="pt-4 border-t" style={{ borderColor: "#2a2e31" }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-y-1">
            <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: "#8a8f93" }}>Shared roll log</div>
            <div className="flex items-center gap-3">
              {logStatus.status === "error" && (
                <span className="text-[11px]" style={{ color: "#c23b3b" }}>{logStatus.msg}</span>
              )}
              <button
                onClick={() => setSoundOn((s) => !s)}
                className="text-[11px] tracking-[0.15em] uppercase px-3 py-1 border transition-colors"
                style={{ color: soundOn ? "#5ec8d8" : "#5a5f62", borderColor: soundOn ? "#5ec8d866" : "#3a3f42" }}
                title={soundOn ? "Mute sound on new rolls" : "Unmute sound on new rolls"}
              >
                {soundOn ? "🔔 Sound on" : "🔕 Muted"}
              </button>
              {log.length > 0 && (
                <button
                  onClick={handleClearLog}
                  className="text-[11px] tracking-[0.15em] uppercase px-3 py-1 border transition-colors"
                  style={{ color: "#c23b3b", borderColor: "#c23b3b44" }}
                >
                  Clear log
                </button>
              )}
            </div>
          </div>
          {log.length === 0 ? (
            <span className="text-[13px]" style={{ color: "#5a5f62" }}>
              No rolls yet.{logStatus.status === "error" ? " Shared log isn't reachable yet — see setup note in the repo README." : ""}
            </span>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {log.map((entry) => (
                <div key={entry.id} className="pb-3" style={{ borderBottom: "1px solid #2a2e31" }}>
                  <div className="flex justify-between text-[12px] mb-1.5">
                    <span style={{ color: "#5ec8d8" }}>{entry.player}</span>
                    <span style={{ color: "#5a5f62" }}>{new Date(entry.ts).toLocaleTimeString()}</span>
                  </div>
                  {entry.rolls && entry.rolls.length > 0 ? (
                    <div className="mb-1.5">
                      <RollResultsStrip rolls={entry.rolls} />
                    </div>
                  ) : entry.pool && (
                    <div className="mb-1.5">
                      <PoolIconStrip pool={entry.pool} />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-5" style={{ color: "#e7e2d2" }}>
                    {entry.netSuccess !== 0 ? (
                      <SymbolTally sym={entry.netSuccess > 0 ? "s" : "f"} count={Math.abs(entry.netSuccess)} size={42} withLabel fontSize={22} />
                    ) : (
                      <span style={{ fontSize: 22, fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>Failure</span>
                    )}
                    {entry.netAdvantage !== 0 && (
                      <SymbolTally sym={entry.netAdvantage > 0 ? "a" : "t"} count={Math.abs(entry.netAdvantage)} size={42} withLabel fontSize={22} />
                    )}
                    {entry.triumph > 0 && <SymbolTally sym="tr" count={entry.triumph} size={42} withLabel fontSize={22} />}
                    {entry.despair > 0 && <SymbolTally sym="d" count={entry.despair} size={42} withLabel fontSize={22} />}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "#5a5f62" }}>
            Rolls are computed in your browser from the exact FFG face tables, then posted to a small shared log (polled every 1.5s)
            so everyone viewing this dashboard sees the same result. Purely a shared-table convenience — it never reads or writes
            Wounds, Strain, Destiny, or any ledger data. Those stay authoritative in the GM's ledger only.
          </p>
        </div>
      </div>
    </div>
  );
}

// NPC Summary — player-facing, one-line-per-NPC readout sourced entirely
// from ledger.json's "npcs" array (itself pulled from the GM master ledger's
// NPC & Ally section). Deliberately excludes GM-only secrets, clock values,
// and anything not already written into the ledger — no field here is
// invented client-side. Grouped into NPCs currently on-site vs. off-screen
// contacts, per each entry's "status" string.
function NPCSummaryPanel({ npcs }) {
  const present = npcs.filter((n) => /^present/i.test(n.status || ""));
  const offScreen = npcs.filter((n) => !/^present/i.test(n.status || ""));

  const Card = ({ npc }) => (
    <div className="border p-3 mb-3" style={{ borderColor: "#2a2e31", background: "#101315" }}>
      <div className="flex items-start justify-between flex-wrap gap-1 mb-1">
        <span className="text-[15px]" style={{ color: "#e7e2d2", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
          {npc.name}
        </span>
        <span className="text-[10px] tracking-[0.15em] uppercase" style={{ color: "#6fae60" }}>
          {npc.role}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-2 text-[11px]" style={{ color: "#5a5f62" }}>
        <span>Species: <span style={{ color: "#8a8f93" }}>{npc.species || "Not specified in ledger"}</span></span>
        <span>Gender: <span style={{ color: "#8a8f93" }}>{npc.gender || "Not specified in ledger"}</span></span>
        <span>{npc.status}</span>
      </div>
      {npc.summary && (
        <p className="text-[13px] italic mb-1.5" style={{ color: "#e7e2d2" }}>{npc.summary}</p>
      )}
      {npc.whatPartyKnows && (
        <p className="text-[12px] leading-relaxed" style={{ color: "#8a8f93" }}>
          <span className="uppercase tracking-[0.1em]" style={{ color: "#5a5f62" }}>What the party knows — </span>
          {npc.whatPartyKnows}
        </p>
      )}
    </div>
  );

  return (
    <div className="relative overflow-hidden border" style={{ borderColor: "#3a3f42", background: "#16191b", boxShadow: "0 0 30px rgba(111,174,96,0.06)" }}>
      <div className="p-5 sm:p-7">
        <div className="text-[11px] tracking-[0.25em] uppercase mb-1" style={{ color: "#6fae60" }}>SHARED SESSION TOOL</div>
        <h1 className="text-2xl sm:text-3xl uppercase tracking-wide mb-2" style={{ color: "#e7e2d2", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
          NPC Summary
        </h1>
        <p className="text-[11px] leading-relaxed mb-5" style={{ color: "#5a5f62" }}>
          Player-facing summaries only — pulled directly from the GM's ledger, no GM-only secrets included. Anything not
          recorded in the ledger is shown as "Not specified" rather than guessed.
        </p>

        {npcs.length === 0 ? (
          <span className="text-[13px]" style={{ color: "#5a5f62" }}>No NPC data in the loaded ledger yet.</span>
        ) : (
          <>
            {present.length > 0 && (
              <div className="mb-5">
                <div className="text-[10px] tracking-[0.2em] uppercase mb-2" style={{ color: "#8a8f93" }}>On-site / Active</div>
                {present.map((npc, i) => <Card key={i} npc={npc} />)}
              </div>
            )}
            {offScreen.length > 0 && (
              <div>
                <div className="text-[10px] tracking-[0.2em] uppercase mb-2" style={{ color: "#8a8f93" }}>Off-screen Contacts</div>
                {offScreen.map((npc, i) => <Card key={i} npc={npc} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
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
            <img
              key={i}
              src={i < yellow ? YELLOW_ICON : GREEN_ICON}
              alt={i < yellow ? "Proficiency die" : "Ability die"}
              className="w-2.5 h-2.5"
              style={{ display: "block" }}
            />
          ))}
        </span>
      )}
      {boost > 0 && (
        <span
          className="text-[10px] leading-none inline-flex items-center gap-0.5"
          style={{ color: "#5ec8d8" }}
          title={`+${boost} Boost die from talents`}
        >
          <img src={BOOST_ICON} alt="Boost" style={{ width: 10, height: 10, display: "inline-block" }} />
          {boost > 1 ? `×${boost}` : ""}
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

  const [playerName, setPlayerName] = useState(() => {
    try { return localStorage.getItem("swrpg-dice-player-name") || ""; } catch { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem("swrpg-dice-player-name", playerName); } catch { /* ignore */ }
  }, [playerName]);

  // Clicking a skill's dice pips (Character Sheet tab or Party View table)
  // jumps to the Dice Roller with that skill's Proficiency/Ability/talent-
  // Boost dice preloaded. diceSeedRef guarantees a fresh nonce every click,
  // even re-clicking the same skill, so DiceRollerPanel's effect always
  // re-applies it instead of bailing out on an unchanged dependency.
  const [dicePreset, setDicePreset] = useState(null);
  const diceSeedRef = useRef(0);
  function loadSkillIntoRoller(skill, characterName) {
    const proficiency = Math.min(skill.rank, skill.characteristic);
    const ability = Math.max(skill.rank, skill.characteristic) - proficiency;
    diceSeedRef.current += 1;
    setDicePreset({
      pool: { ...EMPTY_POOL, proficiency, ability, boost: skill.boost || 0 },
      label: `${characterName} — ${skill.name}`,
      nonce: diceSeedRef.current,
    });
    // Jumping to the roller from a skill click means "I'm rolling as this
    // character" — auto-fill Your Name so the shared log attributes it
    // correctly without the player having to type it themselves.
    if (characterName) setPlayerName(characterName);
    setViewMode("dice");
  }

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
  const gearItems = [
    ...weapons.map((w) => ({ name: w.name, note: `${w.skill} · Dmg ${w.damage} · Crit ${w.crit} · ${w.range}` })),
    ...(armor.name ? [{ name: armor.name, note: `+${armor.soakBonus ?? 0} Soak · Defense (R/M) ${activeDefense.ranged}/${activeDefense.melee}` }] : []),
    ...inv,
  ];

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
            <button
              onClick={() => setViewMode("dice")}
              className="text-[12px] tracking-wide px-3 py-1.5 border transition-colors"
              style={{
                color: viewMode === "dice" ? "#101315" : "#e7e2d2",
                background: viewMode === "dice" ? "#5ec8d8" : "transparent",
                borderColor: viewMode === "dice" ? "#5ec8d8" : "#3a3f42",
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
              }}
            >
              🎲 Dice Roller
            </button>
            <button
              onClick={() => setViewMode("npc")}
              className="text-[12px] tracking-wide px-3 py-1.5 border transition-colors"
              style={{
                color: viewMode === "npc" ? "#101315" : "#e7e2d2",
                background: viewMode === "npc" ? "#6fae60" : "transparent",
                borderColor: viewMode === "npc" ? "#6fae60" : "#3a3f42",
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
              }}
            >
              🗒 NPC Summary
            </button>
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

        {viewMode === "dice" ? (
          <DiceRollerPanel playerName={playerName} setPlayerName={setPlayerName} preset={dicePreset} partyDestiny={partyDestiny} />
        ) : viewMode === "npc" ? (
          <NPCSummaryPanel npcs={ledger.npcs || []} />
        ) : viewMode === "party" ? (
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
                  <img src={YELLOW_ICON} alt="Proficiency die" className="w-2.5 h-2.5 inline-block" /> proficiency dice
                </span>
                <span className="flex items-center gap-1">
                  <img src={GREEN_ICON} alt="Ability die" className="w-2.5 h-2.5 inline-block" /> ability dice
                </span>
                <span className="flex items-center gap-1" style={{ color: "#5ec8d8" }}><img src={BOOST_ICON} alt="Boost" style={{ width: 12, height: 12, display: "inline-block" }} /> talent boost die</span>
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
                                  <button
                                    onClick={() => s && loadSkillIntoRoller(s, party[ci]?.name || `Character ${ci + 1}`)}
                                    title="Load into Dice Roller"
                                    className="hover:opacity-80 transition-opacity"
                                  >
                                    <SkillPips rank={s?.rank ?? 0} characteristic={s?.characteristic ?? 0} boost={s?.boost ?? 0} />
                                  </button>
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
                    {gearItems.length === 0 && <span className="text-[13px]" style={{ color: "#5a5f62" }}>No items recorded.</span>}
                    {gearItems.map((item, i) => (
                      <div key={i} className="text-[13px] pb-2" style={{ borderBottom: i < gearItems.length - 1 ? "1px solid #2a2e31" : "none" }}>
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
                        <img src={YELLOW_ICON} alt="Proficiency die" className="w-2.5 h-2.5 inline-block" /> proficiency
                      </span>
                      <span className="flex items-center gap-1" style={{ color: "#8a8f93" }}>
                        <img src={GREEN_ICON} alt="Ability die" className="w-2.5 h-2.5 inline-block" /> ability
                      </span>
                      <span style={{ color: "#5ec8d8" }}>career skill</span>
                      <span className="inline-flex items-center gap-1" style={{ color: "#5ec8d8" }}><img src={BOOST_ICON} alt="Boost" style={{ width: 12, height: 12, display: "inline-block" }} /> talent boost</span>
                    </div>
                  </div>
                  {["General", "Combat", "Knowledge"].map((group) => (
                    <div key={group} className="mb-3 last:mb-0">
                      <div className="text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "#5a5f62" }}>{group}</div>
                      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                        {skills.filter((s) => s.group === group).map((s, i) => (
                          <button
                            key={i}
                            onClick={() => loadSkillIntoRoller(s, active.name || "Unknown")}
                            title="Load into Dice Roller"
                            className="text-[13px] flex items-center justify-between gap-3 text-left hover:opacity-80 transition-opacity"
                          >
                            <span style={{ color: s.career ? "#5ec8d8" : "#e7e2d2" }}>{s.name}</span>
                            <SkillPips rank={s.rank} characteristic={s.characteristic} boost={s.boost} />
                          </button>
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
