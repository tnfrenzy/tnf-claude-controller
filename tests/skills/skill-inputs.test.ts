import { describe, expect, it } from "vitest";
import * as core from "../../src/core/skill-workshop/inputs.js";
import * as ui from "../../ui/src/skills/skillForm.js";
import { validatePackageInput } from "../../src/core/skill-workshop/package.js";

const base = { required: false, reason: "vì cần", group: "A" };
const valid = () => ({
  version: 2,
  fields: [
    { id: "ten", label: "Tên", kind: "text", ...base, required: true, suggested: "x" },
    { id: "so_luong", label: "SL", kind: "number", unit: "kg", ...base, suggested: 3 },
    { id: "loai", label: "Loại", kind: "select", options: ["a", "b"], ...base, group: "B", suggested: "b" },
    { id: "dong_y", label: "Đồng ý", kind: "bool", ...base, required: true, group: "B" },
    { id: "tep", label: "Tệp", kind: "file", ...base, group: "A" }
  ]
});
const mut = (fn: (s: any) => void) => {
  const s = valid();
  fn(s);
  return s;
};

const schemaCases: [string, unknown, boolean][] = [
  ["valid", valid(), true],
  ["dup id", mut((s) => (s.fields[1].id = "ten")), false],
  ["bad id", mut((s) => (s.fields[0].id = "1Bad")), false],
  ["select no options", mut((s) => delete s.fields[2].options), false],
  ["suggested outside", mut((s) => (s.fields[2].suggested = "z")), false],
  ["unit on text", mut((s) => (s.fields[0].unit = "kg")), false],
  ["options on text", mut((s) => (s.fields[0].options = ["a"])), false],
  ["empty reason", mut((s) => (s.fields[0].reason = " ")), false],
  ["empty fields", { version: 2, fields: [] }, false],
  ["too many", { version: 2, fields: Array.from({ length: 21 }, (_, i) => ({ id: `f${i}`, label: "L", kind: "text", ...base })) }, false],
  ["not object", [], false]
];

describe("validateInputsSchema (core and ui)", () => {
  it.each(schemaCases)("%s", (_n, raw, ok) => {
    expect(core.validateInputsSchema(raw).ok).toBe(ok);
    expect(ui.validateInputsSchema(raw)).toEqual(core.validateInputsSchema(raw));
  });
});

describe("validateAnswers", () => {
  const schema = valid() as any;
  const good = { ten: "a", dong_y: false };
  const cases: [string, Record<string, unknown>, string[]][] = [
    ["ok, bool false valid", good, []],
    ["missing required", { dong_y: true }, ["ten"]],
    ["missing required bool", { ten: "a" }, ["dong_y"]],
    ["number NaN", { ...good, so_luong: NaN }, ["so_luong"]],
    ["number string", { ...good, so_luong: "3" }, ["so_luong"]],
    ["select wrong", { ...good, loai: "z" }, ["loai"]],
    ["bool wrong", { ...good, dong_y: "yes" }, ["dong_y"]],
    ["file array ok", { ...good, tep: ["a.pdf"] }, []],
    ["file not array", { ...good, tep: "a.pdf" }, ["tep"]]
  ];
  it.each(cases)("%s", (_n, answers, bad) => {
    const r = core.validateAnswers(schema, answers);
    expect(Object.keys(r.errors).sort()).toEqual(bad);
    expect(r.ok).toBe(bad.length === 0);
    expect(ui.validateAnswers(schema, answers)).toEqual(r);
  });
  it("required file needs non-empty", () => {
    const s = mut((x) => (x.fields[4].required = true));
    expect(core.validateAnswers(s, { ...good, tep: [] }).errors.tep).toBeTruthy();
  });
});

describe("groupFields / suggestedAnswers", () => {
  it("keeps first-appearance order", () => {
    const g = core.groupFields(valid() as any);
    expect(g.map((x) => x.group)).toEqual(["A", "B"]);
    expect(g[0].fields.map((f) => f.id)).toEqual(["ten", "so_luong", "tep"]);
    expect(ui.groupFields(valid() as any)).toEqual(g);
  });
  it("suggested map", () => {
    const m = core.suggestedAnswers(valid() as any);
    expect(m).toEqual({ ten: "x", so_luong: 3, loai: "b" });
    expect(ui.suggestedAnswers(valid() as any)).toEqual(m);
  });
});

describe("validatePackageInput inputs.json", () => {
  const run = (o: unknown) => {
    try {
      validatePackageInput({ "inputs.json": JSON.stringify(o) });
      return 0;
    } catch (e: any) {
      return e.status;
    }
  };
  it("old schema still accepted", () => {
    expect(run({ description: "d", fields: [{ name: "a_1", label: "A", type: "choice", choices: ["x"] }] })).toBe(0);
  });
  it("new schema accepted, bad new rejected", () => {
    expect(run(valid())).toBe(0);
    expect(run(mut((s) => (s.fields[0].reason = "")))).toBe(400);
  });
  it("empty fields rejected", () => {
    expect(run({ fields: [] })).toBe(400);
    expect(run({ version: 2, fields: [] })).toBe(400);
  });
});
