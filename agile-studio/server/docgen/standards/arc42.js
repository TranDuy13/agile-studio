// arc42 (+ C4 model for the diagram levels of the Building Block View).
// Section titles are the ones arc42 publishes — they stay in English on purpose (RULESET N11);
// `hint` is the one-line Vietnamese tooltip the UI shows on hover.
export default {
  id: "arc42",
  label: "arc42 + C4",
  standard: "arc42 + C4 model",
  summary: "Khung 12 mục cho tài liệu kiến trúc, kèm 4 mức sơ đồ của C4.",
  docs: [
    {
      key: "sad",
      title: "Software Architecture Document",
      short: "Software Architecture",
      hint: "Tài liệu kiến trúc phần mềm theo khung arc42",
      sections: [
        {
          num: "1", title: "Introduction and Goals", kind: "explanation", required: true,
          hint: "Bài toán cần giải, mục tiêu chất lượng, các bên liên quan",
          from: ["agile-docs", "readme"],
          accept: { minBlocks: 2, minSources: 1 },
        },
        {
          num: "2", title: "Constraints", kind: "reference", required: true,
          hint: "Ràng buộc kỹ thuật và tổ chức mà thiết kế phải tuân theo",
          from: ["deps", "config", "env"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "3", title: "Context and Scope", kind: "explanation", required: true,
          hint: "Hệ thống nằm ở đâu, trao đổi gì với hệ thống và người dùng bên ngoài",
          from: ["integrations", "api", "readme"],
          accept: { minBlocks: 2, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "4", title: "Solution Strategy", kind: "explanation", required: true,
          hint: "Các quyết định nền tảng: công nghệ, cách phân rã, cách đạt mục tiêu chất lượng",
          from: ["project-structure", "deps", "git-history"],
          accept: { minBlocks: 2, minSources: 2 },
        },
        {
          num: "5", title: "Building Block View", kind: "reference", required: true,
          hint: "Phân rã hệ thống thành các khối lồng nhau theo từng cấp",
          from: ["project-structure", "code"],
          accept: { minBlocks: 2, mustHave: ["table", "figure"], minSources: 3, noEmptyCells: true },
        },
        {
          num: "6", title: "Runtime View", kind: "reference", required: true,
          hint: "Các thành phần phối hợp với nhau ra sao khi chạy một kịch bản cụ thể",
          from: ["routes", "jobs", "auth"],
          accept: { minBlocks: 2, mustHave: ["flow"], minSources: 3 },
        },
        {
          num: "7", title: "Deployment View", kind: "reference", required: true,
          hint: "Phần mềm chạy trên hạ tầng nào, ánh xạ khối vào máy chủ hoặc container",
          from: ["docker", "ci", "config"],
          accept: { minBlocks: 1, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "8", title: "Cross-cutting Concepts", kind: "explanation", required: true,
          hint: "Chủ đề áp cho toàn hệ thống: xác thực, ghi log, đa ngôn ngữ, xử lý lỗi",
          from: ["auth", "logging", "i18n", "errors"],
          accept: { minBlocks: 3, minSources: 3 },
        },
        {
          num: "9", title: "Architecture Decisions", kind: "explanation", required: true,
          hint: "ADR — quyết định kiến trúc quan trọng kèm bối cảnh và lý do chọn",
          from: ["git-history", "agile-docs", "deps"],
          accept: { minBlocks: 2, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "10", title: "Quality Requirements", kind: "reference", required: true,
          hint: "Kịch bản chất lượng đo được, phân loại theo ISO/IEC 25010",
          from: ["quality-attrs", "config", "tests"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "11", title: "Risks and Technical Debt", kind: "explanation", required: false,
          hint: "Rủi ro đã biết và technical debt đang gánh",
          from: ["todo", "tests", "git-history"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1 },
        },
        {
          num: "12", title: "Glossary", kind: "reference", required: true,
          hint: "Thuật ngữ chuẩn dùng thống nhất xuyên suốt bộ tài liệu",
          from: ["code", "agile-docs"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
      ],
    },
  ],
};
