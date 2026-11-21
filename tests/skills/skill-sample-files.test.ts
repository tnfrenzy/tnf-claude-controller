import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildDocx, buildXlsx, sheetNames, validateSampleDoc, type SampleDoc } from "../../src/core/skill-workshop/sample-files.js";

/** Tiny zip reader (central directory) for tests. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(off + 26);
    const lxlen = buf.readUInt16LE(off + 28);
    const body = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    out[name] = (method === 8 ? inflateRawSync(body) : body).toString("utf8");
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const good: SampleDoc = {
  title: "Báo cáo Q&A",
  inputSummary: "Đầu vào mẫu",
  sections: [{ heading: "Tổng quan", paragraphs: ["Doanh thu tăng & ổn định"] }],
  tables: [{ name: "Doanh thu: [Q1]", columns: ["Tháng", "Giá trị"], rows: [["1", "100"]] }],
};

describe("validateSampleDoc", () => {
  it("accepts a valid doc", () => {
    expect(validateSampleDoc(good).ok).toBe(true);
  });
  it("rejects missing title and empty content", () => {
    expect(validateSampleDoc({ sections: [{ heading: "a", paragraphs: [] }] }).ok).toBe(false);
    expect(validateSampleDoc({ title: "x", sections: [], tables: [] }).ok).toBe(false);
    expect(validateSampleDoc(null).ok).toBe(false);
  });
  it("rejects limits exceeded", () => {
    const rows = Array.from({ length: 201 }, () => ["a"]);
    expect(validateSampleDoc({ title: "x", tables: [{ name: "t", columns: ["a"], rows }] }).ok).toBe(false);
    const secs = Array.from({ length: 31 }, () => ({ heading: "h", paragraphs: [] }));
    expect(validateSampleDoc({ title: "x", sections: secs }).ok).toBe(false);
    expect(validateSampleDoc({ title: "x", sections: [{ heading: "h", paragraphs: ["a".repeat(2001)] }] }).ok).toBe(false);
    const cols = Array.from({ length: 21 }, () => "c");
    expect(validateSampleDoc({ title: "x", tables: [{ name: "t", columns: cols, rows: [] }] }).ok).toBe(false);
  });
});

describe("builders", () => {
  it("docx is a zip with escaped Vietnamese text", () => {
    const buf = buildDocx(good);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const files = unzip(buf);
    expect(files["word/document.xml"]).toContain("Báo cáo Q&amp;A");
    expect(files["[Content_Types].xml"]).toBeDefined();
    expect(files["_rels/.rels"]).toBeDefined();
  });
  it("xlsx has workbook, overview sheet and sanitized names", () => {
    const buf = buildXlsx(good);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const files = unzip(buf);
    expect(files["xl/workbook.xml"]).toContain('name="Tong quan"');
    expect(files["xl/workbook.xml"]).toContain('name="Doanh thu Q1"');
    expect(files["xl/worksheets/sheet1.xml"]).toContain("Doanh thu tăng &amp; ổn định");
    expect(files["xl/worksheets/sheet2.xml"]).toContain('t="inlineStr"');
  });
  it("duplicate sheet names become unique", () => {
    const long = "x".repeat(40);
    const names = sheetNames(["Abc", "abc", long, long + "y", "", ""]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31 && n.length > 0)).toBe(true);
    const doc: SampleDoc = { title: "t", inputSummary: "", sections: [], tables: [
      { name: "Abc", columns: ["a"], rows: [] }, { name: "abc", columns: ["a"], rows: [] }, { name: "Tong quan", columns: ["a"], rows: [] },
    ] };
    const wb = unzip(buildXlsx(doc))["xl/workbook.xml"];
    expect(wb).toContain('name="Abc"');
    expect(wb).toContain('name="abc (2)"');
    expect(wb).toContain('name="Tong quan (2)"');
  });
});
