/** Event types that carry tool names/calls; hidden when the "tool calls" toggle is off. */
export const TOOL_RELATED_TYPES = ["tool.use", "tool.result", "permission.denied", "agent.progress"] as const;

export function isHiddenWhenToolsOff(event: { type: string }): boolean {
  return (TOOL_RELATED_TYPES as readonly string[]).includes(event.type);
}
