import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// RunTable (RunsPage) now delegates to the shared RunTree component, which renders the cards.
const runsPageFile = readFileSync("ui/src/pages/RunsPage.tsx", "utf8");
const runsPage = "export function RunTable\n" + readFileSync("ui/src/components/run/RunTree.tsx", "utf8");
const history = readFileSync("ui/src/pages/HistoryPage.tsx", "utf8");
const css = readFileSync("ui/src/styles.css", "utf8");

function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
}

describe("run list is cards, not a table", () => {
  it("RunTable renders a list of cards with an icon, a clamped prompt and one meta line", () => {
    const fn = runsPage.slice(runsPage.indexOf("export function RunTable"));
    expect(fn).toContain("className={`run-list");
    expect(fn).toContain("run-card");
    expect(fn).toContain("run-ico");
    expect(fn).toContain("run-prompt");
    expect(fn).toContain("run-meta-line");
    expect(fn).not.toContain("<table");
    expect(fn).not.toContain("<th");
  });
  it("the status icon is labelled for assistive tech and tooltip", () => {
    expect(runsPage).toMatch(/role="img" aria-label=\{label\} title=\{label\}/);
  });
  it("no column headers for cost, turns, duration remain in the run list", () => {
    const fn = runsPage.slice(runsPage.indexOf("export function RunTable"));
    expect(fn).not.toContain("t.turns");
    expect(fn).not.toContain("t.duration");
  });
  it("HistoryPage still uses the shared list and keeps the cost-by-day panel", () => {
    expect(history).toContain("<RunTable runs={runs} />");
    expect(history).toContain("t.cost_by_day");
  });
});

describe("run threads (root + follow-ups in one row)", () => {
  const tree = readFileSync("ui/src/components/run/RunTree.tsx", "utf8");
  it("RunTable delegates to RunTree and HistoryPage pages by thread", () => {
    expect(runsPageFile).toContain("<RunTree runs={runs} showProject={showProject} />");
    expect(history).toContain("threads: true");
  });
  it("the disclosure is a real button with aria-expanded / aria-controls; replies are indented and numbered", () => {
    expect(tree).toContain('type="button"');
    expect(tree).toContain("aria-expanded={open}");
    expect(tree).toContain("aria-controls={listId}");
    expect(tree).toContain('className="run-replies"');
    expect(tree).toContain("t.tree_reply");
    expect(tree).toContain("t.tree_replies");
  });
  it("open state comes from threadIsOpen + prefs (localStorage), not sessionStorage", () => {
    expect(tree).toContain("threadIsOpen(th, saved)");
    expect(tree).toContain("loadRunTreeOpen");
    expect(tree).toContain("saveRunTreeOpen");
    expect(tree).not.toContain("sessionStorage");
  });
  it("replies sit behind a vertical rule and shrink their indent on narrow screens", () => {
    expect(rule(".run-replies")).toContain("border-left");
    expect(css).toMatch(/\.run-replies, \.has-threads \.run-replies \{ margin-left: 12px;/);
  });
  it("IdeaHistoryModal shows follow-up runs indented under the command's run", () => {
    const idea = readFileSync("ui/src/components/queue/IdeaHistoryModal.tsx", "utf8");
    expect(idea).toContain("run-replies");
    expect(idea).toContain("t.tree_reply");
  });
});

describe("run list css", () => {
  it("prompt is clamped to 2 lines and never splits a word per line", () => {
    const r = rule(".run-prompt");
    expect(r).toContain("-webkit-line-clamp: 2");
    expect(r).toContain("overflow-wrap: anywhere");
  });
  it("meta items do not wrap inside themselves", () => {
    expect(rule(".run-meta-line")).toContain("white-space: nowrap");
    expect(rule(".run-role")).toContain("white-space: nowrap");
    expect(rule(".run-chip")).toContain("white-space: nowrap");
  });
  it("the card grid has a flexible text column that can shrink", () => {
    expect(rule(".run-card")).toContain("minmax(0, 1fr)");
  });
  it("pulse animation is switched off for reduced motion and the old table rules are gone", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.run-ico\.pulse \{ animation: none; \} \}/);
    expect(css).not.toContain(".run-table");
  });
  it("narrow screens move the project chip under the text instead of squeezing the columns", () => {
    expect(css).toMatch(/@media \(max-width: 480px\) \{\s*\.run-card \{ grid-template-columns: 28px minmax\(0, 1fr\) auto; \}/);
  });
});
