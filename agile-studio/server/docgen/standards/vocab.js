// Shared vocabulary for standard declarations.
//
// `from` on a section names the data a surveying agent should look at. Keys are stable
// identifiers used by the survey prompt; the labels are what the UI shows (Vietnamese).
// `kind` follows Diataxis and drives tone at writing time (D2), never the section title.
export const SOURCE_LABELS = {
  "agile-docs": "Tài liệu agile (PM/BA/DA)",
  readme: "README · mô tả repo",
  "project-structure": "Cấu trúc thư mục project",
  deps: "Phụ thuộc (package/nuget/pip)",
  config: "Tệp cấu hình",
  env: "Biến môi trường",
  secrets: "Nơi cất khoá bí mật",
  "git-history": "Lịch sử git",
  routes: "Route · controller · endpoint",
  api: "API công khai",
  jobs: "Job nền · hàng đợi",
  auth: "Xác thực · phân quyền",
  i18n: "Đa ngôn ngữ",
  logging: "Ghi log · giám sát",
  errors: "Xử lý lỗi",
  "db-schema": "Lược đồ CSDL · entity",
  migrations: "Migration · seed",
  docker: "Docker · hạ tầng chạy",
  ci: "CI/CD · pipeline",
  scripts: "Script build · chạy",
  tests: "Bộ kiểm thử",
  ui: "Màn hình · thành phần giao diện",
  todo: "TODO · FIXME · cảnh báo build",
  code: "Toàn bộ mã nguồn",
  integrations: "Tích hợp với hệ thống ngoài",
  "quality-attrs": "Chỉ tiêu chất lượng · SLA",
};

// Diataxis kinds, with the one-line Vietnamese tooltip shown next to a section's kind.
export const KIND_LABELS = {
  reference: "Tra cứu: nó là gì, giá trị bao nhiêu, ở đâu — viết súc tích",
  howto: "Hướng dẫn: các bước để làm xong một việc cụ thể",
  explanation: "Giải thích: vì sao lại thế — dành cho người muốn hiểu bối cảnh",
  tutorial: "Bài học: dắt người mới đi hết một lượt từ đầu",
};

export const KINDS = Object.keys(KIND_LABELS);
