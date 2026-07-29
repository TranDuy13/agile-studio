// ISO/IEC/IEEE 26514 — designing and developing information for users.
// Two documents (end user / administrator), with Diataxis kinds decided per section:
// a task section is howto, a first-run walkthrough is tutorial, a lookup section is reference.
export default {
  id: "iso26514",
  label: "ISO/IEC/IEEE 26514",
  standard: "ISO/IEC/IEEE 26514:2022 + Diátaxis",
  summary: "Tài liệu cho người dùng cuối và quản trị viên, tách theo loại việc người đọc đang làm.",
  docs: [
    {
      key: "user-guide",
      title: "User Guide",
      short: "User Guide",
      hint: "Hướng dẫn dành cho người dùng cuối",
      sections: [
        {
          num: "1", title: "About This Guide", kind: "explanation", required: true,
          hint: "Tài liệu này dành cho ai, bao trùm phiên bản nào, quy ước trình bày",
          from: ["readme", "agile-docs"],
          accept: { minBlocks: 2, minSources: 1 },
        },
        {
          num: "2", title: "Getting Started", kind: "tutorial", required: true,
          hint: "Đi hết một lượt từ đăng nhập tới khi hoàn thành việc đầu tiên",
          from: ["ui", "auth", "readme"],
          accept: { minBlocks: 2, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "3", title: "Key Concepts", kind: "explanation", required: true,
          hint: "Những khái niệm phải hiểu trước khi thao tác",
          from: ["agile-docs", "db-schema"],
          accept: { minBlocks: 2, minSources: 2 },
        },
        {
          num: "4", title: "Interface Overview", kind: "reference", required: true,
          hint: "Từng vùng màn hình gọi là gì và làm được gì ở đó",
          from: ["ui"],
          accept: { minBlocks: 1, mustHave: ["figure", "table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "5", title: "Common Tasks", kind: "howto", required: true,
          hint: "Các việc làm hằng ngày, mỗi việc một quy trình đánh số bước",
          from: ["ui", "routes"],
          accept: { minBlocks: 3, minSources: 3 },
        },
        {
          num: "6", title: "Advanced Tasks", kind: "howto", required: false,
          hint: "Việc ít gặp hoặc cần quyền cao hơn",
          from: ["ui", "routes", "auth"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "7", title: "Settings and Preferences", kind: "reference", required: true,
          hint: "Từng tuỳ chọn người dùng chỉnh được, giá trị mặc định và ảnh hưởng",
          from: ["config", "ui"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "8", title: "Troubleshooting", kind: "howto", required: true,
          hint: "Triệu chứng thường gặp, nguyên nhân và cách tự xử lý",
          from: ["errors", "logging"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "9", title: "Accessibility", kind: "reference", required: false,
          hint: "Phím tắt, trình đọc màn hình và các hỗ trợ tiếp cận khác",
          from: ["ui"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "10", title: "Glossary", kind: "reference", required: true,
          hint: "Thuật ngữ người dùng gặp trên màn hình, giải thích bằng lời thường",
          from: ["ui", "code"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
      ],
    },
    {
      key: "admin-guide",
      title: "Administrator Guide",
      short: "Administrator Guide",
      hint: "Hướng dẫn dành cho người quản trị hệ thống",
      sections: [
        {
          num: "1", title: "About This Guide", kind: "explanation", required: true,
          hint: "Người đọc là quản trị viên, cần biết gì trước khi bắt đầu",
          from: ["readme"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "2", title: "System Requirements", kind: "reference", required: true,
          hint: "Phần cứng, hệ điều hành và phần mềm nền cần có",
          from: ["docker", "deps", "config"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "3", title: "Installation", kind: "howto", required: true,
          hint: "Các bước cài đặt từ máy trắng tới khi dịch vụ chạy",
          from: ["docker", "scripts", "readme"],
          accept: { minBlocks: 2, minSources: 2 },
        },
        {
          num: "4", title: "Configuration", kind: "reference", required: true,
          hint: "Từng khoá cấu hình: ý nghĩa, giá trị mặc định, phạm vi hợp lệ",
          from: ["config", "env"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "5", title: "User and Access Management", kind: "howto", required: true,
          hint: "Tạo tài khoản, gán vai trò và thu hồi quyền",
          from: ["auth", "db-schema"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2 },
        },
        {
          num: "6", title: "Backup and Restore", kind: "howto", required: true,
          hint: "Sao lưu những gì, bao lâu một lần, và khôi phục ra sao",
          from: ["db-schema", "scripts", "docker"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "7", title: "Monitoring and Logs", kind: "reference", required: true,
          hint: "Log nằm ở đâu, chỉ số nào cần theo dõi, ngưỡng cảnh báo",
          from: ["logging", "config"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "8", title: "Troubleshooting", kind: "howto", required: true,
          hint: "Sự cố vận hành hay gặp và cách khoanh vùng nguyên nhân",
          from: ["errors", "logging"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
      ],
    },
  ],
};
