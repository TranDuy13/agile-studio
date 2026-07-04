import React, { useState, useEffect } from "react";

const baseName = (p) => (p || "").split("/").filter(Boolean).pop() || "";

// Modal tạo project: chọn folder repo (native macOS) + tên.
export default function AddProjectModal({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setName(""); setPath(""); setErr(""); setBusy(false); } }, [open]);
  if (!open) return null;

  const pick = async () => {
    setErr("");
    try {
      const r = await fetch("/api/pick-folder", { method: "POST" });
      const j = await r.json();
      if (j.manual) { setErr(j.error); return; }
      if (j.canceled || !j.path) return;
      setPath(j.path);
      if (!name.trim()) setName(baseName(j.path)); // tự điền tên = tên folder
    } catch (e) { setErr(String(e.message)); }
  };

  const create = async () => {
    if (!name.trim() || !path.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), repo_path: path.trim() }),
      });
      const j = await r.json();
      if (j.error) { setErr(j.error); setBusy(false); return; }
      onCreated(); onClose();
    } catch (e) { setErr(String(e.message)); setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>＋ Thêm project</span><button onClick={onClose}>✕</button></div>

        <label className="fld">
          <span>Folder repo của project</span>
          <div className="folder-pick">
            <button className="folder-btn" onClick={pick}>📁 Chọn folder…</button>
            <span className={"folder-path" + (path ? "" : " empty")}>{path || "chưa chọn"}</span>
          </div>
        </label>

        <label className="fld">
          <span>Tên project</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Dashboard" />
        </label>

        {err && <div className="modal-err">{err}</div>}

        <div className="modal-foot">
          <span className="run-preview" />
          <button className="primary" disabled={!name.trim() || !path.trim() || busy} onClick={create}>
            {busy ? "Đang tạo…" : "Tạo project"}
          </button>
        </div>
      </div>
    </div>
  );
}
