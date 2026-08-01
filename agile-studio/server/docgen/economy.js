// Chế độ tiết kiệm khi test.
//
// Vì sao có tệp này: một lượt viết thật trên repo nhỏ đo được 230K–630K token (§4 D2-BANGIAO), và
// các ca kiểm thử còn lại cần chạy nhiều lượt. Chạy đúng như thật để kiểm một luồng điều khiển là
// trả tiền cho thứ không cần: luồng "claim → spawn → ghi tệp → ingest → sweep" không quan tâm nội
// dung hay ra sao.
//
// Từng nút siết được riêng — không phải một gói cả-hoặc-không — vì mỗi nút đánh đổi khác nhau:
// đổi model đổi chất lượng văn, giới hạn số mục đổi số lần phải bấm Tiếp tục, prompt rút gọn đổi
// độ đầy đủ của nội dung, chặn khảo sát đổi cách lấy dàn ý.

// ============================================================================================
// MỘT CÔNG TẮC DUY NHẤT CHO CẢ GIAI ĐOẠN PHÁT TRIỄN
//
// true  = đang phát triển. Tiết kiệm bị ÉP BẬT ở mức rẻ nhất, người dùng không tắt được. Mục đích
//         là phục vụ kiểm thử phần mềm: mọi lượt chạy trong lúc còn issue mở đều phải rẻ.
// false = đã xong hết issue, sắp ship. Tiết kiệm thành một tuỳ chọn bình thường và MẶC ĐỊNH TẮT,
//         người dùng dùng thoải mái ở chất lượng đầy đủ.
//
// Xong hết issue thì đổi đúng dòng này thành false — không phải sửa chỗ nào khác.
// ============================================================================================
export const DEV_LOCK_ECONOMY = false;

export const LOCK_REASON = "Đang trong giai đoạn phát triển nên mọi lượt chạy bị ép về cấu hình rẻ "
  + "nhất để phục vụ kiểm thử. Xong hết issue thì chế độ này mặc định tắt và bạn dùng thoải mái.";

// Cấu hình rẻ nhất — dùng khi đang bị ép. Không gồm `blockSurvey`: chặn khảo sát không phải "rẻ hơn"
// mà là "tắt tính năng", và luồng khảo sát vẫn còn phải kiểm.
const CHEAPEST = {
  on: true,
  forceModel: true,
  model: "claude-haiku-4-5-20251001",
  capSections: true,
  maxSectionsPerRun: 1,     // rẻ nhất có thể: một mục một lượt
  shortPrompt: true,
};

export const ECONOMY_DEFAULTS = {
  // `on` theo công tắc trên: đang phát triển thì bật, ship rồi thì tắt.
  on: DEV_LOCK_ECONOMY,
  forceModel: true,
  model: "claude-haiku-4-5-20251001",
  capSections: true,
  maxSectionsPerRun: DEV_LOCK_ECONOMY ? 1 : 2,
  shortPrompt: true,
  blockSurvey: false,     // mặc định tắt: chặn hẳn thì không test được luồng khảo sát
};

// Chuẩn hoá cấu hình đến từ HTTP. Mọi giá trị lạ rơi về mặc định, không có nút nào bật được bằng
// cách gửi rác.
export function normalizeEconomy(patch, current = ECONOMY_DEFAULTS) {
  const p = patch && typeof patch === "object" ? patch : {};
  const base = { ...ECONOMY_DEFAULTS, ...(current || {}) };
  const bool = (k) => (typeof p[k] === "boolean" ? p[k] : base[k]);
  return {
    on: bool("on"),
    forceModel: bool("forceModel"),
    model: typeof p.model === "string" && p.model.trim() ? p.model.trim() : base.model,
    capSections: bool("capSections"),
    maxSectionsPerRun: Math.min(50, Math.max(1, Number(p.maxSectionsPerRun) || base.maxSectionsPerRun)),
    shortPrompt: bool("shortPrompt"),
    blockSurvey: bool("blockSurvey"),
  };
}

// Cờ nào đang thật sự có hiệu lực. Mọi chỗ khác hỏi hàm này chứ không tự đọc `on` rồi đọc từng nút:
// tắt `on` phải tắt sạch, không để sót một nút nào còn tác dụng — và khi đang bị ép thì thiết lập
// của người dùng không được lọt qua.
export function economyOf(settings) {
  const saved = { ...ECONOMY_DEFAULTS, ...(settings?.economy || {}) };
  // Đang phát triển: thiết lập đã lưu vẫn giữ nguyên trong docgen.json (để lúc mở khoá thì dùng
  // lại được), nhưng cái CÓ HIỆU LỰC là bản rẻ nhất.
  const e = DEV_LOCK_ECONOMY ? { ...saved, ...CHEAPEST } : saved;
  if (!e.on) {
    return { on: false, locked: false, lockReason: null,
      model: null, maxSections: null, shortPrompt: false, blockSurvey: false, notes: [] };
  }
  const notes = [];
  if (e.forceModel) notes.push(`model ${e.model}`);
  if (e.capSections) notes.push(`tối đa ${e.maxSectionsPerRun} mục/lượt`);
  if (e.shortPrompt) notes.push("prompt rút gọn");
  if (e.blockSurvey) notes.push("chặn khảo sát");
  return {
    on: true,
    // `locked` nói cho UI biết phải khoá ô tick lại và giải thích, thay vì để người dùng bấm rồi
    // thấy không có gì thay đổi.
    locked: DEV_LOCK_ECONOMY,
    lockReason: DEV_LOCK_ECONOMY ? LOCK_REASON : null,
    model: e.forceModel ? e.model : null,
    maxSections: e.capSections ? e.maxSectionsPerRun : null,
    shortPrompt: !!e.shortPrompt,
    blockSurvey: !!e.blockSurvey,
    notes,
  };
}

// Model thật sẽ truyền cho CLI: tiết kiệm thắng Cài đặt chung, vì nó là cái người dùng vừa bật.
export const modelFor = (eco, appModel) => (eco?.model ? eco.model : appModel);

// Cắt danh sách mục của một lượt. Trả về cả phần bị hoãn để UI nói được "còn N mục đợi lượt sau"
// thay vì im lặng làm ít hơn số đã báo.
export function capTargets(targets, eco) {
  if (!eco?.maxSections || targets.length <= eco.maxSections) return { targets, deferred: 0 };
  return { targets: targets.slice(0, eco.maxSections), deferred: targets.length - eco.maxSections };
}

// Hệ số cho dự báo token: prompt rút gọn + model rẻ thì con số trên nút phải đi theo, nếu không
// hộp thoại ngưỡng token sẽ hỏi vì một chi phí không còn đúng.
export function priceFactor(eco) {
  if (!eco?.on) return 1;
  let f = 1;
  if (eco.shortPrompt) f *= 0.45;   // bỏ lược đồ khối dài + yêu cầu 1–2 khối/mục
  if (eco.model) f *= 1;            // token không giảm theo model, chỉ giá tiền — giữ nguyên số token
  return f;
}
