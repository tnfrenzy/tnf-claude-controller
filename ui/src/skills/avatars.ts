import type { Look } from "../components/office/IsoPerson";
import { PREF_AVATARS, PREF_AVATAR_STYLE, recall, remember } from "../lib/prefs";

export type AvatarCategory = "office" | "tech" | "creative" | "special";

/** Thứ tự nhóm hiển thị trong picker. */
export const AVATAR_CATEGORIES: AvatarCategory[] = ["office", "tech", "creative", "special"];

export type AvatarPreset = { id: string; labelVi: string; labelEn: string; category: AvatarCategory; look: Look };

const mk = (tie: string, hairStyle: number, hair: string, skin: string): Look => ({ tie, hairStyle, hair, skin });
const mx = (base: Look, extra: Partial<Look>): Look => ({ ...base, ...extra });

/** Preset nhân vật có thể gán cho từng vai. Id cũ (6 đầu) giữ nguyên. */
export const AVATARS: AvatarPreset[] = [
  { id: "spy", labelVi: "Điệp viên", labelEn: "Spy", category: "special", look: mk("#111111", 2, "#0d0d0d", "#f3cdb0") },
  { id: "it", labelVi: "IT", labelEn: "IT", category: "tech", look: mk("#2ed4c8", 0, "#3a2416", "#d9a983") },
  { id: "manager", labelVi: "Quản lý", labelEn: "Manager", category: "office", look: mk("#c0392b", 1, "#8a8a8a", "#e8b894") },
  { id: "designer", labelVi: "Thiết kế", labelEn: "Designer", category: "creative", look: mk("#ff6fb5", 3, "#7a1f5c", "#f3cdb0") },
  { id: "scientist", labelVi: "Nhà khoa học", labelEn: "Scientist", category: "tech", look: mk("#f5f5f5", 3, "#d8d8d8", "#c68e6a") },
  { id: "clerk", labelVi: "Nhân viên văn phòng", labelEn: "Office clerk", category: "office", look: mk("#5aa0ff", 1, "#5a2a1a", "#f0c8a8") },
  // office
  { id: "accountant", labelVi: "Kế toán", labelEn: "Accountant", category: "office", look: mx(mk("#2f6b4f", 0, "#2b1d14", "#e8b894"), { suit: "#3d4a5c", headgear: "glasses", neckwear: "badge" }) },
  { id: "receptionist", labelVi: "Lễ tân", labelEn: "Receptionist", category: "office", look: mx(mk("#e07a5f", 4, "#4a2c1a", "#f0c8a8"), { suit: "#8e4a6b", headgear: "headset", neckwear: "blouse" }) },
  { id: "executive", labelVi: "Giám đốc", labelEn: "Executive", category: "office", look: mx(mk("#b8860b", 1, "#9a9a9a", "#d9a983"), { suit: "#1f2a44", neckwear: "bow" }) },
  // tech
  { id: "engineer", labelVi: "Kỹ sư công trường", labelEn: "Site engineer", category: "tech", look: mx(mk("#ff9f1c", 0, "#3a2416", "#c68e6a"), { suit: "#4d5b3a", headgear: "hardhat", neckwear: "badge" }) },
  { id: "support", labelVi: "Hỗ trợ kỹ thuật", labelEn: "Tech support", category: "tech", look: mx(mk("#4fc3f7", 2, "#2b1d14", "#f3cdb0"), { suit: "#2d3f55", headgear: "headset" }) },
  { id: "developer", labelVi: "Lập trình viên", labelEn: "Developer", category: "tech", look: mx(mk("#7bd88f", 3, "#1c1c1c", "#e8b894"), { suit: "#33384a", headgear: "glasses" }) },
  { id: "qa", labelVi: "Kiểm thử", labelEn: "QA tester", category: "tech", look: mx(mk("#f2c94c", 5, "#5a2a1a", "#d9a983"), { suit: "#4a4a58", headgear: "glasses", neckwear: "badge" }) },
  // creative
  { id: "artist", labelVi: "Họa sĩ", labelEn: "Artist", category: "creative", look: mx(mk("#9b5de5", 4, "#7a1f5c", "#f0c8a8"), { suit: "#5b3a7a", headgear: "cap", neckwear: "bow" }) },
  { id: "photographer", labelVi: "Nhiếp ảnh gia", labelEn: "Photographer", category: "creative", look: mx(mk("#e5e5e5", 1, "#3a2416", "#c68e6a"), { suit: "#2a2a2a", headgear: "cap" }) },
  { id: "writer", labelVi: "Biên tập viên", labelEn: "Writer", category: "creative", look: mx(mk("#c97b4a", 5, "#8a6a4a", "#f3cdb0"), { suit: "#6b4a3a", headgear: "glasses", neckwear: "bow" }) },
  { id: "musician", labelVi: "Nhạc sĩ", labelEn: "Musician", category: "creative", look: mx(mk("#ff4d6d", 2, "#111111", "#d9a983"), { suit: "#7a1f3a", headgear: "headset" }) },
  // special
  { id: "detective", labelVi: "Thám tử", labelEn: "Detective", category: "special", look: mx(mk("#8b5a2b", 0, "#2b1d14", "#e8b894"), { suit: "#6b5b45", headgear: "cap" }) },
  { id: "pilot", labelVi: "Phi công", labelEn: "Pilot", category: "special", look: mx(mk("#d4af37", 1, "#3a2416", "#f0c8a8"), { suit: "#1b3a6b", headgear: "cap", neckwear: "badge" }) },
  { id: "astronaut", labelVi: "Phi hành gia", labelEn: "Astronaut", category: "special", look: mx(mk("#ff6b35", 3, "#d8d8d8", "#f3cdb0"), { suit: "#e8e8ee", headgear: "headset", neckwear: "badge" }) },
];

export type AvatarMap = Record<string, string>;

export function parseAvatarMap(raw: string): AvatarMap {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: AvatarMap = {};
  for (const [role, id] of Object.entries(data as Record<string, unknown>)) {
    if (typeof id === "string" && AVATARS.some((a) => a.id === id)) out[role] = id;
  }
  return out;
}

export function serializeAvatarMap(map: AvatarMap): string {
  return Object.keys(map).length === 0 ? "" : JSON.stringify(map);
}

export function setAvatar(map: AvatarMap, role: string, avatarId: string): AvatarMap {
  const next = { ...map };
  if (avatarId) next[role] = avatarId;
  else delete next[role];
  return next;
}

let cacheRaw: string | null = null;
let cacheMap: AvatarMap = {};

/** Đọc map đã lưu; chỉ parse lại khi chuỗi thô đổi (rẻ khi gọi mỗi lần render). */
export function getAvatarMap(): AvatarMap {
  const raw = recall(PREF_AVATARS);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheMap = parseAvatarMap(raw);
  }
  return cacheMap;
}

export function saveAvatarMap(map: AvatarMap): void {
  remember(PREF_AVATARS, serializeAvatarMap(map));
}

export type AvatarStyle = "2d" | "3d";

/** "3d" chỉ khi giá trị lưu đúng bằng "3d"; mọi trường hợp khác là "2d". */
export function getAvatarStyle(): AvatarStyle {
  return recall(PREF_AVATAR_STYLE) === "3d" ? "3d" : "2d";
}

export function saveAvatarStyle(style: string): void {
  remember(PREF_AVATAR_STYLE, style === "3d" ? "3d" : "2d");
}

export function resolveAvatarLook(role: string, map: AvatarMap): Look | undefined {
  const id = map[role];
  return id ? AVATARS.find((a) => a.id === id)?.look : undefined;
}

/** Avatar gán trong cài đặt thắng; `fallback` chỉ dùng khi vai chưa gán. */
export function lookWithFallback(role: string, map: AvatarMap, fallback: Look): Look {
  return resolveAvatarLook(role, map) ?? fallback;
}
