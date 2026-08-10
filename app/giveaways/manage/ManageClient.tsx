"use client";

import { useCallback, useEffect, useState } from "react";
import { timeLeft, type GiveawayCard } from "../GiveawaysClient";
import styles from "../giveaways.module.css";

// The desk itself. Three states: not signed in (Discord button), signed in
// without the role (a polite refusal), manager (the form + the table).
//
// The draw button is deliberately TWO clicks — "Draw" then "Confirm" — because
// a draw freezes the list forever and browsers' confirm() is both ugly and
// blockable. Same pattern for cancel.

const fmt = (n: number) => n.toLocaleString("en-US");

type Me = { discordId: string; username: string; avatar: string | null; manager: boolean };

const DURATIONS: { label: string; hours: number }[] = [
  { label: "6 hours", hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "24 hours", hours: 24 },
  { label: "48 hours", hours: 48 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
];

export default function ManageClient() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = loading
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const e = p.get("auth_error");
    if (e) setAuthError(e);
    fetch("/api/auth/discord/me")
      .then((r) => r.json())
      .then((j: { session: Me | null }) => setMe(j.session))
      .catch(() => setMe(null));
  }, []);

  const logout = useCallback(() => {
    fetch("/api/auth/discord/me", { method: "POST" }).then(() => setMe(null));
  }, []);

  return (
    <main className={styles.wrap}>
      <header className={styles.hero}>
        <span className={styles.kicker}>🗝 Collab managers only</span>
        <h1 className={styles.title}>THE DESK</h1>
        <p className={styles.lead}>
          Hang a partner giveaway on the wall, close it, draw it, and hand the winner list over.
        </p>
      </header>

      {authError ? <p className={styles.notice}>Discord sign-in failed: {authError}</p> : null}

      {me === undefined ? (
        <p className={styles.empty}>Checking who&apos;s at the desk…</p>
      ) : me === null ? (
        <div className={styles.desk} style={{ textAlign: "center" }}>
          <p className={styles.prize} style={{ margin: "0 auto 1rem" }}>
            The desk opens with a Discord login. No wallet needed on this side.
          </p>
          <a className={styles.discordBtn} href="/api/auth/discord/login">
            Sign in with Discord
          </a>
        </div>
      ) : !me.manager ? (
        <div className={styles.desk}>
          <div className={styles.deskHead}>
            <span className={styles.deskWho}>
              Signed in as <b>{me.username}</b>
            </span>
            <button className={styles.linkBtn} onClick={logout}>
              Sign out
            </button>
          </div>
          <p className={styles.notice}>
            This account isn&apos;t on the collab managers list. Ask the museum to hand you the
            Collab Manager role in the Cubist souls server, then sign in again.
          </p>
        </div>
      ) : (
        <Desk me={me} onLogout={logout} />
      )}
    </main>
  );
}

function Desk({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [list, setList] = useState<GiveawayCard[] | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const reload = useCallback(() => {
    fetch("/api/giveaways")
      .then((r) => r.json())
      .then((j: { giveaways: GiveawayCard[] }) => setList(j.giveaways ?? []))
      .catch(() => setList([]));
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <>
      <div className={styles.desk}>
        <div className={styles.deskHead}>
          <span className={styles.deskWho}>
            At the desk: <b>{me.username}</b>
          </span>
          <span className={styles.badge}>Collab Manager</span>
          <span className={styles.rowSpacer}>
            <a className={styles.linkBtn} href="/giveaways">
              See the wall →
            </a>
            <button className={styles.linkBtn} onClick={onLogout}>
              Sign out
            </button>
          </span>
        </div>
        <CreateForm onCreated={reload} />
      </div>

      <div className={styles.desk}>
        <span className={styles.label}>Every giveaway on the wall</span>
        {list === null ? (
          <p className={styles.empty}>Loading…</p>
        ) : list.length === 0 ? (
          <p className={styles.empty}>Nothing yet. The form above hangs the first one.</p>
        ) : (
          <div className={styles.rows}>
            {list.map((g) => (
              <Row key={g.id} g={g} now={now} onChanged={reload} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [prize, setPrize] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [winners, setWinners] = useState("10");
  const [hours, setHours] = useState("24");
  const [requireSouls, setRequireSouls] = useState("0");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setMsg(null);
    setBusy(true);
    try {
      const r = await fetch("/api/giveaways/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title,
          project,
          prize,
          imageUrl,
          projectUrl,
          winnersCount: Number(winners),
          endsAt: Math.floor(Date.now() / 1000) + Number(hours) * 3600,
          requireSouls: Number(requireSouls),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "could not create");
      setMsg(`Hung on the wall — giveaway #${j.giveaway.id}. SoulWatcher will announce it within a minute.`);
      setTitle("");
      setProject("");
      setPrize("");
      setImageUrl("");
      setProjectUrl("");
      onCreated();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }, [title, project, prize, imageUrl, projectUrl, winners, hours, requireSouls, onCreated]);

  return (
    <div className={styles.form}>
      <div>
        <label className={styles.label}>Title</label>
        <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="50 WL spots — Partner mint" maxLength={80} />
      </div>
      <div>
        <label className={styles.label}>Project</label>
        <input className={styles.input} value={project} onChange={(e) => setProject(e.target.value)} placeholder="The partner collection" maxLength={60} />
      </div>
      <div className={styles.full}>
        <label className={styles.label}>Prize — what winning gets you</label>
        <input className={styles.input} value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="Whitelist spot for the mint on …" maxLength={240} />
      </div>
      <div>
        <label className={styles.label}>Image URL (optional)</label>
        <input className={styles.input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
      </div>
      <div>
        <label className={styles.label}>Project link (optional)</label>
        <input className={styles.input} value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} placeholder="https://x.com/…" />
      </div>
      <div>
        <label className={styles.label}>Winners</label>
        <input className={styles.input} value={winners} onChange={(e) => setWinners(e.target.value)} inputMode="numeric" />
      </div>
      <div>
        <label className={styles.label}>Entries close in</label>
        <select className={styles.input} value={hours} onChange={(e) => setHours(e.target.value)}>
          {DURATIONS.map((d) => (
            <option key={d.hours} value={d.hours}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={styles.label}>Souls required to enter</label>
        <input className={styles.input} value={requireSouls} onChange={(e) => setRequireSouls(e.target.value)} inputMode="numeric" />
        <p className={styles.hint}>0 = anyone with a wallet may enter; 1+ checks the balance on entry.</p>
      </div>
      <div className={styles.full}>
        <button className={styles.enterBtn} onClick={submit} disabled={busy}>
          {busy ? "Hanging…" : "Hang it on the wall"}
        </button>
      </div>
      {msg ? (
        <p className={`${styles.full} ${styles.hint}`} role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

function Row({ g, now, onChanged }: { g: GiveawayCard; now: number; onChanged: () => void }) {
  const [arm, setArm] = useState<"draw" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = g.status === "open" && now < g.endsAt;
  const ended = g.status === "open" && now >= g.endsAt;

  const act = useCallback(
    async (action: "draw" | "cancel") => {
      setBusy(true);
      setErr(null);
      try {
        const r = await fetch("/api/giveaways/manage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // drawing while entries are still open is an explicit early close
          body: JSON.stringify({ action, id: g.id, ...(action === "draw" && open ? { force: true } : {}) }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "failed");
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "failed");
      } finally {
        setBusy(false);
        setArm(null);
      }
    },
    [g.id, open, onChanged],
  );

  return (
    <div className={styles.row}>
      <span className={styles.rowTitle}>
        #{g.id} · {g.title}
      </span>
      <span className={styles.rowMeta}>
        {g.status === "drawn"
          ? `drawn · ${g.winners.length} winner${g.winners.length === 1 ? "" : "s"}`
          : g.status === "cancelled"
            ? "cancelled"
            : open
              ? `open · closes in ${timeLeft(g.endsAt, now)}`
              : "ended — waiting for the draw"}{" "}
        · {fmt(g.entries)} in
      </span>
      <span className={styles.rowSpacer}>
        {g.status === "open" ? (
          arm ? (
            <>
              <button className={`${styles.actBtn} ${styles.actDanger}`} onClick={() => act(arm)} disabled={busy}>
                {busy ? "…" : arm === "draw" ? (open ? "Confirm — close early & draw" : "Confirm draw") : "Confirm cancel"}
              </button>
              <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => setArm(null)} disabled={busy}>
                Keep it
              </button>
            </>
          ) : (
            <>
              <button className={styles.actBtn} onClick={() => setArm("draw")}>
                {ended ? "Draw winners" : "Draw…"}
              </button>
              <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => setArm("cancel")}>
                Cancel…
              </button>
            </>
          )
        ) : null}
        <a className={`${styles.actBtn} ${styles.actQuiet}`} href={`/api/giveaways/manage?id=${g.id}&csv=entries`}>
          Entries CSV
        </a>
        {g.status === "drawn" ? (
          <a className={styles.actBtn} href={`/api/giveaways/manage?id=${g.id}&csv=winners`}>
            Winners CSV
          </a>
        ) : null}
      </span>
      {err ? <p className={styles.err}>{err}</p> : null}
    </div>
  );
}
