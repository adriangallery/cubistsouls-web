"use client";

import { useMemo, useState } from "react";
import SoulCard from "../components/SoulCard";

// Client-side grid + trait filter for THE FREED. The server hands us the roster
// of freed ids (ISR); everything below is pure client data — no wallet needed.
//
// Filter fields (AND-combined, DESIGN_SYSTEM "Filter by trait"):
//   • 8 canvas categories  → traits/index.json  (packed string decode)
//   • Rarity               → rarity/rarity.json
//   • Cohort               → cohorts/cohorts.json snapshot
// The on-chain multicall delta hydration from the legacy page is NOT ported in
// W1 (souls freed after the last snapshot simply lack a cohort until the mirror
// refreshes ~6h); every other field is exact.

const RAW = "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main";
const COHORT_NAMES = ["OG", "Era I", "Era II", "Era III", "Era IV"];
const CANVAS_CATS = ["Art Background", "Base", "Clothes", "Mouth", "Head", "Left Eye", "Nose", "Right Eye"];

type TraitsIdx = { base: number; values: Record<string, string[]>; tokens: Record<string, string> };
type RarityIdx = { tierNames: string[]; tierEmoji: string[]; tiers: string };
type CohortIdx = Record<string, number>;

type Cat = {
  key: string;
  label: string;
  values: () => string[];
  valueOf: (id: number) => string | null;
  badge?: (v: string) => string;
};

export default function GalleryGrid({ freed }: { freed: number[] }) {
  const [open, setOpen] = useState(false);
  const [traits, setTraits] = useState<TraitsIdx | null>(null);
  const [rarity, setRarity] = useState<RarityIdx | null>(null);
  const [cohorts, setCohorts] = useState<CohortIdx | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});

  async function ensureData() {
    if (traits && rarity && cohorts) return;
    setLoading(true);
    setErr(false);
    try {
      const [t, r, c] = await Promise.all([
        traits ? Promise.resolve(traits) : fetch(`${RAW}/traits/index.json`, { cache: "force-cache" }).then((x) => x.json()),
        rarity ? Promise.resolve(rarity) : fetch(`${RAW}/rarity/rarity.json`, { cache: "force-cache" }).then((x) => x.json()),
        cohorts ? Promise.resolve(cohorts) : fetch(`${RAW}/cohorts/cohorts.json`, { cache: "no-cache" }).then((x) => x.json()).then((j) => j.cohorts || {}),
      ]);
      setTraits(t); setRarity(r); setCohorts(c);
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) ensureData();
  }

  const registry: Cat[] = useMemo(() => {
    const cats: Cat[] = [];
    if (traits) {
      for (const c of CANVAS_CATS) {
        if (!traits.values[c] || !traits.tokens[c]) continue;
        cats.push({
          key: c,
          label: c,
          values: () => traits.values[c],
          valueOf: (id) => traits.values[c][traits.tokens[c].charCodeAt(id - 1) - traits.base] ?? null,
        });
      }
    }
    if (cohorts) {
      cats.push({
        key: "Cohort",
        label: "Cohort",
        values: () => COHORT_NAMES,
        valueOf: (id) => {
          const v = cohorts[String(id)];
          return v === undefined ? null : COHORT_NAMES[v] ?? null;
        },
      });
    }
    if (rarity) {
      cats.push({
        key: "Rarity",
        label: "Rarity",
        values: () => [4, 3, 2, 1, 0].map((t) => rarity.tierNames[t]),
        valueOf: (id) => rarity.tierNames[Number(rarity.tiers[id - 1])] ?? null,
        badge: (v) => `${rarity.tierEmoji[rarity.tierNames.indexOf(v)] || ""} ${v}`.trim(),
      });
    }
    return cats;
  }, [traits, rarity, cohorts]);

  const active = Object.entries(filters).filter(([, v]) => v);

  const shown = useMemo(() => {
    if (!active.length) return freed;
    const byKey = Object.fromEntries(registry.map((c) => [c.key, c]));
    return freed.filter((id) => active.every(([k, v]) => byKey[k]?.valueOf(id) === v));
  }, [freed, active, registry]);

  // per-value counts among currently-shown (for the selects), computed lazily
  function countsFor(cat: Cat): Map<string, number> {
    const m = new Map<string, number>();
    for (const id of freed) {
      const v = cat.valueOf(id);
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return m;
  }

  function badgeFor(id: number): string | undefined {
    if (!active.length) return undefined;
    const byKey = Object.fromEntries(registry.map((c) => [c.key, c]));
    const parts = active.map(([k]) => {
      const cat = byKey[k];
      const v = cat?.valueOf(id);
      return v ? (cat!.badge ? cat!.badge(v) : v) : null;
    }).filter(Boolean);
    return parts.length ? (parts.join(" · ") as string) : undefined;
  }

  return (
    <>
      {/* The prominent count lives in the page-level tally now; here we only surface
          the filtered subset so the two numbers never compete. */}
      {active.length > 0 && (
        <div className="freed-count">
          <b>{shown.length.toLocaleString("en-US")}</b> souls match · filtered
        </div>
      )}

      <div className="filterbar">
        <button className="fpill" type="button" aria-expanded={open} onClick={toggle}>
          <span className="ic">⌕</span>
          <span className="lbl">Filter by trait</span>
          {active.length ? <span className="n">{active.length}</span> : null}
        </button>

        {open && (
          <div className="fpanel">
            {loading && <div className="fhead">Loading trait index…</div>}
            {err && (
              <div className="fhead">
                Filter unavailable right now.{" "}
                <button className="fclear" style={{ display: "inline" }} onClick={ensureData}>retry</button>
              </div>
            )}
            {!loading && !err && registry.length > 0 && (
              <>
                <div className="fhead">
                  Counts are among the <b>{freed.length.toLocaleString("en-US")}</b> souls freed
                </div>
                <div className="fgrid">
                  {registry.map((cat) => {
                    const counts = countsFor(cat);
                    const opts = cat.values().filter((v) => (counts.get(v) || 0) > 0);
                    return (
                      <div className="field" key={cat.key}>
                        <label htmlFor={`f-${cat.key}`}>{cat.label}</label>
                        <select
                          id={`f-${cat.key}`}
                          value={filters[cat.key] || ""}
                          onChange={(e) => setFilters((f) => ({ ...f, [cat.key]: e.target.value }))}
                        >
                          <option value="">Any</option>
                          {opts.map((v) => (
                            <option key={v} value={v}>
                              {v} ({counts.get(v)})
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                {active.length > 0 && (
                  <div className="fclear">
                    <button onClick={() => setFilters({})}>Clear all filters</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="gempty">
          No souls match these traits. <button className="fclear" style={{ display: "inline" }} onClick={() => setFilters({})}>Clear filters</button>
        </div>
      ) : (
        <div className="grid">
          {shown.map((id, i) => (
            <SoulCard key={id} id={id} eager={i < 12} badge={badgeFor(id)} status="Freed" />
          ))}
        </div>
      )}
    </>
  );
}
