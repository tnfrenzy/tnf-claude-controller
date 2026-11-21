import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { adoptStagedInbox, inboxPromptNote, INBOX_MAX_BYTES, listInbox, saveInboxFile, validateInboxName } from "../../src/core/run/inbox.js";
import { buildZip } from "../../src/core/app/zip.js";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-inbox-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("inbox", () => {
  it("accepts ASCII names only and refuses traversal / unicode / spaces", () => {
    expect(validateInboxName("spec-v1.md")).toBeNull();
    expect(validateInboxName("A_1.txt")).toBeNull();
    for (const bad of ["", "..", "../x.txt", "a/b.txt", "a\\b.txt", ".hidden", "tệp.txt", "a b.txt", "x".repeat(101)]) expect(validateInboxName(bad)).not.toBeNull();
  });
  it("saves into <runDir>/inbox, enforces the 5 MB cap and lists + describes files", () => {
    const run = tmp();
    const f = saveInboxFile(run, "notes.md", Buffer.from("# hi"));
    expect(f.size).toBe(4);
    expect(fs.readFileSync(path.join(run, "inbox", "notes.md"), "utf8")).toBe("# hi");
    expect(() => saveInboxFile(run, "../evil.txt", Buffer.from("x"))).toThrow(/Tên tệp/);
    expect(() => saveInboxFile(run, "big.bin", Buffer.alloc(INBOX_MAX_BYTES + 1))).toThrow(/quá lớn/);
    expect(() => saveInboxFile(run, "empty.txt", Buffer.alloc(0))).toThrow(/rỗng/);
    expect(fs.existsSync(path.join(run, "evil.txt"))).toBe(false);
    expect(listInbox(run).map((x) => x.name)).toEqual(["notes.md"]);
    const note = inboxPromptNote(run);
    expect(note).toContain("[Tệp đính kèm]");
    expect(note).toContain(`${run.replace(/\\/g, "/")}/inbox/notes.md`);
    expect(inboxPromptNote(tmp())).toBe("");
  });
  it("adopts a staging directory into the run inbox and removes the staging dir", () => {
    const stage = tmp();
    const run = tmp();
    saveInboxFile(stage, "a.txt", Buffer.from("a"));
    fs.writeFileSync(path.join(stage, "inbox", "bad name.txt"), "b");
    const got = adoptStagedInbox(stage, run);
    expect(got.map((x) => x.name)).toEqual(["a.txt"]);
    expect(fs.existsSync(stage)).toBe(false);
    expect(adoptStagedInbox(path.join(run, "nope"), run).length).toBe(1);
  });
});

describe("zip", () => {
  it("writes a readable archive (local headers, central directory, inflatable entries)", () => {
    const text = Buffer.from("hello hello hello hello hello hello\n".repeat(20));
    const zip = buildZip([{ name: "notes/a.txt", data: text, mtime: Date.UTC(2026, 9, 21, 10, 0, 0) }, { name: "b.bin", data: Buffer.from([1, 2, 3]) }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
    // first entry: deflated (method 8), name follows the 30-byte header, then the body
    const nameLen = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLen).toString()).toBe("notes/a.txt");
    const method = zip.readUInt16LE(8);
    const compSize = zip.readUInt32LE(18);
    expect(method).toBe(8);
    expect(compSize).toBeLessThan(text.length);
    const body = zip.subarray(30 + nameLen, 30 + nameLen + compSize);
    expect(inflateRawSync(body).equals(text)).toBe(true);
    // second entry is tiny → stored (method 0)
    const off2 = zip.readUInt32LE(zip.readUInt32LE(zip.length - 22 + 16) + 46 + nameLen + 42);
    expect(zip.readUInt16LE(off2 + 8)).toBe(0);
  });
});
