import { describe, expect, it } from "vitest";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";
import {
  findDuplicates,
  fileSimilarity,
  jaccard,
  normalizePath,
  normalizeText,
  tokenSimilarity,
  tokenize,
} from "../../src/core/queue/queue-dup.js";

describe("normalizeText", () => {
  it("NFC and NFD give the same result", () => {
    const nfc = "Đăng nhập".normalize("NFC");
    const nfd = "Đăng nhập".normalize("NFD");
    expect(normalizeText(nfc)).toBe(normalizeText(nfd));
  });
  it("strips diacritics and maps đ", () => {
    expect(normalizeText("Đăng nhập")).toBe(normalizeText("dang nhap"));
    expect(normalizeText("Đăng nhập")).toBe("dang nhap");
  });
  it("drops punctuation and collapses spaces", () => {
    expect(normalizeText("  Fix: bug,  login!! ")).toBe("fix bug login");
  });
});

describe("tokenize", () => {
  it("returns unique tokens of length >= 2", () => {
    expect(tokenize("a bb bb cc")).toEqual(["bb", "cc"]);
  });
});

describe("normalizePath", () => {
  it("unifies separators, case and leading ./", () => {
    expect(normalizePath("Src\\Core\\A.ts")).toBe(normalizePath("./src/core/a.ts"));
  });
  it("strips trailing slash and handles empty", () => {
    expect(normalizePath("src/core/")).toBe("src/core");
    expect(normalizePath("")).toBe("");
  });
});

describe("jaccard", () => {
  it("identical = 1", () => expect(jaccard(["a", "b"], ["b", "a"])).toBe(1));
  it("disjoint = 0", () => expect(jaccard(["a"], ["b"])).toBe(0));
  it("both empty = 0", () => expect(jaccard([], [])).toBe(0));
  it("half overlap = 1/3", () => expect(jaccard(["a", "b"], ["b", "c"])).toBe(1 / 3));
});

describe("similarities", () => {
  it("token order does not matter", () => {
    expect(tokenSimilarity("fix login bug", "bug login fix")).toBe(1);
  });
  it("file path style and case do not matter", () => {
    expect(fileSimilarity(["Src\\Core\\A.ts"], ["./src/core/a.ts"])).toBe(1);
  });
  it("ignores empty file entries", () => {
    expect(fileSimilarity(["", "a.ts"], ["a.ts"])).toBe(1);
  });
});

function q(id: string, body: string, over: Partial<QueueCommand> = {}): QueueCommand {
  return { id, project: "p", title: "", body, files: [], status: "chờ duyệt", ...over } as QueueCommand;
}
function nw(body: string, files?: string[], project = "p") {
  return { id: "new", title: "", body, files, project };
}

describe("findDuplicates", () => {
  it("empty queue returns []", () => {
    expect(findDuplicates(nw("aa bb"), [])).toEqual([]);
  });
  it("near-verbatim is high", () => {
    const r = findDuplicates(nw("them dang nhap cho trang chu"), [q("1", "Thêm đăng nhập cho trang chủ!")]);
    expect(r).toHaveLength(1);
    expect(r[0].level).toBe("high");
    expect(r[0].score).toBe(1);
  });
  it("moderate similarity is medium", () => {
    const r = findDuplicates(nw("aa bb cc dd"), [q("1", "aa bb cc ee")]);
    expect(r[0].score).toBe(0.6);
    expect(r[0].level).toBe("medium");
  });
  it("different text returns empty", () => {
    expect(findDuplicates(nw("aa bb cc"), [q("1", "xx yy zz")])).toEqual([]);
  });
  it("other project is ignored", () => {
    expect(findDuplicates(nw("aa bb"), [q("1", "aa bb", { project: "other" })])).toEqual([]);
  });
  it("done/skipped ignored by default, present when statuses given", () => {
    const queue = [q("1", "aa bb", { status: "đã commit" }), q("2", "aa bb", { status: "bỏ qua" })];
    expect(findDuplicates(nw("aa bb"), queue)).toEqual([]);
    const r = findDuplicates(nw("aa bb"), queue, { statuses: ["đã commit", "bỏ qua"] });
    expect(r.map((m) => m.id)).toEqual(["1", "2"]);
  });
  it("empty statuses array means no status filter", () => {
    const r = findDuplicates(nw("aa bb"), [q("1", "aa bb", { status: "đã gộp" })], { statuses: [] });
    expect(r).toHaveLength(1);
  });
  it("shared files raise the score", () => {
    const base = findDuplicates(nw("aa bb cc dd"), [q("1", "aa bb cc ee")])[0];
    const withFiles = findDuplicates(nw("aa bb cc dd", ["src/a.ts"]), [q("1", "aa bb cc ee", { files: ["SRC\\a.ts"] })])[0];
    expect(withFiles.fileScore).toBe(1);
    expect(withFiles.score).toBe(0.72);
    expect(withFiles.score).toBeGreaterThan(base.score);
  });
  it("one side without files: score equals tokenScore", () => {
    const r = findDuplicates(nw("aa bb cc dd", ["src/a.ts"]), [q("1", "aa bb cc ee")])[0];
    expect(r.fileScore).toBe(0);
    expect(r.score).toBe(r.tokenScore);
  });
  it("sorts by score desc then id asc", () => {
    const r = findDuplicates(nw("aa bb cc dd"), [
      q("b", "aa bb cc ee"),
      q("a", "aa bb cc ee"),
      q("c", "aa bb cc dd"),
    ]);
    expect(r.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });
  it("threshold boundaries are inclusive", () => {
    const half = findDuplicates(nw("aa bb"), [q("1", "aa bb cc dd")]);
    expect(half[0].score).toBe(0.5);
    expect(half[0].level).toBe("medium");
    expect(findDuplicates(nw("aa bb"), [q("1", "aa bb cc dd")], { mediumThreshold: 0.51 })).toEqual([]);
    const eighty = findDuplicates(nw("aa bb cc dd"), [q("1", "aa bb cc dd ee")]);
    expect(eighty[0].score).toBe(0.8);
    expect(eighty[0].level).toBe("high");
    const lower = findDuplicates(nw("aa bb cc dd"), [q("1", "aa bb cc dd ee")], { highThreshold: 0.81 });
    expect(lower[0].level).toBe("medium");
  });
});
