import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface SchemaType {
  name: string;
  type: string;
  pattern?: string;
  description: string;
  examples: (string | number | boolean)[];
  default?: string | number | boolean;
  auto_generate?: string;
  minLength?: number;
  constraints?: Record<string, string>;
}

export interface EnvSchema {
  types: SchemaType[];
}

export interface EnvVarSchema {
  key: string;
  defaultValue: string;
  comment: string;
  required: boolean;
  isCommentedOut: boolean;
  /** Section/group name (e.g. Database, App). Ungrouped vars become "Other" when any group is used. */
  group?: string;
  /** Full schema type name, e.g. "network/url", "integer", "credentials/secret". */
  type?: string;
  /** Constraint values parsed from [CONSTRAINTS: k=v,...] in comment. */
  constraints?: Record<string, string>;
}

let _schema: EnvSchema | null = null;

export function loadSchema(customPath?: string): EnvSchema {
  if (_schema && !customPath) return _schema;
  if (customPath) {
    return JSON.parse(fs.readFileSync(customPath, "utf-8")) as EnvSchema;
  }
  const selfPath = fileURLToPath(import.meta.url);
  const dir = path.dirname(selfPath);
  for (const candidate of [
    path.join(dir, "..", "schema.json"),
    path.join(dir, "..", "..", "schema.json"),
    path.join(dir, "schema.json"),
  ]) {
    if (fs.existsSync(candidate)) {
      _schema = JSON.parse(fs.readFileSync(candidate, "utf-8")) as EnvSchema;
      return _schema;
    }
  }
  throw new Error("schema.json not found");
}

export function resetSchemaCache(): void {
  _schema = null;
}

export function getSchemaTypes(): SchemaType[] {
  return loadSchema().types;
}

export function findSchemaType(name: string): SchemaType | undefined {
  return getSchemaTypes().find((t) => t.name === name);
}

/** Parse ^(a|b|c)$ pattern into choice strings. */
export function parseEnumChoices(pattern: string): string[] {
  const m = pattern.match(/^\^?\(([^)]+)\)\$?$/);
  if (m)
    return m[1]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/**
 * Return the available constraint descriptors for a type.
 * If the type itself defines constraints, use those.
 * Otherwise, fall back to the constraints of the corresponding primitive type.
 */
export function getAvailableConstraints(
  typeName: string
): Record<string, string> {
  const st = findSchemaType(typeName);
  if (!st) return {};
  if (st.constraints) return st.constraints;
  const baseName: Record<string, string> = {
    number: "float",
    integer: "integer",
    boolean: "boolean",
    string: "string",
  };
  const base = baseName[st.type];
  if (base) {
    const bt = findSchemaType(base);
    return bt?.constraints || {};
  }
  return {};
}
