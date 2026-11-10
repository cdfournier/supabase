import type { AgentName } from "@/lib/agent-context";

export const DEFAULT_ANTHROPIC_MODEL_BY_AGENT: Record<AgentName, string> = {
  soren: "claude-opus-4-6",
  varro: "claude-sonnet-4-6"
};

const AGENT_MODEL_ENV: Record<AgentName, "ANTHROPIC_MODEL_SOREN" | "ANTHROPIC_MODEL_VARRO"> = {
  soren: "ANTHROPIC_MODEL_SOREN",
  varro: "ANTHROPIC_MODEL_VARRO"
};

export type ModelLaneSource = "agent_override" | "shared_default" | "built_in_default";

export type ModelLane = {
  agent: AgentName;
  provider: "anthropic";
  model: string;
  source: ModelLaneSource;
  source_env: string | null;
  fallback_model: string;
};

/**
 * Resolve an Agent's runtime model once, in one place.
 *
 * A preview migration changes only this process's environment. It does not
 * rewrite an Agent record, memory, restoration profile, capability profile, or
 * conversation. Removing the override and restarting restores the prior lane.
 */
export function modelLaneForAgent(
  agent: AgentName,
  environment: NodeJS.ProcessEnv = process.env
): ModelLane {
  const agentEnv = AGENT_MODEL_ENV[agent];
  const agentOverride = configuredValue(environment[agentEnv]);
  const sharedDefault = configuredValue(environment.ANTHROPIC_MODEL);
  const fallbackModel = DEFAULT_ANTHROPIC_MODEL_BY_AGENT[agent];

  if (agentOverride) {
    return {
      agent,
      provider: "anthropic",
      model: agentOverride,
      source: "agent_override",
      source_env: agentEnv,
      fallback_model: fallbackModel
    };
  }

  if (sharedDefault) {
    return {
      agent,
      provider: "anthropic",
      model: sharedDefault,
      source: "shared_default",
      source_env: "ANTHROPIC_MODEL",
      fallback_model: fallbackModel
    };
  }

  return {
    agent,
    provider: "anthropic",
    model: fallbackModel,
    source: "built_in_default",
    source_env: null,
    fallback_model: fallbackModel
  };
}

export function modelForAgent(agent: AgentName, environment?: NodeJS.ProcessEnv) {
  return modelLaneForAgent(agent, environment).model;
}

function configuredValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
