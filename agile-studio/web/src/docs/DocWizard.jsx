import React, { useEffect, useMemo, useState } from "react";
import TokenConfirm, { TokenChip, shouldAsk } from "./TokenConfirm.jsx";

// Wizard for a new document set (MH 2). Three steps: scope & sources, the standard, presentation.
// Publishing is not here on purpose — content lives in Studio and is exported later (Q10).

const TONES = [
  { id: "concise", label: "Định danh · súc tích",
    sample: "“ConnectionStrings:Main — chuỗi kết nối, khai báo trong appsettings.json.”" },
  { id: "academic", label: "Hàn lâm",
    sample: "“Tham số kết nối được định nghĩa theo mô hình cấu hình phân tầng, tách mã nguồn khỏi tham số môi trường.”" },
  { id: "detailed", label: "Diễn giải chi tiết",
    sample: "“Khoá này quyết định ứng dụng nối tới đâu. Khi đổi máy chủ, sửa giá trị rồi khởi động lại service…”" },
  { id: "narrative", label: "Kể chuyện · dẫn dắt",
    sample: "“Trước khi bàn tới chuyện kết nối, cần hiểu vì sao hệ thống tách cấu hình ra khỏi mã nguồn…”" },
];

const DEPTHS = [
  { id: "overview", label: "Tổng quan — mỗi mục một trang" },
  { id: "standard", label: "Vừa — có bảng và sơ đồ chính" },
  { id: "detailed", label: "Chi tiết tới từng luồng nghiệp vụ" },
];

// Rows of the "Kiểm soát tài liệu" table. In D1 there is no Word template yet, so every row is
// marked as one Studio would add; D3/D4 replace `source` with what was actually found in the mẫu.
const CONTROL_ROWS = [
  { key: "title", label: "Tên tài liệu", value: "theo chuẩn đã chọn", on: true },
  { key: "docId", label: "Mã tài liệu", value: "tự sinh, sửa được", on: true },
  { key: "owner", label: "Chủ sở hữu", value: "người duyệt dàn ý", on: true },
  { key: "created", label: "Ngày tạo", value: "ngày duyệt dàn ý", on: true },
  { key: "version", label: "Phiên bản", value: "dòng cuối bảng lịch sử", on: true },
  { key: "classification", label: "Phân loại", value: "cũng in ở chân trang", on: true },
  { key: "status", label: "Trạng thái", value: "Bản nháp → Chờ duyệt → Ban hành", on: true },
  { key: "approvals", label: "Trang phê duyệt", value: "bảng ký của hai bên", on: false },
];

const today = () => new Date().toISOString().slice(0, 10);
const vnDate = (iso) => iso.split("-").reverse().join("/");

export default function DocWizard({ project, standards, composable, settings, onSettings, onCancel, onCreated }) {
  const [step, setStep] = useState(1);
  const [extra, setExtra] = useState([]);
  const [scope, setScope] = useState({ mode: "all", byAuthor: false, authors: [], from: "", to: "" });
  const [features, setFeatures] = useState("");
  const [authorGroups, setAuthorGroups] = useState([]);
  const [preview, setPreview] = useState(null);
  const [standardId, setStandardId] = useState(standards[0]?.id || "arc42");
  const [picks, setPicks] = useState([]);
  const [control, setControl] = useState(CONTROL_ROWS.map((r) => ({ ...r, enabled: r.on, source: "added" })));
  const [history, setHistory] = useState([{ date: today(), version: "1.0", change: "Khởi tạo", by: "" }]);
  const [style, setStyle] = useState({ tone: "concise", language: "vi-keep-en", depth: "detailed" });
  const [docIdPrefix, setDocIdPrefix] = useState("");
  const [classification, setClassification] = useState("Nội bộ");
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState(false);

  const custom = standardId === "custom";
  const std = useMemo(() => standards.find((s) => s.id === standardId) || null, [standards, standardId]);
  const pickedDocs = useMemo(
    () => picks.map((p) => composable.find((c) => c.standardId === p.standardId && c.docKey === p.docKey)).filter(Boolean),
    [picks, composable]);
  const docList = custom ? pickedDocs : (std?.docs || []);
  const sectionTotal = custom
    ? pickedDocs.reduce((n, d) => n + d.sections, 0)
    : (std?.sectionCount || 0);

  // git identities of the project repo, grouped per person
  useEffect(() => {
    fetch(`/api/doc-scan/git-authors?path=${encodeURIComponent(project.repo_path)}`)
      .then((r) => r.json()).then((d) => setAuthorGroups(d.groups || [])).catch(() => setAuthorGroups([]));
  }, [project.repo_path]);

  // scope preview — the number that proves "theo đóng góp của tác giả" actually narrows things
  useEffect(() => {
    const q = new URLSearchParams({
      path: project.repo_path, byAuthor: scope.byAuthor ? "1" : "0",
      authors: scope.authors.join("|"), from: scope.from, to: scope.to,
    });
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/doc-scan/preview?${q}`).then((r) => r.json())
        .then((d) => live && setPreview(d)).catch(() => live && setPreview(null));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [project.repo_path, scope.byAuthor, scope.authors, scope.from, scope.to]);

  // estimate for the survey button
  useEffect(() => {
    const q = custom ? `?picks=${picks.map((p) => `${p.standardId}:${p.docKey}`).join(",")}` : "";
    if (custom && !picks.length) { setEst(null); return; }
    fetch(`/api/doc-standards/${standardId}/estimate${q}`).then((r) => r.json())
      .then(setEst).catch(() => setEst(null));
  }, [standardId, picks, custom]);

  const addFolder = async (kind) => {
    const r = await fetch("/api/pick-folder", { method: "POST" }).then((x) => x.json()).catch(() => ({}));
    if (r.path) setExtra((s) => [...s, { kind, path: r.path }]);
    else if (r.error) setErr(r.error);
  };

  const addAuthorGroup = (key) => {
    const g = authorGroups.find((x) => x.key === key);
    if (!g) return;
    const ids = g.identities.map((i) => i.email || i.name).filter(Boolean);
    setScope((s) => ({ ...s, authors: [...new Set([...s.authors, ...ids])] }));
  };

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const body = {
        standardId, customDocs: custom ? picks : undefined,
        name: custom ? "Bộ tài liệu tuỳ chọn" : std?.docs?.[0]?.title,
        sources: { extra },
        scope: { ...scope, features: features.split(",").map((s) => s.trim()).filter(Boolean) },
        meta: { docIdPrefix, classification, docStatus: "Bản nháp",
          approvals: control.find((c) => c.key === "approvals")?.enabled || false,
          control: control.map(({ key, label, source, enabled, value }) => ({ key, label, source, enabled, value })),
          history },
        style,
      };
      const r = await fetch(`/api/projects/${project.id}/doc-jobs`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      // Creating and surveying are one gesture for the user: the button says "Khảo sát".
      const s = await fetch(`/api/doc-jobs/${r.job.id}/survey`, { method: "POST" }).then((x) => x.json());
      if (s.error) throw new Error(s.error);
      onCreated(r.job);
    } catch (e) {
      setErr(String(e.message));
    } finally { setBusy(false); }
  };

  const surveyTokens = est?.survey || 0;
  const startSurvey = () => {
    if (shouldAsk("survey", surveyTokens, settings)) setAsk(true);
    else create();
  };

  return (
    <div className="dg-pane">
      <div className="dg-head">
        <b className="dg-h1">＋ Bộ tài liệu mới</b>
        <span className="pill acc">{project.name}</span>
        <span className="dg-spacer" />
        <button className="mini" onClick={onCancel}>✕ Đóng</button>
      </div>

      <div className="dg-steps" role="tablist">
        {["Phạm vi & nguồn", "Bộ tài liệu", "Trình bày & văn phong"].map((t, i) => (
          <button key={t} role="tab" aria-selected={step === i + 1} className={step === i + 1 ? "on" : ""}
            onClick={() => setStep(i + 1)}><b>{i + 1}</b> {t}</button>
        ))}
      </div>

      {err && <div className="dg-err">{err}</div>}

      {step === 1 && (
        <div className="dg-pane">
          <div className="dg-field">
            <span className="dg-label">Nguồn</span>
            <div className="dg-card dg-locked dg-src">
              <span className="pill acc">nguồn chính</span>
              <div>
                <b>{project.name}</b>
                <div className="path">{project.repo_path}</div>
              </div>
              <span className="dg-dim">🔒 không đổi được</span>
            </div>
            {extra.map((e, i) => (
              <div className="dg-card dg-src" key={i} style={{ marginTop: 7 }}>
                <span className="pill">{e.kind === "reference" ? "tham chiếu" : "mã nguồn"}</span>
                <div><b>{e.path.split(/[\\/]/).pop()}</b><div className="path">{e.path}</div></div>
                <button className="mini danger" onClick={() => setExtra((s) => s.filter((_, j) => j !== i))}>Bỏ</button>
              </div>
            ))}
            <div className="dg-row" style={{ marginTop: 8 }}>
              <button className="ghost" onClick={() => addFolder("code")}>＋ Thư mục mã nguồn của sản phẩm này…</button>
              <button className="ghost" onClick={() => addFolder("reference")}>＋ Tài liệu tham chiếu…</button>
            </div>
            <p className="dg-note">Nguồn chính luôn là repo của project đang mở. Chỉ thêm được thư mục
              <b> thuộc cùng sản phẩm</b> và tài liệu tham chiếu — không lấy mã nguồn của project khác.</p>
          </div>

          <div className="dg-card">
            <div className="dg-label" style={{ marginBottom: 9 }}>Phạm vi nội dung</div>
            <div className="dg-opts">
              <Radio on={scope.mode === "all"} onClick={() => setScope((s) => ({ ...s, mode: "all" }))}
                title="Toàn bộ sản phẩm" sub="Mọi thư mục trong phạm vi nguồn" />
              <Radio on={scope.mode === "feature"} onClick={() => setScope((s) => ({ ...s, mode: "feature" }))}
                title="Theo feature" sub="Đọc tài liệu agile của project, hoặc tự liệt kê" />
            </div>
            {scope.mode === "feature" && (
              <div className="dg-field" style={{ marginTop: 10 }}>
                <span className="dg-label">Feature (phân cách bằng dấu phẩy) — để trống thì agent tự đọc tài liệu agile</span>
                <input className="dg-inp" value={features} onChange={(e) => setFeatures(e.target.value)}
                  placeholder="đăng nhập, tạo đơn hàng, báo cáo" />
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--line)", margin: "12px 0 10px" }} />
            <button className={"dg-chk" + (scope.byAuthor ? " on" : "")} style={{ alignItems: "center" }}
              onClick={() => setScope((s) => ({ ...s, byAuthor: !s.byAuthor }))}>
              <i className="bx">{scope.byAuthor ? "✓" : ""}</i>
              <span className="dg-chk-t">
                <b>Chỉ phần đóng góp của tác giả (git)</b>
                <span>Bỏ chọn = viết cho đóng góp của mọi contributor</span>
              </span>
            </button>

            {scope.byAuthor && (
              <div className="dg-row" style={{ marginTop: 11 }}>
                <div className="dg-field" style={{ flex: "2 1 330px" }}>
                  <span className="dg-label">Tác giả (git) — gom mọi identity của một người</span>
                  <div className="dg-chips">
                    {scope.authors.map((a) => (
                      <span className="dg-chip" key={a}>{a}
                        <button title="Bỏ identity này"
                          onClick={() => setScope((s) => ({ ...s, authors: s.authors.filter((x) => x !== a) }))}>✕</button>
                      </span>
                    ))}
                    <select className="dg-inp" value="" onChange={(e) => { addAuthorGroup(e.target.value); e.target.value = ""; }}>
                      <option value="">＋ thêm tác giả…</option>
                      {authorGroups.map((g) => (
                        <option key={g.key} value={g.key}>{g.label} · {g.commits} commit · {g.identities.length} identity</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="dg-field" style={{ flex: "0 0 140px" }}>
                  <span className="dg-label">Từ ngày</span>
                  <input className="dg-inp" type="date" value={scope.from}
                    onChange={(e) => setScope((s) => ({ ...s, from: e.target.value }))} />
                </div>
                <div className="dg-field" style={{ flex: "0 0 140px" }}>
                  <span className="dg-label">Đến ngày</span>
                  <input className="dg-inp" type="date" value={scope.to}
                    onChange={(e) => setScope((s) => ({ ...s, to: e.target.value }))} />
                </div>
              </div>
            )}

            <div className="dg-note" style={{ marginTop: 10 }}>
              <b style={{ color: "var(--ink)" }}>Xem trước: </b>
              {!preview ? "đang đọc repo…" : preview.error ? preview.error : (
                <>
                  {preview.repo
                    ? <>{preview.commits}/{preview.totalCommits} commit · </>
                    : <>thư mục không phải git repo · </>}
                  {preview.dirs} thư mục · {preview.files} file
                  {preview.byAuthor && preview.authorFiles
                    ? <> · tác giả đã đụng {preview.authorFiles} file{preview.thinDirs
                        ? `, ${preview.thinDirs} thư mục dưới 3 commit sẽ vào phụ lục` : ""}</>
                    : null}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="dg-pane">
          <div className="dg-field">
            <span className="dg-label">Chuẩn áp dụng — quyết định bộ tài liệu gồm những file nào</span>
            <div className="dg-opts">
              {standards.map((s) => (
                <Radio key={s.id} on={standardId === s.id} onClick={() => setStandardId(s.id)}
                  title={s.label} sub={`${s.docs[0].title}${s.docCount > 1 ? "…" : ""} · ${s.docCount} file · ${s.sectionCount} mục`} />
              ))}
              <Radio on={custom} onClick={() => setStandardId("custom")}
                title="Tuỳ chọn" sub="Tự ghép tài liệu từ các chuẩn trên" />
            </div>
          </div>

          {custom ? (
            <div className="dg-card">
              <div className="dg-label" style={{ marginBottom: 9 }}>Chọn tài liệu — vẫn là tài liệu của chuẩn quốc tế</div>
              <div className="dg-opts">
                {composable.map((c) => {
                  const on = picks.some((p) => p.standardId === c.standardId && p.docKey === c.docKey);
                  return (
                    <button key={c.standardId + c.docKey} className={"dg-chk" + (on ? " on" : "")}
                      onClick={() => setPicks((s) => on
                        ? s.filter((p) => !(p.standardId === c.standardId && p.docKey === c.docKey))
                        : [...s, { standardId: c.standardId, docKey: c.docKey }])}>
                      <i className="bx">{on ? "✓" : ""}</i>
                      <span className="dg-chk-t">
                        <b title={c.hint}>{c.title}</b>
                        <span>{c.standardLabel} · {c.sections} mục</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {std?.caveat && !custom && <div className="dg-note">⚠ {std.caveat}</div>}

          <div className="dg-card">
            <div className="dg-row" style={{ alignItems: "center", marginBottom: 9 }}>
              <div className="dg-label">Mục của bộ tài liệu</div>
              <span className="pill acc" style={{ marginLeft: "auto" }}>
                {docList.length} tài liệu · {sectionTotal} mục
              </span>
            </div>
            <div className="dg-scroll" style={{ maxHeight: "40vh", overflowY: "auto" }}>
              {custom
                ? <p className="dg-muted" style={{ fontSize: 11 }}>
                    {picks.length ? "Danh sách mục hiện đầy đủ ở màn duyệt dàn ý." : "Chưa chọn tài liệu nào."}
                  </p>
                : (std?.docs || []).map((d) => (
                  <div key={d.key} style={{ marginBottom: 12 }}>
                    <div className="dg-label" style={{ marginBottom: 4 }} title={d.hint}>{d.title}</div>
                    <table className="dg-tbl">
                      <thead><tr><th style={{ width: 26 }} /><th>Mục</th><th>Loại nội dung</th><th>Nguồn dữ liệu</th></tr></thead>
                      <tbody>
                        {d.sections.map((s) => (
                          <tr key={s.num}>
                            <td>{s.required ? "☑" : "☐"}</td>
                            <td>{s.num}. <abbr className="tt" title={s.hint}>{s.title}</abbr></td>
                            <td><abbr className="tt" title={s.kindHint}>{s.kind}</abbr></td>
                            <td className="dg-muted">{s.fromLabels.join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </div>
            <p className="dg-note" style={{ marginTop: 8 }}>Tên mục và tên tài liệu do chuẩn quy định nên
              giữ nguyên tiếng Anh — rê chuột vào chữ có gạch chân chấm để xem giải thích tiếng Việt.
              Mục nào bật/tắt sẽ chốt ở màn duyệt dàn ý.</p>
          </div>

          <div className="dg-card">
            <div className="dg-label" style={{ marginBottom: 9 }}>Lịch sử phiên bản — ghi vào bảng “Kiểm soát tài liệu”</div>
            <div className="dg-scroll">
              <table className="dg-tbl">
                <thead><tr><th>Ngày</th><th>Phiên bản</th><th>Thay đổi</th><th>Người sửa</th><th /></tr></thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      {["date", "version", "change", "by"].map((f) => (
                        <td key={f}>
                          <input className="dg-inp" style={{ width: "100%" }} value={h[f]}
                            onChange={(e) => setHistory((s) => s.map((r, j) => j === i ? { ...r, [f]: e.target.value } : r))} />
                        </td>
                      ))}
                      <td>{history.length > 1 &&
                        <button className="mini danger" onClick={() => setHistory((s) => s.filter((_, j) => j !== i))}>✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="mini" style={{ marginTop: 8 }}
              onClick={() => setHistory((s) => [...s, { date: today(), version: "", change: "", by: "" }])}>
              ＋ Thêm dòng
            </button>
            <p className="dg-note" style={{ marginTop: 8 }}>Phiên bản của bộ tài liệu là dòng cuối của bảng này.
              Mỗi lần dựng lại, một dòng mới được thêm từ khác biệt nội dung (D2).</p>
          </div>

          <div className="dg-card">
            <div className="dg-row" style={{ alignItems: "center", marginBottom: 10 }}>
              <div className="dg-label">Bảng “Kiểm soát tài liệu” — thông tin đầu tài liệu</div>
              <span className="pill" style={{ marginLeft: "auto" }}>chưa gắn mẫu Word</span>
            </div>
            <p className="dg-note" style={{ marginBottom: 11 }}>Khi bộ này gắn mẫu Word, Studio dò bảng kiểm soát
              có sẵn trong mẫu và <b>giữ nguyên bố cục của mẫu</b>, chỉ điền giá trị. Chưa có mẫu thì dựng bảng mới
              theo các dòng bạn bật dưới đây.</p>
            <div className="dg-row" style={{ marginBottom: 10 }}>
              <div className="dg-field" style={{ flex: "1 1 180px" }}>
                <span className="dg-label">Tiền tố mã tài liệu</span>
                <input className="dg-inp" value={docIdPrefix} placeholder="vd: AP"
                  onChange={(e) => setDocIdPrefix(e.target.value.toUpperCase())} />
              </div>
              <div className="dg-field" style={{ flex: "1 1 180px" }}>
                <span className="dg-label">Phân loại</span>
                <select className="dg-inp" value={classification} onChange={(e) => setClassification(e.target.value)}>
                  {["Nội bộ", "Công khai", "Mật"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="dg-scroll">
              <table className="dg-tbl">
                <thead><tr><th style={{ width: 24 }} /><th>Dòng</th><th>Nguồn</th><th>Giá trị</th></tr></thead>
                <tbody>
                  {control.map((r, i) => (
                    <tr key={r.key}>
                      <td>
                        <button className="mini" style={{ padding: "0 5px" }}
                          onClick={() => setControl((s) => s.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x))}>
                          {r.enabled ? "☑" : "☐"}
                        </button>
                      </td>
                      <td>{r.label}</td>
                      <td><span className="pill acc">＋ Studio dựng</span></td>
                      <td className="dg-muted">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="dg-pane">
          <div className="dg-field">
            <span className="dg-label">Mẫu Word</span>
            <div className="dg-row" style={{ gap: 7 }}>
              <input className="dg-inp" style={{ flex: 1 }} value="(chưa có mẫu — dùng theme mặc định)" readOnly />
              <span className="pill">theme mặc định</span>
            </div>
            <p className="dg-note">Quản lý mẫu Word ba cấp và dò style từ mẫu là phần của D3/D4.
              Nội dung không phụ thuộc mẫu: đổi mẫu về sau không phải viết lại.</p>
          </div>

          <div className="dg-field">
            <span className="dg-label">Văn phong</span>
            <div className="dg-opts">
              {TONES.map((t) => (
                <Radio key={t.id} on={style.tone === t.id} onClick={() => setStyle((s) => ({ ...s, tone: t.id }))}
                  title={t.label} sub={t.sample} />
              ))}
            </div>
            <p className="dg-note">Văn phong áp theo <b>loại nội dung</b>: mục <code>reference</code> luôn súc tích,
              mục <code>howto</code> luôn đánh số bước — lựa chọn ở đây chi phối phần <code>explanation</code>.</p>
          </div>

          <div className="dg-row">
            <div className="dg-field">
              <span className="dg-label">Ngôn ngữ</span>
              <select className="dg-inp" value={style.language} onChange={(e) => setStyle((s) => ({ ...s, language: e.target.value }))}>
                <option value="vi-keep-en">Tiếng Việt · giữ thuật ngữ EN</option>
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="dg-field">
              <span className="dg-label">Độ sâu</span>
              <select className="dg-inp" value={style.depth} onChange={(e) => setStyle((s) => ({ ...s, depth: e.target.value }))}>
                {DEPTHS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          </div>

          <div className="dg-row">
            <button className="ghost" onClick={() => setStep(2)}>Quay lại</button>
            <span className="dg-spacer" />
            <button className="primary" disabled={busy || (custom && !picks.length)} onClick={startSurvey}>
              {busy ? "Đang khởi động khảo sát…" : "Khảo sát & đề xuất dàn ý"}{" "}
              <TokenChip tokens={surveyTokens} threshold={settings?.tokenThreshold} />
            </button>
          </div>
        </div>
      )}

      {step < 3 && (
        <div className="dg-row">
          {step > 1 && <button className="ghost" onClick={() => setStep(step - 1)}>Quay lại</button>}
          <span className="dg-spacer" />
          <button className="primary" onClick={() => setStep(step + 1)}>Tiếp tục</button>
        </div>
      )}

      <TokenConfirm open={ask} kind="survey" tokens={surveyTokens} settings={settings} spent={0}
        onCancel={() => setAsk(false)}
        onConfirm={(dontAsk) => {
          setAsk(false);
          if (dontAsk) onSettings({ dontAsk: { ...(settings?.dontAsk || {}), survey: true } });
          create();
        }} />
    </div>
  );
}

function Radio({ on, onClick, title, sub }) {
  return (
    <button className={"dg-chk" + (on ? " on" : "")} onClick={onClick}>
      <i className="bx radio">{on ? "●" : ""}</i>
      <span className="dg-chk-t"><b>{title}</b><span>{sub}</span></span>
    </button>
  );
}
