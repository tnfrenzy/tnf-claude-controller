// Output formats of the "Tạo mới" skill training (mirror of src/core/skill-workshop/output-formats.ts, which the server owns).
export type OutputFormat = "docx" | "xlsx" | "pdf" | "html" | "dxf" | "step";

export interface OutputFormatChoice {
  id: OutputFormat;
  label: string;
  /** Opens inside the browser (new tab); the others open with the program Windows associates with the file. */
  viewInBrowser: boolean;
  hint: string;
}

export const OUTPUT_CHOICES: readonly OutputFormatChoice[] = [
  { id: "docx", label: "Word", viewInBrowser: false, hint: "Văn bản, thư, báo cáo" },
  { id: "xlsx", label: "Excel", viewInBrowser: false, hint: "Bảng tính, danh sách" },
  { id: "pdf", label: "PDF", viewInBrowser: true, hint: "Xem được ngay trên trình duyệt; hợp cho bản vẽ 2D và báo cáo" },
  { id: "html", label: "HTML", viewInBrowser: true, hint: "Trang web, xem ngay trên trình duyệt" },
  { id: "dxf", label: "AutoCAD (DXF)", viewInBrowser: false, hint: "Bản vẽ 2D mở bằng AutoCAD; cần đối tượng hình học (đường, tròn, cung, chữ)" },
  { id: "step", label: "SolidWorks (STEP)", viewInBrowser: false, hint: "Mô hình 3D (khối hộp, trụ) mở bằng SolidWorks; cần công cụ CAD đã cài" },
];

export const DEFAULT_OUTPUT_CHOICES: readonly OutputFormat[] = ["docx", "xlsx"];

export function outputLabel(id: string): string {
  return OUTPUT_CHOICES.find((c) => c.id === id)?.label ?? id;
}

/** Toggle one format; the list keeps catalogue order and never becomes empty. */
export function toggleOutput(current: readonly OutputFormat[], id: OutputFormat): OutputFormat[] {
  const has = current.includes(id);
  const next = has ? current.filter((x) => x !== id) : [...current, id];
  if (next.length === 0) return [...current];
  return OUTPUT_CHOICES.map((c) => c.id).filter((x) => next.includes(x));
}
