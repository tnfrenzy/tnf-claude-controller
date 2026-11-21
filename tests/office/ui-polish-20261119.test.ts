import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CityScene } from "../../ui/src/office/CityScene";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const base = { towers: ["TNF Tower", "Huấn luyện AI"] as [string, string], floors: [] };

describe("favicon and app icons", () => {
  it("index.html points to the new tn-* icons (new names, so a cached old favicon is not reused)", () => {
    const html = read("ui/index.html");
    expect(html).toContain("/favicon-tn-32.png");
    expect(html).toContain("/favicon-tn-64.png");
    expect(html).toContain("/favicon.ico");
    expect(html).not.toContain('href="/favicon-64.png"');
  });
  it("the manifest uses the 192 and 512 icons and every icon file exists", () => {
    const manifest = JSON.parse(read("ui/public/manifest.webmanifest")) as { icons: Array<{ src: string }> };
    const srcs = manifest.icons.map((i) => i.src);
    expect(srcs).toEqual(["/icon-tn-192.png", "/icon-tn-512.png"]);
    for (const f of [...srcs, "/favicon-tn-32.png", "/favicon-tn-64.png", "/favicon.ico", "/logo.png"]) {
      expect(existsSync(new URL(`../../ui/public${f}`, import.meta.url)), f).toBe(true);
    }
  });
  it("the old favicon file is gone", () => {
    expect(existsSync(new URL("../../ui/public/favicon-64.png", import.meta.url))).toBe(false);
  });
});

describe("quick command in the work area", () => {
  it("LeftPanel has the quick command box that runs the default environment, and the pick-roles button", () => {
    const src = read("ui/src/components/LeftPanel.tsx");
    expect(src).toContain('className="quick-cmd"');
    expect(src).toContain("t.ss_cmd_placeholder");
    expect(src).toContain('onOpen("cmd", { projectName: "default"');
    expect(src).toContain("rolesOpen: true");
    expect(src).toMatch(/e\.key === "Enter"\) submit\(\)/);
  });
});

describe("tower lights", () => {
  it("draws lights on the side towers (training, API, 3D, video) and not on an absent tower", () => {
    const html = renderToStaticMarkup(createElement(CityScene, { ...base, design3dFloors: [], videoStudioFloors: [] }));
    // training + API are always drawn; 3D and video only when their floors are passed.
    expect(html.match(/class="tower-lights"/g)).toHaveLength(4);
    const two = renderToStaticMarkup(createElement(CityScene, base));
    expect(two.match(/class="tower-lights"/g)).toHaveLength(2);
  });
  it("the lights include a roof beacon and blinking bulbs", () => {
    const html = renderToStaticMarkup(createElement(CityScene, { ...base, videoStudioFloors: [] }));
    expect(html).toContain("beacon");
    expect(html).toContain("win win-blink");
  });
});

describe("API tower popup", () => {
  it("no longer renders the office view", () => {
    const src = read("ui/src/components/office/ApiFloorPopup.tsx");
    expect(src).not.toContain("OfficeViewport");
    expect(src).not.toContain("useLayout");
    expect(src).toContain("api-table");
  });
});
