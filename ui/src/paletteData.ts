import type { api } from "./api";
import type { PaletteData } from "./palette";

type PaletteClient = Pick<typeof api, "projects">;

export async function loadPaletteData(client: PaletteClient): Promise<PaletteData> {
  const p = await Promise.resolve().then(() => client.projects()).catch(() => null);
  return { projects: p?.projects ?? [] };
}
