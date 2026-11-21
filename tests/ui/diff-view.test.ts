import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView, parseDiffStat, parsePatch } from "../../ui/src/components/run/DiffView.js";

const STAT = ` README.md         |  1 +
 src/cli.js        | 12 ++++++++++++
 tests/cli.test.js | 28 ++++++++++++++++++++++++++++
 3 files changed, 41 insertions(+)
`;

const PATCH = `diff --git a/README.md b/README.md
index 21b4b6b..e50e26c 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # spike-repo

 Throwaway repo.
+Usage: node src/cli.js version
diff --git a/src/cli.js b/src/cli.js
new file mode 100644
index 0000000..81b29be
--- /dev/null
+++ b/src/cli.js
@@ -0,0 +1,2 @@
+const a = 1;
+export default a;
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
`;

describe("Diff tab parsers (pure, UI)", () => {
  it("parses git diff --stat rows and the summary line", () => {
    const { rows, summary } = parseDiffStat(STAT);
    expect(rows.map((r) => r.path)).toEqual(["README.md", "src/cli.js", "tests/cli.test.js"]);
    expect(rows[1]).toEqual({ path: "src/cli.js", added: 12, deleted: 0 });
    expect(summary).toBe("3 files changed, 41 insertions(+)");
  });
  it("splits a unified diff per file with +/- counts, headers kept apart from body lines", () => {
    const files = parsePatch(PATCH);
    expect(files.map((f) => f.path)).toEqual(["README.md", "src/cli.js", "old.txt"]);
    expect(files[0]!.added).toBe(1);
    expect(files[0]!.header).toHaveLength(4);
    expect(files[0]!.lines[0]!.kind).toBe("hunk");
    expect(files[1]!.header.some((h) => h.startsWith("new file"))).toBe(true);
    expect(files[1]!.added).toBe(2);
    expect(files[2]!.deleted).toBe(1);
    // a "---" inside the body (not a header) is a deletion, not a header line
    const tricky = parsePatch("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- old\n+new\n");
    expect(tricky[0]!.deleted).toBe(1);
    expect(tricky[0]!.added).toBe(1);
  });
  it("shows line numbers and click targets only when onLineClick is given", () => {
    const p = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -10,5 +10,5 @@\n a\n-b\n+B\n c\n\n d\n";
    const clicks: unknown[] = [];
    const html = renderToStaticMarkup(
      createElement(DiffView, {
        patch: p,
        onLineClick: (f, l, s) => clicks.push([f, l, s]),
        comments: [{ file: "f.txt", line: 11, side: "old", text: "x" }],
      }),
    );
    const cells = [...html.matchAll(/data-line="(\d+)" data-side="(old|new)"/g)].map((m) => [Number(m[1]), m[2]]);
    // ctx a (10), del b (old 11), add B (new 11), ctx c (12), empty mid-hunk ctx (13), ctx d (14); trailing empty dropped
    expect(cells).toEqual([[10, "new"], [11, "old"], [11, "new"], [12, "new"], [13, "new"], [14, "new"]]);
    expect(html.match(/<span class="ln">/g)).toHaveLength(7); // hunk row has an empty gutter
    expect(html.match(/class="dl hunk"/g)).toHaveLength(1);
    expect(html).not.toMatch(/dl hunk clickable/);
    // only the old-side line 11 (the deletion) is marked as commented
    expect(html.match(/has-comment/g)).toHaveLength(1);
    expect(html).toMatch(/dl del clickable has-comment" data-line="11" data-side="old"/);
    // without onLineClick the old markup is kept
    const plain = renderToStaticMarkup(createElement(DiffView, { patch: p }));
    expect(plain).not.toContain("data-line");
    expect(plain).not.toContain('class="ln"');
  });
  it("renders renderAfterLine content right after the matching clickable line only", () => {
    const p = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -10,2 +10,2 @@\n a\n-b\n+B\n";
    const calls: string[] = [];
    const html = renderToStaticMarkup(
      createElement(DiffView, {
        patch: p,
        onLineClick: () => {},
        renderAfterLine: (f, l, s) => {
          calls.push(`${f}:${l}:${s}`);
          return f === "f.txt" && l === 11 && s === "old" ? createElement("i", { id: "box" }, "BOX") : null;
        },
      }),
    );
    // hunk header is never offered to renderAfterLine
    expect(calls).toEqual(["f.txt:10:new", "f.txt:11:old", "f.txt:11:new"]);
    expect(html).toMatch(/data-line="11" data-side="old"[^>]*>.*?<\/div><div class="dl-inline"><i id="box">BOX<\/i><\/div><div class="dl add/);
    expect(html.match(/dl-inline/g)).toHaveLength(1);
    const plain = renderToStaticMarkup(createElement(DiffView, { patch: p, onLineClick: () => {} }));
    expect(plain).not.toContain("dl-inline");
  });
  it("tolerates an empty or non-diff text", () => {
    expect(parsePatch("")).toEqual([]);
    expect(parseDiffStat("").rows).toEqual([]);
  });
});
