/** Dev-only mock of the variants + materials APIs (w3d-dev.html?view=variants): in-memory, builds progress on timers. */
import type { MaterialsApi } from "../components/workshop3d/materials-api";
import type { VariantsApi } from "../components/workshop3d/variants-api";
import type { VConfig, VOption, VOverview } from "../components/workshop3d/variants-logic";

const SLOTS: VOverview["slots"] = [
  { id: "handrail", name: "Tay vịn", type: "part", matched: ["handrail_back", "handrail_bracket_1", "handrail_bracket_2"], size_mm: { w: 1100, d: 60, h: 80 } },
  { id: "floor", name: "Đá sàn", type: "material", matched: ["floor"], size_mm: { w: 1150, d: 1450, h: 50 } },
  { id: "wall", name: "Vách", type: "material", matched: ["wall_left", "wall_right", "wall_back"], size_mm: { w: 1150, d: 1450, h: 2300 } },
];

export function makeMockVariantsApi(glb: () => Promise<Blob>, withSlots = true): VariantsApi {
  let slots = withSlots ? SLOTS : [];
  let seq = 1;
  const options: VOption[] = [];
  const configs: VConfig[] = [];
  const t0 = Date.now();
  const overview = (): VOverview => ({
    ready: slots.length > 0,
    reason: slots.length > 0 ? null : "Mẫu chính chưa khai báo chỗ cấu hình (slot). Thêm slot ở tờ yêu cầu khi tạo phiên.",
    slots,
    options,
    configs,
    limits: { maxConfigs: 24, maxOptions: 24, maxTotalConfigs: 48, maxPartBytes: 20 * 1024 * 1024 },
  });
  const add = (slot: string, kind: VOption["kind"], name: string, command: string, readyAfter: number): VOption => {
    const o: VOption = { id: `o-mock${seq++}-abc`, slot, kind, name, command, state: readyAfter > 0 ? "building" : "ready", created: new Date(t0).toISOString() };
    options.push(o);
    if (readyAfter > 0) setTimeout(() => { o.state = "ready"; }, readyAfter);
    return o;
  };
  return {
    masters: async () => [{ slug: "mock-cabin", title: "Cabin thang khách 630 kg", state: "done" }],
    overview: async () => overview(),
    putSlots: async (_s, s) => { slots = s.map((x) => ({ ...x, matched: [x.id], size_mm: null })); return overview(); },
    addOption: async (_s, b) => add(b.slot ?? "floor", "material", (b.command.split("\n")[0] ?? "").slice(0, 40) || "Phương án", b.command, b.upload ? 2500 : 0),
    addPart: async (_s, slot, name) => add(slot, "part", name, "", 0),
    removeOption: async (_s, id) => { const i = options.findIndex((o) => o.id === id); if (i >= 0) options.splice(i, 1); },
    startBatch: async (_s, sel) => {
      const made: VConfig[] = [];
      let acc: Record<string, string>[] = [{}];
      for (const [slot, ids] of Object.entries(sel)) acc = acc.flatMap((b) => ids.map((id) => ({ ...b, [slot]: id })));
      for (const choices of acc) {
        const name = Object.entries(choices).map(([s, id]) => `${slots.find((x) => x.id === s)?.name}: ${options.find((o) => o.id === id)?.name}`).join(" · ");
        const c: VConfig = { id: `c-mock${seq++}-abc`, name, choices, state: "queued", created: new Date().toISOString() };
        configs.push(c);
        made.push(c);
        setTimeout(() => { c.state = "running"; }, 400 * made.length);
        setTimeout(() => { c.state = "done"; c.bytes = 1_400_000; }, 900 * made.length + 600);
      }
      return made;
    },
    removeConfig: async (_s, id) => { const i = configs.findIndex((c) => c.id === id); if (i >= 0) configs.splice(i, 1); },
    configGlb: () => glb(),
  };
}

export const mockMaterialsApi: MaterialsApi = {
  list: async () => ({ items: [{ id: "m-kem", name: "Đá kem vân mây", category: "stone", kind: "material", materialKind: "stone", size_mm: { w: 600, d: 600, h: 20 }, source: "kem.jpg", session: null, tile_cm: 60, mapping: "tile", created: "", files: ["albedo.png", "slab.glb", "preview.png"] }], categories: [{ id: "stone", kind: "material", ready: true, defaultSize: { w: 600, d: 600, h: 20 } }], batches: [], limits: { upload: 12, dir: 24, imageBytes: 10 * 1024 * 1024 }, localDir: true }),
  upload: async (f) => ({ upload: `u-mock-${f.size}.png`, fileName: f.name }),
  startBatch: async () => { throw new Error("mock"); },
  importDir: async () => { throw new Error("mock"); },
  batch: async () => { throw new Error("mock"); },
  update: async () => { throw new Error("mock"); },
  remove: async () => undefined,
  file: async () => new Blob([new Uint8Array(8)]),
};
