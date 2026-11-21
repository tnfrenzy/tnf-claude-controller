import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../../ui/src/App.tsx", import.meta.url), "utf8");
const popups = readFileSync(new URL("../../ui/src/components/workshop3d/Design3DPopups.tsx", import.meta.url), "utf8");

describe("App design3d wiring", () => {
  it("polls the hook and passes the tower props (runs + workshop sessions) to CityScene", () => {
    expect(app).toContain("useDesign3DFloors(");
    for (const p of ["design3dFloors=", "onDesign3DFloorClick=", "onAddDesign3DFloor=", "onDesign3DGroundClick=", "design3dSessions=", "onDesign3DSessionClick="]) expect(app).toContain(p);
  });
  it("the request sheet creates a workshop session and opens its room (no longer the command popup)", () => {
    expect(app).toContain('"design3d"');
    expect(app).toContain('"design3dFloor"');
    expect(app).not.toContain('onOpen("cmd", { prompt');
    expect(app).toContain('onCreated={(slug) => { reloadDesign3D(); onOpen("workshop3d", { slug }); }}');
    expect(app).toContain('onDesign3DSessionClick={(slug) => onOpen("workshop3d", { slug })}');
    expect(app).toContain('onDesign3DFloorClick={(id) => onOpen("design3dFloor", { runId: id })}');
  });
  it("design3d branches sit inside the ternary chain, before the final null", () => {
    expect(app.indexOf('"design3dFloor" && runId')).toBeGreaterThan(-1);
    expect(app.indexOf('"design3dFloor" && runId')).toBeLessThan(app.lastIndexOf(": null"));
    expect(app.indexOf('open === "design3d"')).toBeGreaterThan(app.indexOf('open === "addFloor"'));
  });
  it("the old run floor popup still opens outputs", () => {
    expect(popups).toContain("api.openOutput");
  });
});
