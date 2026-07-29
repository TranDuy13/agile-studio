// ISO/IEC/IEEE 29148 — requirements engineering. One document: the SRS.
// Requirement identifiers (FR-##, QR-##) come from here and feed the traceability score (D6).
export default {
  id: "iso29148",
  label: "ISO/IEC/IEEE 29148",
  standard: "ISO/IEC/IEEE 29148:2018",
  summary: "Đặc tả yêu cầu phần mềm: mã yêu cầu, thuộc tính, và truy vết.",
  docs: [
    {
      key: "srs",
      title: "Software Requirements Specification",
      short: "SRS",
      hint: "SRS — đặc tả yêu cầu phần mềm theo ISO/IEC/IEEE 29148",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Mục đích của tài liệu, phạm vi sản phẩm, người đọc mong đợi",
          from: ["agile-docs", "readme"],
          accept: { minBlocks: 2, minSources: 1 },
        },
        {
          num: "2", title: "References", kind: "reference", required: true,
          hint: "Tài liệu, chuẩn và đặc tả ngoài được viện dẫn trong SRS",
          from: ["readme", "deps"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "3", title: "Definitions and Acronyms", kind: "reference", required: true,
          hint: "Thuật ngữ và từ viết tắt dùng trong tài liệu",
          from: ["code", "agile-docs"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "4", title: "Product Perspective and Users", kind: "explanation", required: true,
          hint: "Sản phẩm nằm ở đâu trong bức tranh lớn, ai dùng và dùng để làm gì",
          from: ["agile-docs", "integrations", "ui"],
          accept: { minBlocks: 2, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "5", title: "Functional Requirements", kind: "reference", required: true,
          hint: "Yêu cầu chức năng, mỗi yêu cầu một mã FR-## kiểm chứng được",
          from: ["routes", "ui", "agile-docs"],
          accept: { minBlocks: 2, mustHave: ["table"], minSources: 3, noEmptyCells: true },
        },
        {
          num: "6", title: "External Interface Requirements", kind: "reference", required: true,
          hint: "Giao diện với người dùng, phần cứng, phần mềm khác và mạng",
          from: ["api", "integrations", "ui"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "7", title: "Quality Requirements", kind: "reference", required: true,
          hint: "Yêu cầu phi chức năng theo ISO/IEC 25010, phải đo được",
          from: ["quality-attrs", "config", "tests"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "8", title: "Constraints, Assumptions and Dependencies", kind: "reference", required: true,
          hint: "Điều kiện bắt buộc phải chấp nhận và những gì hệ thống phụ thuộc vào",
          from: ["deps", "env", "config"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2 },
        },
        {
          num: "9", title: "Verification and Traceability", kind: "reference", required: true,
          hint: "Cách kiểm chứng từng yêu cầu và bảng truy vết yêu cầu ↔ thiết kế ↔ kiểm thử",
          from: ["tests", "agile-docs"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
      ],
    },
  ],
};
