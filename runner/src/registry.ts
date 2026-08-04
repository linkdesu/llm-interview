import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { parse } from "smol-toml";

/**
 * A local LLM model entry in the registry.
 */
export interface RegistryModel {
  name: string;
  provider: string;
  modelId: string;
  params: Record<string, string | number | boolean>;
  /**
   * Optional per-model override of the global max turn limit.
   * Give weaker models more turns to attempt the task.
   */
  maxTurns?: number;
  notes?: string;
}

/**
 * The optional [loop_detector] section: when present, work invocations are
 * supervised for non-productive repetition loops (see loop-detector.ts).
 * Section absent = feature disabled.
 */
export interface LoopDetectorConfig {
  /** Supervisor provider name in <piHome>/models.json (e.g. "ornith"). */
  provider: string;
  /** Supervisor model id (e.g. "ai-01/ornith-1.0-35b-5"). */
  modelId: string;
  /** Judge every `step` new tool calls (default 5; > 10 acts as spot-check). */
  step: number;
  /** Minimum verdict confidence that kills the Combo (default 80). */
  confidenceThreshold: number;
}

/**
 * Full runner configuration loaded from config.toml.
 */
export interface RunnerConfig {
  models: RegistryModel[];
  maxTurns: number;
  /**
   * Heartbeat interval in seconds: how often the console prints a
   * "(running)" line per in-flight Combo during long turns. Optional
   * (`heartbeat_seconds` in config.toml), defaults to 60 when absent.
   */
  heartbeatSeconds: number;
  runRules: string;
  configDir: string;
  /** Loop detection settings, or undefined when the section is absent. */
  loopDetector?: LoopDetectorConfig;
}

function toPrimitive(v: unknown): string | number | boolean {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v == null) return "";
  try { return JSON.stringify(v); } catch { return String(v); }
}

function validateModels(rawModels: unknown[]): RegistryModel[] {
  const names = new Set<string>();
  const result: RegistryModel[] = [];

  for (let i = 0; i < rawModels.length; i++) {
    const entry = rawModels[i] as Record<string, unknown>;
    const label = `models[${i}]`;

    const name = String(entry.name ?? "");
    if (!name.trim()) throw new Error(`Invalid entry at ${label}: "name" must be a non-empty string`);
    if (names.has(name)) throw new Error(`Invalid entry at ${label}: duplicate name "${name}"`);
    names.add(name);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error(`Invalid entry at ${label}: "name" must be path-safe, got "${name}"`);
    }

    const provider = String(entry.provider ?? "");
    if (!provider.trim()) throw new Error(`Invalid entry at ${label}: "provider" must be a non-empty string`);

    const modelId = String(entry.modelId ?? "");
    if (!modelId.trim()) throw new Error(`Invalid entry at ${label}: "modelId" must be a non-empty string`);

    let params: Record<string, string | number | boolean> = {};
    if (entry.params != null && typeof entry.params === "object") {
      const raw = entry.params as Record<string, unknown>;
      params = {};
      for (const k of Object.keys(raw)) {
        params[k] = toPrimitive(raw[k]);
      }
    }

    let maxTurns: number | undefined;
    if (entry.max_turns != null) {
      if (
        typeof entry.max_turns !== "number" ||
        !Number.isInteger(entry.max_turns) ||
        entry.max_turns < 1
      ) {
        throw new Error(`Invalid entry at ${label}: "max_turns" must be a positive integer`);
      }
      maxTurns = entry.max_turns;
    }

    result.push({
      name,
      provider,
      modelId,
      params,
      maxTurns,
      notes: typeof entry.notes === "string" ? entry.notes : undefined,
    });
  }

  return result;
}

function validateLoopDetector(raw: unknown): LoopDetectorConfig {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const label = "[loop_detector]";

  const provider = String(entry.provider ?? "");
  if (!provider.trim()) throw new Error(`Invalid config ${label}: "provider" must be a non-empty string`);

  const modelId = String(entry.modelId ?? "");
  if (!modelId.trim()) throw new Error(`Invalid config ${label}: "modelId" must be a non-empty string`);

  let step = 5;
  if (entry.step != null) {
    if (typeof entry.step !== "number" || !Number.isInteger(entry.step) || entry.step < 1) {
      throw new Error(`Invalid config ${label}: "step" must be a positive integer`);
    }
    step = entry.step;
  }

  let confidenceThreshold = 80;
  if (entry.confidence_threshold != null) {
    const c = entry.confidence_threshold;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > 100) {
      throw new Error(`Invalid config ${label}: "confidence_threshold" must be an integer between 1 and 100`);
    }
    confidenceThreshold = c;
  }

  return { provider, modelId, step, confidenceThreshold };
}

/**
 * Load and validate the full runner configuration from a TOML file.
 */
export async function loadConfig(path: string): Promise<RunnerConfig> {
  const raw = await readFile(path, "utf-8");
  const data = parse(raw) as Record<string, unknown>;
  const configDir = resolve(dirname(path));

  if (!Array.isArray(data.models)) {
    throw new Error(`Invalid config: "models" array is missing or not an array`);
  }
  const models = validateModels(data.models);

  const maxTurns = typeof data.max_turns === "number" ? data.max_turns : 100;

  const heartbeatSeconds =
    typeof data.heartbeat_seconds === "number" && data.heartbeat_seconds > 0
      ? data.heartbeat_seconds
      : 60;

  let runRules = "";
  const runRulesPath = String(data.run_rules ?? "");
  if (runRulesPath.trim()) {
    try {
      runRules = await readFile(join(configDir, runRulesPath.trim()), "utf-8");
    } catch {
      runRules = "";
    }
  }

  const loopDetector =
    data.loop_detector != null ? validateLoopDetector(data.loop_detector) : undefined;

  return { models, maxTurns, heartbeatSeconds, runRules, configDir, loopDetector };
}

/**
 * Load only the model registry part (backward-compat).
 */
export async function loadRegistry(path: string): Promise<RegistryModel[]> {
  const config = await loadConfig(path);
  return config.models;
}


