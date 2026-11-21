import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CityScene, cityViewBox } from "../../ui/src/office/CityScene.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";
import type { Design3DFloor } from "../../ui/src/types.js";

function floor(i: number, title: string, status: string): Design3DFloor {
  return { runId: `run-${i}`, title, status, fileCount: 2, primaryFormat: "glb" } as unknown as Design3DFloor;
}

function render(design3dFloors?: Design3DFloor[]): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
      createElement(CityScene, { towers: ["TNF Tower", "Tower 2"], floors: [{ id: "default", name: "default", running: false }], design3dFloors }),
    ),
  );
}

describe("city scene design3d tower", () => {
  it("renders roof, floors, status labels and the add button", () => {
    const html = render([floor(1, "Ghế gỗ", "running"), floor(2, "Bàn tròn", "done")]);
    expect(html).toContain("design3d-tower");
    expect(html).toContain("XƯỞNG MẪU 3D");
    expect(html).toContain("Ghế gỗ");
    expect(html).toContain("Bàn tròn");
    expect(html).toContain("Tạo mẫu mới");
    expect(html).toContain("Tầng trệt");
    expect(html).toContain("beacon");
    expect(html).toContain("Đang dựng");
    expect(html).toContain("Xong");
  });

  it("hides the add button when 5 floors are shown", () => {
    const html = render([1, 2, 3, 4, 5].map((i) => floor(i, `Mẫu ${i}`, "done")));
    expect(html).toContain("design3d-tower");
    expect(html).not.toContain("Tạo mẫu mới");
  });

  it("an empty array still renders the tower with the add button", () => {
    const html = render([]);
    expect(html).toContain("design3d-tower");
    expect(html).toContain("XƯỞNG MẪU 3D");
    expect(html).toContain("Tạo mẫu mới");
  });

  it("undefined renders no tower", () => {
    expect(render(undefined)).not.toContain("design3d-tower");
  });
});

describe("cityViewBox", () => {
  it("desktop is always the full frame", () => {
    for (const api of [false, true]) for (const d3 of [false, true]) expect(cityViewBox(false, api, d3)).toBe("0 0 1400 846");
  });

  it("narrow without 3D keeps the old frames", () => {
    expect(cityViewBox(true, true, false)).toBe("200 150 1120 696");
    expect(cityViewBox(true, false, false)).toBe("200 150 900 696");
  });

  it("narrow with 3D covers x 10-200 and keeps the right edge", () => {
    for (const [api, right] of [[true, 1320], [false, 1100]] as const) {
      const parts = cityViewBox(true, api, true).split(" ").map(Number);
      const minX = parts[0] as number;
      const w = parts[2] as number;
      expect(minX).toBeLessThanOrEqual(10);
      expect(minX + w).toBeGreaterThanOrEqual(200);
      expect(minX + w).toBe(right);
    }
  });
});
