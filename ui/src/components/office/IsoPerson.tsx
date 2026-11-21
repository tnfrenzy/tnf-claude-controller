// Sprite nhân vật isometric, theo hàm person() và bảng LOOK của docs/design/single-screen.html.
//
// Quy tắc kỹ thuật (xem thêm CSS "IsoPerson sprite" trong styles.css):
// - Thuộc tính transform đặt VỊ TRÍ dùng transform-box: view-box; CHỈ phần có animation CSS
//   (torso, head, eye, pupil, arm, leg, body, brow, think, zzz) dùng fill-box. Mouth không dùng fill-box.
// - Phần đặt vị trí nằm ở nhóm NGOÀI (translate), phần animation nằm ở nhóm TRONG (class torso/arm/leg...),
//   để transform của CSS animation không ghi đè transform vị trí. Không node nào vừa có vị trí vừa animation.
// - Gốc luôn là cùng một kiểu phần tử <g class="p <act> pose-<pose>"> để CSS kiểu .p.walking .leg khớp
//   và React không gắn lại node khi đổi trạng thái.
// - Sắp chiều sâu ở IsoOffice chỉ dời node lệch chỗ, không gắn lại cả dãy (gắn lại làm animation CSS khởi động lại).
import type { CSSProperties, ReactElement } from 'react';
import { getAvatarMap, resolveAvatarLook } from '../../skills/avatars';
import { poseGeometry, type PoseName } from '../../office/iso/pose-geom';

/** Deterministic per-role rhythm offsets so characters breathe, blink, glance and type organically out of sync. */
function personRhythm(role: string): CSSProperties {
  let h = 2166136261;
  for (let i = 0; i < role.length; i++) h = Math.imul(h ^ role.charCodeAt(i), 16777619);
  const u = (h >>> 0) / 4294967296;
  const phase = -(u * 3.4).toFixed(2) + 's';
  const blinkDelay = -(((u * 7.3) % 4.5)).toFixed(2) + 's';
  const typeDur = (0.21 + (u * 0.08)).toFixed(2) + 's';
  return {
    '--p-phase': phase,
    '--p-blink-delay': blinkDelay,
    '--p-type-dur': typeDur,
  } as CSSProperties;
}

export type Look = {
  tie: string;
  hairStyle: number;
  hair: string;
  skin: string;
  /** Màu vest (tùy chọn); không có thì dùng SUIT mặc định. */
  suit?: string;
  /** Phụ kiện đầu (tùy chọn). */
  headgear?: 'cap' | 'glasses' | 'headset' | 'hardhat' | 'beret' | 'ar';
  /** Phụ kiện cổ/ngực (tùy chọn). */
  neckwear?: 'bow' | 'badge' | 'blouse' | 'apron';
  /** Vật cầm ở tay phải (tùy chọn): máy ảnh, kính lúp, máy tính bảng, kẹp bảng ghi chép. */
  holding?: 'camera' | 'loupe' | 'tablet' | 'clipboard';
};

const mk = (tie: string, hairStyle: number, hair: string, skin: string): Look => ({ tie, hairStyle, hair, skin });

/** Bảng LOOK của mẫu: màu cà vạt theo vai, kiểu tóc 0-3, màu tóc, màu da. */
export const LOOK: Record<string, Look> = {
  analyst: mk('#8b5cf6', 3, '#2b1d14', '#f3cdb0'),
  planner: mk('#ff9f43', 1, '#5a2a1a', '#e8b894'),
  critic: mk('#ff5c5c', 2, '#111', '#f3cdb0'),
  implementer: mk('#5aa0ff', 0, '#2b1d14', '#d9a983'),
  qa: mk('#2ed47a', 2, '#3a2416', '#f3cdb0'),
  debug: mk('#ffc542', 1, '#6b4a2a', '#e8b894'),
  searcher: mk('#ff9f43', 0, '#3a2416', '#f3cdb0'),
  analyzer: mk('#2ed47a', 2, '#111', '#d9a983'),
  synthesizer: mk('#8b5cf6', 3, '#2b1d14', '#f3cdb0'),
  writer: mk('#ff5c5c', 1, '#6b4a2a', '#e8b894'),
  editor: mk('#5aa0ff', 2, '#111', '#f3cdb0'),
  seo: mk('#ffc542', 0, '#2b1d14', '#d9a983'),
  coordinator: mk('#d9b26a', 1, '#111', '#f3cdb0'),
};

const FALLBACK: Look = mk('#8aa0c0', 1, '#2b1d14', '#e8b894');

/** Role lạ dùng màu dự phòng. */
export function lookFor(role: string, override?: Look): Look {
  return override ?? LOOK[role] ?? FALLBACK;
}

const SUIT = '#1c2437';
const SUIT_L = '#2a3450';
const PANTS = '#3a4360';

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v * k)) | 0;
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export const HAIRS = [
  'M-15 {y} q0 -17 15 -17 q15 0 15 17 q-4 -8 -15 -8 q-11 0 -15 8z',
  'M-16 {y} q-2 -20 16 -20 q18 0 16 20 q-3 -10 -9 -12 q-9 1 -23 12z M-16 {y} q-3 7 -2 14 l5 -3z',
  'M-15 {y} q2 -17 15 -17 q13 0 15 17 l-3 2 q-4 -9 -12 -9 q-8 0 -12 9z M-15 {y} v12 q-2 -7 0 -12z M15 {y} v12 q2 -7 0 -12z',
  'M-16 {y} q0 -19 16 -19 q16 0 16 19 q-8 -5 -16 -5 q-8 0 -16 5z M10 {y} q10 -4 8 12',
  'M-16 {y} q-1 -21 16 -21 q17 0 16 21 q-5 -12 -16 -12 q-11 0 -16 12z M-16 {y} q-4 10 -1 20 l4 -8z M16 {y} q4 10 1 20 l-4 -8z',
  'M-15 {y} q0 -15 15 -15 q15 0 15 15 q-3 -6 -8 -7 q-7 3 -22 7z M-4 {y} q4 -12 14 -10 q-8 3 -10 10z',
];

export type IsoPersonProps = {
  role: string;
  pose?: string;
  act?: string;
  face?: 1 | -1;
  back?: boolean;
  bubble?: string;
  isCoord?: boolean;
  x?: number;
  y?: number;
  /** Ghi đè Look (tùy chọn); không có thì lấy theo avatar đã gán hoặc bảng LOOK. */
  lookOverride?: Look | undefined;
  /** Trục của ghế/giường mà pose lie nằm dọc theo (mặc định 'u'). */
  lieAxis?: 'u' | 'v';
};

export function IsoPerson({ role, pose = 'stand', act = 'idle', face = 1, back = false, bubble, isCoord = false, x, y, lookOverride, lieAxis = 'u' }: IsoPersonProps): ReactElement {
  const look = lookFor(isCoord ? 'coordinator' : role, isCoord ? undefined : lookOverride ?? resolveAvatarLook(role, getAvatarMap()));
  const { tie, skin, hair, hairStyle } = look;
  const f = face;
  // màu vest tùy chọn; ve áo sáng hơn 1.3 lần so với màu vest (mặc định giữ SUIT/SUIT_L)
  const suit = look.suit ?? SUIT;
  const suitL = look.suit ? shade(look.suit, 1.3) : SUIT_L;
  const cy = pose === 'stand' ? -27 : -25;
  const hy = cy - 32;
  const legY = pose === 'stand' ? -10 : -8;
  // chỉ typing mới gõ phím; seated và thinking ngồi yên
  const working = act === 'typing';
  const ex = 5 * f;
  // miệng theo trạng thái: talking/happy mở/cười, sleeping khép, còn lại mặc định
  const mouthD =
    act === 'happy' || act === 'talking'
      ? `M${ex - 8} ${hy + 8} q4.5 5 9 0`
      : act === 'sleeping'
        ? `M${ex - 5} ${hy + 9} q2 1 4 0`
        : `M${ex - 7} ${hy + 8} q3.5 2.5 7 0`;
  const geom = poseGeometry(pose as PoseName, face, lieAxis);
  // bong bóng của lie: vị trí đầu sau xoay (quay (0,hy) bởi R, trừ độ nâng), cộng offset lên trên đầu
  const thighsOver = geom.legsOverTorso && !back;
  const rad = (geom.rotate * Math.PI) / 180;
  const bubbleX = pose === 'lie' ? -hy * Math.sin(rad) + 6 * f : 6 * f;
  const bubbleY = pose === 'lie' ? hy * Math.cos(rad) - geom.lift - 30 : hy - 40;
  const place = x !== undefined || y !== undefined ? `translate(${x ?? 0},${y ?? 0})` : undefined;

  const arm = (cls: 'l' | 'r') => (
    <g className={`arm ${cls}`} data-part="arm">
      <path d="M-4 0 h8 v13 q0 4 -4 4 q-4 0 -4 -4z" fill={suit} />
      <rect x={-3.2} y={12} width={6.4} height={3} fill="#f4f6fa" />
      <circle cx={0} cy={18} r={4} fill={skin} />
      {/* đạo cụ tay phải: drinking/resting cầm cốc, phone cầm điện thoại */}
      {cls === 'r' && (act === 'drinking' || act === 'resting') && <path className="prop-cup" d="M-4 15 h9 v9 q0 1 -1 1 h-7 q-1 0 -1 -1z" fill="#fff" />}
      {cls === 'r' && act === 'phone' && <rect className="prop-phone" x={-3} y={13} width={6} height={10} rx={1.5} fill="#0b1020" stroke="#9cc4ff" strokeWidth={0.8} />}
      {cls === 'r' && look.holding && act !== 'phone' && act !== 'drinking' && act !== 'resting' && (
        // vật cầm: nằm trong nhóm .arm nên đi theo cánh tay khi animation
        <g className={`prop-held prop-${look.holding}`} data-prop={look.holding}>
          {look.holding === 'camera' && (
            <>
              <rect x={-7} y={13} width={14} height={9} rx={2} fill="#1d2029" stroke="#8b96a8" strokeWidth={0.7} />
              <circle cx={0} cy={17.5} r={3.4} fill="#0b1020" stroke="#9cc4ff" strokeWidth={0.8} />
              <rect x={3} y={11.5} width={4} height={2} rx={0.6} fill="#e6edf8" />
            </>
          )}
          {look.holding === 'loupe' && (
            <>
              <path d="M1 20 l7 -9" stroke="#6b4a2a" strokeWidth={2.2} strokeLinecap="round" />
              <circle cx={9} cy={8} r={5.6} fill="#9cc4ff" fillOpacity={0.35} stroke="#c9d1e0" strokeWidth={1.4} />
            </>
          )}
          {look.holding === 'tablet' && (
            <>
              <rect x={-6} y={9} width={12} height={16} rx={1.6} fill="#0b1020" stroke="#c9d1e0" strokeWidth={0.9} />
              <rect x={-4.4} y={11} width={8.8} height={9} fill="#2f6fed" opacity={0.85} />
            </>
          )}
          {look.holding === 'clipboard' && (
            <>
              <rect x={-6} y={9} width={12} height={16} rx={1.2} fill="#a87a45" stroke="#6b4a2a" strokeWidth={0.8} />
              <rect x={-4.6} y={11.6} width={9.2} height={11.6} fill="#f4f6fa" />
              <rect x={-2.4} y={8} width={4.8} height={3} rx={0.8} fill="#8b96a8" />
              <path d="M-3 15 h6 M-3 18 h6 M-3 21 h4" stroke="#5b6578" strokeWidth={0.6} />
            </>
          )}
        </g>
      )}
    </g>
  );

  const leg = (s: 'l' | 'r', i: number) => (
    // nhóm ngoài: vị trí (view-box); nhóm trong .leg: animation (fill-box)
    <g key={s} transform={`translate(${(i ? 3 : -9) + 3},${legY})`} data-slot={`leg-${s}`}>
      <g className={`leg ${s}`} data-part="leg">
        {pose === 'stand' ? (
          <>
            <rect x={-3.5} y={0} width={7} height={10} rx={3} fill={PANTS} />
            <path d="M-4.5 8 h9 q3 0 3 3 h-12z" fill="#0d1019" />
            <path d="M-3 9.5 h6" stroke="#8b96a8" strokeWidth={1} opacity={0.7} />
          </>
        ) : (
          <>
            {/* dáng sit/sofa/lie: đùi ngang về phía mặt (face), cẳng chân và giày */}
            <path d={`M-3.5 0 h7 l${7 * f} 2 l${-7 * f} 6 h-7z`} fill={PANTS} />
            <rect x={7 * f - 3} y={2} width={6} height={8} rx={2} fill={shade(PANTS, 0.85)} />
            <path d={`M${7 * f - 4} 9 h8 q3 0 3 3 h-11z`} fill="#0d1019" />
          </>
        )}
      </g>
    </g>
  );

  const eyes = [ex - 8, ex + 1].map((cx) => (
    <g key={cx}>
      <ellipse className="eye" data-part="eye" cx={cx} cy={hy + 1} rx={2.6} ry={3.2} fill="#fff" />
      <ellipse className="pupil" data-part="pupil" cx={cx + 0.7 * f} cy={hy + 1.5} rx={1.4} ry={2} fill="#1a1f2e" />
      <circle cx={cx + 1.2 * f} cy={hy + 0.4} r={0.55} fill="#fff" />
    </g>
  ));

  return (
    <g className={`p ${act} pose-${pose}${back ? ' back' : ''}`} data-role={role} data-act={act} data-pose={pose} transform={place} style={personRhythm(role)}>
      {/* nhóm vị trí dáng: lie nâng lên mặt đệm rồi xoay theo trục ghế (view-box); các dáng khác để trống transform, cùng kiểu phần tử */}
      <g
        data-slot="pose"
        transform={pose === 'lie' ? `translate(0,${-geom.lift}) rotate(${geom.rotate})` : undefined}
        style={pose === 'lie' ? { transformBox: 'view-box', transformOrigin: '0 0' } : undefined}
      >
      <g className={working ? 'body iso-bob' : 'body'}>
        {geom.shadow && (
          <g className="p-shadow" pointerEvents="none">
            <ellipse cx={0} cy={1.6} rx={19} ry={5.6} fill="#000" opacity={0.16} />
            <ellipse cx={0} cy={1} rx={14.5} ry={4} fill="#000" opacity={0.35} />
          </g>
        )}
        {/* ngồi (sit/sofa) nhìn thẳng: đùi ngang vẽ SAU thân để đè lên đáy thân; còn lại chân vẽ trước thân */}
        {!(back && pose === 'sit') && !thighsOver && ['l', 'r'].map((s, i) => leg(s as 'l' | 'r', i))}
        <g className="torso" data-part="torso">
          <ellipse cx={0} cy={cy} rx={17} ry={19} fill={suit} />
          {working && !back && (
            <ellipse className="p-screen-glow" cx={6 * f} cy={cy - 10} rx={15} ry={18} fill="#74c0ff" opacity={0.14} pointerEvents="none" />
          )}
          <path d={`M${-9 * f} ${cy - 19} q${-10 * f} 6 ${-12 * f} 20 q${2 * f} 10 ${8 * f} 16`} fill="none" stroke="#000" strokeWidth={4} opacity={0.12} />
          {back ? (
            <>
              {/* góc lưng: đường giữa vest, không sơ mi/cà vạt */}
              <path d={`M0 ${cy - 17} v34`} stroke="#000" strokeWidth={1.2} opacity={0.25} />
              <path d={`M-17 ${cy} q17 -8 34 0`} stroke="#fff" strokeWidth={1} opacity={0.08} fill="none" />
              {look.neckwear === 'apron' && (
                // tạp dề nhìn từ sau: dây chéo và dây thắt eo
                <g className="acc-neck acc-apron" data-slot="neckwear">
                  <path d={`M-9 ${cy - 17} L9 ${cy + 4} M9 ${cy - 17} L-9 ${cy + 4}`} stroke="#8a5a2b" strokeWidth={2.6} />
                  <path d={`M-17 ${cy + 4} h34`} stroke="#8a5a2b" strokeWidth={3} />
                  <circle cx={0} cy={cy + 4} r={2.4} fill="#6b4a2a" />
                </g>
              )}
            </>
          ) : (
            <>
              <path d={`M-7 ${cy - 18} l7 22 l7 -22 q-7 -3 -14 0z`} fill="#f4f6fa" />
              <path d={`M-8 ${cy - 19} l8 10 l-3 10 l-6 -8 q-3 -8 1 -12z M8 ${cy - 19} l-8 10 l3 10 l6 -8 q3 -8 -1 -12z`} fill={suitL} />
              {look.neckwear !== 'bow' && (
                <>
                  <path className="tie" d={`M-2.2 ${cy - 10} h4.4 l1.2 12 l-3.4 5 l-3.4 -5z`} fill={tie} />
                  <path d={`M-2.2 ${cy - 10} h4.4 l-2.2 2.5z`} fill={shade(tie, 0.7)} />
                </>
              )}
              <circle cx={0} cy={cy + 9} r={1.2} fill="#d9b26a" />
              {isCoord && <rect className="badge" x={8} y={cy - 4} width={6} height={4} rx={1} fill="#d9b26a" />}
              {look.neckwear && (
                // vẽ trước tay; nhóm ngoài mang vị trí (không class), nhóm trong mang class acc-*
                <g transform={`translate(0,${cy})`} data-slot="neckwear">
                  {look.neckwear === 'bow' && (
                    <g className="acc-neck acc-bow">
                      <path d="M0 -10 l-7 -4 v8z M0 -10 l7 -4 v8z" fill={tie} />
                      <circle cx={0} cy={-10} r={2} fill={shade(tie, 0.7)} />
                    </g>
                  )}
                  {look.neckwear === 'badge' && (
                    <g className="acc-neck acc-badge">
                      <rect x={-14} y={0} width={9} height={6} rx={1} fill="#fff" stroke="#8b96a8" strokeWidth={0.6} />
                      <path d="M-12.5 2.5 h6 M-12.5 4.3 h4" stroke="#5b6578" strokeWidth={0.7} />
                    </g>
                  )}
                  {look.neckwear === 'apron' && (
                    <g className="acc-neck acc-apron">
                      <path d="M-11 -12 h22 l3 30 h-28z" fill="#8a5a2b" />
                      <path d="M-11 -12 q11 -7 22 0" stroke="#6b4a2a" strokeWidth={1.6} fill="none" />
                      <rect x={-6} y={6} width={12} height={6} rx={1} fill="#6b4a2a" />
                    </g>
                  )}
                  {look.neckwear === 'blouse' && (
                    <g className="acc-neck acc-blouse">
                      <path d="M-16 -14 q-3 18 0 34 h12 l2 -34z M16 -14 q3 18 0 34 h-12 l-2 -34z" fill="#f4f6fa" opacity={0.95} />
                      <path d="M-4 -16 v38 M4 -16 v38" stroke="#c6cdda" strokeWidth={0.8} />
                    </g>
                  )}
                </g>
              )}
            </>
          )}
          {/* tay: nhóm ngoài đặt vị trí, nhóm trong .arm chạy animation */}
          <g transform={`translate(${-16 * f},${cy - 8})`} data-slot="arm-l">{arm('l')}</g>
          <g transform={`translate(${16 * f},${cy - 8})`} data-slot="arm-r">{arm('r')}</g>
        </g>
        {thighsOver && ['l', 'r'].map((s, i) => leg(s as 'l' | 'r', i))}
        <g className="head" data-part="head">
          <circle cx={0} cy={hy} r={15} fill={skin} />
          <path
            d={`M${-15 * f} ${hy} a15 15 0 0 ${f > 0 ? 1 : 0} ${30 * f} 0 a15 15 0 0 ${f > 0 ? 1 : 0} ${-30 * f} 0z M${-10 * f} ${hy} a10 10 0 0 ${f > 0 ? 0 : 1} ${20 * f} 0`}
            fill="#000"
            opacity={0.06}
          />
          <path className={`hair hair-${hairStyle % HAIRS.length}`} d={(HAIRS[hairStyle % HAIRS.length] ?? HAIRS[0] ?? "").replace(/\{y\}/g, String(hy - 4))} fill={hair} />
          <path d={`M${-7 * f} ${hy - 19} q${5 * f} -3 ${11 * f} -1`} stroke="#fff" strokeWidth={1.5} fill="none" opacity={0.22} strokeLinecap="round" />
          {look.headgear && (look.headgear !== 'glasses' || !back) && (
            // nhóm ngoài: vị trí (không class); nhóm trong: class acc-* (không animation riêng)
            <g transform={`translate(0,${hy})`} data-slot="headgear">
              {look.headgear === 'cap' && (
                <g className="acc-head acc-cap">
                  <path d="M-15 -4 q0 -17 15 -17 q15 0 15 17 q-15 -4 -30 0z" fill="#2f5d9e" />
                  <path d={`M${f > 0 ? -2 : -22} -5 h24 q0 3 -3 3 h-18 q-3 0 -3 -3z`} fill="#244a80" />
                </g>
              )}
              {look.headgear === 'hardhat' && (
                <g className="acc-head acc-hardhat">
                  <path d="M-16 -3 q0 -20 16 -20 q16 0 16 20z" fill="#f2c230" />
                  <rect x={-18} y={-4} width={36} height={3.5} rx={1.5} fill="#d9a91c" />
                  <rect x={-2} y={-22} width={4} height={16} fill="#d9a91c" />
                </g>
              )}
              {look.headgear === 'headset' && (
                <g className="acc-head acc-headset">
                  <path d="M-15 1 q0 -20 15 -20 q15 0 15 20" stroke="#2a2f3d" strokeWidth={2.4} fill="none" />
                  <rect x={-18.5} y={-3} width={5} height={9} rx={2} fill="#2a2f3d" />
                  <rect x={13.5} y={-3} width={5} height={9} rx={2} fill="#2a2f3d" />
                  {!back && <path d={`M${15 * f} 6 q${-4 * f} 8 ${-12 * f} 8`} stroke="#2a2f3d" strokeWidth={1.4} fill="none" />}
                </g>
              )}
              {look.headgear === 'beret' && (
                <g className="acc-head acc-beret">
                  <ellipse cx={-3 * f} cy={-17} rx={17} ry={7} fill="#c0392b" transform={`rotate(${-8 * f} 0 -17)`} />
                  <path d="M-15 -8 q0 -9 15 -9 q15 0 15 9 q-15 -3 -30 0z" fill="#a83232" />
                  <rect x={-1.5 - 3 * f} y={-26} width={3} height={4} rx={1.2} fill="#7c2018" />
                </g>
              )}
              {look.headgear === 'ar' && (
                <g className="acc-head acc-ar">
                  <path d="M-15 -2 q15 -10 30 0" stroke="#2a2f3d" strokeWidth={2.2} fill="none" />
                  <rect x={ex - 14} y={-3} width={24} height={9} rx={4} fill="#0e8aa6" fillOpacity={0.55} stroke="#74e0ff" strokeWidth={1.2} />
                  <path d={`M${ex - 9} 0 l6 0 M${ex - 1} 3 l5 0`} stroke="#e6faff" strokeWidth={1} opacity={0.85} />
                </g>
              )}
              {look.headgear === 'glasses' && (
                <g className="acc-head acc-glasses">
                  <circle cx={ex - 8} cy={1} r={3.9} fill="none" stroke="#1a1f2e" strokeWidth={1.2} />
                  <circle cx={ex + 1} cy={1} r={3.9} fill="none" stroke="#1a1f2e" strokeWidth={1.2} />
                  <path d={`M${ex - 4.1} 1 h1.2`} stroke="#1a1f2e" strokeWidth={1.2} />
                </g>
              )}
            </g>
          )}
          {back ? (
            <>
              {/* gáy: tóc phủ, hai tai, không mặt */}
              <path className="nape" d={`M-15 ${hy - 4} q0 -17 15 -17 q15 0 15 17 q0 8 -3 12 q-12 -3 -24 0 q-3 -4 -3 -12z`} fill={hair} />
              <ellipse className="ear" cx={15 * f} cy={hy + 1} rx={2.6} ry={3.6} fill={skin} />
              <ellipse className="ear" cx={-15 * f} cy={hy + 1} rx={2.6} ry={3.6} fill={skin} />
            </>
          ) : (
            <>
              <ellipse className="ear" cx={-15 * f} cy={hy + 1} rx={2.6} ry={3.6} fill={skin} />
              {eyes}
              <path className="brow" d={`M${ex - 11} ${hy - 4.5} q3 -2.5 6.5 -.5`} stroke={hair} strokeWidth={1.6} fill="none" strokeLinecap="round" />
              <path className="brow" d={`M${ex - 2} ${hy - 5} q3 -2 6.5 0`} stroke={hair} strokeWidth={1.6} fill="none" strokeLinecap="round" />
              <path className="mouth" data-part="mouth" d={mouthD} stroke="#b5604f" strokeWidth={1.4} fill="none" strokeLinecap="round" />
              <ellipse cx={ex - 10} cy={hy + 6} rx={2.6} ry={1.5} fill="#ff8a8a" opacity={0.3} />
              <ellipse cx={ex + 3} cy={hy + 6} rx={2.6} ry={1.5} fill="#ff8a8a" opacity={0.3} />
            </>
          )}
        </g>
      </g>
      </g>
      {act === 'sleeping' &&
        [
          { c: 'zzz', zx: 14, zy: -40, s: 11 },
          { c: 'zzz b', zx: 20, zy: -48, s: 9 },
        ].map((z) => (
          // zzz: nhóm ngoài đặt vị trí; chữ trong chạy animation (class iso-zzz + zzz)
          <g key={z.c} transform={`translate(${z.zx * f},${z.zy})`} data-slot="zzz">
            <text className={`${z.c} iso-zzz`} x={0} y={0} fill="#9fb0c8" fontSize={z.s} fontWeight={700}>z</text>
          </g>
        ))}
      {act === 'thinking' && (
        // dáng suy nghĩ: tay chống cằm và dấu "..." nhỏ trên đầu, không gõ phím
        <g data-slot="thinking">
          <path className="think-arm" d={`M${8 * f} ${cy - 2} q${4 * f} -8 ${-1 * f} ${hy + 12 - cy + 2}`} stroke={suit} strokeWidth={6} fill="none" strokeLinecap="round" />
          <circle className="think-hand" data-part="chin-hand" cx={ex - 2} cy={hy + 12} r={3.8} fill={skin} />
          <text className="think-dots" x={4 * f} y={hy - 18} textAnchor="middle" fill="#9fb0c8" fontSize={10} fontWeight={700}>...</text>
        </g>
      )}
      {bubble ? (
        // bong bóng suy nghĩ: nhóm ngoài mang translate (view-box), nhóm trong .think + iso-think chạy animation (fill-box)
        <g transform={`translate(${bubbleX},${bubbleY})`} data-slot="think">
          <g className="think iso-think" data-part="think">
            <circle className="mood-bg" fill="#ffffff" stroke="#c9d1e3" strokeWidth={0.6} cx={-8 * f} cy={16} r={2} />
            <circle className="mood-bg" fill="#ffffff" stroke="#c9d1e3" strokeWidth={0.6} cx={-4 * f} cy={10} r={3} />
            <rect className="mood-bg" fill="#ffffff" stroke="#c9d1e3" strokeWidth={0.6} x={-(bubble.length * 5.4 + 16) / 2} y={-10} width={bubble.length * 5.4 + 16} height={17} rx={8.5} />
            <text className="mood" fill="#0b1020" x={0} y={2.5} textAnchor="middle">{bubble}</text>
          </g>
        </g>
      ) : null}
    </g>
  );
}
