import type { Activity, Phase } from "../../office/model";
import { ROLE_COLORS, type DeskGroup } from "../../office/layout";

export type OfficeCharacterProps = {
  group: DeskGroup;
  activity: Activity;
  phase: Phase;
  ok: boolean;
  seated: boolean;
  /** Đang đi: bỏ ghế (hiện chân), thêm class char-walking. Bị bỏ qua khi phase = "left". */
  walking?: boolean;
};

export type CharPose = "typing" | "think" | "tool" | "wait" | "gone";

/** Tư thế theo hoạt động; rời đi thắng mọi hoạt động. `seated` chỉ đổi bố cục, không đổi tư thế. */
export function charPose(activity: Activity, phase: Phase, _seated: boolean): CharPose {
  if (phase === "left") return "gone";
  if (activity === "typing") return "typing";
  if (activity === "thinking") return "think";
  if (activity === "tool") return "tool";
  return "wait";
}

/** Tóc/da theo nhóm vai. Giá trị của analyst..coordinator mượn từ bảng LOOK của IsoPerson; `spare` là giá trị mới. */
const LOOKS: Record<DeskGroup, { hair: string; skin: string }> = {
  analyst: { hair: "#2b1d14", skin: "#f3cdb0" },
  critic: { hair: "#111111", skin: "#f3cdb0" },
  implementer: { hair: "#2b1d14", skin: "#d9a983" },
  qa: { hair: "#3a2416", skin: "#f3cdb0" },
  coordinator: { hair: "#111111", skin: "#f3cdb0" },
  debug: { hair: "#3a2416", skin: "#d9a983" },
  subagent: { hair: "#2b1d14", skin: "#e8b894" },
};

/**
 * Nhân vật nhìn chéo từ trên xuống, vẽ trong hệ tọa độ riêng (gốc ở giữa chân, x -10..10, y -38..0).
 * `<g class="char">` ngoài không có animation (chỗ đặt transform vị trí); `<g class="char-inner char-<pose>">`
 * trong chứa các phần có animation. CSS cho `char-*` được thêm sau.
 */
export function OfficeCharacter({ group, activity, phase, ok, seated: seatedProp, walking = false }: OfficeCharacterProps) {
  const isWalking = walking && phase !== "left";
  const seated = isWalking ? false : seatedProp;
  const pose = charPose(activity, phase, seated);
  const color = ROLE_COLORS[group];
  const { hair, skin } = LOOKS[group] ?? LOOKS.subagent;
  const bodyTop = seated ? -22 : -26;
  const bodyH = seated ? 14 : 18;
  const headY = bodyTop - 8;
  const armY = bodyTop + 3;

  // Tay: [x, y, rộng, cao] cho trái/phải theo tư thế.
  let armL = { x: -10, y: armY, w: 4, h: 12 };
  let armR = { x: 6, y: armY, w: 4, h: 12 };
  if (pose === "typing") {
    armL = { x: -6, y: armY + 6, w: 4, h: 8 };
    armR = { x: 2, y: armY + 6, w: 4, h: 8 };
  } else if (pose === "think") {
    armR = { x: 3, y: bodyTop - 3, w: 4, h: 8 };
  } else if (pose === "tool") {
    armR = { x: 8, y: armY - 2, w: 4, h: 10 };
  }

  return (
    <g className="char" data-pose={pose} data-group={group} {...(isWalking ? { "data-walking": "1" } : {})}>
      <g className={`char-inner char-${pose}${isWalking ? " char-walking" : ""}`}>
        {!seated && (
          <g className="char-legs">
            <rect x={-5} y={-8} width={4} height={8} rx={1} fill="#3a3f4a" />
            <rect x={1} y={-8} width={4} height={8} rx={1} fill="#3a3f4a" />
          </g>
        )}
        <rect className="char-body" x={-7} y={bodyTop} width={14} height={bodyH} rx={5} fill={color} />
        <rect className="char-arm char-arm-l" x={armL.x} y={armL.y} width={armL.w} height={armL.h} rx={2} fill={color} />
        <rect className="char-arm char-arm-r" x={armR.x} y={armR.y} width={armR.w} height={armR.h} rx={2} fill={color} />
        {pose === "tool" && <rect className="char-item" x={10} y={armY - 5} width={5} height={5} rx={1} fill="#c9ccd4" />}
        <g className="char-head">
          <circle cx={0} cy={headY} r={7} fill={skin} />
          <path d={`M -7 ${headY} A 7 7 0 0 1 7 ${headY} Q 0 ${headY - 3} -7 ${headY} Z`} fill={hair} />
        </g>
        {pose === "think" && (
          <g className="char-think-bubble">
            <circle cx={9} cy={headY - 6} r={1.2} fill="#9aa0ad" />
            <circle cx={13} cy={headY - 10} r={1.6} fill="#9aa0ad" />
            <circle cx={18} cy={headY - 15} r={2} fill="#9aa0ad" />
          </g>
        )}
        {pose === "gone" && (
          <text className={ok ? "char-ok" : "char-fail"} x={0} y={headY - 10} textAnchor="middle" fontSize={9} fill={ok ? "#3fb950" : "#f85149"}>
            {ok ? "✓" : "!"}
          </text>
        )}
      </g>
    </g>
  );
}

export default OfficeCharacter;
