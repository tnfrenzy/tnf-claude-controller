import { describe, expect, it } from "vitest";
import { clampPage, pageCount, pageOffset } from "../../ui/src/lib/pagination";

describe("history pagination", () => {
  it("pageCount", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(25, 10)).toBe(3);
    expect(pageCount(10, 10)).toBe(1);
    expect(pageCount(11, 10)).toBe(2);
  });
  it("pageOffset", () => {
    expect(pageOffset(1, 10)).toBe(0);
    expect(pageOffset(3, 10)).toBe(20);
    expect(pageOffset(0, 10)).toBe(0);
  });
  it("clampPage when total shrinks", () => {
    expect(clampPage(3, 25, 10)).toBe(3);
    expect(clampPage(3, 15, 10)).toBe(2);
    expect(clampPage(5, 0, 10)).toBe(1);
    expect(clampPage(-2, 25, 10)).toBe(1);
  });
});
