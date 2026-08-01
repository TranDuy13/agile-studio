// Node side of the Python sidecar: find an interpreter that can actually render, then hand it the
// IR and collect the files it produced.
//
// "An interpreter that can render" is not the same as "python is installed". On this machine the
// `python` on PATH is the one bundled with LibreOffice and `py -3` is a newer CPython without
// python-docx — so every candidate is probed with `render.py --check`, which answers the only
// question that matters. The answer is cached, and D3 will reuse the same probe for its
// "công cụ ngoài" screen.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WORK_DIR } from "../store/docgen.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// server/docgen/exporter.js -> <app>/docgen/render.py
export const SIDECAR_DIR = join(HERE, "..", "..", "docgen");
export const RENDER_PY = join(SIDECAR_DIR, "render.py");

const WIN = process.platform === "win32";
const CANDIDATES = WIN
  ? [["python", []], ["py", ["-3"]], ["python3", []], ["python3.12", []]]
  : [["python3", []], ["python", []], ["python3.12", []]];

const INSTALL_HINT = "Cần Python 3 kèm gói python-docx để xuất .docx. "
  + "Cài Python rồi chạy: pip install python-docx. "
  + "Đường tự dò và cài giúp sẽ có ở màn Cài đặt → Công cụ ngoài.";

// A short-lived child that must never hang the request. Returns { code, stdout, stderr }.
function run(bin, args, { cwd, timeout = 120000, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd, windowsHide: true,
        // PYTHONIOENCODING is not optional: without it a Vietnamese string in the JSON answer
        // dies with UnicodeEncodeError on a cp1252 console (RULESET §6 #1).
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ...env },
      });
    } catch (e) { return resolve({ code: -1, stdout: "", stderr: String(e.message) }); }
    let stdout = "", stderr = "";
    child.stdout?.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr?.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr + String(e.message) }));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// render.py prints exactly one JSON object, but a Windows Python can still prepend a warning line.
function parseOut(stdout) {
  const a = stdout.indexOf("{");
  const b = stdout.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(stdout.slice(a, b + 1)); } catch { return null; }
}

let cached = null;

export async function detectPython({ force = false } = {}) {
  if (cached && !force) return cached;
  if (!existsSync(RENDER_PY))
    return (cached = { ok: false, reason: "missing-script",
      hint: `Không thấy ${RENDER_PY}. Cài đặt app bị thiếu tệp sidecar.`, tried: [] });

  const tried = [];
  for (const [bin, pre] of CANDIDATES) {
    const r = await run(bin, [...pre, RENDER_PY, "--check"], { cwd: SIDECAR_DIR, timeout: 25000 });
    const out = parseOut(r.stdout);
    if (out?.ok) {
      return (cached = { ok: true, bin, args: pre, python: out.python,
        pythonDocx: out.pythonDocx, tried });
    }
    tried.push({ bin: [bin, ...pre].join(" "),
      why: out?.error || (r.code === -1 ? "không gọi được" : (r.stderr || r.stdout || "").trim().slice(0, 140))
        || `thoát ${r.code}` });
  }
  return (cached = { ok: false, reason: tried.some((t) => /python-docx/i.test(t.why)) ? "missing-docx" : "missing-python",
    hint: INSTALL_HINT, tried });
}

export function forgetPython() { cached = null; }

// docs: [{ file, title, project, docId, version, classification, docStatus, standard, sections }]
export async function renderDocx({ jobId, docs, destDir, draft }) {
  const py = await detectPython();
  if (!py.ok) return { ok: false, locked: true, error: py.hint, reason: py.reason, tried: py.tried };

  const scratch = join(WORK_DIR, String(jobId), "export");
  mkdirSync(scratch, { recursive: true });
  const payloadFile = join(scratch, `payload-${Date.now().toString(36)}.json`);
  // A payload file rather than an argument or stdin: multi-line JSON through `python -c` breaks on
  // PowerShell quoting (RULESET §6 #2), and a file is also what makes a failed export debuggable.
  writeFileSync(payloadFile, JSON.stringify({ destDir, draft: !!draft, docs }, null, 1), "utf8");

  const r = await run(py.bin, [...py.args, RENDER_PY, payloadFile],
    { cwd: SIDECAR_DIR, timeout: 10 * 60 * 1000 });
  const out = parseOut(r.stdout);
  try { rmSync(payloadFile, { force: true }); } catch { /* keep going */ }

  if (!out) {
    return { ok: false, error: "Không đọc được kết quả của render.py. "
      + (r.stderr || r.stdout || "").trim().slice(0, 400) };
  }
  return { ...out, python: { bin: [py.bin, ...py.args].join(" "), version: py.python, docx: py.pythonDocx } };
}
