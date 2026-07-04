import React, { useEffect, useState, useCallback, useRef } from "react";

const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + "MB" : n > 1e3 ? (n / 1e3).toFixed(0) + "KB" : n + "B");

// Kho requirement khách hàng: thêm theo ngày, đính kèm file, đánh dấu đã giải quyết,
// và bấm "Phân tích" để chạy 1 session đọc/phân tích requirement (xong tự đánh dấu resolved).
export default function Requirements({ projectId, version, onAnalyze }) {
  const [items, setItems] = useState([]);
  const [body, setBody] = useState("");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [filter, setFilter] = useState("all"); // all | open | resolved

  const load = useCallback(() => {
    fetch(`/api/projects/${projectId}/requirements`).then((r) => r.json()).then(setItems);
  }, [projectId]);
  useEffect(load, [load, version]); // reload khi có requirement:updated

  const add = async () => {
    if (!body.trim()) return;
    await fetch(`/api/projects/${projectId}/requirements`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, day }),
    });
    setBody(""); load();
  };
  const del = async (id) => { if (confirm("Xoá requirement này?")) { await fetch(`/api/requirements/${id}`, { method: "DELETE" }); load(); } };
  const setStatus = async (id, status) => {
    await fetch(`/api/requirements/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    }); load();
  };
  const upload = async (id, file) => {
    const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
    await fetch(`/api/requirements/${id}/files`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, data }),
    }); load();
  };
  const delFile = async (id, idx) => { await fetch(`/api/requirements/${id}/files/${idx}`, { method: "DELETE" }); load(); };

  const shown = items.filter((it) => filter === "all" || (it.status || "open") === filter);
  const byDay = shown.reduce((acc, it) => { (acc[it.day] = acc[it.day] || []).push(it); return acc; }, {});

  return (
    <div className="req">
      <div className="req-add">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <textarea placeholder="Requirement khách hàng thêm hôm nay…" value={body} onChange={(e) => setBody(e.target.value)} />
        <button onClick={add}>Thêm</button>
      </div>

      <div className="req-filter">
        {["all", "open", "resolved"].map((f) => (
          <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? "Tất cả" : f === "open" ? "Chưa giải quyết" : "Đã giải quyết"}
          </button>
        ))}
      </div>

      <div className="req-list">
        {!shown.length && <p className="muted">Chưa có requirement nào.</p>}
        {Object.entries(byDay).map(([d, list]) => (
          <div key={d} className="req-day">
            <div className="req-date">{d}</div>
            {list.map((it) => (
              <ReqItem key={it.id} it={it} onDel={del} onStatus={setStatus} onUpload={upload} onDelFile={delFile} onAnalyze={onAnalyze} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReqItem({ it, onDel, onStatus, onUpload, onDelFile, onAnalyze }) {
  const fileRef = useRef(null);
  const resolved = (it.status || "open") === "resolved";
  const files = it.files || [];

  return (
    <div className={"req-item2" + (resolved ? " resolved" : "")}>
      <div className="req-row1">
        <span className={"req-status " + (resolved ? "ok" : "open")}>{resolved ? "✓ đã giải quyết" : "● chưa giải quyết"}</span>
        <div className="req-actions">
          {!resolved && <button className="req-analyze"
            onClick={() => onAnalyze({ feature: (it.body.split("\n")[0] || "Requirement").slice(0, 60), description: it.body, presetId: "refine", requirementId: it.id })}
            title="Chạy 1 session phân tích requirement này (PM→BA→DA), xong tự đánh dấu đã giải quyết">📥 Phân tích</button>}
          <button onClick={() => onStatus(it.id, resolved ? "open" : "resolved")}>{resolved ? "Mở lại" : "Đánh dấu xong"}</button>
          <input type="file" ref={fileRef} style={{ display: "none" }}
            onChange={(e) => { if (e.target.files[0]) onUpload(it.id, e.target.files[0]); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()}>📎 File</button>
          <button className="req-del" onClick={() => onDel(it.id)}>✕</button>
        </div>
      </div>
      <div className="req-body">{it.body}</div>
      {files.length > 0 && (
        <div className="req-files">
          {files.map((f, i) => (
            <span className="req-file" key={i}>
              <a href={`/api/requirements/${it.id}/files/${i}`} target="_blank" rel="noreferrer">📄 {f.name}</a>
              <span className="req-fsize">{fmtSize(f.size || 0)}</span>
              <button onClick={() => onDelFile(it.id, i)}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
