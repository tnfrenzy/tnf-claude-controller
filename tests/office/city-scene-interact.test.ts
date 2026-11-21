import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CityScene } from "../../ui/src/office/CityScene.js";
import { floorSub } from "../../ui/src/office/floor-sub.js";

describe("CityScene interaction", () => {
  const html = renderToStaticMarkup(
    createElement(CityScene, { towers: ["TNF Tower", "Tower 2"], floors: [{ id: "a", name: "alpha", running: false }], onAddSkillFloor: () => {} }),
  );
  it("keeps main.scene as root without nested .scene", () => {
    expect(html.startsWith('<main class="scene"')).toBe(true);
    expect(html.match(/class="scene"/g)).toHaveLength(1);
  });
  it("floor, add-floor and add-skill-floor are focusable buttons", () => {
    const buttons = html.match(/<g[^>]*role="button"[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) expect(b).toContain('tabindex="0"');
    expect(html).toContain('class="training-tower"');
  });
});

describe("CityScene ground floor", () => {
  const floors = [{ id: "default", name: "Tầng trệt", running: false }, ...["a", "b", "c", "d", "e"].map((n) => ({ id: n, name: n, running: false }))];
  const html = renderToStaticMarkup(createElement(CityScene, { towers: ["TNF Tower", "Tower 2"], floors }));
  it("renders ground floor label and numbers project floors from 1", () => {
    expect(html).toContain("Tầng trệt");
    expect(html).toContain("Tầng 1 · a");
    expect(html).toContain("Tầng 5 · e");
  });
  it("default does not count against the add-floor limit", () => {
    expect(html).not.toContain("Thêm tầng ·");
    const four = renderToStaticMarkup(createElement(CityScene, { towers: ["TNF Tower", "Tower 2"], floors: floors.slice(0, 5) }));
    expect(four).toContain("Thêm tầng ·");
  });
});

describe("CityScene training tower", () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `skill ${i}`, state: "passed", badge: "passed" as const, score: i === 0 ? 92 : null, running: false }));
  const render = (n: number) =>
    renderToStaticMarkup(createElement(CityScene, { towers: ["TNF Tower", "Huấn luyện AI"], floors: [], skillFloors: mk(n) }));
  it("renders the second tower name, skill floors with badge and best score", () => {
    const html = render(2);
    expect(html).toContain("HUẤN LUYỆN AI");
    expect(html).not.toContain("SẮP MỞ");
    expect(html).toContain("skill 0");
    expect(html).toContain("Đạt");
    expect(html).toContain("Điểm cao nhất: 92");
    expect(html).toContain("Điểm cao nhất: –");
    const buttons = html.match(/<g[^>]*role="button"[^>]*>/g) ?? [];
    for (const b of buttons) expect(b).toContain('tabindex="0"');
  });
  it("shows the add-training-floor button below 5 skills and hides it at 5", () => {
    expect(render(4)).toContain("Thêm tầng huấn luyện");
    expect(render(5)).not.toContain("Thêm tầng huấn luyện");
  });
  const tower = (n: number) => render(n).split('class="training-tower"')[1] ?? "";
  const bodyHeight = (n: number) => Number(/<rect x="810" y="[\d.]+" width="220" height="([\d.]+)" fill="url\(#gGlassDim\)"/.exec(tower(n))?.[1]);
  const addY = (n: number) => Number(/<rect x="816" y="(-?[\d.]+)"/.exec(tower(n))?.[1]);
  it("n=0 has only the ground floor, a button, and the add button", () => {
    const html = tower(0);
    expect(html).toContain("Tầng trệt");
    expect(html).toContain("ground-floor");
    expect(html).not.toContain("skill 0");
    expect(html).toContain("Thêm tầng huấn luyện");
    expect(/class="floor-band ground-floor"[^>]*role="button"/.test(html)).toBe(true);
  });
  it("n=1 has one skill floor and a taller body", () => {
    expect(tower(1)).toContain("skill 0");
    expect(tower(1)).not.toContain("skill 1");
    expect(bodyHeight(1)).toBeGreaterThan(bodyHeight(0));
  });
  it("n=5 has five floors, no add button, taller body, button within viewBox", () => {
    const html = tower(5);
    expect(html).toContain("skill 4");
    expect(html).not.toContain("Thêm tầng huấn luyện");
    expect(bodyHeight(5) - bodyHeight(4)).toBe(62);
    expect(addY(4)).toBeGreaterThanOrEqual(0);
  });
  it("draws window lights only inside the tower-lights group (never behind the floor plates)", () => {
    const t = tower(0).split("KHU TH")[0] ?? "";
    const beforeLights = t.split('class="tower-lights"')[0] ?? "";
    expect(beforeLights).not.toContain('class="win"');
    expect(beforeLights).not.toContain('rx="1"');
    expect(t).toContain('class="tower-lights"');
  });
});

describe("floorSub", () => {
  const run = {
    status: "running",
    agents: [
      { role: "analyst", status: "finished" },
      { role: "implementer", status: "running" },
    ],
  };
  it("shows step k/n and role", () => {
    expect(floorSub(run, ["analyst", "implementer", "qa", "critic"], "vi")).toMatch(/^bước 2\/4 · /);
  });
  it("derives order from agents when roles omitted", () => {
    expect(floorSub(run, undefined, "en")).toMatch(/^step 2\/2 · /);
  });
  it("is empty when not running or no data", () => {
    expect(floorSub(null, [])).toBe("");
    expect(floorSub({ status: "done", agents: run.agents }, [])).toBe("");
    expect(floorSub({ status: "running", agents: [] }, [])).toBe("");
  });
});
