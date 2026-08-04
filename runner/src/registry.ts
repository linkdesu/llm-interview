import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { parse } from "smol-toml";
import type { LoopDetectorConfig } from "./loop-detector";

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
  /**
   * Loop detection (issue #21): the optional [loop_detector] section.
   * Absent = feature disabled, zero behavior change.
   */
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

  return { models, maxTurns, heartbeatSeconds, runRules, configDir, loopDetector: parseLoopDetectorSection(data.loop_detector) };
}

/**
 * Parse the optional [loop_detector] section (issue #21). provider and
 * modelId are required; step defaults to 5, confidence_threshold to 80.
 */
function parseLoopDetectorSection(raw: unknown): LoopDetectorConfig | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid config: "loop_detector" must be a table`);
  }
  const section = raw as Record<string, unknown>;

  const provider = String(section.provider ?? "");
  if (!provider.trim()) {
    throw new Error(`Invalid config: "loop_detector.provider" must be a non-empty string`);
  }
  const modelId = String(section.modelId ?? "");
  if (!modelId.trim()) {
    throw new Error(`Invalid config: "loop_detector.modelId" must be a non-empty string`);
  }

  let step = 5;
  if (section.step != null) {
    if (
      typeof section.step !== "number" ||
      !Number.isInteger(section.step) ||
      section.step < 1
    ) {
      throw new Error(`Invalid config: "loop_detector.step" must be a positive integer`);
    }
    step = section.step;
  }

  let confidenceThreshold = 80;
  if (section.confidence_threshold != null) {
    if (
      typeof section.confidence_threshold !== "number" ||
      section.confidence_threshold < 0 ||
      section.confidence_threshold > 100
    ) {
      throw new Error(`Invalid config: "loop_detector.confidence_threshold" must be a number between 0 and 100`);
    }
    confidenceThreshold = section.confidence_threshold;
  }

  return { provider, modelId, step, confidenceThreshold };
}

/**
 * Load only the model registry part (backward-compat).
 */
export async function loadRegistry(path: string): Promise<RegistryModel[]> {
  const config = await loadConfig(path);
  return config.models;
}


