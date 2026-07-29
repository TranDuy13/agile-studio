// ISO/IEC/IEEE 15289 — life-cycle information items. Six documents, 41 sections.
//
// Caveat kept honest on purpose: 15289 catalogues the *information items* a life cycle must
// produce, it does not publish a section-by-section outline for each one. The outline below is
// the common industry shape of those items; rà lại với văn bản chuẩn trước khi phát hành ra ngoài.
export default {
  id: "iso15289",
  label: "ISO/IEC/IEEE 15289",
  standard: "ISO/IEC/IEEE 15289:2019",
  summary: "Bộ hạng mục thông tin của vòng đời phần mềm — 6 tài liệu bàn giao được.",
  caveat: "Danh sách mục là khung theo thực hành phổ biến, chưa đối chiếu từng chữ với văn bản chuẩn.",
  docs: [
    {
      key: "sdd",
      title: "Software Design Description",
      short: "Software Design Description",
      hint: "Bản mô tả thiết kế phần mềm trong bộ hạng mục vòng đời",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Mục đích, phạm vi và người đọc của bản thiết kế",
          from: ["readme", "agile-docs"],
          accept: { minBlocks: 2, minSources: 1 },
        },
        {
          num: "2", title: "References", kind: "reference", required: true,
          hint: "Tài liệu và chuẩn được viện dẫn",
          from: ["readme", "deps"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "3", title: "Definitions", kind: "reference", required: true,
          hint: "Thuật ngữ và từ viết tắt dùng trong tài liệu",
          from: ["code"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "4", title: "Context", kind: "explanation", required: true,
          hint: "Hệ thống đứng ở đâu và trao đổi với ai bên ngoài",
          from: ["integrations", "api"],
          accept: { minBlocks: 1, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "5", title: "Design Overview", kind: "explanation", required: true,
          hint: "Ý tưởng thiết kế tổng thể và cách phân rã hệ thống",
          from: ["project-structure", "code"],
          accept: { minBlocks: 2, minSources: 2 },
        },
        {
          num: "6", title: "Design Views", kind: "reference", required: true,
          hint: "Từng khung nhìn thiết kế: thành phần, dữ liệu, triển khai",
          from: ["project-structure", "db-schema", "docker"],
          accept: { minBlocks: 3, mustHave: ["table", "figure"], minSources: 3, noEmptyCells: true },
        },
        {
          num: "7", title: "Interfaces", kind: "reference", required: true,
          hint: "Giao diện trong và ngoài kèm chữ ký, tham số, mã lỗi",
          from: ["api", "routes"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "8", title: "Rationale", kind: "explanation", required: true,
          hint: "Lý do chọn phương án và các phương án đã loại",
          from: ["git-history", "agile-docs"],
          accept: { minBlocks: 1, minSources: 1 },
        },
      ],
    },
    {
      key: "dbdd",
      title: "Database Design Description",
      short: "Database Design",
      hint: "Thiết kế cơ sở dữ liệu: thực thể, trường, quan hệ, chỉ mục",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Phạm vi dữ liệu được mô tả và hệ quản trị đang dùng",
          from: ["db-schema", "config"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "2", title: "Data Model Overview", kind: "explanation", required: true,
          hint: "Bức tranh tổng thể của mô hình dữ liệu và các nhóm chính",
          from: ["db-schema"],
          accept: { minBlocks: 1, mustHave: ["figure"], minSources: 1 },
        },
        {
          num: "3", title: "Entities and Collections", kind: "reference", required: true,
          hint: "Danh sách bảng hoặc collection kèm mục đích của từng cái",
          from: ["db-schema", "code"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "4", title: "Fields and Types", kind: "reference", required: true,
          hint: "Từng trường: kiểu, độ dài, cho phép rỗng, giá trị mặc định",
          from: ["db-schema", "migrations"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "5", title: "Relationships and Constraints", kind: "reference", required: true,
          hint: "Khoá ngoại, ràng buộc duy nhất và quy tắc toàn vẹn dữ liệu",
          from: ["db-schema", "migrations"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "6", title: "Indexes", kind: "reference", required: true,
          hint: "Chỉ mục đang có và truy vấn mà nó phục vụ",
          from: ["db-schema", "migrations"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "7", title: "Migration and Seed", kind: "howto", required: true,
          hint: "Chạy migration ra sao và dữ liệu khởi tạo gồm những gì",
          from: ["migrations", "scripts"],
          accept: { minBlocks: 1, minSources: 1 },
        },
      ],
    },
    {
      key: "deployment",
      title: "Deployment and Installation",
      short: "Deployment & Installation",
      hint: "Cài đặt và đưa hệ thống lên môi trường chạy",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Tài liệu này bao trùm thành phần nào và môi trường nào",
          from: ["readme", "docker"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "2", title: "Environments and Topology", kind: "reference", required: true,
          hint: "Có mấy môi trường, mỗi môi trường gồm những máy chủ và dịch vụ nào",
          from: ["docker", "ci", "config"],
          accept: { minBlocks: 1, mustHave: ["figure"], minSources: 2 },
        },
        {
          num: "3", title: "Server Requirements", kind: "reference", required: true,
          hint: "Yêu cầu máy chủ, tách riêng phần backend và phần frontend",
          from: ["docker", "deps"],
          accept: { minBlocks: 2, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "4", title: "Prerequisites", kind: "reference", required: true,
          hint: "Phần mềm nền, phiên bản và quyền cần có trước khi cài",
          from: ["deps", "scripts"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "5", title: "Build", kind: "howto", required: true,
          hint: "Lệnh build và sản phẩm build sinh ra ở đâu",
          from: ["scripts", "ci"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "6", title: "Install and Configure", kind: "howto", required: true,
          hint: "Các bước cài đặt và giá trị cấu hình phải điền",
          from: ["docker", "config", "env"],
          accept: { minBlocks: 2, minSources: 2 },
        },
        {
          num: "7", title: "Verification", kind: "howto", required: true,
          hint: "Cách xác nhận bản cài đã chạy đúng",
          from: ["tests", "scripts", "api"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "8", title: "Rollback", kind: "howto", required: true,
          hint: "Quay lại bản trước khi bản mới hỏng",
          from: ["ci", "scripts", "migrations"],
          accept: { minBlocks: 1, minSources: 1 },
        },
      ],
    },
    {
      key: "config-mgmt",
      title: "Configuration Management",
      short: "Configuration Management",
      hint: "Quản lý cấu hình: hạng mục, giá trị theo môi trường, kiểm soát thay đổi",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Phạm vi quản lý cấu hình và vai trò chịu trách nhiệm",
          from: ["readme", "ci"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "2", title: "Configuration Items", kind: "reference", required: true,
          hint: "Những gì được coi là hạng mục cấu hình và định danh của chúng",
          from: ["config", "env", "ci"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "3", title: "Per-environment Values", kind: "reference", required: true,
          hint: "Bảng giá trị theo từng môi trường, che giá trị nhạy cảm",
          from: ["env", "config", "docker"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "4", title: "Secrets Handling", kind: "explanation", required: true,
          hint: "Khoá bí mật cất ở đâu, ai được đọc, xoay vòng thế nào",
          from: ["secrets", "env", "ci"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "5", title: "Change Control", kind: "howto", required: true,
          hint: "Quy trình đề nghị, duyệt và áp một thay đổi cấu hình",
          from: ["git-history", "ci"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "6", title: "Status Accounting and Audit", kind: "reference", required: false,
          hint: "Ghi nhận cấu hình đang ở phiên bản nào và soát lại khi cần",
          from: ["git-history", "ci", "logging"],
          accept: { minBlocks: 1, minSources: 1 },
        },
      ],
    },
    {
      key: "operations",
      title: "Operations Guide",
      short: "Operations Guide",
      hint: "Vận hành hằng ngày: theo dõi, sao lưu, xử lý sự cố",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Phạm vi vận hành và đội chịu trách nhiệm",
          from: ["readme"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "2", title: "Routine Operations", kind: "howto", required: true,
          hint: "Việc lặp lại theo ngày, tuần, tháng và cách làm",
          from: ["jobs", "scripts"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "3", title: "Monitoring and Alerts", kind: "reference", required: true,
          hint: "Chỉ số theo dõi, ngưỡng cảnh báo và nơi xem",
          from: ["logging", "config"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "4", title: "Backup and Restore", kind: "howto", required: true,
          hint: "Chu kỳ sao lưu, nơi cất và quy trình khôi phục",
          from: ["db-schema", "scripts"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "5", title: "Incident Handling", kind: "howto", required: true,
          hint: "Phân loại sự cố, các bước xử lý và cách báo cáo",
          from: ["errors", "logging"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "6", title: "Maintenance Schedule", kind: "reference", required: true,
          hint: "Lịch bảo trì định kỳ và cửa sổ được phép dừng dịch vụ",
          from: ["jobs", "ci"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 1, noEmptyCells: true },
        },
        {
          num: "7", title: "Support and Escalation", kind: "reference", required: false,
          hint: "Ai nhận yêu cầu hỗ trợ và khi nào chuyển lên mức cao hơn",
          from: ["readme", "agile-docs"],
          accept: { minBlocks: 1, minSources: 1 },
        },
      ],
    },
    {
      key: "repo-structure",
      title: "Repository Structure",
      short: "Repository Structure",
      hint: "Bố cục kho mã: thư mục nào để làm gì",
      sections: [
        {
          num: "1", title: "Introduction", kind: "explanation", required: true,
          hint: "Kho mã này chứa gì và ai làm việc trên đó",
          from: ["readme"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "2", title: "Directory Tree", kind: "reference", required: true,
          hint: "Cây thư mục tới mức đủ để định vị, không liệt kê từng tệp",
          from: ["project-structure"],
          accept: { minBlocks: 1, mustHave: ["code"], minSources: 1 },
        },
        {
          num: "3", title: "Role of Each Area", kind: "reference", required: true,
          hint: "Mỗi vùng trong cây chịu trách nhiệm gì",
          from: ["project-structure", "code"],
          accept: { minBlocks: 1, mustHave: ["table"], minSources: 2, noEmptyCells: true },
        },
        {
          num: "4", title: "Build Artifacts", kind: "reference", required: true,
          hint: "Sản phẩm build sinh ra ở đâu và thứ nào không đưa vào git",
          from: ["scripts", "ci"],
          accept: { minBlocks: 1, minSources: 1 },
        },
        {
          num: "5", title: "Conventions", kind: "explanation", required: true,
          hint: "Quy ước đặt tên, nhánh và commit đang áp dụng",
          from: ["git-history", "readme"],
          accept: { minBlocks: 1, minSources: 1 },
        },
      ],
    },
  ],
};
