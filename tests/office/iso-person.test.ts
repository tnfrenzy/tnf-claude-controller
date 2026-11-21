import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HAIRS, IsoPerson, LOOK } from "../../ui/src/components/office/IsoPerson.js";
import { sortedDrawList } from "../../ui/src/office/iso/depth.js";
import { LIE_LIFT } from "../../ui/src/office/iso/pose-geom.js";

const ACTS = ["seated", "typing", "walking", "talking", "drinking", "cooking", "resting", "sleeping", "stretch", "phone", "idle", "happy"];
const POSES = ["stand", "sit", "sofa", "lie"];
const css = readFileSync("ui/src/styles.css", "utf8");
const person = readFileSync("ui/src/components/office/IsoPerson.tsx", "utf8");

/** Keep tags, class and data-* attributes; drop every other attribute (coordinates, colors, paths). */
function shape(props: Record<string, unknown>): string {
  const html = renderToStaticMarkup(createElement(IsoPerson, props as never));
  return html
    .replace(/<(\w+)([^>]*?)(\/?)>/g, (_m, tag: string, attrs: string, close: string) => {
      const keep = [...attrs.matchAll(/\s(class|data-[\w-]+)="([^"]*)"/g)].map((a) => `${a[1]}="${a[2]}"`);
      return `<${tag}${keep.length ? " " + keep.join(" ") : ""}${close}>`;
    })
    .replace(/>([^<]*)</g, (_m, t: string) => `>${t.replace(/\d+/g, "#")}<`);
}

const rootOf = (html: string) => html.slice(0, html.indexOf(">") + 1);

describe("IsoPerson structure snapshots", () => {
  for (const act of ACTS) {
    it(`act ${act}`, () => {
      expect(shape({ role: "implementer", act, pose: "stand" })).toMatchSnapshot();
    });
  }
  for (const pose of POSES) {
    it(`pose ${pose}`, () => {
      expect(shape({ role: "qa", act: "idle", pose })).toMatchSnapshot();
    });
  }
  it("back view", () => {
    const back = shape({ role: "analyst", act: "typing", pose: "sit", back: true });
    expect(back).toMatchSnapshot();
    expect(back).toContain("nape");
    expect(back).not.toContain('class="mouth"');
  });
  it("coordinator has badge, others do not", () => {
    expect(shape({ role: "x", isCoord: true })).toContain('class="badge"');
    expect(shape({ role: "analyst" })).not.toContain('class="badge"');
    expect(renderToStaticMarkup(createElement(IsoPerson, { role: "x", isCoord: true }))).toContain(LOOK.coordinator.tie);
  });
  it("unknown role falls back to a sprite", () => {
    const html = shape({ role: "mystery" });
    expect(html).toContain('data-role="mystery"');
    expect(html).toContain('class="head"');
  });
  it("bubble only when text is non-empty", () => {
    expect(shape({ role: "qa", bubble: "" })).not.toContain("think");
    const b = shape({ role: "qa", bubble: "chay test" });
    expect(b).toContain("think iso-think");
    expect(b).toContain("mood-bg");
    expect(b).toMatchSnapshot();
  });
  it("bubble has explicit white fill and dark text", () => {
    const html = renderToStaticMarkup(createElement(IsoPerson, { role: "qa", bubble: "Đang nghĩ" } as never));
    const bgs = [...html.matchAll(/<(?:circle|rect)[^>]*class="mood-bg"[^>]*>/g)].map((m) => m[0]);
    expect(bgs.length).toBe(3);
    for (const b of bgs) expect(b).toContain('fill="#ffffff"');
    const text = html.match(/<text[^>]*class="mood"[^>]*>([^<]*)<\/text>/)!;
    expect(text[0]).toContain('fill="#0b1020"');
    expect(text[1]).toBe("Đang nghĩ");
    expect(renderToStaticMarkup(createElement(IsoPerson, { role: "qa" } as never))).not.toContain("mood-bg");
  });
  it("root element is always the same kind of node", () => {
    const roots = new Set<string>();
    for (const act of ACTS) for (const pose of POSES) roots.add(rootOf(shape({ role: "qa", act, pose })).match(/^<(\w+)/)![1]);
    expect([...roots]).toEqual(["g"]);
    for (const act of ACTS) expect(rootOf(shape({ role: "qa", act }))).toContain(`class="p ${act} pose-stand"`);
  });
});

describe("lying pose geometry", () => {
  const poseTransform = (props: Record<string, unknown>): string | null => {
    const html = renderToStaticMarkup(createElement(IsoPerson, { role: "qa", ...props } as never));
    const m = html.match(/<g[^>]*data-slot="pose"[^>]*>/);
    expect(m).not.toBeNull();
    return m![0].match(/ transform="([^"]*)"/)?.[1] ?? null;
  };
  it("lie face=1 rotates along u and lifts onto the surface", () => {
    const t = poseTransform({ pose: "lie" })!;
    expect(t).toContain("rotate(120");
    expect(t).toContain(`translate(0,-${LIE_LIFT})`);
    expect(t).not.toContain("118");
  });
  it("lie face=-1 and axis v rotate by the derived angle", () => {
    expect(poseTransform({ pose: "lie", face: -1 })).toContain("rotate(-60");
    expect(poseTransform({ pose: "lie", face: 1, lieAxis: "v" })).toContain("rotate(-120");
  });
  it("other poses have no transform on the pose group", () => {
    for (const pose of ["stand", "sit", "sofa"]) expect(poseTransform({ pose })).toBeNull();
  });
  it("keeps root class and data-pose, and draws no shadow for lie", () => {
    const html = renderToStaticMarkup(createElement(IsoPerson, { role: "qa", pose: "lie" } as never));
    expect(rootOf(html)).toContain('class="p idle pose-lie"');
    expect(rootOf(html)).toContain('data-pose="lie"');
    expect(html).not.toContain('opacity="0.35"');
    expect(renderToStaticMarkup(createElement(IsoPerson, { role: "qa", pose: "stand" } as never))).toContain('opacity="0.35"');
  });
});

describe("seated leg order and thigh direction", () => {
  const order = (props: Record<string, unknown>): string[] => {
    const html = renderToStaticMarkup(createElement(IsoPerson, { role: "qa", ...props } as never));
    const body = html.slice(html.indexOf('class="body"'));
    const marks = ["data-part=\"torso\"", "data-slot=\"leg-l\"", "data-slot=\"leg-r\""];
    return marks.map((m) => [body.indexOf(m), m] as const).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]).map(([, m]) => m);
  };
  const torso = "data-part=\"torso\"";
  it("sit and sofa draw torso before both legs", () => {
    for (const pose of ["sit", "sofa"]) expect(order({ pose })).toEqual([torso, "data-slot=\"leg-l\"", "data-slot=\"leg-r\""]);
  });
  it("stand and lie draw legs before torso", () => {
    for (const pose of ["stand", "lie"]) expect(order({ pose })).toEqual(["data-slot=\"leg-l\"", "data-slot=\"leg-r\"", torso]);
  });
  it("back + sit has no legs", () => {
    expect(order({ pose: "sit", back: true })).toEqual([torso]);
  });
  it("thigh path goes toward +x for face 1 and -x for face -1", () => {
    const thigh = (face: number) => renderToStaticMarkup(createElement(IsoPerson, { role: "qa", pose: "sit", face } as never)).match(/d="M-3\.5 0 h7 l(-?\d+) /)?.[1];
    expect(Number(thigh(1))).toBeGreaterThan(0);
    expect(Number(thigh(-1))).toBeLessThan(0);
  });
});

describe("hair styles", () => {
  it("has 6 styles, all with a {y} placeholder", () => {
    expect(HAIRS.length).toBe(6);
    for (const h of HAIRS) expect(h).toContain("{y}");
  });
  it("hairStyle 4 renders class hair-4", () => {
    const look = { ...LOOK.qa, hairStyle: 4 };
    const html = renderToStaticMarkup(createElement(IsoPerson, { role: "qa", lookOverride: look } as never));
    expect(html).toContain("hair hair-4");
    expect(html).not.toContain("{y}");
  });
});

describe("optional suit color", () => {
  it("uses look.suit for torso and arms, lapels are shade(suit, 1.3)", () => {
    // #123456 = (18,52,86); x1.3 truncated = (23,67,111)
    const look = { ...LOOK.qa, suit: "#123456" };
    const html = renderToStaticMarkup(createElement(IsoPerson, { role: "qa", lookOverride: look } as never));
    expect(html).toContain("#123456");
    expect(html).toContain("rgb(23,67,111)");
    expect(html).not.toContain("#1c2437");
    expect(html).not.toContain("#2a3450");
  });
  it("default look keeps the original suit colors", () => {
    const html = renderToStaticMarkup(createElement(IsoPerson, { role: "qa" } as never));
    expect(html).toContain("#1c2437");
    expect(html).toContain("#2a3450");
  });
});

const withLook = (extra: Record<string, unknown>, props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(createElement(IsoPerson, { role: "qa", lookOverride: { ...LOOK.qa, ...extra }, ...props } as never));

describe("optional head accessories", () => {
  for (const [g, cls] of [["cap", "acc-cap"], ["glasses", "acc-glasses"], ["headset", "acc-headset"], ["hardhat", "acc-hardhat"]] as const) {
    it(`headgear ${g} renders ${cls} with outer group unclassed`, () => {
      const html = withLook({ headgear: g });
      expect(html).toContain(cls);
      expect(html).toContain("acc-head");
      expect(html).toContain('data-slot="headgear"');
    });
  }
  it("glasses are absent at back, other headgear remain", () => {
    expect(withLook({ headgear: "glasses" }, { back: true })).not.toContain("acc-glasses");
    expect(withLook({ headgear: "cap" }, { back: true })).toContain("acc-cap");
    expect(withLook({ headgear: "headset" }, { back: true })).toContain("acc-headset");
    expect(withLook({ headgear: "hardhat" }, { back: true })).toContain("acc-hardhat");
  });
  it("no headgear leaves no accessory markup", () => {
    expect(withLook({})).not.toContain("acc-");
  });
});

describe("optional neckwear", () => {
  it("bow replaces the tie (no tie node, no knot shade)", () => {
    const html = withLook({ neckwear: "bow" });
    expect(html).toContain("acc-bow");
    expect(html).not.toContain('class="tie"');
    expect(html).toContain("acc-neck");
    // nút cà vạt shade(tie, 0.7) chỉ còn ở nơ (1 lần), không còn ở nút cà vạt
    const knot = html.split(`M-2.2 `).length - 1;
    expect(knot).toBe(0);
  });
  it("badge and blouse render and keep the tie", () => {
    const badge = withLook({ neckwear: "badge" });
    expect(badge).toContain("acc-badge");
    expect(badge).toContain('class="tie"');
    expect(withLook({ neckwear: "blouse" })).toContain("acc-blouse");
  });
  it("neckwear is absent at back", () => {
    for (const n of ["bow", "badge", "blouse"]) {
      const html = withLook({ neckwear: n }, { back: true });
      expect(html).not.toContain("acc-neck");
      expect(html).not.toContain(`acc-${n}`);
    }
  });
  it("blouse and badge are drawn before the arms", () => {
    for (const n of ["badge", "blouse"]) {
      const html = withLook({ neckwear: n });
      expect(html.indexOf(`acc-${n}`)).toBeLessThan(html.indexOf('data-slot="arm-l"'));
    }
  });
  it("default look has no accessory markup and keeps tie", () => {
    const html = withLook({});
    expect(html).not.toContain("acc-");
    expect(html).toContain('class="tie"');
  });
});

describe("depth ordering without remounting", () => {
  it("sortedDrawList is independent of input order", () => {
    const items = [
      { id: "c", depth: 3 },
      { id: "a", depth: 1 },
      { id: "b", depth: 2 },
      { id: "a2", depth: 1 },
    ];
    const want = sortedDrawList(items).map((i) => i.id);
    expect(want).toEqual(["a", "a2", "b", "c"]);
    expect(sortedDrawList([...items].reverse()).map((i) => i.id)).toEqual(want);
  });
});

describe("styles.css matches the sprite", () => {
  it("every .p.<act> used in CSS is an act the sprite can emit", () => {
    const used = new Set([...css.matchAll(/\.p\.([a-z]+)/g)].map((m) => m[1]));
    for (const u of used) expect(ACTS, `unknown class .p.${u}`).toContain(u);
    for (const a of ACTS) expect(used.has(a), `no CSS for ${a}`).toBe(true);
  });
  it("keyframes names are unique", () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
  });
  it("documents the transform-box rule in code", () => {
    expect(person).toContain("view-box");
    expect(person).toContain("fill-box");
  });
});
