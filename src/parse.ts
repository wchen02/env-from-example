import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getSchemaTypes, findSchemaType, type EnvVarSchema } from "./schema.js";
import { detectType } from "./validate.js";

/**
 * Parse [TYPE: full/name] and [CONSTRAINTS: k=v,k=v] from comment text.
 */
function parseSchemaMeta(
  comment: string,
  _key: string
): Pick<EnvVarSchema, "type" | "constraints"> {
  const full = comment.replace(/\s+/g, " ");
  const out: Pick<EnvVarSchema, "type" | "constraints"> = {};

  const validNames = new Set(getSchemaTypes().map((t) => t.name));
  const typeMatch = full.match(/\[TYPE:\s*([^\]]+)\]/i);
  if (typeMatch) {
    const t = typeMatch[1].trim();
    if (validNames.has(t)) out.type = t;
  }

  const constraintsMatch = full.match(/\[CONSTRAINTS:\s*([^\]]+)\]/i);
  if (constraintsMatch) {
    const raw = constraintsMatch[1].trim();
    const constraints: Record<string, string> = {};
    const pairs = raw.split(/,(?=[a-zA-Z_]+=)/);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        constraints[pair.substring(0, eqIdx).trim()] = pair
          .substring(eqIdx + 1)
          .trim();
      }
    }
    if (Object.keys(constraints).length > 0) out.constraints = constraints;
  }

  return out;
}

// ─── File parsing ────────────────────────────────────────────────────────────

export function parseEnvExample(rootDir: string): {
  version: string | null;
  variables: EnvVarSchema[];
} {
  const envExamplePath = path.join(rootDir, ".env.example");
  if (!fs.existsSync(envExamplePath)) {
    throw new Error(`.env.example not found at ${envExamplePath}`);
  }

  const content = fs.readFileSync(envExamplePath, "utf-8");
  const lines = content.split("\n");
  const variables: EnvVarSchema[] = [];
  let currentComments: string[] = [];
  let currentGroup = "";
  let version = null;
  let inBannerBlock = false;
  let bannerGroupName = "";

  const buildComment = (comments: string[]): string => comments.join("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#\s*={5,}\s*$/.test(trimmed)) {
      if (!inBannerBlock) {
        inBannerBlock = true;
        bannerGroupName = "";
      } else {
        if (bannerGroupName) {
          currentGroup = bannerGroupName;
        }
        currentComments = [];
        inBannerBlock = false;
      }
      continue;
    }

    if (inBannerBlock) {
      bannerGroupName = trimmed.replace(/^#\s*/, "").trim();
      continue;
    }

    if (trimmed.startsWith("# ENV_SCHEMA_VERSION=")) {
      const match = trimmed.match(/# ENV_SCHEMA_VERSION="?([^"]+)"?/);
      if (match) version = match[1];
      continue;
    }

    if (trimmed.startsWith("#")) {
      const maybeVarMatch = trimmed.match(/^#\s*([A-Z0-9_]+)=(.*)$/);
      if (maybeVarMatch) {
        let val = maybeVarMatch[2].trim();
        val = val.split(" #")[0].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        const commentStr = buildComment(currentComments);
        const meta = parseSchemaMeta(commentStr, maybeVarMatch[1]);
        variables.push({
          key: maybeVarMatch[1],
          defaultValue: val,
          comment: commentStr,
          required: false,
          isCommentedOut: true,
          group: currentGroup || undefined,
          ...meta,
        });
        currentComments = [];
        continue;
      }

      currentComments.push(trimmed.replace(/^#\s*/, ""));
      continue;
    }

    if (!trimmed) {
      currentComments = [];
      continue;
    }

    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      val = val.split(" #")[0].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      const fullComment = currentComments.join(" ");
      const required = fullComment.toUpperCase().includes("[REQUIRED]");
      const commentStr = buildComment(currentComments);
      const meta = parseSchemaMeta(commentStr, match[1]);

      variables.push({
        key: match[1],
        defaultValue: val,
        comment: commentStr,
        required,
        isCommentedOut: false,
        group: currentGroup || undefined,
        ...meta,
      });
      currentComments = [];
    } else {
      currentComments = [];
    }
  }

  if (variables.some((v) => v.group)) {
    variables.forEach((v) => {
      if (v.group === undefined || v.group === "") v.group = "Other";
    });
  }

  return { version, variables };
}

export function getExistingEnvVersion(content: string): string | null {
  const match = content.match(/# ENV_SCHEMA_VERSION="?([^"\n]+)"?/);
  return match ? match[1] : null;
}

export function getExistingEnvVariables(
  envPath: string
): Record<string, string> {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    return dotenv.parse(content);
  }
  return {};
}

// ─── Grouping / serialization ────────────────────────────────────────────────

export function getGroup(v: EnvVarSchema): string {
  return v.group || "";
}

function renderGroupBanner(groupName: string): string[] {
  const W = 40;
  const bar = "# " + "=".repeat(W);
  const padLen = Math.max(1, Math.floor((W - groupName.length) / 2));
  const center = "#" + " ".repeat(padLen) + groupName;
  return [bar, center, bar];
}

/** Reorder variables so same-group variables are contiguous. Ungrouped vars become "Other" when any group is used. */
export function groupVariablesBySection(
  variables: EnvVarSchema[]
): EnvVarSchema[] {
  const hasAnyGroup = variables.some((v) => getGroup(v) !== "");
  const groups = new Map<string, EnvVarSchema[]>();
  const groupOrder: string[] = [];
  for (const v of variables) {
    const group = getGroup(v) || (hasAnyGroup ? "Other" : "");
    if (!groups.has(group)) {
      groups.set(group, []);
      groupOrder.push(group);
    }
    groups.get(group)!.push(v);
  }
  const result: EnvVarSchema[] = [];
  for (const g of groupOrder) {
    result.push(...groups.get(g)!);
  }
  return result;
}

export function dedupeVariables(variables: EnvVarSchema[]): EnvVarSchema[] {
  const seen = new Set<string>();
  return variables.filter((v) => {
    if (seen.has(v.key)) return false;
    seen.add(v.key);
    return true;
  });
}

const ENV_FROM_EXAMPLE_CREDIT =
  "# env-from-example (https://www.npmjs.com/package/env-from-example)";

export function serializeEnvExample(
  version: string | null,
  variables: EnvVarSchema[]
): string {
  const lines: string[] = [ENV_FROM_EXAMPLE_CREDIT, ""];
  if (version !== null && version !== undefined) {
    lines.push(`# ENV_SCHEMA_VERSION="${version}"`);
    lines.push("");
  }
  const grouped = groupVariablesBySection(variables);
  let lastGroup = "";
  for (const v of grouped) {
    const group = getGroup(v);
    if (group && group !== lastGroup) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push(...renderGroupBanner(group));
      lines.push("");
      lastGroup = group;
    }
    const commentLines = v.comment.split("\n").filter(Boolean);
    for (const c of commentLines) {
      lines.push("# " + c.replace(/^#\s*/, ""));
    }
    const needsQuotes = /[\s#"']/.test(v.defaultValue) || v.defaultValue === "";
    const value =
      needsQuotes && v.defaultValue !== ""
        ? `"${v.defaultValue.replace(/"/g, '\\"')}"`
        : v.defaultValue;
    if (v.isCommentedOut) {
      lines.push(`# ${v.key}=${value}`);
    } else {
      lines.push(`${v.key}=${value}`);
    }
    lines.push("");
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

// ─── Description / comment helpers ───────────────────────────────────────────

export function humanizeEnvKey(key: string): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Strip [REQUIRED], [TYPE: ...], [CONSTRAINTS: ...], Default: ... from comment
 * to get the plain description text.
 */
export function stripMetaFromComment(comment: string): string {
  return comment
    .replace(/\s*\[REQUIRED\]\s*/gi, " ")
    .replace(/\s*\[TYPE:\s*[^\]]+\]\s*/gi, " ")
    .replace(/\s*\[CONSTRAINTS:\s*[^\]]+\]\s*/gi, " ")
    .replace(/\s*Default:\s*[^\n]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferDescription(v: EnvVarSchema): string {
  const plain = stripMetaFromComment(v.comment);
  if (plain) return plain;
  return humanizeEnvKey(v.key);
}

export function buildCommentLine(parts: {
  description: string;
  required: boolean;
  type?: string;
  constraints?: Record<string, string>;
  defaultValue: string;
}): string {
  const meta: string[] = [];
  if (parts.required) meta.push("[REQUIRED]");
  if (parts.type) meta.push(`[TYPE: ${parts.type}]`);
  if (parts.constraints && Object.keys(parts.constraints).length > 0) {
    const constraintsStr = Object.entries(parts.constraints)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    meta.push(`[CONSTRAINTS: ${constraintsStr}]`);
  }
  meta.push(
    parts.defaultValue === ""
      ? "Default: (empty)"
      : `Default: ${parts.defaultValue}`
  );
  return parts.description + "\n" + meta.join(" ");
}

export function enrichVariablesForPolish(
  variables: EnvVarSchema[]
): EnvVarSchema[] {
  return variables.map((v) => {
    const commentLines = v.comment.split("\n").filter(Boolean);
    let description =
      commentLines
        .find((l) => !l.toUpperCase().includes("[REQUIRED]"))
        ?.trim() || "";
    if (!description) description = humanizeEnvKey(v.key);

    const type = v.type || detectType(v.defaultValue, v.key);

    const line = buildCommentLine({
      description,
      required: v.required,
      type,
      constraints: v.constraints,
      defaultValue: v.defaultValue,
    });
    return { ...v, comment: line, type, group: getGroup(v) || v.group };
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initEnvExample(
  rootDir: string,
  options: { from?: string } = {}
): void {
  const envExamplePath = path.join(rootDir, ".env.example");
  if (fs.existsSync(envExamplePath)) {
    throw new Error(
      `.env.example already exists at ${envExamplePath}. Use --polish to update it.`
    );
  }

  let variables: EnvVarSchema[] = [];
  const sourceFile = options.from || ".env";
  const sourcePath = path.join(rootDir, sourceFile);

  if (fs.existsSync(sourcePath)) {
    const existingVars = dotenv.parse(fs.readFileSync(sourcePath, "utf-8"));
    for (const [key, value] of Object.entries(existingVars)) {
      const detectedType = detectType(value, key);
      const matchedSchema = detectedType
        ? findSchemaType(detectedType)
        : undefined;
      const schema: EnvVarSchema = {
        key,
        defaultValue: value,
        comment: humanizeEnvKey(key),
        required: false,
        isCommentedOut: false,
        type: detectedType,
      };
      if (matchedSchema?.auto_generate && !value) {
        schema.defaultValue = "";
      }
      variables.push(schema);
    }
  } else {
    variables = [
      {
        key: "NODE_ENV",
        defaultValue: "development",
        comment: "Node environment",
        type: "structured/enum",
        constraints: { pattern: "^development|test|staging|production$" },
        required: false,
        isCommentedOut: false,
      },
      {
        key: "PORT",
        defaultValue: "3000",
        comment: "Server port",
        required: true,
        isCommentedOut: false,
        type: "integer",
        constraints: { min: "1", max: "65535" },
      },
    ];
  }

  const version = getDefaultSchemaVersion(rootDir);
  const enriched = enrichVariablesForPolish(variables);
  const content = serializeEnvExample(version, enriched);
  fs.writeFileSync(envExamplePath, content, "utf-8");
}

export function getDefaultSchemaVersion(rootDir: string): string {
  const pkgPath = path.join(rootDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        version?: string;
      };
      if (pkg.version && typeof pkg.version === "string") return pkg.version;
    } catch {
      /* ignore */
    }
  }
  return "1.0.0";
}
