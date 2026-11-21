import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Several runs and test suites can share one slow machine (parallel controller runs); 10 s made tests flaky under load.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
