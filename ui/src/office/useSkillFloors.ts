import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { skillsToFloors } from "./floors";
import type { SkillFloor } from "./floors";

/** Skill floors from GET /api/skills, refreshed on a timer (no WebSocket). */
export function useSkillFloors(intervalMs = 5000): { floors: SkillFloor[]; reload: () => void } {
  const [floors, setFloors] = useState<SkillFloor[]>([]);
  const load = useCallback(async () => {
    try {
      const { skills } = await api.skills();
      setFloors(skillsToFloors(skills));
    } catch {
      /* keep the previous state; the next tick retries */
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);
  return { floors, reload: () => void load() };
}
