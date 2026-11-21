/**
 * Builds minimal .docx / .xlsx sample files (OOXML) from a structured SampleDoc.
 * No dependency: zip via src/core/app/zip.ts. Pure functions, Vietnamese error messages.
 */
import { buildZip, type ZipEntry } from "../app/zip.js";
import { isObj } from "../app/util.js";

export interface SampleSection { heading: string; paragraphs: string[] }
export interface SampleTable { name: string; columns: string[]; rows: string[][] }
export interface SampleDoc { title: string; inputSummary: string; sections: SampleSection[]; tables: SampleTable[] }

export const SAMPLE_LIMITS = { sections: 30, tables: 20, rows: 200, columns: 20, cell: 2000 } as const;

type Validated = { ok: true; value: SampleDoc } | { ok: false; error: string };

export function validateSampleDoc(raw: unknown): Validated {
  const fail = (error: string): Validated => ({ ok: false, error });
  if (!isObj(raw)) return fail("Mẫu phải là một đối tượng JSON.");
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return fail("Thiếu tiêu đề (title) của mẫu.");
  const inputSummary = typeof raw.inputSummary === "string" ? raw.inputSummary : "";
  const secRaw = raw.sections === undefined ? [] : raw.sections;
  const tabRaw = raw.tables === undefined ? [] : raw.tables;
  if (!Array.isArray(secRaw)) return fail("sections phải là mảng.");
  if (!Array.isArray(tabRaw)) return fail("tables phải là mảng.");
  if (secRaw.length > SAMPLE_LIMITS.sections) return fail(`Quá ${SAMPLE_LIMITS.sections} mục.`);
  if (tabRaw.length > SAMPLE_LIMITS.tables) return fail(`Quá ${SAMPLE_LIMITS.tables} bảng.`);
  const tooLong = (s: string): boolean => s.length > SAMPLE_LIMITS.cell;
  const sections: SampleSection[] = [];
  for (const s of secRaw) {
    if (!isObj(s) || typeof s.heading !== "string") return fail("Mỗi mục cần có heading dạng chuỗi.");
    const paras = s.paragraphs === undefined ? [] : s.paragraphs;
    if (!Array.isArray(paras) || paras.some((p) => typeof p !== "string")) return fail("paragraphs phải là mảng chuỗi.");
    if (tooLong(s.heading) || (paras as string[]).some(tooLong)) return fail(`Một ô văn bản dài quá ${SAMPLE_LIMITS.cell} ký tự.`);
    sections.push({ heading: s.heading, paragraphs: paras as string[] });
  }
  const tables: SampleTable[] = [];
  for (const t of tabRaw) {
    if (!isObj(t) || typeof t.name !== "string") return fail("Mỗi bảng cần có name dạng chuỗi.");
    if (!Array.isArray(t.columns) || t.columns.some((c) => typeof c !== "string")) return fail("columns phải là mảng chuỗi.");
    if (!Array.isArray(t.rows)) return fail("rows phải là mảng.");
    if (t.columns.length > SAMPLE_LIMITS.columns) return fail(`Bảng có quá ${SAMPLE_LIMITS.columns} cột.`);
    if (t.rows.length > SAMPLE_LIMITS.rows) return fail(`Bảng có quá ${SAMPLE_LIMITS.rows} hàng.`);
    const rows: string[][] = [];
    for (const r of t.rows) {
      if (!Array.isArray(r) || r.length > SAMPLE_LIMITS.columns) return fail("Mỗi hàng phải là mảng ô hợp lệ.");
      const cells = r.map((c) => (typeof c === "string" ? c : c == null ? "" : String(c)));
      if (cells.some(tooLong)) return fail(`Một ô dài quá ${SAMPLE_LIMITS.cell} ký tự.`);
      rows.push(cells);
    }
    if ((t.columns as string[]).some(tooLong)) return fail(`Một ô dài quá ${SAMPLE_LIMITS.cell} ký tự.`);
    tables.push({ name: t.name, columns: t.columns as string[], rows });
  }
  if (sections.length === 0 && tables.length === 0) return fail("Mẫu cần ít nhất một mục hoặc một bảng.");
  if (tooLong(title) || tooLong(inputSummary)) return fail(`Tiêu đề hoặc tóm tắt đầu vào dài quá ${SAMPLE_LIMITS.cell} ký tự.`);
  return { ok: true, value: { title, inputSummary, sections, tables } };
}

/** Escape XML and drop characters illegal in XML 1.0. */
export function xmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
  return clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Unique, Excel-safe sheet names (<= 31 chars, no []:*?/\, case-insensitive unique). */
export function sheetNames(names: string[], reserved: string[] = []): string[] {
  const used = new Set(reserved.map((n) => n.toLowerCase()));
  return names.map((raw, i) => {
    let base = raw.replace(/[\[\]:*?/\\]/g, "").trim().slice(0, 31).trim();
    if (!base) base = `Bang ${i + 1}`;
    let name = base;
    let k = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${k++})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const entry = (name: string, xml: string): ZipEntry => ({ name, data: Buffer.from(XML_HEAD + xml, "utf8") });

function wPara(text: string, style?: string, bold = false): string {
  const ppr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const rpr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`;
}

function wTable(t: SampleTable): string {
  const cell = (c: string, bold: boolean) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${wPara(c, undefined, bold)}</w:tc>`;
  const row = (cells: string[], bold: boolean) => `<w:tr>${cells.map((c) => cell(c, bold)).join("")}</w:tr>`;
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${row(t.columns, true)}${t.rows.map((r) => row(r, false)).join("")}</w:tbl>`;
}

export function buildDocx(doc: SampleDoc): Buffer {
  const body: string[] = [wPara(doc.title, "Title", true)];
  if (doc.inputSummary) body.push(wPara(doc.inputSummary));
  for (const s of doc.sections) {
    body.push(wPara(s.heading, "Heading1", true));
    for (const p of s.paragraphs) body.push(wPara(p));
  }
  for (const t of doc.tables) {
    body.push(wPara(t.name, "Heading2", true), wTable(t), wPara(""));
  }
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return buildZip([
    entry("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    entry("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    entry("word/document.xml", `<w:document ${ns}><w:body>${body.join("")}<w:sectPr/></w:body></w:document>`),
  ]);
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(rows: string[][]): string {
  const data = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlText(c)}</t></is></c>`).join("")}</row>`)
    .join("");
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`;
}

export const OVERVIEW_SHEET = "Tong quan";

export function buildXlsx(doc: SampleDoc): Buffer {
  const overview: string[][] = [[doc.title]];
  if (doc.inputSummary) overview.push([doc.inputSummary]);
  for (const s of doc.sections) {
    overview.push([s.heading]);
    for (const p of s.paragraphs) overview.push([p]);
  }
  const names = [OVERVIEW_SHEET, ...sheetNames(doc.tables.map((t) => t.name), [OVERVIEW_SHEET])];
  const sheets: string[] = [sheetXml(overview), ...doc.tables.map((t) => sheetXml([t.columns, ...t.rows]))];
  const entries: ZipEntry[] = [
    entry("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    entry("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    entry("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    entry("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
    ...sheets.map((x, i) => entry(`xl/worksheets/sheet${i + 1}.xml`, x)),
  ];
  return buildZip(entries);
}
