import React, { useEffect, useState } from "react";
import Dialog, { DialogButtons } from "./Dialog.jsx";
import { BLOCK_LABELS, flowShape } from "./IrView.jsx";

// Q20 — hand editing, block by block. Deliberately NOT a JSON textarea: the person fixing a wrong
// sentence should not have to know what the IR looks like, and one misplaced comma should not be
// able to destroy a section. Each block type gets the fields it actually has; the shape is
// rebuilt on save.
//
// Saving costs no tokens, and the dialog says so.

const ADDABLE = ["p", "bullets", "num", "table", "code", "flow", "callout", "refs", "figure"];

function blankBlock(t) {
  switch (t) {
    case "bullets": case "num": return { t, items: [""] };
    case "table": return { t, headers: ["", ""], rows: [["", ""]] };
    case "code": return { t, lang: "text", text: "" };
    case "figure": return { t, src: "", caption: "", alt: "" };
    case "flow": return { t, steps: [""] };
    case "refs": return { t, items: [["", ""]] };
    case "callout": return { t, level: "warn", text: "" };
    default: return { t: "p", text: "" };
  }
}

const linesToItems = (s) => String(s).split("\n").map((x) => x.trim()).filter(Boolean);

export default function SectionEditor({ open, section, ir, onCancel, onSave }) {
  const [blocks, setBlocks] = useState([]);
  const [traces, setTraces] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Deep copy: the dialog must be cancellable without having touched what the screen shows.
    setBlocks(JSON.parse(JSON.stringify(ir?.blocks || [blankBlock("p")])));
    setTraces((ir?.traces || []).join(", "));
    setErr("");
  }, [open, ir]);

  const patch = (i, next) => setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...next } : b)));
  const move = (i, d) => setBlocks((bs) => {
    const out = [...bs];
    const j = i + d;
    if (j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });
  const drop = (i) => setBlocks((bs) => bs.filter((_, j) => j !== i));
  const add = (t) => setBlocks((bs) => [...bs, blankBlock(t)]);

  const save = async () => {
    const clean = blocks.filter((b) => {
      if (b.t === "table") return (b.rows || []).some((r) => r.some((c) => String(c).trim()));
      if (b.t === "bullets" || b.t === "num" || b.t === "flow")
        return (b.items || b.steps || []).some((x) => String(x).trim());
      if (b.t === "refs") return (b.items || []).some((p) => String(p[0] || p[1] || "").trim());
      if (b.t === "figure") return String(b.caption || b.alt || "").trim();
      return String(b.text || "").trim();
    });
    if (!clean.length) return setErr("Mục phải còn ít nhất một khối có nội dung.");
    const missingAlt = clean.find((b) => b.t === "figure" && !String(b.alt || "").trim());
    if (missingAlt) return setErr("Hình bắt buộc có alt text — đây là yêu cầu accessibility, không phải tuỳ chọn.");
    setBusy(true);
    const e = await onSave({ blocks: clean, traces: linesToItems(traces.replace(/,/g, "\n")) });
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <Dialog open={open} width={860} onClose={onCancel}
      title={`✎ Sửa tay mục ${section?.num || ""} — ${section?.title || ""}`}
      sub="Sau khi lưu, mục này được đánh dấu “đã sửa tay” và agent sẽ không ghi đè nó ở lần viết lại."
      footer={<DialogButtons onCancel={onCancel} onOk={save} okDisabled={busy}
        okLabel={busy ? "Đang lưu…" : "💾 Lưu & đánh dấu đã sửa tay"} />}>
      {err && <div className="dg-err">{err}</div>}
      <div className="dg-ed">
        {blocks.map((b, i) => (
          <section className="dg-ed-b" key={i}>
            <header>
              <span className="dg-label">{BLOCK_LABELS[b.t] || b.t}</span>
              {(b.sources || []).length > 0 && (
                <span className="pill" title={(b.sources || []).map((s) => s.file).join("\n")}>
                  {b.sources.length} nguồn — giữ nguyên
                </span>
              )}
              {!b.sources?.length && !b.assumption && !b.providedBy && (
                <button className={"mini"} title="Khối không có nguồn thì phải tự khai là suy luận"
                  onClick={() => patch(i, { assumption: !b.assumption })}>
                  đánh dấu assumption
                </button>
              )}
              {b.assumption && <span className="pill run">assumption</span>}
              <span className="dg-spacer" />
              <button className="mini" title="Lên" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="mini" title="Xuống" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="mini danger" title="Xoá khối" onClick={() => drop(i)}>✕</button>
            </header>
            <BlockFields b={b} onChange={(n) => patch(i, n)} />
          </section>
        ))}
      </div>

      <div className="dg-row" style={{ alignItems: "center", gap: 6 }}>
        <span className="dg-label">Thêm khối</span>
        {ADDABLE.map((t) => (
          <button className="mini" key={t} onClick={() => add(t)}>＋ {BLOCK_LABELS[t]}</button>
        ))}
      </div>

      <label className="dg-field">
        <span className="dg-label">Truy vết yêu cầu (tuỳ chọn)</span>
        <input className="dg-inp" value={traces} placeholder="FR-07, FR-12"
          onChange={(e) => setTraces(e.target.value)} />
        <span className="dg-dlg-hint">Mã yêu cầu từ tài liệu agile của project, cách nhau bằng dấu phẩy.</span>
      </label>
    </Dialog>
  );
}

function BlockFields({ b, onChange }) {
  if (b.t === "p" || b.t === "callout") {
    return (
      <>
        {b.t === "callout" && (
          <div className="dg-row" style={{ gap: 6 }}>
            {["info", "warn", "danger"].map((lv) => (
              <button key={lv} className={"mini" + (b.level === lv ? " on" : "")}
                onClick={() => onChange({ level: lv })}>{lv}</button>
            ))}
          </div>
        )}
        <textarea className="dg-inp" rows={3} value={b.text || ""}
          onChange={(e) => onChange({ text: e.target.value })} />
      </>
    );
  }
  if (b.t === "code") {
    return (
      <>
        <input className="dg-inp" style={{ maxWidth: 160 }} value={b.lang || ""} placeholder="ngôn ngữ"
          onChange={(e) => onChange({ lang: e.target.value })} />
        <textarea className="dg-inp" rows={5} value={b.text || ""} spellCheck={false}
          onChange={(e) => onChange({ text: e.target.value })} />
      </>
    );
  }
  if (b.t === "bullets" || b.t === "num" || b.t === "flow") {
    const key = b.t === "flow" ? "steps" : "items";
    const list = b[key] || [];
    return (
      <>
        <textarea className="dg-inp" rows={Math.min(9, Math.max(3, list.length + 1))}
          value={list.join("\n")}
          onChange={(e) => onChange({ [key]: e.target.value.split("\n") })} />
        <span className="dg-dlg-hint">
          {b.t === "flow"
            ? "Một bước mỗi dòng. Bước bắt đầu bằng “if ” là nhánh điều kiện, “return ” là kết thúc, “DB: ” là truy cập dữ liệu."
            : "Một mục mỗi dòng."}
        </span>
        {b.t === "flow" && (
          <div className="dg-ir-flowprev">
            {list.filter(Boolean).map((s, i) => {
              const sh = flowShape(s);
              return <span key={i} title={sh.title}>{sh.mark} {s}</span>;
            })}
          </div>
        )}
      </>
    );
  }
  if (b.t === "figure") {
    return (
      <>
        <input className="dg-inp" value={b.caption || ""} placeholder="chú thích hình"
          onChange={(e) => onChange({ caption: e.target.value })} />
        <input className="dg-inp" value={b.alt || ""} placeholder="alt text — bắt buộc"
          onChange={(e) => onChange({ alt: e.target.value, altFromCaption: false })} />
        <span className="dg-dlg-hint">Alt text là bắt buộc: trình đọc màn hình chỉ có mỗi dòng này.
          Hình thật được vẽ ở bước sau, giờ để trống cũng được.</span>
      </>
    );
  }
  if (b.t === "refs") {
    const items = b.items || [];
    return (
      <>
        {items.map((p, i) => (
          <div className="dg-row" key={i} style={{ gap: 6 }}>
            <input className="dg-inp" style={{ flex: "1 1 40%" }} value={p[0] || ""} placeholder="tên tài liệu"
              onChange={(e) => onChange({ items: items.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) })} />
            <input className="dg-inp" style={{ flex: "1 1 50%" }} value={p[1] || ""} placeholder="https://…"
              onChange={(e) => onChange({ items: items.map((x, j) => (j === i ? [x[0], e.target.value] : x)) })} />
            <button className="mini danger" onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="mini" onClick={() => onChange({ items: [...items, ["", ""]] })}>＋ dòng</button>
      </>
    );
  }
  if (b.t === "table") return <TableFields b={b} onChange={onChange} />;
  return <p className="dg-dim">Khối “{b.t}” chưa có editor riêng — nội dung được giữ nguyên khi lưu.</p>;
}

// A real grid, not a comma-separated string: a cell containing a comma is normal in a document and
// must not silently split the row.
function TableFields({ b, onChange }) {
  const headers = b.headers || [];
  const rows = b.rows || [];
  const width = headers.length || (rows[0]?.length || 2);

  const setHeader = (i, v) => onChange({ headers: headers.map((h, j) => (j === i ? v : h)) });
  const setCell = (r, c, v) =>
    onChange({ rows: rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const addRow = () => onChange({ rows: [...rows, Array(width).fill("")] });
  const addCol = () => onChange({
    headers: [...headers, ""],
    rows: rows.map((r) => [...r, ""]),
  });
  const dropRow = (r) => onChange({ rows: rows.filter((_, i) => i !== r) });
  const dropCol = (c) => onChange({
    headers: headers.filter((_, i) => i !== c),
    rows: rows.map((r) => r.filter((_, i) => i !== c)),
  });

  return (
    <>
      <div className="dg-scroll">
        <table className="dg-ed-tbl">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>
                  <input className="dg-inp" value={h} placeholder={`cột ${i + 1}`}
                    onChange={(e) => setHeader(i, e.target.value)} />
                  <button className="mini danger" title="Xoá cột" onClick={() => dropCol(i)}>✕</button>
                </th>
              ))}
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((c, i) => (
                  <td key={i}>
                    <input className="dg-inp" value={c} onChange={(e) => setCell(r, i, e.target.value)} />
                  </td>
                ))}
                <td><button className="mini danger" title="Xoá hàng" onClick={() => dropRow(r)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dg-row" style={{ gap: 6 }}>
        <button className="mini" onClick={addRow}>＋ hàng</button>
        <button className="mini" onClick={addCol}>＋ cột</button>
        <span className="dg-dlg-hint">Bảng phải có hàng tiêu đề và không nên có ô trống.</span>
      </div>
    </>
  );
}
