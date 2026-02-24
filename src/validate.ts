import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  type SchemaType,
  type EnvVarSchema,
  getSchemaTypes,
  findSchemaType,
  parseEnumChoices,
} from "./schema.js";
import {
  parseEnvExample,
  getExistingEnvVersion,
  getExistingEnvVariables,
} from "./parse.js";

// ─── Type detection ──────────────────────────────────────────────────────────

export function detectType(value: string, key: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const types = getSchemaTypes();
  const integerType = types.find((t) => t.name === "integer");
  const floatType = types.find((t) => t.name === "float");
  const booleanType = types.find((t) => t.name === "boolean");
  const stringType = types.find((t) => t.name === "string");
  const enumType = types.find((t) => t.name === "structured/enum");
  const ordered = [
    integerType,
    floatType,
    booleanType,
    ...types.filter(
      (t) =>
        t.name !== "integer" &&
        t.name !== "float" &&
        t.name !== "boolean" &&
        t.name !== "string" &&
        t.name !== "structured/enum"
    ),
    stringType,
    enumType,
  ].filter(Boolean) as typeof types;
  for (const t of ordered) {
    if (matchesSchemaType(t, trimmed, key)) return t.name;
  }
  return undefined;
}

export function matchesSchemaType(
  t: SchemaType,
  value: string,
  key: string
): boolean {
  if (t.pattern) {
    if (t.name === "file/path" && !/[/\\]|^[.~]/.test(value)) return false;
    if (
      t.name === "locale/langtag" &&
      /^(true|false|yes|no|on|off|ok)$/i.test(value)
    )
      return false;

    try {
      if (!new RegExp(t.pattern).test(value)) return false;
    } catch {
      return false;
    }
    if (t.name === "structured/json") {
      try {
        JSON.parse(value);
      } catch {
        return false;
      }
    }
    return true;
  }

  if (t.name === "credentials/secret" && t.minLength !== undefined) {
    return (
      /SECRET|KEY|TOKEN|PASSWORD|SALT|BEARER|CREDENTIAL|AUTH/i.test(key) &&
      value.length >= t.minLength
    );
  }

  if (t.name === "float" && t.type === "number") {
    return /^-?\d*\.\d+$/.test(value) && !isNaN(parseFloat(value));
  }
  if (t.name === "integer" && t.type === "integer") {
    return /^-?\d+$/.test(value) && !isNaN(parseInt(value, 10));
  }
  if (t.name === "boolean" && t.type === "boolean") {
    return /^(true|false|1|0|yes|no)$/i.test(value);
  }
  if (t.name === "string" && t.type === "string" && !t.pattern) {
    return true;
  }

  return false;
}

// ─── Value validation ────────────────────────────────────────────────────────

export function validateValue(value: string, v: EnvVarSchema): string | null {
  const trimmed = value.trim();
  if (v.required && !trimmed) return `${v.key} is required.`;
  if (!trimmed && !v.required) return null;

  if (!v.type) return null;
  const st = findSchemaType(v.type);
  if (!st) return null;

  if (v.type === "structured/enum" && v.constraints?.pattern) {
    try {
      if (!new RegExp(v.constraints.pattern).test(trimmed)) {
        const choices = parseEnumChoices(v.constraints.pattern);
        if (choices.length > 0) {
          return `${v.key} must be one of: ${choices.join(", ")}`;
        }
        return `${v.key} must match pattern ${v.constraints.pattern}`;
      }
    } catch {
      return `${v.key} has an invalid enum pattern: ${v.constraints.pattern}`;
    }
    return null;
  }

  if (st.pattern) {
    try {
      if (!new RegExp(st.pattern).test(trimmed)) {
        return `${v.key} must be a valid ${st.name} (${st.description}).`;
      }
    } catch {
      /* invalid pattern in schema, skip */
    }
  }

  if (v.type === "structured/json") {
    try {
      JSON.parse(trimmed);
    } catch {
      return `${v.key} must be valid JSON.`;
    }
  }

  if (st.type === "number" || st.name === "float") {
    const n = Number(trimmed);
    if (isNaN(n)) return `${v.key} must be a number.`;
    const m = v.constraints || {};
    if (m.min !== undefined && n < Number(m.min))
      return `${v.key} must be >= ${m.min}.`;
    if (m.max !== undefined && n > Number(m.max))
      return `${v.key} must be <= ${m.max}.`;
    if (m.precision !== undefined) {
      const prec = Number(m.precision);
      const decPart = trimmed.split(".")[1];
      if (decPart && decPart.length > prec) {
        return `${v.key} must have at most ${prec} decimal places.`;
      }
    }
  }

  if (st.type === "integer" || st.name === "integer") {
    const n = Number(trimmed);
    if (isNaN(n) || Math.floor(n) !== n) return `${v.key} must be an integer.`;
    const m = v.constraints || {};
    if (m.min !== undefined && n < Number(m.min))
      return `${v.key} must be >= ${m.min}.`;
    if (m.max !== undefined && n > Number(m.max))
      return `${v.key} must be <= ${m.max}.`;
  }

  if (st.type === "boolean" || st.name === "boolean") {
    if (!/^(true|false|1|0|yes|no)$/i.test(trimmed)) {
      return `${v.key} must be a boolean (true/false/1/0/yes/no).`;
    }
  }

  if (st.minLength !== undefined && trimmed.length < st.minLength) {
    return `${v.key} must be at least ${st.minLength} characters.`;
  }

  if (st.type === "string") {
    const m = v.constraints || {};
    if (m.minLength !== undefined && trimmed.length < Number(m.minLength))
      return `${v.key} must be at least ${m.minLength} characters.`;
    if (m.maxLength !== undefined && trimmed.length > Number(m.maxLength))
      return `${v.key} must be at most ${m.maxLength} characters.`;
    if (m.pattern) {
      try {
        if (!new RegExp(m.pattern).test(trimmed))
          return `${v.key} must match pattern ${m.pattern}`;
      } catch {
        return `${v.key} has an invalid pattern: ${m.pattern}`;
      }
    }
  }

  return null;
}

// ─── Env-level validation ────────────────────────────────────────────────────

export interface ValidateEnvResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnv(
  rootDir: string,
  options: { envFile?: string } = {}
): ValidateEnvResult {
  const { version, variables } = parseEnvExample(rootDir);
  const envFileName = options.envFile || ".env";
  const envPath = path.join(rootDir, envFileName);
  const existing = getExistingEnvVariables(envPath);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (fs.existsSync(envPath) && version) {
    const schemaVersionInEnv = getExistingEnvVersion(
      fs.readFileSync(envPath, "utf-8")
    );
    if (schemaVersionInEnv !== null && schemaVersionInEnv !== version) {
      warnings.push(
        `ENV_SCHEMA_VERSION mismatch: ${envFileName} has "${schemaVersionInEnv}", .env.example has "${version}".`
      );
    }
  }

  for (const v of variables) {
    if (v.isCommentedOut) continue;
    const value = existing[v.key];
    const valuePresent = value !== undefined && value !== null;
    if (v.required && !valuePresent) {
      errors.push(`Missing required variable: ${v.key}`);
      continue;
    }
    if (!valuePresent) continue;
    const err = validateValue(value, v);
    if (err) errors.push(err);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Coercion ────────────────────────────────────────────────────────────────

export function coerceToType(value: string, typeName?: string): string {
  if (!typeName) return value;
  const st = findSchemaType(typeName);
  if (!st) return value;

  const trimmed = value.trim();

  if (st.type === "number" || st.name === "float") {
    const n = Number(trimmed);
    if (isNaN(n)) return value;
    return String(n);
  }
  if (st.type === "integer" || st.name === "integer") {
    const n = Number(trimmed);
    if (isNaN(n)) return value;
    return String(Math.floor(n));
  }
  if (st.type === "boolean" || st.name === "boolean") {
    const lower = trimmed.toLowerCase();
    if (["true", "1", "yes"].includes(lower)) return "true";
    if (["false", "0", "no", ""].includes(lower)) return "false";
    return value;
  }
  if (st.type === "string") return trimmed;

  return value;
}

// ─── Auto-generation ─────────────────────────────────────────────────────────

const AUTO_GENERATORS: Record<string, () => string> = {
  rsa_private_key: () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return privateKey as string;
  },
  uuidv4: () => crypto.randomUUID(),
  random_secret_32: () => crypto.randomBytes(32).toString("base64"),
};

export function generateAutoValue(kind: string): string {
  const gen = AUTO_GENERATORS[kind];
  if (!gen) return "";
  return gen();
}
