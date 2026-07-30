// Writing tones. Declared once here so the wizard can preview them and the writing stage (D2)
// can reuse the same `guidance` text in its prompt — the samples the user picks from and the
// instruction the agent receives can never drift apart.
//
// Samples are shown for three Diataxis kinds on purpose (RULESET N6): the tone only governs
// `explanation`. A `reference` section is always terse and a `howto` is always numbered steps,
// whichever tone is picked — the preview has to teach that, otherwise people expect the whole
// document to change and are surprised later.
//
// Sample content is a made-up order service, deliberately generic.
const REFERENCE_SAMPLE = [
  "`ORDER_QUEUE_NAME` — tên hàng đợi nhận đơn mới. Mặc định `orders.inbound`. Khai báo trong `config/queue.yml`.",
  "`ORDER_RETRY_MAX` — số lần thử lại tối đa cho một đơn lỗi. Mặc định `3`. Vượt ngưỡng thì đơn chuyển sang hàng đợi lỗi.",
];

const HOWTO_SAMPLE = [
  "Mở `config/queue.yml`, sửa `ORDER_RETRY_MAX` thành giá trị mong muốn.",
  "Chạy `./scripts/reload-config.sh` để nạp lại cấu hình mà không dừng dịch vụ.",
  "Kiểm tra log `logs/queue.log`, dòng `config reloaded` phải xuất hiện trong 5 giây.",
];

export const TONES = [
  {
    id: "concise",
    label: "Định danh · súc tích",
    blurb: "Nêu tên, giá trị, vị trí. Không giải thích thêm nếu không cần.",
    guidance: "Viết ngắn, mỗi câu một khẳng định. Nêu định danh (tên khoá, tên lớp, đường dẫn) trước, "
      + "giải thích sau, tối đa một câu. Không mở bài, không chuyển ý.",
    samples: {
      explanation: [
        "Đơn hàng đi qua hàng đợi `orders.inbound` trước khi được ghi vào cơ sở dữ liệu.",
        "Lý do: tách nhận đơn khỏi xử lý đơn, để lúc cao điểm việc nhận đơn không bị chậm theo việc xử lý.",
        "Hệ quả: đơn có thể được ghi trễ vài giây so với lúc khách bấm gửi.",
      ],
      reference: REFERENCE_SAMPLE,
      howto: HOWTO_SAMPLE,
    },
  },
  {
    id: "academic",
    label: "Hàn lâm",
    blurb: "Câu đầy đủ chủ vị, dùng thuật ngữ chuẩn, giọng khách quan như tài liệu nghiệm thu.",
    guidance: "Viết câu đầy đủ, giọng khách quan, không dùng đại từ nhân xưng. Dùng thuật ngữ chuẩn "
      + "của lĩnh vực. Mỗi đoạn nêu nguyên tắc trước, dẫn chứng sau. Tránh lối nói khẩu ngữ.",
    samples: {
      explanation: [
        "Việc tiếp nhận đơn hàng được thực hiện thông qua một hàng đợi trung gian nhằm bảo đảm tính "
        + "sẵn sàng của thành phần tiếp nhận độc lập với năng lực xử lý của thành phần nghiệp vụ.",
        "Cơ chế này tuân theo nguyên tắc phân tách trách nhiệm: thành phần tiếp nhận chịu trách nhiệm "
        + "xác thực khuôn dạng và ghi nhận, thành phần xử lý chịu trách nhiệm áp dụng quy tắc nghiệp vụ.",
        "Đánh đổi tương ứng là tính nhất quán chỉ đạt mức cuối cùng (eventual consistency) trong khoảng "
        + "thời gian chờ của hàng đợi.",
      ],
      reference: REFERENCE_SAMPLE,
      howto: HOWTO_SAMPLE,
    },
  },
  {
    id: "detailed",
    label: "Diễn giải chi tiết",
    blurb: "Giải thích kỹ, nói rõ khi nào cần quan tâm và hệ quả nếu làm sai.",
    guidance: "Giải thích đầy đủ: nó là gì, vì sao có, khi nào người đọc cần quan tâm, và điều gì xảy ra "
      + "nếu cấu hình sai. Cho phép dài, nhưng mỗi đoạn chỉ một ý. Nêu ví dụ số cụ thể khi có thể.",
    samples: {
      explanation: [
        "Khi khách bấm gửi đơn, hệ thống không ghi ngay vào cơ sở dữ liệu mà đẩy đơn vào hàng đợi "
        + "`orders.inbound`. Một tiến trình nền đọc hàng đợi này và mới thực sự tạo đơn.",
        "Cách làm này giúp phần nhận đơn luôn trả lời nhanh, kể cả khi cơ sở dữ liệu đang chậm hoặc "
        + "đang bảo trì — đơn không bị mất, chỉ nằm chờ trong hàng đợi.",
        "Điều cần lưu ý khi vận hành: nếu tiến trình nền dừng, khách vẫn gửi đơn thành công nhưng đơn "
        + "không xuất hiện trong danh sách. Dấu hiệu nhận biết là số thông điệp tồn trong hàng đợi tăng dần.",
        "Nếu đặt `ORDER_RETRY_MAX` quá thấp (ví dụ `1`), một lỗi mạng nhất thời cũng đủ đẩy đơn sang "
        + "hàng đợi lỗi và phải xử lý tay.",
      ],
      reference: REFERENCE_SAMPLE,
      howto: HOWTO_SAMPLE,
    },
  },
  {
    id: "narrative",
    label: "Kể chuyện · dẫn dắt",
    blurb: "Dắt người đọc từ vấn đề tới giải pháp. Phù hợp tài liệu cho người mới.",
    guidance: "Dẫn dắt theo mạch: nêu tình huống có thật, chỉ ra vấn đề, rồi mới giới thiệu cách hệ thống "
      + "giải quyết. Được dùng câu nối. Không kể chuyện quá hai đoạn trước khi vào nội dung kỹ thuật.",
    samples: {
      explanation: [
        "Hãy hình dung một buổi khuyến mãi: trong mười phút, số đơn gửi về gấp năm mươi lần ngày thường. "
        + "Nếu mỗi đơn phải chờ ghi xong vào cơ sở dữ liệu mới trả lời khách, người đặt sau sẽ thấy trang "
        + "quay vòng vòng rồi báo lỗi.",
        "Đó là lý do đơn hàng không đi thẳng vào cơ sở dữ liệu. Chúng được xếp vào hàng đợi "
        + "`orders.inbound` — nơi việc duy nhất cần làm là nhận và xác nhận, rất nhanh.",
        "Phần việc nặng — kiểm tra tồn kho, tính giá, tạo đơn — do một tiến trình nền làm sau đó, ở nhịp "
        + "mà cơ sở dữ liệu chịu được. Khách nhận xác nhận ngay, còn đơn được xử lý chậm hơn vài giây.",
      ],
      reference: REFERENCE_SAMPLE,
      howto: HOWTO_SAMPLE,
    },
  },
];

export const toneById = (id) => TONES.find((t) => t.id === id) || TONES[0];
