import React, { useCallback, useEffect, useState } from "react";
import DocWizard from "./DocWizard.jsx";
import DocOutline from "./DocOutline.jsx";
import DocProgress from "./DocProgress.jsx";
import { fmtTokens } from "./TokenConfirm.jsx";
import "./docgen.css";

// Tab "📚 Tài liệu" (MH 1). Every document set on this board belongs to the project that is open:
// they differ by the standard applied, never by product (Q6). One card = one set = 1..n files.

// `pct` is the fallback for the stages that have no real progress number yet. Once writing starts,
// the ring shows how much content exists (job.progress), not a stage guess.
const STATUS = {
  draft: { pill: "", text: "⏸ chưa khảo sát", ring: "", pct: 0 },
  surveying: { pill: "run", text: "🔎 đang khảo sát", ring: "run", pct: 45 },
  "plan-review": { pill: "acc", text: "⏸ chờ duyệt dàn ý", ring: "", pct: 100 },
  "plan-approved": { pill: "ok", text: "✓ dàn ý đã chốt", ring: "ok", pct: 100 },
  writing: { pill: "run", text: "▶ đang viết", ring: "run", pct: 0 },
  editing: { pill: "ok", text: "✓ đã viết xong", ring: "ok", pct: 100 },
  paused: { pill: "", text: "⏸ đã tạm dừng", ring: "run", pct: 0 },
  ready: { pill: "ok", text: "✓ sẵn sàng", ring: "ok", pct: 100 },
  error: { pill: "err", text: "✖ lỗi", ring: "err", pct: 100 },
};

// Which stages have content to show, i.e. when the card offers "Tiến độ →" instead of the outline.
const WRITTEN_STAGES = ["writing", "editing", "paused", "ready"];

// `view` đến từ URL (App.jsx → router.js), không còn là state nội bộ. Đó là điểm sửa của bug "bấm
// sang project khác mà nội dung bên phải vẫn của project cũ": component này không remount khi đổi
// project, nên một `useState` ở đây sống sót qua lần đổi và tiếp tục vẽ dàn ý của project đã rời.
export default function DocJobs({ project, view, onView, onJobName }) {
  const [jobs, setJobs] = useState([]);
  const [standards, setStandards] = useState([]);
  const [composable, setComposable] = useState([]);
  const [tones, setTones] = useState([]);
  const [settings, setSettings] = useState(null);
  const [storage, setStorage] = useState(null);
  const [cli, setCli] = useState(null);
  const [err, setErr] = useState("");
  // Danh sách đang cầm là của project NÀO. Không có nó thì lúc vừa đổi project, `jobs` còn là của
  // project cũ và mọi phép kiểm "bộ này có thuộc project này không" đều trả lời sai.
  const [loadedFor, setLoadedFor] = useState(null);

  const loadJobs = useCallback(() => {
    fetch(`/api/projects/${project.id}/doc-jobs`).then((r) => r.json()).then((d) => {
      if (d.error) return setErr(d.error);
      setJobs(d.jobs || []); setStorage(d.storage || null); setCli(d.cli || null);
      setLoadedFor(project.id);
    }).catch((e) => setErr(String(e.message)));
  }, [project.id]);

  useEffect(loadJobs, [loadJobs]);

  const openJob = view.jobId ? jobs.find((j) => j.id === view.jobId) : null;

  // Bộ tài liệu trong URL không thuộc project trong URL → về danh sách. Xảy ra thật khi sửa tay URL,
  // khi bộ bị xoá ở tab khác, hoặc khi dán link của project khác.
  useEffect(() => {
    if (loadedFor !== project.id || !view.jobId) return;
    if (!openJob) onView({ name: "list" });
  }, [loadedFor, project.id, view.jobId, openJob]); // eslint-disable-line

  // Báo tên bộ đang mở lên App để nó vá slug trên URL khi bộ bị đổi tên.
  useEffect(() => { onJobName?.(openJob?.name || ""); }, [openJob?.name]); // eslint-disable-line

  useEffect(() => {
    fetch("/api/doc-standards").then((r) => r.json())
      .then((d) => { setStandards(d.standards || []); setComposable(d.composable || []); setTones(d.tones || []); })
      .catch(() => {});
    fetch("/api/agent-settings").then((r) => r.json()).then(setSettings).catch(() => {});
  }, []);

  // Own WebSocket connection: the docgen feature listens for its own events without adding a
  // case to the app's shared socket handler.
  useEffect(() => {
    let ws;
    try { ws = new WebSocket(`ws://${location.host.replace("5311", "4311")}`); } catch { return; }
    ws.onmessage = (m) => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      if (e.type !== "doc:job" && e.type !== "doc:activity") return;
      if (e.type === "doc:activity") {
        setJobs((prev) => prev.map((j) => j.id === e.jobId
          ? { ...j, survey: { ...(j.survey || {}), activity: e.text } } : j));
        return;
      }
      loadJobs();
    };
    return () => { try { ws.close(); } catch { /* already closed */ } };
  }, [loadJobs]);

  const saveSettings = (patch) => {
    fetch("/api/agent-settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    }).then((r) => r.json()).then(setSettings).catch(() => {});
  };

  const retry = (id) => fetch(`/api/doc-jobs/${id}/survey`, { method: "POST" })
    .then((r) => r.json()).then((d) => { if (d.error) setErr(d.error); else loadJobs(); });

  const remove = (id) => {
    if (!confirm("Xoá bộ tài liệu này? Dàn ý và mọi kết quả khảo sát của nó sẽ mất.")) return;
    fetch(`/api/doc-jobs/${id}`, { method: "DELETE" }).then(() => loadJobs());
  };

  // `onCreated` chèn bộ vừa tạo vào danh sách TRƯỚC khi điều hướng: nếu chỉ gọi loadJobs() rồi đi
  // ngay thì phép kiểm "bộ có thuộc project này không" ở trên chạy với danh sách cũ (chưa có bộ mới)
  // và đá thẳng người dùng về màn danh sách.
  if (view.name === "wizard")
    return (
      <div className="dg">
        <DocWizard project={project} standards={standards} composable={composable} tones={tones}
          settings={settings} onSettings={saveSettings}
          onCancel={() => onView({ name: "list" })}
          onCreated={(job) => {
            setJobs((prev) => [job, ...prev]); loadJobs();
            onView({ name: "outline", jobId: job.id, jobName: job.name });
          }} />
      </div>
    );

  if (view.name === "outline")
    return (
      <div className="dg">
        <DocOutline jobId={view.jobId} settings={settings} onSettings={saveSettings}
          onBack={() => { loadJobs(); onView({ name: "list" }); }} onJobChanged={loadJobs}
          onWrite={() => onView({ name: "progress", jobId: view.jobId, jobName: openJob?.name })} />
      </div>
    );

  if (view.name === "progress")
    return (
      <div className="dg">
        <DocProgress jobId={view.jobId} settings={settings} onSettings={saveSettings}
          onBack={() => { loadJobs(); onView({ name: "list" }); }} onJobChanged={loadJobs} />
      </div>
    );

  return (
    <div className="dg">
      <div className="dg-head">
        <b className="dg-h1">📚 Tài liệu sản phẩm</b>
        <span className="dg-sub">theo chuẩn quốc tế · chỉ của project {project.name}</span>
        <span className="dg-spacer" />
        <button className="primary" onClick={() => onView({ name: "wizard" })}>＋ Bộ tài liệu mới</button>
      </div>

      {err && <div className="dg-err">{err}</div>}
      {storage?.error && <div className="dg-err">{storage.error}</div>}
      {cli && !cli.ok && <div className="dg-err">⚠ {cli.hint} — khảo sát sẽ không chạy được cho tới khi sửa.</div>}

      {!jobs.length ? (
        <p className="dg-muted">Chưa có bộ tài liệu nào. Bấm <b>＋ Bộ tài liệu mới</b> để chọn chuẩn,
          agent sẽ khảo sát mã nguồn thật rồi đề xuất dàn ý.</p>
      ) : (
        <div className="dg-grid">
          {jobs.map((j) => {
            const st = STATUS[j.status] || STATUS.draft;
            const written = WRITTEN_STAGES.includes(j.status);
            const pct = written && j.progress?.sections ? j.progress.pct : st.pct;
            return (
              <article className="dg-job" key={j.id}>
                <div className="dg-job-h">
                  <div className={"dg-ring " + st.ring} style={{ "--p": pct }}
                    data-v={written ? `${pct}%` : j.status === "plan-approved" ? "✓" : j.status === "error" ? "!" : j.status === "surveying" ? "…" : "⏸"} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dg-job-t">{j.name}</div>
                    <div className="dg-job-std">{j.standardLabel}{j.planRevision ? ` · dàn ý bản ${j.planRevision}` : ""}</div>
                  </div>
                  <button className="mini danger" title="Xoá bộ tài liệu" onClick={() => remove(j.id)}>🗑</button>
                </div>

                <div className="bar"><i style={{ width: pct + "%",
                  background: j.status === "surveying" || j.status === "writing" ? "var(--running)"
                    : ["plan-approved", "editing", "ready"].includes(j.status) ? "var(--done)" : "var(--accent)" }} /></div>

                <div className="dg-job-meta">
                  <span className={"pill " + st.pill}>{st.text}</span>
                  <span className="pill">{j.docCount} tài liệu · {j.sectionCount} mục</span>
                  {written && <span className="pill">{j.progress?.done}/{j.progress?.sections} đã viết
                    {j.progress?.pages ? ` · ~${j.progress.pages} trang` : ""}</span>}
                  {j.staleCount > 0 && <span className="pill run" title="Nguồn đã đổi kể từ lần viết">● {j.staleCount} đã cũ</span>}
                  {j.editedCount > 0 && <span className="pill acc" title="Mục đã sửa tay — agent không ghi đè">✎ {j.editedCount}</span>}
                  {j.metrics?.tokens > 0 && <span className="pill">⛽ {fmtTokens(j.metrics.tokens)}</span>}
                  {j.exportCount > 0 && <span className="pill">📄 {j.exportCount} lượt xuất</span>}
                </div>

                {j.status === "surveying" && j.survey?.activity &&
                  <div className="dg-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.survey.activity}
                  </div>}
                {j.status === "writing" && j.write?.activity &&
                  <div className="dg-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.write.activity}
                  </div>}
                {j.status === "error" && <div className="dg-err">{j.error?.message}</div>}

                <div className="dg-job-files">
                  {j.docs.map((d) => (
                    <div className="dg-job-file" key={d.key}>
                      <i>📘</i><b title={d.file}>{d.file}</b>
                      <span className="dg-dim">{written ? `${d.done}/${d.sections} mục` : `${d.sections} mục`}</span>
                    </div>
                  ))}
                </div>

                <div className="dg-job-acts">
                  {j.status !== "surveying" &&
                    <button className="mini" onClick={() => onView({ name: "outline", jobId: j.id, jobName: j.name })}>
                      {j.status === "plan-review" ? "Duyệt dàn ý →" : j.planApproved ? "Xem dàn ý →" : "Dàn ý →"}
                    </button>}
                  {/* Anything past the approval gate has a progress screen, even before a single
                      section is written: that is where the ▶ Bắt đầu viết button lives. */}
                  {j.planApproved &&
                    <button className="mini" onClick={() => onView({ name: "progress", jobId: j.id, jobName: j.name })}>
                      {written || j.error?.kind === "write" ? "Tiến độ →" : "Viết nội dung →"}
                    </button>}
                  {/* "Tiếp tục" after a failed survey retries the survey; after a failed write the
                      progress screen owns it, because that is where the token forecast is. */}
                  {((j.status === "error" && j.error?.kind !== "write" && !j.planApproved) || j.status === "draft") &&
                    <button className="mini" onClick={() => retry(j.id)}>
                      {j.status === "error" ? "▶ Tiếp tục" : "▶ Khảo sát"}
                    </button>}
                  {(j.status === "surveying" || j.status === "writing") &&
                    <button className="mini" onClick={() => fetch(`/api/doc-jobs/${j.id}/stop`, { method: "POST" })}>
                      ⏸ Dừng
                    </button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
