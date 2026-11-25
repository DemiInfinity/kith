// My Pip: there's only one Pip, the friend she chats with. Make it in 3D (describe it, or pick the
// parts), see its moods, and save it: saving replaces the old look and makes the chat picture.

import { useEffect, useRef, useState } from "react";
import { api, type Me } from "../api";
import { Avatar } from "../components/Avatar";
import { PICTURE_MOODS, pipPictureUrl, setPipPicture, usePipPicture } from "../components/CompanionPic";
import type { PipStage } from "../pip3d/engine";
import { DEFAULT_LOOK, normaliseLook, type Look } from "../pip3d/look";
import { ago, DescribePanel, fileName, LookPanel, MakerStage, MakerTabs, MoodPanel, savePng, SnapMenu, useSay, useStill } from "../pip3d/Maker";
import { action } from "../lib/action";

type Tab = "describe" | "look" | "mood" | "chat";

export function MyPip({ me }: { me: Me }) {
  const companion = me.profile.name;
  const [look, setLook] = useState<Look | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("describe");
  const [still, setStill] = useStill();
  const [stage, setStage] = useState<PipStage | null>(null);
  const [say, setSay] = useSay();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [needsMoods, setNeedsMoods] = useState(false);
  const pic = usePipPicture();

  useEffect(() => {
    api<{ look: Look | null; updated: number | null; picture: boolean; moods?: boolean }>("/api/pip/look")
      .then((r) => { setLook(r.look ? normaliseLook(r.look) : { ...DEFAULT_LOOK, name: companion }); setSavedAt(r.updated); setNeedsMoods(!!r.look && r.picture && !r.moods); })
      .catch(() => setLook({ ...DEFAULT_LOOK, name: companion }));
  }, [companion]);
  const change = (l: Look) => { setLook(l); setDirty(true); };

  // The chat picture, kept in step with the look while its tab is open.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (tab !== "chat" || !stage) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { try { setPreview(stage.snapshot("portrait", 160, false).toDataURL("image/png")); } catch { /* the saved one shows */ } }, 350);
    return () => clearTimeout(timer.current);
  }, [tab, stage, look]);

  // A Pip saved before the mood stills existed: make them once, quietly, with the saved look.
  const filling = useRef(false);
  useEffect(() => {
    if (!needsMoods || !stage || !look || dirty || filling.current) return;
    const t = setTimeout(() => {
      filling.current = true; setNeedsMoods(false);
      try {
        const picture = stage.snapshot("portrait", 256, false).toDataURL("image/png");
        const moods = stage.moodPictures(PICTURE_MOODS, 256);
        void api<{ updated: number; picture: boolean }>("/api/pip/look", { method: "PUT", body: { look, picture, moods } })
          .then((r) => { if (r.picture) setPipPicture(r.updated); }).catch(() => undefined);
      } catch { /* try again next time */ }
    }, 800);
    return () => clearTimeout(t);
  }, [needsMoods, stage, look, dirty]);

  const save = action(async () => {
    if (!look) return;
    setBusy(true);
    try {
      const picture = stage ? stage.snapshot("portrait", 256, false).toDataURL("image/png") : null;
      const moods = stage ? stage.moodPictures(PICTURE_MOODS, 256) : {};
      const r = await api<{ updated: number; picture: boolean }>("/api/pip/look", { method: "PUT", body: { look, picture, moods } });
      setSavedAt(r.updated); setDirty(false);
      if (r.picture) setPipPicture(r.updated);
      setSay(`Saved. This is me now!`);
    } finally {
      setBusy(false);
    }
  }, `save ${companion}`);

  if (!look) return <div className="screen" aria-busy="true"><span className="typing" aria-hidden><i /><i /><i /></span></div>;
  const status = dirty ? "Not saved yet" : savedAt ? `Saved · ${ago(savedAt)}` : "Not saved yet";
  const shown = preview || (pic !== null ? pipPictureUrl(pic) : "");
  const fallback = pic !== null ? <img src={pipPictureUrl(pic)} alt={`${companion}’s picture`} /> : <Avatar look={me.profile.look} size={180} variant="ring" />;

  return (
    <div className="screen maker-screen">
      <div className="mk-head"><h2 className="screen-title">My {companion}</h2><span className="hand">there’s only one {companion}: the friend you chat with. Make it look however you like.</span></div>
      <div className="maker">
        <MakerStage look={look} still={still} onStage={setStage} title={look.name || companion} say={say} fallback={fallback}
          menu={<SnapMenu stage={stage} name={look.name || companion} fallbackName="pip" />} />
        <section className="mk-panel" aria-label={`Make your ${companion}`}>
          <MakerTabs label="Maker sections" tab={tab} setTab={setTab} tabs={[["describe", "Describe"], ["look", "Look"], ["mood", "Mood"], ["chat", "Chat picture"]]} />
          <div className="mk-body" role="tabpanel">
            {tab === "describe" && <DescribePanel forWhat="pip" look={look} setLook={change} say={setSay} companion={companion} />}
            {tab === "look" && <LookPanel forWhat="pip" look={look} setLook={change} companion={companion} />}
            {tab === "mood" && <MoodPanel forWhat="pip" look={look} setLook={change} still={still} setStill={setStill} companion={companion} />}
            {tab === "chat" && (
              <div className="mk-pane">
                <h2>Chat picture</h2>
                <p className="mk-sub">Made from {companion}’s 3D look, so it always matches. It shows at the top of chat, in your profile panel and in {me.parentLabel}’s view once you save.</p>
                <div className="mk-chatmock">
                  {shown ? <img className="mk-dp" src={shown} alt={`${companion}’s chat picture`} /> : <Avatar look={me.profile.look} size={56} variant="side" />}
                  <div className="mk-bubble"><b>{companion}</b>Hiya! Ready when you are.</div>
                </div>
                {shown && (
                  <div className="mk-sizes">
                    {[96, 44, 28].map((s) => <img key={s} src={shown} alt="" width={s} height={s} />)}
                    <span className="small">profile · chat · small</span>
                  </div>
                )}
                <button className="btn ghost" disabled={!stage} onClick={() => stage && void savePng(stage.snapshot("portrait", 1024, false), fileName(look.name, "pip", "picture"))}>Download {companion}’s picture</button>
              </div>
            )}
          </div>
          <div className="mk-foot">
            <span className="mk-status" role="status">{status}<span className="mk-long"> · only one {companion}, saving replaces the old look</span></span>
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : `Save as my ${companion}`}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
