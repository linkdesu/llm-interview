import { readFileSync } from "node:fs";

/**
 * A local LLM model entry in the registry.
 * Records the model identity and a snapshot of its server-side sampling parameters.
 */
export interface RegistryModel {
  /** Unique kebab-case identifier for this model (used in paths and IDs). */
  name: string;
  /** Pi provider name (e.g., "llamacpp-local"). */
  provider: string;
  /** The model id sent to the API. */
  modelId: string;
  /** Free-form sampling parameter snapshot (e.g., thinking, temp, top_k). */
  params: Record<string, string | number | boolean>;
  /** Optional human-readable notes about the model or its parameters. */
  notes?: string;
}

interface RawRegistryModel {
  name?: unknown;
  provider?: unknown;
  modelId?: unknown;
  params?: unknown;
  notes?: unknown;
}

interface RawRegistry {
  models?: unknown;
}

/**
 * Load and validate a model registry JSON file.
 * @param path - Path to the models.registry.json file.
 * @returns Array of validated RegistryModel entries.
 * @throws Error if the file is invalid or contains malformed entries.
 */
export async function loadRegistry(path: string): Promise<RegistryModel[]> {
  const raw = readFileSync(path, "utf-8");
  const data: RawRegistry = JSON.parse(raw);

  if (!data.models || !Array.isArray(data.models)) {
    throw new Error(`Invalid registry: top-level "models" array is missing or not an array`);
  }

  const names = new Set<string>();
  const result: RegistryModel[] = [];

  for (let i = 0; i < data.models.length; i++) {
    const entry = data.models[i] as RawRegistryModel;
    const entryLabel = `models[${i}]`;

    // Validate name
    if (typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error(`Invalid entry at ${entryLabel}: "name" must be a non-empty string`);
    }

    if (names.has(entry.name)) {
      throw new Error(`Invalid entry at ${entryLabel}: duplicate name "${entry.name}"`);
    }
    names.add(entry.name);

    // Names are used in filesystem paths and URLs — require path-safe characters
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)) {
      throw new Error(
        `Invalid entry at ${entryLabel}: "name" must be path-safe (letters, digits, ".", "_", "-"; must start with a letter or digit), got "${entry.name}"`
      );
    }

    // Validate provider
    if (typeof entry.provider !== "string" || !entry.provider.trim()) {
      throw new Error(`Invalid entry at ${entryLabel}: "provider" must be a non-empty string`);
    }

    // Validate modelId
    if (typeof entry.modelId !== "string" || !entry.modelId.trim()) {
      throw new Error(`Invalid entry at ${entryLabel}: "modelId" must be a non-empty string`);
    }

    // Validate params (defaults to {})
    let params: Record<string, string | number | boolean>;
    if (entry.params === undefined || entry.params === null) {
      params = {};
    } else if (typeof entry.params === "object" && !Array.isArray(entry.params)) {
      params = entry.params as Record<string, string | number | boolean>;
    } else {
      throw new Error(`Invalid entry at ${entryLabel}: "params" must be an object when present`);
    }

    result.push({
      name: entry.name,
      provider: entry.provider,
      modelId: entry.modelId,
      params,
      notes: typeof entry.notes === "string" ? entry.notes : undefined,
    });
  }

  return result;
}
