import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/core/roles/agent-md.js";

// Decisions: body keeps everything after the closing line verbatim (no blank-line
// stripping), normalized to LF. Without frontmatter, body is the original text.
describe("parseFrontmatter", () => {
  it("parses a standard subagent file", () => {
    const text = "---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\nmodel: sonnet\n---\nYou review.\n";
    const r = parseFrontmatter(text);
    expect(r.hasFrontmatter).toBe(true);
    expect(r.meta).toEqual({ name: "reviewer", description: "Reviews code", tools: "Read, Grep", model: "sonnet" });
    expect(r.body).toBe("You review.\n");
  });

  it("parses inline array tools", () => {
    const r = parseFrontmatter("---\ntools: [Read, Grep]\n---\nx");
    expect(r.meta.tools).toEqual(["Read", "Grep"]);
  });

  it("parses block list tools", () => {
    const r = parseFrontmatter("---\nname: a\ntools:\n  - Read\n  - Grep\nmodel: opus\n---\nx");
    expect(r.meta.tools).toEqual(["Read", "Grep"]);
    expect(r.meta.model).toBe("opus");
  });

  it("handles CRLF and BOM", () => {
    const r = parseFrontmatter("﻿---\r\nname: a\r\ntools: Read\r\n---\r\nline1\r\nline2\r\n");
    expect(r.hasFrontmatter).toBe(true);
    expect(r.meta).toEqual({ name: "a", tools: "Read" });
    expect(r.body).toBe("line1\nline2\n");
  });

  it("returns the original text when there is no frontmatter", () => {
    const text = "# Title\n\nhello\n";
    expect(parseFrontmatter(text)).toEqual({ hasFrontmatter: false, meta: {}, body: text });
  });

  it("treats unclosed frontmatter as none", () => {
    const text = "---\nname: a\nbody never closed\n";
    expect(parseFrontmatter(text)).toEqual({ hasFrontmatter: false, meta: {}, body: text });
  });

  it("joins folded and literal multiline descriptions", () => {
    const folded = parseFrontmatter("---\ndescription: >\n  one\n  two\nname: a\n---\n");
    expect(folded.meta.description).toBe("one two");
    expect(folded.meta.name).toBe("a");
    const literal = parseFrontmatter("---\ndescription: |\n  one\n  two\n---\n");
    expect(literal.meta.description).toBe("one\ntwo");
  });

  it("lowercases keys", () => {
    const r = parseFrontmatter("---\nName: a\nMODEL: sonnet\n---\n");
    expect(r.meta).toEqual({ name: "a", model: "sonnet" });
  });

  it("strips surrounding quotes", () => {
    const r = parseFrontmatter("---\nname: \"a b\"\ndescription: 'c: d'\n---\n");
    expect(r.meta).toEqual({ name: "a b", description: "c: d" });
  });

  it("skips malformed lines without throwing", () => {
    const r = parseFrontmatter("---\nname: a\nnonsense line\n: nokey\n# comment\n  orphan\nmodel: sonnet\n---\n");
    expect(r.meta).toEqual({ name: "a", model: "sonnet" });
  });
});
