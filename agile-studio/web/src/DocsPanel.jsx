import React, { useEffect, useState, useCallback } from "react";

// Dựng cây thư mục từ danh sách path phẳng ("features/DEV_F01.md" -> node lồng nhau).
function buildTree(files) {
  const root = { dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      node.dirs[parts[i]] = node.dirs[parts[i]] || { dirs: {}, files: [] };
      node = node.dirs[parts[i]];
    }
    node.files.push({ name: parts[parts.length - 1], path: f.path, size: f.size });
  }
  return root;
}

// Xem/sửa Skill tổng (.skill/) + tài liệu project (docsDir) — có cây thư mục, search, reload.
export default function DocsPanel({ projectId }) {
  const [skills, setSkills] = useState([]);
  const [docs, setDocs] = useState({ mode: "", docsDir: "", files: [] });
  const [sel, setSel] = useState(null); // { kind:"skill"|"doc", name }
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState(new Set());

  const loadLists = useCallback(async () => {
    setReloading(true);
    try {
      const [sk, dc] = await Promise.all([
        fetch("/api/skills").then((r) => r.json()).catch(() => []),
        fetch(`/api/projects/${projectId}/docs`).then((r) => r.json()).catch(() => ({ files: [] })),
      ]);
      setSkills(Array.isArray(sk) ? sk : []);
      setDocs(dc || { files: [] });
    } finally { setReloading(false); }
  }, [projectId]);
  useEffect(() => { loadLists(); }, [loadLists]);

  const openSkill = (f) => {
    const sk = skills.find((s) => s.file === f);
    setSel({ kind: "skill", name: f }); setContent(sk?.content || ""); setDirty(false);
  };
  const openDoc = (path) => {
    setSel({ kind: "doc", name: path });
    fetch(`/api/projects/${projectId}/docs/file?path=${encodeURIComponent(path)}`)
      .then((r) => r.json()).then((d) => { setContent(d.content || ""); setDirty(false); });
  };
  const toggleDir = (p) => setCollapsed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const save = async () => {
    if (!sel) return;
    setSaving(true);
    try {
      if (sel.kind === "skill") {
        await fetch(`/api/skills/${encodeURIComponent(sel.name)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
        });
        setSkills((list) => list.map((s) => (s.file === sel.name ? { ...s, content } : s)));
      } else {
        await fetch(`/api/projects/${projectId}/docs/file`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: sel.name, content }),
        });
      }
      setDirty(false); loadLists();
    } finally { setSaving(false); }
  };

  const ql = q.trim().toLowerCase();
  const skillsShown = ql ? skills.filter((s) => s.file.toLowerCase().includes(ql)) : skills;
  const docsShown = ql ? docs.files.filter((f) => f.path.toLowerCase().includes(ql)) : docs.files;

  const FileBtn = ({ path, name, depth }) => (
    <button className={"docs-file" + (sel?.kind === "doc" && sel.name === path ? " on" : "")}
      style={{ paddingLeft: 8 + depth * 12 }} onClick={() => openDoc(path)}>📄 {name || path}</button>
  );
  const Dir = ({ name, node, prefix, depth }) => {
    const path = prefix ? prefix + "/" + name : name;
    const off = collapsed.has(path);
    return (
      <div>
        <button className="docs-dir" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggleDir(path)}>
          <span className="docs-caret">{off ? "▸" : "▾"}</span> 📁 {name}
        </button>
        {!off && (
          <>
            {Object.keys(node.dirs).sort().map((d) => <Dir key={d} name={d} node={node.dirs[d]} prefix={path} depth={depth + 1} />)}
            {node.files.map((f) => <FileBtn key={f.path} path={f.path} name={f.name} depth={depth + 1} />)}
          </>
        )}
      </div>
    );
  };
  const tree = buildTree(docsShown);

  return (
    <div className="docs">
      <div className="docs-list">
        <div className="docs-tools">
          <input className="docs-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Tìm file…" />
          <button className={"docs-reload" + (reloading ? " spin" : "")} onClick={loadLists} title="Nạp lại danh sách tài liệu">↻</button>
        </div>

        <div className="docs-group">🧠 Skill tổng (.skill)</div>
        {skillsShown.map((s) => (
          <button key={s.file} className={"docs-file" + (sel?.kind === "skill" && sel.name === s.file ? " on" : "")}
            style={{ paddingLeft: 8 }} onClick={() => openSkill(s.file)}>📄 {s.file}</button>
        ))}
        {!skillsShown.length && <p className="muted small">—</p>}

        <div className="docs-group">📁 Tài liệu project {docs.mode && <span className="docs-mode">({docs.mode})</span>}</div>
        {!docsShown.length && <p className="muted small">{ql ? "không khớp" : "chưa có tài liệu (chạy 1 session để sinh)."}</p>}
        {ql
          ? docsShown.map((f) => <FileBtn key={f.path} path={f.path} name={f.path} depth={0} />)
          : (
            <>
              {Object.keys(tree.dirs).sort().map((d) => <Dir key={d} name={d} node={tree.dirs[d]} prefix="" depth={0} />)}
              {tree.files.map((f) => <FileBtn key={f.path} path={f.path} name={f.name} depth={0} />)}
            </>
          )}
      </div>

      <div className="docs-edit">
        {!sel ? <div className="placeholder">Chọn 1 file để xem/sửa.</div> : (
          <>
            <div className="docs-edit-head">
              <span>{sel.kind === "skill" ? "🧠 " : "📄 "}{sel.name}{dirty ? " •" : ""}</span>
              <button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? "Đang lưu…" : "💾 Lưu"}</button>
            </div>
            <textarea className="docs-textarea" value={content} spellCheck={false}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }} />
          </>
        )}
      </div>
    </div>
  );
}
