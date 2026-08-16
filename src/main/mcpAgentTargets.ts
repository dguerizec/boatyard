export const MCP_AGENT_TARGETS = [
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
  { id: "hermes", label: "Hermes" }
] as const;

export type McpAgentTargetId = typeof MCP_AGENT_TARGETS[number]["id"];

export function isMcpAgentTargetId(value: unknown): value is McpAgentTargetId {
  return MCP_AGENT_TARGETS.some(({ id }) => id === value);
}
