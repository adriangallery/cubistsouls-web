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

/** What Clone hands back to the form — everything but the clock. */
export type Prefill = {
  title: string;
  project: string;
  prize: string;
  imageUrl: string;
  projectUrl: string;
  winnersCount: number;
  requireSouls: number;
  autoDraw: boolean;
};

function Desk({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [list, setList] = useState<GiveawayCard[] | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [prefill, setPrefill] = useState<Prefill | null>(null);

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

  const clone = useCallback((g: GiveawayCard) => {
    setPrefill({
      title: g.title,
      project: g.project,
      prize: g.prize,
      imageUrl: g.imageUrl,
      projectUrl: g.projectUrl,
      winnersCount: g.winnersCount,
      requireSouls: g.requireSouls,
      autoDraw: g.autoDraw === true,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

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
        <CreateForm onCreated={reload} prefill={prefill} />
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
              <Row key={g.id} g={g} now={now} onChanged={reload} onClone={clone} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CreateForm({ onCreated, prefill }: { onCreated: () => void; prefill: Prefill | null }) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [prize, setPrize] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [winners, setWinners] = useState("10");
  const [hours, setHours] = useState("24");
  const [requireSouls, setRequireSouls] = useState("0");
  const [autoDraw, setAutoDraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Clone = the previous occasion poured back into the form, fresh clock.
  useEffect(() => {
    if (!prefill) return;
    setTitle(prefill.title);
    setProject(prefill.project);
    setPrize(prefill.prize);
    setImageUrl(prefill.imageUrl);
    setProjectUrl(prefill.projectUrl);
    setWinners(String(prefill.winnersCount));
    setRequireSouls(String(prefill.requireSouls));
    setAutoDraw(prefill.autoDraw);
    setMsg("Cloned — adjust what changed and hang it.");
  }, [prefill]);

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
          autoDraw,
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
  }, [title, project, prize, imageUrl, projectUrl, winners, hours, requireSouls, autoDraw, onCreated]);

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
      <div>
        <label className={styles.label}>Draw</label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={autoDraw} onChange={(e) => setAutoDraw(e.target.checked)} />
          <span>Auto-draw the winners the moment entries close</span>
        </label>
        <p className={styles.hint}>Off = you press Draw yourself when it suits the partner.</p>
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

function Row({
  g,
  now,
  onChanged,
  onClone,
}: {
  g: GiveawayCard;
  now: number;
  onChanged: () => void;
  onClone: (g: GiveawayCard) => void;
}) {
  const [arm, setArm] = useState<"draw" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showWinners, setShowWinners] = useState(false);
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
    <div className={styles.rowWrap}>
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
                ? `open · closes in ${timeLeft(g.endsAt, now)}${g.autoDraw ? " · auto-draw" : ""}`
                : g.autoDraw
                  ? "ended — auto-draw imminent"
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
                <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => setEditing((v) => !v)}>
                  {editing ? "Close editor" : "Edit"}
                </button>
                <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => setArm("cancel")}>
                  Cancel…
                </button>
              </>
            )
          ) : null}
          {g.status === "drawn" && g.winners.length > 0 ? (
            <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => setShowWinners((v) => !v)}>
              {showWinners ? "Hide winners" : "Winners / re-roll"}
            </button>
          ) : null}
          <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => onClone(g)}>
            Clone
          </button>
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
      {editing && g.status === "open" ? <EditForm g={g} onSaved={() => { setEditing(false); onChanged(); }} /> : null}
      {showWinners && g.status === "drawn" ? <WinnerList g={g} onChanged={onChanged} /> : null}
    </div>
  );
}

/** Amend an open giveaway in place. The clock field EXTENDS from now — a
 *  blank keeps the current close. */
function EditForm({ g, onSaved }: { g: GiveawayCard; onSaved: () => void }) {
  const [title, setTitle] = useState(g.title);
  const [prize, setPrize] = useState(g.prize);
  const [imageUrl, setImageUrl] = useState(g.imageUrl);
  const [projectUrl, setProjectUrl] = useState(g.projectUrl);
  const [winners, setWinners] = useState(String(g.winnersCount));
  const [requireSouls, setRequireSouls] = useState(String(g.requireSouls));
  const [autoDraw, setAutoDraw] = useState(g.autoDraw === true);
  const [extend, setExtend] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        action: "edit",
        id: g.id,
        title,
        prize,
        imageUrl,
        projectUrl,
        winnersCount: Number(winners),
        requireSouls: Number(requireSouls),
        autoDraw,
      };
      if (extend) payload.endsAt = Math.floor(Date.now() / 1000) + Number(extend) * 3600;
      const r = await fetch("/api/giveaways/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "could not save");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not save");
    } finally {
      setBusy(false);
    }
  }, [g.id, title, prize, imageUrl, projectUrl, winners, requireSouls, autoDraw, extend, onSaved]);

  return (
    <div className={styles.editBox}>
      <div className={styles.form}>
        <div>
          <label className={styles.label}>Title</label>
          <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label className={styles.label}>Winners</label>
          <input className={styles.input} value={winners} onChange={(e) => setWinners(e.target.value)} inputMode="numeric" />
        </div>
        <div className={styles.full}>
          <label className={styles.label}>Prize</label>
          <input className={styles.input} value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={240} />
        </div>
        <div>
          <label className={styles.label}>Image URL</label>
          <input className={styles.input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </div>
        <div>
          <label className={styles.label}>Project link</label>
          <input className={styles.input} value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} />
        </div>
        <div>
          <label className={styles.label}>Souls required</label>
          <input className={styles.input} value={requireSouls} onChange={(e) => setRequireSouls(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className={styles.label}>New close (from now)</label>
          <select className={styles.input} value={extend} onChange={(e) => setExtend(e.target.value)}>
            <option value="">keep the current close</option>
            {DURATIONS.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.full}>
          <label className={styles.checkRow}>
            <input type="checkbox" checked={autoDraw} onChange={(e) => setAutoDraw(e.target.checked)} />
            <span>Auto-draw at close</span>
          </label>
        </div>
        <div className={styles.full}>
          <button className={styles.enterBtn} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
        {err ? <p className={`${styles.full} ${styles.err}`}>{err}</p> : null}
      </div>
    </div>
  );
}

/** The drawn list with Alphabot's most-asked-for button: re-roll one seat. */
function WinnerList({ g, onChanged }: { g: GiveawayCard; onChanged: () => void }) {
  const [arm, setArm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = g.winnersInfo?.length
    ? g.winnersInfo
    : g.winners.map((address) => ({ address, username: null as string | null }));

  const reroll = useCallback(
    async (address: string) => {
      setBusy(true);
      setErr(null);
      try {
        const r = await fetch("/api/giveaways/manage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reroll", id: g.id, address }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "could not re-roll");
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "could not re-roll");
      } finally {
        setBusy(false);
        setArm(null);
      }
    },
    [g.id, onChanged],
  );

  return (
    <div className={styles.editBox}>
      <span className={styles.label}>Winners — re-roll replaces a seat with a substitute drawn from the same seed chain</span>
      <div className={styles.rows}>
        {info.map((w) => (
          <div key={w.address} className={styles.row}>
            <span className={styles.rowTitle}>
              {w.address.slice(0, 8)}…{w.address.slice(-6)}
              {w.username ? ` · @${w.username}` : ""}
            </span>
            <span className={styles.rowSpacer}>
              {arm === w.address ? (
                <>
                  <button className={`${styles.actBtn} ${styles.actDanger}`} onClick={() => reroll(w.address)} disabled={busy}>
                    {busy ? "…" : "Confirm re-roll"}
                  </button>
                  <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => setArm(null)} disabled={busy}>
                    Keep
                  </button>
                </>
              ) : (
                <button className={`${styles.actBtn} ${styles.actQuiet}`} onClick={() => setArm(w.address)}>
                  Re-roll…
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {(g as unknown as { rerolls?: { out: string; in: string | null }[] }).rerolls?.length ? (
        <p className={styles.hint}>
          {(g as unknown as { rerolls: { out: string; in: string | null }[] }).rerolls.length} re-roll
          {(g as unknown as { rerolls: { out: string; in: string | null }[] }).rerolls.length === 1 ? "" : "s"} so far —
          each one is recorded and replayable.
        </p>
      ) : null}
      {err ? <p className={styles.err}>{err}</p> : null}
    </div>
  );
}
