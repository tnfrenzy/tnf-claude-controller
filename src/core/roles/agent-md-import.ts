// Import an agent markdown file (subagent / SKILL.md / prompt) into the RoleLibrary. No runs, no other side effects.
import { buildImportPreview, MAX_IMPORT_TEXT_BYTES, type AgentMdPreview, type ImportPreviewOptions } from "./agent-md.js";
import { LibraryError, type LibraryItem, type LibraryRole, type RoleLibrary } from "./role-library.js";

export type LibraryImportRequest = {
  text: string;
  dryRun?: boolean;
  filename?: string;
  as?: "role" | "skill" | "prompt";
  id?: string;
};

export type LibraryImportResult = {
  preview: AgentMdPreview;
  created?: { kind: "role"; role: LibraryRole } | { kind: "skill" | "prompt"; item: LibraryItem };
};

export function importAgentMd(lib: RoleLibrary, req: LibraryImportRequest): LibraryImportResult {
  const text = req.text;
  if (typeof text !== "string" || text.trim() === "") throw new LibraryError("Nội dung tệp trống, không có gì để nhập.", 400);
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_TEXT_BYTES) {
    throw new LibraryError(`Nội dung quá lớn (tối đa ${Math.round(MAX_IMPORT_TEXT_BYTES / 1024)} KB).`, 400);
  }

  const cur = lib.list();
  const opts: ImportPreviewOptions = {
    builtinRoles: cur.builtinRoles,
    libraryRoleIds: cur.roles.map((r) => r.id),
    libraryItemCount: cur.items.length,
  };
  if (req.filename !== undefined) opts.filename = req.filename;
  if (req.as !== undefined) opts.as = req.as;
  if (req.id !== undefined) opts.id = req.id;
  const preview = buildImportPreview(text, opts);

  if (req.dryRun) return { preview };

  switch (preview.blocked) {
    case "id_conflict":
      throw new LibraryError(`Mã "${preview.id}" đã trùng với một vai có sẵn hoặc trong thư viện. Hãy đặt mã khác.`, 409);
    case "empty":
      throw new LibraryError("Không nhập được: thiếu mã hợp lệ hoặc nội dung chính (prompt) trống.", 400);
    case "license_not_permissive":
      throw new LibraryError(`Không nhập được: giấy phép "${preview.license ?? ""}" không thuộc nhóm cho phép sao chép.`, 400);
    case "library_full":
      throw new LibraryError("Không nhập được: thư viện đã đầy.", 400);
    default:
      break;
  }

  if (preview.kind === "role") {
    const body: Record<string, unknown> = {
      id: preview.id,
      description: preview.description,
      prompt: preview.prompt,
      tools: preview.tools,
    };
    if (preview.model !== undefined) body["model"] = preview.model;
    return { preview, created: { kind: "role", role: lib.createRole(body) } };
  }
  const item = lib.createItem({ name: preview.name, type: preview.kind, content: preview.prompt, roleIds: [] });
  return { preview, created: { kind: preview.kind, item } };
}
