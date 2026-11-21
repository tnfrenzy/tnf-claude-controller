import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/core/release/redact.js";

describe("redactSecrets", () => {
  it("masks tokens and passwords", () => {
    expect(redactSecrets("x ghp_abcdefghijklmnop1234 y")).not.toContain("ghp_abcdefghij");
    expect(redactSecrets("github_pat_11ABCDEFG0abcdefghij_xyz")).toBe("[ẩn]");
    expect(redactSecrets("key sk-ant-abcdef123456789")).not.toContain("abcdef123456");
    expect(redactSecrets("Authorization: Bearer abc.def-123456")).toBe("Authorization: Bearer [ẩn]");
    expect(redactSecrets("password=hunter2 ok")).toBe("password=[ẩn] ok");
    expect(redactSecrets("TOKEN: s3cr3tvalue")).toBe("TOKEN: [ẩn]");
  });
  it("keeps normal text", () => {
    expect(redactSecrets("npm run build:ui done in 3s")).toBe("npm run build:ui done in 3s");
  });
});
