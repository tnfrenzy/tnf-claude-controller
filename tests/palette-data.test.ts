import { describe, expect, it, vi } from "vitest";
import type { api } from "../ui/src/api.js";
import { loadPaletteData } from "../ui/src/paletteData.js";

type Client = Pick<typeof api, "projects">;

const projects = [{ name: "p1" }];

function make(over: { projects?: () => unknown } = {}) {
  const proj = vi.fn(over.projects ?? (async () => ({ projects })));
  return { client: { projects: proj } as unknown as Client, proj };
}

describe("loadPaletteData", () => {
  it("returns projects on success", async () => {
    const { client } = make();
    expect(await loadPaletteData(client)).toEqual({ projects });
  });

  it("returns empty projects when projects rejects", async () => {
    const { client } = make({ projects: async () => { throw new Error("boom"); } });
    expect(await loadPaletteData(client)).toEqual({ projects: [] });
  });

  it("treats synchronous throws as empty", async () => {
    const { client } = make({ projects: () => { throw new Error("sync"); } });
    expect(await loadPaletteData(client)).toEqual({ projects: [] });
  });
});
