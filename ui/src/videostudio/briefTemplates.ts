/* Structured brief for a new video: fields, quick templates and the pure function that turns them into the brief text. */

export type BriefTone = "friendly" | "professional" | "energetic" | "emotional";
export type BriefLang = "vi" | "en";
export const BRIEF_SECONDS = [15, 30, 60, 90] as const;
export type BriefSeconds = (typeof BRIEF_SECONDS)[number];
export const BRIEF_TONES: readonly BriefTone[] = ["friendly", "professional", "energetic", "emotional"];

export interface BriefFields {
  goal: string;
  audience: string;
  tone: BriefTone;
  seconds: BriefSeconds;
  lang: BriefLang;
  points: string;
  cta: string;
  notes: string;
}

export function emptyBrief(): BriefFields {
  return { goal: "", audience: "", tone: "professional", seconds: 30, lang: "vi", points: "", cta: "", notes: "" };
}

const TONE_TEXT: Record<BriefTone, string> = {
  friendly: "thân thiện, gần gũi",
  professional: "chuyên nghiệp, đáng tin cậy",
  energetic: "sôi động, nhiều năng lượng",
  emotional: "giàu cảm xúc, kể chuyện",
};
const LANG_TEXT: Record<BriefLang, string> = { vi: "tiếng Việt", en: "tiếng Anh" };

/** Up to 12 key points, one per line, any leading dash or bullet removed. */
export function pointLines(points: string): string[] {
  return points
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * The brief text sent to the director: labelled lines for everything that was filled in, so the AI always
 * sees the goal, audience, tone, target length, language, key points and call to action in the same layout.
 */
export function composeBrief(f: BriefFields): string {
  const lines: string[] = [];
  const goal = f.goal.trim();
  const audience = f.audience.trim();
  const cta = f.cta.trim();
  const notes = f.notes.trim();
  const points = pointLines(f.points);
  if (goal) lines.push(`Chủ đề / mục tiêu: ${goal}`);
  if (audience) lines.push(`Người xem: ${audience}`);
  lines.push(`Giọng điệu: ${TONE_TEXT[f.tone]}`);
  lines.push(`Thời lượng mục tiêu: khoảng ${f.seconds} giây`);
  lines.push(`Ngôn ngữ lời dẫn và chữ trên video: ${LANG_TEXT[f.lang]}`);
  if (points.length) lines.push(`Ý chính (theo thứ tự):\n${points.map((p) => `- ${p}`).join("\n")}`);
  if (cta) lines.push(`Kêu gọi hành động ở cuối: ${cta}`);
  if (notes) lines.push(`Ghi chú thêm: ${notes}`);
  return lines.join("\n");
}

export interface VideoTemplate {
  id: string;
  /** Vietnamese name shown on the chip. */
  name: string;
  fields: Partial<BriefFields>;
  aspect: "16:9" | "9:16" | "1:1";
  /** Preferred built-in style; applied only when that style exists. */
  styleId: string;
}

export const VIDEO_TEMPLATES: readonly VideoTemplate[] = [
  {
    id: "product",
    name: "Giới thiệu sản phẩm",
    aspect: "16:9",
    styleId: "product-showcase",
    fields: {
      goal: "Giới thiệu sản phẩm [tên sản phẩm] và lý do nên chọn",
      audience: "Khách hàng đang tìm giải pháp cho [nhu cầu]",
      tone: "professional",
      seconds: 30,
      points: "Vấn đề khách hàng đang gặp\nSản phẩm giải quyết vấn đề như thế nào\n3 điểm nổi bật nhất\nGiá trị khách hàng nhận được",
      cta: "Liên hệ ngay để được tư vấn",
    },
  },
  {
    id: "tutorial",
    name: "Hướng dẫn từng bước",
    aspect: "16:9",
    styleId: "tutorial-clear",
    fields: {
      goal: "Hướng dẫn cách [việc cần làm]",
      audience: "Người mới bắt đầu, chưa có kinh nghiệm",
      tone: "friendly",
      seconds: 60,
      points: "Chuẩn bị những gì\nBước 1\nBước 2\nBước 3\nLỗi thường gặp và cách tránh",
      cta: "Lưu video lại để làm theo",
    },
  },
  {
    id: "company",
    name: "Giới thiệu công ty",
    aspect: "16:9",
    styleId: "corporate-minimal",
    fields: {
      goal: "Giới thiệu công ty và năng lực chính",
      audience: "Đối tác và khách hàng tiềm năng",
      tone: "professional",
      seconds: 60,
      points: "Công ty làm gì\nĐiểm mạnh và kinh nghiệm\nDự án hoặc khách hàng tiêu biểu\nCam kết chất lượng",
      cta: "Liên hệ để hợp tác",
    },
  },
  {
    id: "promo",
    name: "Khuyến mãi ngắn",
    aspect: "9:16",
    styleId: "promo-sale",
    fields: {
      goal: "Thông báo chương trình khuyến mãi [tên chương trình]",
      audience: "Khách hàng quen và người theo dõi trang",
      tone: "energetic",
      seconds: 15,
      points: "Ưu đãi chính\nThời gian áp dụng\nĐiều kiện ngắn gọn",
      cta: "Đặt hàng ngay hôm nay",
    },
  },
  {
    id: "recruit",
    name: "Tuyển dụng",
    aspect: "9:16",
    styleId: "social-dynamic",
    fields: {
      goal: "Tuyển [vị trí] cho [công ty]",
      audience: "Ứng viên trẻ đang tìm việc",
      tone: "friendly",
      seconds: 30,
      points: "Công việc chính\nQuyền lợi nổi bật\nYêu cầu cơ bản\nMôi trường làm việc",
      cta: "Gửi hồ sơ qua [kênh liên hệ]",
    },
  },
  {
    id: "story",
    name: "Câu chuyện thương hiệu",
    aspect: "16:9",
    styleId: "cinematic-slow",
    fields: {
      goal: "Kể câu chuyện hình thành và giá trị của thương hiệu",
      audience: "Khách hàng muốn hiểu thương hiệu hơn",
      tone: "emotional",
      seconds: 60,
      points: "Khởi đầu và lý do bắt đầu\nKhó khăn đã vượt qua\nGiá trị thương hiệu theo đuổi\nLời cảm ơn khách hàng",
      cta: "Cùng chúng tôi viết tiếp câu chuyện",
    },
  },
];

/** Fields of a template applied on top of an empty brief. */
export function applyTemplate(t: VideoTemplate): BriefFields {
  return { ...emptyBrief(), ...t.fields };
}

/** Template placeholders like "[tên sản phẩm]" that the user still has to replace. */
export function hasPlaceholders(f: BriefFields): boolean {
  return /\[[^\]]+\]/.test(`${f.goal} ${f.audience} ${f.cta}`);
}
