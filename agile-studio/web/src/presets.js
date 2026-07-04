export const ROLE_ORDER = ["pm", "ba", "da", "dev", "qc", "po"];

export const ROLE_META = {
  pm:  { emoji: "🎯", name: "PM" },
  ba:  { emoji: "📋", name: "BA" },
  da:  { emoji: "🏗️", name: "DA" },
  dev: { emoji: "💻", name: "Dev" },
  qc:  { emoji: "🔍", name: "QC" },
  po:  { emoji: "✅", name: "PO" },
};

// Preset "chế độ chạy" — map sang các giai đoạn Agile thực tế.
export const PRESETS = [
  { id: "full",    icon: "🔄", label: "Full luồng",       roles: ["pm", "ba", "da", "dev", "qc", "po"], desc: "Feature mới trọn vẹn: phân tích → thiết kế → code → test → nghiệm thu" },
  { id: "refine",  icon: "📐", label: "Phân tích & TK",    roles: ["pm", "ba", "da"],                    desc: "Cập nhật tài liệu theo yêu cầu mới của khách — KHÔNG code" },
  { id: "analyze", icon: "🧩", label: "BA + DA",           roles: ["ba", "da"],                          desc: "Làm rõ nghiệp vụ & thiết kế, không đụng PM/code" },
  { id: "build",   icon: "💻", label: "Chỉ code (Dev)",    roles: ["dev"],                               desc: "Tài liệu đã đủ → chỉ implement; gom nhiều feature, chưa test" },
  { id: "devtest", icon: "🧪", label: "Code + Test",       roles: ["dev", "qc"],                         desc: "Code xong kiểm thử luôn, chưa nghiệm thu" },
  { id: "harden",  icon: "✅", label: "Test + Nghiệm thu", roles: ["qc", "po"],                          desc: "Gom nhiều feature test & nghiệm thu 1 lần" },
  { id: "impl",    icon: "🚀", label: "Dev→QC→PO",         roles: ["dev", "qc", "po"],                   desc: "Tài liệu đã có → thực thi tới nghiệm thu" },
];

export const presetOf = (roles) =>
  PRESETS.find((p) => p.roles.length === roles.length && p.roles.every((r) => roles.includes(r)));
