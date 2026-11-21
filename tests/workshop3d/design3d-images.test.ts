// Request sheet of the 3D workshop: reference images (pick, check, upload to one inbox stage) and the 4000-char description.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Design3DPanel, createWithImages } from "../../ui/src/components/workshop3d/Design3DPanel.js";
import { I18nContext, dicts } from "../../ui/src/i18n.js";
import {
  W3D_IMAGE_LIMITS, W3D_LIMITS, addReferenceImages, buildWorkshop3DBrief, safeImageName,
} from "../../ui/src/office/workshop3d-session.js";
import type { Workshop3DBriefInput } from "../../ui/src/types.js";

const img = (name: string, size = 1000, type = "image/png") => ({ name, size, type });
const sheet = { title: "Cabin", rows: [], material: "", purpose: "", detail: "high" as const };

describe("safeImageName", () => {
  it("makes Vietnamese names with spaces inbox-safe and keeps the extension", () => {
    expect(safeImageName("Ảnh mẫu cabin đẹp.JPG", new Set())).toBe("Anh-mau-cabin-dep.jpg");
    expect(safeImageName("../../evil.png", new Set())).toBe("evil.png");
    expect(safeImageName("???.webp", new Set())).toBe("anh.webp");
    expect(safeImageName("a.png", new Set(["a.png"]))).toBe("a-2.png");
    expect(safeImageName("x".repeat(200) + ".png", new Set()).length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(safeImageName("  -- trần nhà --.jpeg", new Set()))).toBe(true);
  });
});

describe("addReferenceImages", () => {
  it("accepts up to 5 PNG/JPG/WebP images and reports the first problem", () => {
    let r = addReferenceImages([], [img("a.png"), img("b.jpg", 10, "image/jpeg"), img("c.gif", 10, "image/gif")]);
    expect(r.images.map((f) => f.name)).toEqual(["a.png", "b.jpg"]);
    expect(r.error).toBe("image_type");
    r = addReferenceImages(r.images, [img("big.png", W3D_IMAGE_LIMITS.fileBytes + 1)]);
    expect(r.error).toBe("image_size");
    r = addReferenceImages(r.images, [img("c.webp", 10, "image/webp"), img("d.png"), img("e.png"), img("f.png")]);
    expect(r.images).toHaveLength(5);
    expect(r.error).toBe("image_count");
    const near = Array.from({ length: 3 }, (_, i) => img(`n${i}.png`, W3D_IMAGE_LIMITS.fileBytes));
    expect(addReferenceImages(near, [img("z.png", 10)]).error).toBe("image_total");
  });
});

describe("description length", () => {
  it("4000 characters pass whole, longer is an error instead of a silent cut", () => {
    const ok = buildWorkshop3DBrief({ ...sheet, object: "o".repeat(W3D_LIMITS.object) });
    expect("brief" in ok && ok.brief.object.length).toBe(4000);
    expect(buildWorkshop3DBrief({ ...sheet, object: "o".repeat(4001) })).toEqual({ error: "object_long" });
    expect(dicts.vi.w3i_err_object_long).toMatch(/4000/);
  });
});

describe("createWithImages", () => {
  const brief: Workshop3DBriefInput = { title: "Cabin", object: "cabin", params: {}, detail: "high", attachments: [] };
  it("uploads every image to the same stage with safe names, then creates with that stage", async () => {
    const staged: { name: string; stage: string | null; bytes: number }[] = [];
    const created: (string | null)[] = [];
    const files = [new File([new Uint8Array([1, 2, 3])], "Ảnh 1.png", { type: "image/png" }), new File([new Uint8Array([4])], "Ảnh 1.png", { type: "image/png" })];
    const r = await createWithImages(brief, files, {
      stage: async (f, s) => {
        staged.push({ name: f.name, stage: s, bytes: f.size });
        return { stage_id: "s-1" };
      },
      create: async (_b, s) => {
        created.push(s);
        return { slug: "20261111-000000-abcdef" };
      },
    });
    expect(r.slug).toBe("20261111-000000-abcdef");
    expect(staged).toEqual([{ name: "Anh-1.png", stage: null, bytes: 3 }, { name: "Anh-1-2.png", stage: "s-1", bytes: 1 }]);
    expect(created).toEqual(["s-1"]);
  });
  it("without images there is no upload and no stage", async () => {
    const created: (string | null)[] = [];
    await createWithImages(brief, [], { stage: async () => { throw new Error("no"); }, create: async (_b, s) => { created.push(s); return { slug: "x" }; } });
    expect(created).toEqual([null]);
  });
});

describe("Design3DPanel markup", () => {
  it("has the image picker with the accepted types and the hint", () => {
    const html = renderToStaticMarkup(
      createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
        createElement(Design3DPanel, { kit: null, onCreated: () => {}, onClose: () => {} })),
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain("Ảnh mẫu (không bắt buộc)");
    expect(html).toContain('maxLength="4000"');
  });
});

describe("Workshop3DControls: automatic resume wait", () => {
  it("a retry wait is labelled as an automatic resume, not a quota wait", async () => {
    const { Workshop3DControls } = await import("../../ui/src/components/workshop3d/Workshop3DPopup.js");
    const snap = { state: "waiting_quota", waitReason: "retry" as const, waitUntil: Date.UTC(2026, 10, 11, 9), costUsd: 0, questions: [], issues: [], note: null, error: null };
    const html = renderToStaticMarkup(
      createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
        createElement(Workshop3DControls, { slug: "s", session: { snapshot: snap }, onChanged: () => {} })),
    );
    expect(html).toContain("Chờ tự tiếp tục");
    expect(html).toContain("phiên tự tiếp tục lúc");
    expect(html).not.toContain("Hết hạn mức tạm thời");
  });
});
