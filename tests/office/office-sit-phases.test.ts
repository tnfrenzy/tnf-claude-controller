import { describe, expect, it } from "vitest";
import { WIDE } from "../../ui/src/office/layout";
import { isoLabelsFrom } from "../../ui/src/office/iso/scene";
import { dicts } from "../../ui/src/i18n";
import { createStaff, deskPlace, leisurePlaces, seededRng, staffView, tickStaff } from "../../ui/src/office/staff";

const labels = isoLabelsFrom(dicts.vi as unknown as Record<string, string>);

describe("sit and stand transitions", () => {
  it("walks, sits down, then is seated; never walking next to seated", () => {
    const rng = seededRng(2);
    const list = createStaff(WIDE, 0, rng);
    const s = list[1]!;
    const sofa = leisurePlaces(WIDE).find((p) => p.pose !== "stand")!;
    // leave the desk to the sofa, then come back
    s.until = 0;
    const phases: string[] = [];
    const seenSit: number[] = [];
    let walkOnlyWalking = true;
    // force walk back to desk from the sofa
    s.at = sofa;
    s.route = [sofa.pos];
    s.arriveAt = 0;
    s.startedAt = 0;
    s.job = "x";
    tickStaff(list, WIDE, 1000, rng, labels);
    for (let t = 1000; t < 40000; t += 20) {
      tickStaff(list, WIDE, t, rng, labels);
      const v = staffView(s, t);
      if (v.walking !== (v.phase === "walking")) walkOnlyWalking = false;
      if (phases[phases.length - 1] !== v.phase) phases.push(v.phase);
      if (v.phase === "sitting-down") seenSit.push(v.sitT);
    }
    expect(phases).toEqual(["standing-up", "walking", "sitting-down", "seated"]);
    expect(walkOnlyWalking).toBe(true);
    for (let i = 1; i < seenSit.length; i++) expect(seenSit[i]!).toBeGreaterThanOrEqual(seenSit[i - 1]!);
    const end = staffView(s, 40000);
    const desk = deskPlace(s.resident, WIDE);
    expect(end.pos).toEqual(desk.pos);
    expect(end.sitT).toBe(1);
    expect(end.pose).toBe(desk.pose);
  });
});
