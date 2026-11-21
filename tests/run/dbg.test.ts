import { expect, it } from "vitest";
import { createScene, isoLabelsFrom } from "../../ui/src/office/iso/scene.js";

// Placeholder left from debugging (could not be deleted by the implementer); safe to remove.
it("createScene with empty labels does not throw", () => {
  expect(createScene(["a"], () => 0.5, isoLabelsFrom({})).agents.length).toBe(2);
});
