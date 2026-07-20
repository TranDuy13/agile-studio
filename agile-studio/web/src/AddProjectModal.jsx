import React, { useState, useEffect } from "react";

const baseName = (p) => (p || "").split(/[\\/]/).filter(Boolean).pop() || "";

// Add projects: one at a time by picking a folder, or in bulk by scanning a drive/folder
// for sub-folders or for local git repos.
export default function AddProjectModal({ open, onClose, onCreated }) {
  const [mode, setMode] = useState("one"); // "one" | "scan"

  // --- single project ---
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  // --- bulk scan ---
  const [drives, setDrives] = useState([]);
  const [root, setRoot] = useState("");
  const [kind, setKind] = useState("repos"); // "repos" | "folders"
  const [depth, setDepth] = useState(3);
  const [items, setItems] = useState(null); // null = chưa quét
  const [picked, setPicked] = useState(() => new Set());
  const [truncated, setTruncated] = useState(false);
  const [result, setResult] = useState(null);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("one"); setName(""); setPath(""); setErr(""); setBusy(false);
    setItems(null); setPicked(new Set()); setResult(null); setTruncated(false);
    fetch("/api/drives").then((r) => r.json()).then((j) => {
      setDrives(j.drives || []);
      setRoot((cur) => cur || j.drives?.[0] || "");
    }).catch(() => {});
  }, [open]);

  if (!open) return null;

  const pick = async () => {
    setErr("");
    try {
      const r = await fetch("/api/pick-folder", { method: "POST" });
      const j = await r.json();
      if (j.manual) { setErr(j.error); return; }
      if (j.canceled || !j.path) return;
      setPath(j.path);
      if (!name.trim()) setName(baseName(j.path));
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

  const scan = async () => {
    if (!root.trim()) return;
    setBusy(true); setErr(""); setResult(null); setItems(null);
    try {
      const q = new URLSearchParams({ path: root.trim(), mode: kind, depth: String(depth) });
      const r = await fetch(`/api/scan?${q}`);
      const j = await r.json();
      if (j.error) { setErr(j.error); setBusy(false); return; }
      setItems(j.items || []);
      setTruncated(!!j.truncated);
      setPicked(new Set((j.items || []).map((i) => i.path))); // default: everything selected
    } catch (e) { setErr(String(e.message)); }
    setBusy(false);
  };

  const toggle = (p) => setPicked((s) => {
    const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n;
  });
  const allPicked = items && items.length > 0 && picked.size === items.length;
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(items.map((i) => i.path)));

  const addBulk = async () => {
    const chosen = (items || []).filter((i) => picked.has(i.path));
    if (!chosen.length) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/projects/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: chosen.map((i) => ({ name: i.name, repo_path: i.path })) }),
      });
      const j = await r.json();
      setResult(j);
      onCreated();
    } catch (e) { setErr(String(e.message)); }
    setBusy(false);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>＋ Thêm project</span><button onClick={onClose}>✕</button></div>

        <div className="tabs modal-tabs">
          <button className={mode === "one" ? "on" : ""} onClick={() => setMode("one")}>Một project</button>
          <button className={mode === "scan" ? "on" : ""} onClick={() => setMode("scan")}>Quét hàng loạt</button>
        </div>

        {mode === "one" ? (
          <>
            <label className="fld">
              <span>Folder repo của project</span>
              <div className="folder-pick">
                <button className="folder-btn" onClick={pick}>📁 Chọn folder…</button>
                <input className="folder-input" value={path} onChange={(e) => setPath(e.target.value)}
                  placeholder="hoặc dán/nhập đường dẫn tuyệt đối" />
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
          </>
        ) : (
          <>
            <label className="fld">
              <span>Quét trong</span>
              <div className="folder-pick">
                <select value={drives.includes(root) ? root : ""} onChange={(e) => setRoot(e.target.value)}>
                  <option value="">— ổ đĩa —</option>
                  {drives.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input className="folder-input" value={root} onChange={(e) => setRoot(e.target.value)}
                  placeholder="ổ đĩa hoặc đường dẫn, vd D:/work" />
              </div>
            </label>

            <label className="fld">
              <span>Kiểu</span>
              <div className="scan-opts">
                <label><input type="radio" checked={kind === "repos"} onChange={() => setKind("repos")} /> Git repo trên máy</label>
                <label><input type="radio" checked={kind === "folders"} onChange={() => setKind("folders")} /> Mọi thư mục con</label>
                {kind === "repos" && (
                  <span className="scan-depth">độ sâu&nbsp;
                    <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </span>
                )}
                <button className="folder-btn" disabled={!root.trim() || busy} onClick={scan}>
                  {busy ? "Đang quét…" : "🔎 Quét"}
                </button>
              </div>
            </label>

            {err && <div className="modal-err">{err}</div>}

            {items && (
              <>
                <div className="scan-head">
                  <label><input type="checkbox" checked={!!allPicked} onChange={toggleAll} /> Chọn tất cả</label>
                  <span className="scan-count">
                    {picked.size}/{items.length} chọn{truncated ? " · đã cắt bớt (quá nhiều kết quả)" : ""}
                  </span>
                </div>
                <div className="scan-list">
                  {items.map((i) => (
                    <label key={i.path} className="scan-row">
                      <input type="checkbox" checked={picked.has(i.path)} onChange={() => toggle(i.path)} />
                      <span className="scan-name">{i.isGit ? "🔗 " : "📁 "}{i.name}</span>
                      <span className="scan-path">{i.path}</span>
                    </label>
                  ))}
                  {!items.length && <p className="empty">Không tìm thấy gì trong đường dẫn này.</p>}
                </div>
              </>
            )}

            {result && (
              <div className="scan-result">
                ✅ Đã thêm {result.added?.length || 0} project
                {result.skipped?.length ? ` · bỏ qua ${result.skipped.length} (trùng hoặc không hợp lệ)` : ""}
              </div>
            )}

            <div className="modal-foot">
              <span className="run-preview" />
              <button className="primary" disabled={!picked.size || busy} onClick={addBulk}>
                {busy ? "Đang thêm…" : `Thêm ${picked.size} project`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
