import React from "react";

// Reading the content of one section. This is the "đọc được nội dung" half of D2 — the .docx is
// for handing over, this is for checking what the agent actually wrote before you hand anything
// over. It renders the IR block types of README §5 and nothing else.
//
// Every block shows where it came from, or says out loud that it has no source (RULESET N2): a
// paragraph whose provenance you cannot see is the one that turns out to be invented.

export const BLOCK_LABELS = {
  p: "Đoạn văn", bullets: "Gạch đầu dòng", num: "Danh sách đánh số", table: "Bảng",
  code: "Mã nguồn", figure: "Hình", flow: "Sơ đồ luồng", refs: "Tài liệu tham chiếu",
  callout: "Lưu ý",
};

// The flow shape convention of RULESET §3, shown as the marker the renderer will draw later.
export function flowShape(step) {
  const s = String(step || "").trim().toLowerCase();
  if (s.startsWith("if ")) return { mark: "◇", title: "nhánh điều kiện — thoi đỏ trong sơ đồ" };
  if (s.startsWith("return ")) return { mark: "⬤", title: "kết thúc — viên xanh lá trong sơ đồ" };
  if (s.startsWith("db:")) return { mark: "▱", title: "truy cập dữ liệu — hình bình hành" };
  return { mark: "▭", title: "bước xử lý — chữ nhật bo góc" };
}

function shortPath(p) {
  const parts = String(p || "").replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? String(p || "") : "…/" + parts.slice(-2).join("/");
}

export function SourceTags({ block }) {
  const list = block.sources || [];
  if (list.length) {
    return (
      <div className="dg-ir-src">
        {list.slice(0, 4).map((s, i) => (
          <em key={i} title={`${s.file}${s.lines ? ` · dòng ${s.lines.join("–")}` : ""}${s.commit ? ` · commit ${s.commit}` : ""}`}>
            {shortPath(s.file)}{s.lines ? `:${s.lines[0]}` : ""}
          </em>
        ))}
        {list.length > 4 && <em className="more">+{list.length - 4}</em>}
      </div>
    );
  }
  if (block.assumption)
    return <div className="dg-ir-src"><em className="warn" title="Khối này là suy luận, chưa dẫn được về mã nguồn">assumption</em></div>;
  if (block.providedBy)
    return <div className="dg-ir-src"><em className="warn" title="Thông tin do chủ sản phẩm cung cấp, không có trong mã nguồn">provided-by-owner</em></div>;
  return <div className="dg-ir-src"><em className="bad" title="Khối không có nguồn và cũng không tự khai là suy luận — nên sửa">chưa có nguồn</em></div>;
}

function Block({ b }) {
  const body = () => {
    switch (b.t) {
      case "p": return <p>{b.text}</p>;
      case "bullets": return <ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
      case "num": return <ol>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ol>;
      case "code": return (
        <pre className="dg-ir-code"><code>{b.text}</code></pre>
      );
      case "table": return (
        // Wide tables scroll inside their own box: the page itself must never scroll sideways.
        <div className="dg-scroll">
          <table className="dg-ir-tbl">
            <thead><tr>{(b.headers || []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {(b.rows || []).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
            </tbody>
          </table>
          {b.caption && <div className="dg-ir-cap">{b.caption}</div>}
        </div>
      );
      case "figure": return (
        <div className="dg-ir-fig">
          <div className="ph">chưa có hình — sơ đồ được vẽ ở bản sau</div>
          <div className="dg-ir-cap">{b.caption || "(chưa có chú thích)"}</div>
          <div className="dg-ir-alt">
            alt: {b.alt || <b className="bad">thiếu alt text</b>}
            {b.altFromCaption && <span className="dg-dim"> · lấy từ chú thích</span>}
          </div>
        </div>
      );
      case "flow": return (
        <>
          <ol className="dg-ir-flow">
            {b.steps.map((s, i) => {
              const sh = flowShape(s);
              return <li key={i}><i title={sh.title}>{sh.mark}</i><span>{s}</span></li>;
            })}
          </ol>
          {b.caption && <div className="dg-ir-cap">{b.caption}</div>}
        </>
      );
      case "refs": return (
        <ul className="dg-ir-refs">
          {b.items.map((p, i) => (
            <li key={i}>{p[1]
              ? <a href={p[1]} target="_blank" rel="noreferrer">{p[0] || p[1]}</a>
              : p[0]}</li>
          ))}
        </ul>
      );
      case "callout": return (
        <div className={"dg-ir-call " + (b.level || "info")}>
          <i>{b.level === "warn" ? "⚠" : b.level === "danger" ? "✖" : "ℹ"}</i><span>{b.text}</span>
        </div>
      );
      default: return <p className="dg-dim">Khối lạ: {b.t}</p>;
    }
  };
  return <div className="dg-ir-b">{body()}<SourceTags block={b} /></div>;
}

export default function IrView({ ir, section }) {
  if (!ir) {
    return <p className="dg-muted">Mục này chưa có nội dung. Bấm <b>▶ Bắt đầu viết</b> (hoặc chọn riêng
      mục này) để agent viết, hoặc bấm ✎ để tự viết tay.</p>;
  }
  const unsourced = (ir.blocks || []).filter((b) => !b.sources?.length && !b.assumption && !b.providedBy).length;
  return (
    <div className="dg-ir">
      <div className="dg-ir-h">
        <b>{section?.num}. {section?.title}</b>
        <span className="pill">{ir.kind}</span>
        {section?.edited && <span className="pill acc" title="Đã sửa tay — agent không ghi đè mục này">✎ sửa tay</span>}
        {section?.status === "stale" && <span className="pill run" title={(section.staleFiles || []).join("\n")}>● nguồn đã đổi</span>}
        <span className="dg-spacer" />
        {unsourced > 0 && <span className="pill err">{unsourced} khối chưa có nguồn</span>}
      </div>
      {(ir.traces || []).length > 0 && (
        <div className="dg-ir-tr">
          truy vết: {ir.traces.map((t) => <span className="dg-chip" key={t}>{t}</span>)}
        </div>
      )}
      {(ir.blocks || []).map((b, i) => <Block key={i} b={b} />)}
    </div>
  );
}
