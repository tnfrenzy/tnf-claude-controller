import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildPresentation, miniMarkdown } from "../../src/core/workshop3d/presentation.js";

describe("presentation page", () => {
  it("renders headings, lists and escapes html", () => {
    const h = miniMarkdown("## Thông số\n- **Cao:** 2400 <mm>\nvăn bản");
    expect(h).toContain("<h3>Thông số</h3>");
    expect(h).toContain("<li><b>Cao:</b> 2400 &lt;mm&gt;</li>");
    expect(h).toContain("<p>văn bản</p>");
  });

  it("builds a self-contained folder from a session", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-pres-"));
    fs.mkdirSync(path.join(dir, "renders", "hq"), { recursive: true });
    fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify({ title: "Cabin thử", object: "Cabin inox. Chi tiết." }));
    fs.writeFileSync(path.join(dir, "REPORT.md"), "## Thông số\n- Cao 2400\n\n## Nhận xét\nTạm ổn.");
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ bestScore: 24 }));
    fs.writeFileSync(path.join(dir, "renders", "hq", "overview.png"), "png");
    fs.writeFileSync(path.join(dir, "renders", "noi_that.png"), "png");
    fs.writeFileSync(path.join(dir, "outputs", "model-view.glb"), Buffer.from("glb"));
    const r = buildPresentation(dir);
    expect(r.images).toBe(2);
    const html = fs.readFileSync(r.index, "utf8");
    expect(html).toContain("Cabin thử");
    expect(html).not.toContain("24/40"); // the self-assessment score is no longer shown
    expect(html).not.toContain("Đánh giá");
    expect(html).toContain("anh/hq_overview.png");
    expect(html).toContain("Noi that");
    expect(fs.existsSync(path.join(r.dir, "anh", "xn_noi_that.png"))).toBe(true);
    if (r.hasModel) expect(fs.readFileSync(path.join(r.dir, "data", "model.js"), "utf8")).toContain("data:model/gltf-binary;base64,");
    // a rebuild replaces the folder instead of piling files up
    expect(buildPresentation(dir).images).toBe(2);
  });
});
