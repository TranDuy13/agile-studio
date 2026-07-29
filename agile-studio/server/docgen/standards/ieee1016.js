// IEEE 1016 (design descriptions) organised by the ISO/IEC/IEEE 42010 chain:
// stakeholder -> concern -> viewpoint -> view. Each viewpoint is one section.
export default {
  id: "ieee1016",
  label: "IEEE 1016 + ISO 42010",
  standard: "IEEE 1016-2009 + ISO/IEC/IEEE 42010:2011",
  summary: "Mô tả thiết kế theo viewpoint, mỗi viewpoint trả lời một nhóm mối quan tâm.",
  docs: [
    {
      key: "sdd",
      title: "Software Design Description",
      short: "SDD",
      hint: "SDD — mô tả thiết kế phần mềm theo viewpoint",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Mục đích, phạm vi, người đọc và cách tổ chức tài liệu thiết kế",
          from: ["readme", "agile-docs"],
          accept: { minBlocks: 2, minSources: 1 },
        },
        {
          num: "2", title: "References", kind: "reference", required: true,
          hint: "Tài liệu và chuẩn được viện dẫn trong bản thiết kế",
          from: ["readme", "deps"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "3", title: "Stakeholders and Design Concerns", kind: "explanation", required: true,
          hint: "Ai quan tâm tới thiết kế này và họ quan tâm điều gì",
          from: ["agile-docs", "readme"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "4", title: "Context Viewpoint", kind: "reference", required: true,
          hint: "Ranh giới hệ thống, tác nhân ngoài và dịch vụ trao đổi qua ranh giới đó",
          from: ["integrations", "api"],
          accept: { minBlocks: 1, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "5", title: "Composition Viewpoint", kind: "reference", required: true,
          hint: "Hệ thống gồm những thành phần nào và mỗi thành phần chịu trách nhiệm gì",
          from: ["project-structure", "code"],
          accept: { minBlocks: 2, mustHave: ["table"], minSources: 3, noEmptyCells: true },
        },
        {
          num: "6", title: "Logical Viewpoint", kind: "reference", required: true,
          hint: "Lớp, kiểu dữ liệu và quan hệ tĩnh giữa chúng",
          from: ["code", "db-schema"],
          accept: { minBlocks: 2, mustHave: ["table"], minSources: 3 },
        },
        {
          num: "7", title: "Dependency Viewpoint", kind: "reference", required: true,
          hint: "Thành phần nào dùng thành phần nào, và phụ thuộc ra bên ngoài",
          from: ["deps", "project-structure"],
          accept: { minBlocks: 1, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "8", title: "Information Viewpoint", kind: "reference", required: true,
          hint: "Dữ liệu bền vững: thực thể, lược đồ, vòng đời và ràng buộc",
          from: ["db-schema", "migrations"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "9", title: "Interface Viewpoint", kind: "reference", required: true,
          hint: "Chữ ký của mọi giao diện mà thành phần khác gọi tới",
          from: ["api", "routes"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "10", title: "Interaction Viewpoint", kind: "reference", required: true,
          hint: "Trình tự trao đổi giữa các thành phần trong từng kịch bản chính",
          from: ["routes", "jobs"],
          accept: { minBlocks: 1, mustHave: ["flow"], minSources: 2 },
        },
        {
          num: "11", title: "Design Rationale", kind: "explanation", required: true,
          hint: "Vì sao chọn phương án này, đã cân nhắc và loại bỏ những phương án nào",
          from: ["git-history", "agile-docs"],
          accept: { minBlocks: 2, minSources: 2 },
        },
      ],
    },
  ],
};
