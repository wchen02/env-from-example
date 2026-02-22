import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import {
  getRootDirFromArgv,
  parseEnvExample,
  getExistingEnvVersion,
  getExistingEnvVariables,
  serializeEnvExample,
  polishEnvExample,
  bumpSemver,
  updateEnvSchemaVersion,
  generateAutoValue,
  validateValue,
  coerceToType,
  validateEnv,
  initEnvExample,
  detectType,
  parseEnumChoices,
  findSchemaType,
  getAvailableConstraints,
  inferDescription,
  type EnvVarSchema,
} from "../../env-from-example.js";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

describe("getRootDirFromArgv", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("returns process.cwd() when --cwd is not present", () => {
    process.argv = ["node", "env-from-example.ts"];
    expect(getRootDirFromArgv()).toBe(process.cwd());
  });

  it("returns resolved path when --cwd is present with value", () => {
    process.argv = ["node", "env-from-example.ts", "--cwd", "/some/project"];
    expect(getRootDirFromArgv()).toBe(path.resolve("/some/project"));
  });

  it("returns process.cwd() when --cwd is last (no value)", () => {
    process.argv = ["node", "env-from-example.ts", "--yes", "--cwd"];
    expect(getRootDirFromArgv()).toBe(process.cwd());
  });

  it("returns resolved path for relative --cwd", () => {
    process.argv = ["node", "env-from-example.ts", "--cwd", "./fixtures/full"];
    const result = getRootDirFromArgv();
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toMatch(/fixtures[\\/]full$/);
  });
});

describe("parseEnvExample", () => {
  it("throws when .env.example does not exist", () => {
    expect(() => parseEnvExample("/nonexistent/dir")).toThrow(
      /.env.example not found at/
    );
  });

  it("parses full fixture: version, sections, required, commented-out", () => {
    const rootDir = path.join(FIXTURES_DIR, "full");
    const { version, variables } = parseEnvExample(rootDir);

    expect(version).toBe("1.0");

    const keys = variables.map((v) => v.key);
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("DATABASE_POOL_SIZE");
    expect(keys).toContain("API_KEY");
    expect(keys).toContain("API_SECRET");
    expect(keys).toContain("API_BASE_URL");
    expect(keys).toContain("NODE_ENV");
    expect(keys).toContain("SESSION_SECRET");
    expect(keys).toContain("FEATURE_BETA");
    expect(keys).toContain("PORT");

    const databaseUrl = variables.find((v) => v.key === "DATABASE_URL")!;
    expect(databaseUrl.defaultValue).toBe("postgres://localhost:5432/myapp");
    expect(databaseUrl.required).toBe(true);
    expect(databaseUrl.isCommentedOut).toBe(false);
    expect(databaseUrl.comment).toMatch(/Postgres|REQUIRED/);

    const apiBaseUrl = variables.find((v) => v.key === "API_BASE_URL")!;
    expect(apiBaseUrl.defaultValue).toBe("https://api.example.com/v1");

    const featureBeta = variables.find((v) => v.key === "FEATURE_BETA")!;
    expect(featureBeta.isCommentedOut).toBe(true);
    expect(featureBeta.defaultValue).toBe("false");

    const port = variables.find((v) => v.key === "PORT")!;
    expect(port.isCommentedOut).toBe(true);
    expect(port.defaultValue).toBe("3000");
  });

  it("parses minimal fixture with version", () => {
    const rootDir = path.join(FIXTURES_DIR, "minimal");
    const { version, variables } = parseEnvExample(rootDir);

    expect(version).toBe("2.0");
    expect(variables).toHaveLength(2);

    const nodeEnv = variables.find((v) => v.key === "NODE_ENV")!;
    expect(nodeEnv.defaultValue).toBe("development");
    expect(nodeEnv.required).toBe(false);

    const someKey = variables.find((v) => v.key === "SOME_KEY")!;
    expect(someKey.defaultValue).toBe("default_value");
  });

  it("parses required-only fixture", () => {
    const rootDir = path.join(FIXTURES_DIR, "required-only");
    const { version, variables } = parseEnvExample(rootDir);

    expect(version).toBe("1.0");
    expect(variables).toHaveLength(1);
    expect(variables[0].key).toBe("REQUIRED_VAR");
    expect(variables[0].required).toBe(true);
    expect(variables[0].defaultValue).toBe("");
  });

  it("parses no-version fixture: version is null", () => {
    const rootDir = path.join(FIXTURES_DIR, "no-version");
    const { version, variables } = parseEnvExample(rootDir);

    expect(version).toBeNull();
    expect(variables).toHaveLength(2);
    expect(variables.find((v) => v.key === "FOO")?.defaultValue).toBe("bar");
    expect(variables.find((v) => v.key === "BAZ")?.defaultValue).toBe("qux");
  });

  it("strips inline comments from values", () => {
    const rootDir = path.join(FIXTURES_DIR, "full");
    const { variables } = parseEnvExample(rootDir);
    const apiBase = variables.find((v) => v.key === "API_BASE_URL")!;
    expect(apiBase.defaultValue).toBe("https://api.example.com/v1");
  });

  it("preserves section group from banner", () => {
    const rootDir = path.join(FIXTURES_DIR, "full");
    const { variables } = parseEnvExample(rootDir);
    const dbUrl = variables.find((v) => v.key === "DATABASE_URL")!;
    expect(dbUrl.group).toBeDefined();
    expect(typeof dbUrl.group).toBe("string");
    expect(dbUrl.group!.length).toBeGreaterThan(0);
  });
});

describe("getExistingEnvVersion", () => {
  it("returns null for content without version", () => {
    expect(getExistingEnvVersion("FOO=bar")).toBeNull();
    expect(getExistingEnvVersion("")).toBeNull();
  });

  it("returns version from quoted ENV_SCHEMA_VERSION", () => {
    const content = '# ENV_SCHEMA_VERSION="1.0"\nFOO=bar';
    expect(getExistingEnvVersion(content)).toBe("1.0");
  });

  it("returns version from unquoted ENV_SCHEMA_VERSION", () => {
    const content = "# ENV_SCHEMA_VERSION=2.0\n";
    expect(getExistingEnvVersion(content)).toBe("2.0");
  });

  it("returns first match when multiple version-like lines exist", () => {
    const content = '# ENV_SCHEMA_VERSION="1.0"\n# ENV_SCHEMA_VERSION="2.0"';
    expect(getExistingEnvVersion(content)).toBe("1.0");
  });
});

describe("getExistingEnvVariables", () => {
  it("returns empty object when file does not exist", () => {
    const result = getExistingEnvVariables(
      path.join(FIXTURES_DIR, "nonexistent.env")
    );
    expect(result).toEqual({});
  });

  it("parses existing .env file", () => {
    const envPath = path.join(FIXTURES_DIR, "full", ".env.example");
    const result = getExistingEnvVariables(envPath);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result.DATABASE_URL).toBe("postgres://localhost:5432/myapp");
    expect(result.NODE_ENV).toBe("development");
  });

  it("returns empty object for empty or comment-only file", () => {
    const tmpDir = path.join(FIXTURES_DIR, "full");
    const commentOnlyPath = path.join(tmpDir, ".env.comment-only");
    fs.writeFileSync(commentOnlyPath, "# only comments\n\n", "utf-8");
    try {
      const result = getExistingEnvVariables(commentOnlyPath);
      expect(result).toEqual({});
    } finally {
      try {
        fs.unlinkSync(commentOnlyPath);
      } catch {
        /* ignore */
      }
    }
  });
});

describe("serializeEnvExample", () => {
  it("outputs version line and variables with sections", () => {
    const variables: EnvVarSchema[] = [
      {
        key: "FOO",
        defaultValue: "bar",
        comment: "Description",
        required: false,
        isCommentedOut: false,
        group: "Section",
      },
      {
        key: "BAZ",
        defaultValue: "qux",
        comment: "",
        required: false,
        isCommentedOut: true,
      },
    ];
    const out = serializeEnvExample("1.0", variables);
    expect(out).toMatch(/# ENV_SCHEMA_VERSION="1.0"/);
    expect(out).toMatch(/# ={5,}/);
    expect(out).toMatch(/#\s+Section/);
    expect(out).toMatch(/FOO=bar/);
    expect(out).toMatch(/# BAZ=qux/);
  });

  it("outputs no version line when version is null", () => {
    const variables: EnvVarSchema[] = [
      {
        key: "X",
        defaultValue: "y",
        comment: "",
        required: false,
        isCommentedOut: false,
      },
    ];
    const out = serializeEnvExample(null, variables);
    expect(out).not.toMatch(/ENV_SCHEMA_VERSION/);
    expect(out).toMatch(/env-from-example/);
    expect(out).toMatch(/\nX=y\n/);
  });
});

describe("bumpSemver", () => {
  it("bumps patch", () => {
    expect(bumpSemver("1.0.0", "patch")).toBe("1.0.1");
    expect(bumpSemver("1.0", "patch")).toBe("1.0.1");
  });
  it("bumps minor", () => {
    expect(bumpSemver("1.0.0", "minor")).toBe("1.1.0");
    expect(bumpSemver("2.1", "minor")).toBe("2.2.0");
  });
  it("bumps major", () => {
    expect(bumpSemver("1.0.0", "major")).toBe("2.0.0");
    expect(bumpSemver("3.2.1", "major")).toBe("4.0.0");
  });
});

describe("polishEnvExample", () => {
  it("overwrites .env.example with normalized content and dedupes keys", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(fixtureDir, ".env.example");
    const before = fs.readFileSync(envPath, "utf-8");
    polishEnvExample(fixtureDir);
    const after = fs.readFileSync(envPath, "utf-8");
    expect(after).toMatch(/# ENV_SCHEMA_VERSION="1.0"/);
    expect(after).toMatch(/DATABASE_URL=postgres:\/\/localhost:5432\/myapp/);
    expect(after).toMatch(/#\s+Database/);
    fs.writeFileSync(envPath, before, "utf-8");
  });

  it("adds ENV_SCHEMA_VERSION when missing", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "no-version");
    const envPath = path.join(fixtureDir, ".env.example");
    const before = fs.readFileSync(envPath, "utf-8");
    polishEnvExample(fixtureDir);
    const after = fs.readFileSync(envPath, "utf-8");
    expect(after).toMatch(/# ENV_SCHEMA_VERSION="/);
    expect(after).toMatch(/FOO=bar/);
    expect(after).toMatch(/BAZ=qux/);
    fs.writeFileSync(envPath, before, "utf-8");
  });

  it("enriches comments with Default: and description", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(fixtureDir, ".env.example");
    const before = fs.readFileSync(envPath, "utf-8");
    polishEnvExample(fixtureDir);
    const after = fs.readFileSync(envPath, "utf-8");
    expect(after).toMatch(/Default: postgres:\/\/localhost:5432\/myapp/);
    expect(after).toMatch(/\[REQUIRED\]/);
    expect(after).toMatch(/Default: \(empty\)/);
    fs.writeFileSync(envPath, before, "utf-8");
  });

  it("dedupes duplicate keys (keeps first occurrence)", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-polish-dedup");
    const envPath = path.join(tmpDir, ".env.example");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(envPath, "FOO=first\nBAR=ok\nFOO=second\n", "utf-8");
    try {
      polishEnvExample(tmpDir);
      const after = fs.readFileSync(envPath, "utf-8");
      const fooMatches = after.match(/^FOO=/gm);
      expect(fooMatches).toHaveLength(1);
      expect(after).toMatch(/FOO=first/);
      expect(after).not.toMatch(/FOO=second/);
      expect(after).toMatch(/BAR=ok/);
    } finally {
      try {
        fs.unlinkSync(envPath);
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  });

  it("throws when .env.example does not exist", () => {
    expect(() => polishEnvExample("/nonexistent/dir")).toThrow(
      /.env.example not found/
    );
  });
});

describe("updateEnvSchemaVersion", () => {
  it("updates ENV_SCHEMA_VERSION in .env.example", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "minimal");
    const envPath = path.join(fixtureDir, ".env.example");
    const before = fs.readFileSync(envPath, "utf-8");
    try {
      updateEnvSchemaVersion(fixtureDir, "3.0.0");
      const after = fs.readFileSync(envPath, "utf-8");
      expect(after).toMatch(/# ENV_SCHEMA_VERSION="3.0.0"/);
      expect(after).toMatch(/NODE_ENV=development/);
    } finally {
      fs.writeFileSync(envPath, before, "utf-8");
    }
  });

  it("throws when .env.example does not exist", () => {
    expect(() => updateEnvSchemaVersion("/nonexistent", "1.0.0")).toThrow(
      /.env.example not found/
    );
  });
});

describe("parseEnvExample schema meta (type, constraints)", () => {
  it("parses [TYPE], [CONSTRAINTS] from comments", () => {
    const rootDir = path.join(FIXTURES_DIR, "schema-meta");
    const { variables } = parseEnvExample(rootDir);

    const logLevel = variables.find((v) => v.key === "LOG_LEVEL")!;
    expect(logLevel.type).toBe("structured/enum");
    expect(logLevel.constraints).toEqual({
      pattern: "^(debug|info|warn|error)$",
    });
    expect(logLevel.defaultValue).toBe("info");

    const port = variables.find((v) => v.key === "PORT")!;
    expect(port.type).toBe("integer");
    expect(port.constraints).toEqual({ min: "1", max: "65535" });

    const featureX = variables.find((v) => v.key === "FEATURE_X")!;
    expect(featureX.type).toBe("boolean");

    const apiBase = variables.find((v) => v.key === "API_BASE")!;
    expect(apiBase.type).toBe("network/url");

    const mySecret = variables.find((v) => v.key === "MY_SECRET")!;
    expect(mySecret.type).toBe("credentials/secret");
  });

  it("parses [TYPE: visual/hex_color] from comments", () => {
    const rootDir = path.join(FIXTURES_DIR, "schema-meta");
    const { variables } = parseEnvExample(rootDir);

    const brandColor = variables.find((v) => v.key === "BRAND_COLOR")!;
    expect(brandColor.type).toBe("visual/hex_color");
    expect(brandColor.defaultValue).toBe("#3b82f6");
  });

  it("parses [TYPE: version/semver] from comments", () => {
    const rootDir = path.join(FIXTURES_DIR, "schema-meta");
    const { variables } = parseEnvExample(rootDir);

    const appVersion = variables.find((v) => v.key === "APP_VERSION")!;
    expect(appVersion.type).toBe("version/semver");
    expect(appVersion.defaultValue).toBe("1.0.0");
  });
});

describe("detectType", () => {
  it("detects HTTPS URLs", () => {
    expect(detectType("https://api.example.com", "API_URL")).toBe(
      "network/https_url"
    );
  });

  it("detects HTTP URLs", () => {
    expect(detectType("http://localhost:3000", "API_URL")).toBe("network/url");
  });

  it("detects non-HTTP URIs", () => {
    expect(
      detectType("postgres://user:pass@db:5432/mydb", "DATABASE_URL")
    ).toBe("network/uri");
    expect(detectType("redis://:password@redis:6379/0", "REDIS_URL")).toBe(
      "network/uri"
    );
  });

  it("detects UUIDs", () => {
    expect(
      detectType("3fa85f64-5717-4562-b3fc-2c963f66afa6", "REQUEST_ID")
    ).toBe("id/uuid");
  });

  it("detects semver", () => {
    expect(detectType("1.2.3", "APP_VERSION")).toBe("version/semver");
  });

  it("detects hex colors", () => {
    expect(detectType("#3b82f6", "BRAND_COLOR")).toBe("visual/hex_color");
    expect(detectType("#fff", "COLOR")).toBe("visual/hex_color");
  });

  it("detects JSON", () => {
    expect(detectType('{"key":"value"}', "CONFIG")).toBe("structured/json");
  });

  it("detects integers", () => {
    expect(detectType("42", "PORT")).toBe("integer");
    expect(detectType("0", "COUNT")).toBe("integer");
  });

  it("detects floats", () => {
    expect(detectType("3.14", "RATE")).toBe("float");
  });

  it("detects booleans", () => {
    expect(detectType("true", "ENABLED")).toBe("boolean");
    expect(detectType("false", "FLAG")).toBe("boolean");
    expect(detectType("yes", "FLAG")).toBe("boolean");
    expect(detectType("no", "FLAG")).toBe("boolean");
  });

  it("falls back to string for generic text", () => {
    expect(detectType("hello world", "GREETING")).toBe("string");
    expect(detectType("development", "NODE_ENV")).toBe("string");
  });

  it("returns undefined for empty string", () => {
    expect(detectType("", "KEY")).toBeUndefined();
    expect(detectType("  ", "KEY")).toBeUndefined();
  });

  it("detects credentials/secret by key name + length", () => {
    const longSecret = "sk_live_4f3b2a1cabcdef12";
    expect(detectType(longSecret, "API_SECRET")).toBe("credentials/secret");
    expect(detectType(longSecret, "API_KEY")).toBe("credentials/secret");
    expect(detectType(longSecret, "AUTH_TOKEN")).toBe("credentials/secret");
  });

  it("does not detect credentials/secret for short values", () => {
    expect(detectType("short", "API_SECRET")).toBe("string");
  });

  it("does not detect credentials/secret without matching key", () => {
    expect(detectType("some_long_value_here_yes", "NODE_ENV")).toBe("string");
  });

  it("detects file paths", () => {
    expect(detectType("./config.yml", "CONFIG_PATH")).toBe("file/path");
    expect(detectType("/var/app/secrets.json", "FILE")).toBe("file/path");
  });

  it("does not detect numbers as file paths", () => {
    expect(detectType("3000", "PORT")).toBe("integer");
    expect(detectType("true", "FLAG")).toBe("boolean");
  });

  it("detects durations", () => {
    expect(detectType("30s", "TIMEOUT")).toBe("temporal/duration");
    expect(detectType("7d", "TTL")).toBe("temporal/duration");
  });

  it("detects IPv4", () => {
    expect(detectType("127.0.0.1", "HOST")).toBe("network/ip");
  });

  it("detects domains", () => {
    expect(detectType("example.com", "DOMAIN")).toBe("network/domain");
  });

  it("detects cron expressions", () => {
    expect(detectType("0 3 1 * *", "CRON")).toBe("temporal/cron");
  });

  it("detects CSV values", () => {
    expect(detectType("a,b,c", "TAGS")).toBe("structured/csv");
  });
});

describe("parseEnumChoices", () => {
  it("parses ^(a|b|c)$ format", () => {
    expect(parseEnumChoices("^(debug|info|warn|error)$")).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ]);
  });

  it("parses (a|b|c) without anchors", () => {
    expect(parseEnumChoices("(a|b|c)")).toEqual(["a", "b", "c"]);
  });

  it("returns empty for non-enum patterns", () => {
    expect(parseEnumChoices("^[a-z]+$")).toEqual([]);
    expect(parseEnumChoices("")).toEqual([]);
  });
});

describe("findSchemaType", () => {
  it("finds known types", () => {
    expect(findSchemaType("integer")).toBeDefined();
    expect(findSchemaType("integer")!.name).toBe("integer");
    expect(findSchemaType("network/url")).toBeDefined();
    expect(findSchemaType("boolean")).toBeDefined();
  });

  it("returns undefined for unknown types", () => {
    expect(findSchemaType("nonexistent")).toBeUndefined();
  });
});

describe("getAvailableConstraints", () => {
  it("returns constraints for integer type", () => {
    const constraints = getAvailableConstraints("integer");
    expect(constraints).toHaveProperty("min");
    expect(constraints).toHaveProperty("max");
  });

  it("returns constraints for float type", () => {
    const constraints = getAvailableConstraints("float");
    expect(constraints).toHaveProperty("min");
    expect(constraints).toHaveProperty("max");
    expect(constraints).toHaveProperty("precision");
  });

  it("returns string constraints for string type", () => {
    const constraints = getAvailableConstraints("string");
    expect(constraints).toHaveProperty("minLength");
    expect(constraints).toHaveProperty("maxLength");
    expect(constraints).toHaveProperty("pattern");
  });

  it("inherits string constraints for string sub-types", () => {
    const constraints = getAvailableConstraints("network/url");
    expect(constraints).toHaveProperty("minLength");
    expect(constraints).toHaveProperty("maxLength");
    expect(constraints).toHaveProperty("pattern");
  });

  it("returns empty for boolean type", () => {
    const constraints = getAvailableConstraints("boolean");
    expect(Object.keys(constraints)).toHaveLength(0);
  });

  it("returns own constraints for structured/enum", () => {
    const constraints = getAvailableConstraints("structured/enum");
    expect(constraints).toHaveProperty("pattern");
  });
});

describe("generateAutoValue", () => {
  it("returns UUID v4 for uuidv4", () => {
    const v = generateAutoValue("uuidv4");
    expect(v).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("returns base64 for random_secret_32", () => {
    const v = generateAutoValue("random_secret_32");
    expect(v.length).toBeGreaterThan(0);
    expect(Buffer.from(v, "base64").length).toBe(32);
  });

  it("returns PEM key for rsa_private_key", () => {
    const v = generateAutoValue("rsa_private_key");
    expect(v).toMatch(/-----BEGIN PRIVATE KEY-----/);
    expect(v).toMatch(/-----END PRIVATE KEY-----/);
  });

  it("returns empty string for unknown kind", () => {
    expect(generateAutoValue("nonexistent")).toBe("");
  });
});

describe("validateValue", () => {
  it("returns error when required and empty", () => {
    const v: EnvVarSchema = {
      key: "X",
      defaultValue: "",
      comment: "",
      required: true,
      isCommentedOut: false,
    };
    expect(validateValue("", v)).toMatch(/required/);
    expect(validateValue("  ", v)).toMatch(/required/);
  });

  it("returns null when optional and empty", () => {
    const v: EnvVarSchema = {
      key: "X",
      defaultValue: "",
      comment: "",
      required: false,
      isCommentedOut: false,
    };
    expect(validateValue("", v)).toBeNull();
  });

  it("validates structured/enum against constraints pattern", () => {
    const v: EnvVarSchema = {
      key: "L",
      defaultValue: "info",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "structured/enum",
      constraints: { pattern: "^(debug|info|warn|error)$" },
    };
    expect(validateValue("info", v)).toBeNull();
    expect(validateValue("debug", v)).toBeNull();
    expect(validateValue("verbose", v)).toMatch(/one of/);
  });

  it("validates integer type", () => {
    const v: EnvVarSchema = {
      key: "N",
      defaultValue: "0",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "integer",
    };
    expect(validateValue("42", v)).toBeNull();
    expect(validateValue("3.14", v)).toMatch(/integer/);
    expect(validateValue("abc", v)).toMatch(/integer/);
  });

  it("validates integer with constraints constraints", () => {
    const v: EnvVarSchema = {
      key: "P",
      defaultValue: "3000",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "integer",
      constraints: { min: "1", max: "65535" },
    };
    expect(validateValue("8080", v)).toBeNull();
    expect(validateValue("0", v)).toMatch(/>= 1/);
    expect(validateValue("99999", v)).toMatch(/<= 65535/);
  });

  it("validates float type with precision", () => {
    const v: EnvVarSchema = {
      key: "R",
      defaultValue: "0.0",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "float",
      constraints: { precision: "2" },
    };
    expect(validateValue("3.14", v)).toBeNull();
    expect(validateValue("3.141", v)).toMatch(/decimal places/);
  });

  it("validates boolean type", () => {
    const v: EnvVarSchema = {
      key: "B",
      defaultValue: "false",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "boolean",
    };
    expect(validateValue("true", v)).toBeNull();
    expect(validateValue("false", v)).toBeNull();
    expect(validateValue("yes", v)).toBeNull();
    expect(validateValue("no", v)).toBeNull();
    expect(validateValue("maybe", v)).toMatch(/boolean/);
  });

  it("validates network/url against schema pattern", () => {
    const v: EnvVarSchema = {
      key: "U",
      defaultValue: "",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "network/url",
    };
    expect(validateValue("https://example.com", v)).toBeNull();
    expect(validateValue("http://localhost:3000", v)).toBeNull();
    expect(validateValue("not-a-url", v)).toMatch(/valid network\/url/);
  });

  it("validates network/https_url rejects http", () => {
    const v: EnvVarSchema = {
      key: "U",
      defaultValue: "",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "network/https_url",
    };
    expect(validateValue("https://example.com", v)).toBeNull();
    expect(validateValue("http://example.com", v)).toMatch(
      /valid network\/https_url/
    );
  });

  it("validates visual/hex_color", () => {
    const v: EnvVarSchema = {
      key: "C",
      defaultValue: "#000000",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "visual/hex_color",
    };
    expect(validateValue("#3b82f6", v)).toBeNull();
    expect(validateValue("#fff", v)).toBeNull();
    expect(validateValue("red", v)).toMatch(/valid visual\/hex_color/);
  });

  it("validates structured/json requires JSON.parse", () => {
    const v: EnvVarSchema = {
      key: "J",
      defaultValue: "",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "structured/json",
    };
    expect(validateValue('{"x":1}', v)).toBeNull();
    expect(validateValue("{not json}", v)).toMatch(/valid JSON/);
  });

  it("validates string constraints (minLength, maxLength, pattern)", () => {
    const v: EnvVarSchema = {
      key: "S",
      defaultValue: "",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "string",
      constraints: { minLength: "3", maxLength: "10", pattern: "^[a-z]+$" },
    };
    expect(validateValue("hello", v)).toBeNull();
    expect(validateValue("ab", v)).toMatch(/at least 3/);
    expect(validateValue("toolongvalue", v)).toMatch(/at most 10/);
    expect(validateValue("UPPER", v)).toMatch(/match pattern/);
  });

  it("returns null for optional empty value", () => {
    const v: EnvVarSchema = {
      key: "OPT",
      defaultValue: "",
      comment: "",
      required: false,
      isCommentedOut: false,
      type: "network/url",
    };
    expect(validateValue("", v)).toBeNull();
  });
});

describe("coerceToType", () => {
  it("coerces to integer", () => {
    expect(coerceToType("42", "integer")).toBe("42");
    expect(coerceToType(" 99 ", "integer")).toBe("99");
    expect(coerceToType("3.7", "integer")).toBe("3");
  });

  it("coerces to float", () => {
    expect(coerceToType("3.14", "float")).toBe("3.14");
    expect(coerceToType(" 99 ", "float")).toBe("99");
  });

  it("coerces to boolean", () => {
    expect(coerceToType("true", "boolean")).toBe("true");
    expect(coerceToType("yes", "boolean")).toBe("true");
    expect(coerceToType("false", "boolean")).toBe("false");
    expect(coerceToType("no", "boolean")).toBe("false");
  });

  it("leaves string types as-is (trimmed)", () => {
    expect(coerceToType("hello", "string")).toBe("hello");
    expect(coerceToType("https://x.com", "network/url")).toBe("https://x.com");
  });

  it("returns value unchanged for unknown type", () => {
    expect(coerceToType("test", "nonexistent")).toBe("test");
  });
});

describe("validateEnv", () => {
  it("returns valid when .env matches schema and required present", () => {
    const rootDir = path.join(FIXTURES_DIR, "minimal");
    const envPath = path.join(rootDir, ".env");
    const before = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, "utf-8")
      : null;
    fs.writeFileSync(
      envPath,
      '# ENV_SCHEMA_VERSION="2.0"\nNODE_ENV=development\nSOME_KEY=default_value\n',
      "utf-8"
    );
    try {
      const result = validateEnv(rootDir, { envFile: ".env" });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    } finally {
      if (before !== null) fs.writeFileSync(envPath, before, "utf-8");
      else if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
    }
  });

  it("returns invalid when required variable is missing", () => {
    const rootDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(rootDir, ".env");
    fs.writeFileSync(envPath, "NODE_ENV=development\n", "utf-8");
    try {
      const result = validateEnv(rootDir, { envFile: ".env" });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes("DATABASE_URL") && e.includes("required")
        )
      ).toBe(true);
    } finally {
      if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
    }
  });

  it("returns valid when env file does not exist", () => {
    const rootDir = path.join(FIXTURES_DIR, "minimal");
    const result = validateEnv(rootDir, { envFile: ".env.nonexistent" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("initEnvExample", () => {
  it("creates .env.example from scratch when no source exists", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-init-scratch");
    const envExamplePath = path.join(tmpDir, ".env.example");
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      initEnvExample(tmpDir);
      expect(fs.existsSync(envExamplePath)).toBe(true);
      const content = fs.readFileSync(envExamplePath, "utf-8");
      expect(content).toMatch(/NODE_ENV/);
      expect(content).toMatch(/PORT/);
      expect(content).toMatch(/ENV_SCHEMA_VERSION/);
    } finally {
      try {
        fs.unlinkSync(envExamplePath);
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  });

  it("creates .env.example from an existing .env file", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-init-from");
    const envPath = path.join(tmpDir, ".env");
    const envExamplePath = path.join(tmpDir, ".env.example");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(envPath, "MY_VAR=hello\nDEBUG=true\n", "utf-8");
    try {
      initEnvExample(tmpDir);
      expect(fs.existsSync(envExamplePath)).toBe(true);
      const content = fs.readFileSync(envExamplePath, "utf-8");
      expect(content).toMatch(/MY_VAR=hello/);
      expect(content).toMatch(/DEBUG=true/);
    } finally {
      try {
        fs.unlinkSync(envPath);
        fs.unlinkSync(envExamplePath);
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  });

  it("throws when .env.example already exists", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    expect(() => initEnvExample(fixtureDir)).toThrow(/already exists/);
  });
});

describe("inferDescription", () => {
  it("strips meta tags and returns plain description", () => {
    const v: EnvVarSchema = {
      key: "PORT",
      defaultValue: "3000",
      comment:
        "Server port [REQUIRED] [TYPE: integer] [CONSTRAINTS: min=1,max=65535] Default: 3000",
      required: true,
      isCommentedOut: false,
      type: "integer",
    };
    expect(inferDescription(v)).toBe("Server port");
  });

  it("falls back to humanized key name", () => {
    const v: EnvVarSchema = {
      key: "DATABASE_URL",
      defaultValue: "",
      comment: "",
      required: false,
      isCommentedOut: false,
    };
    expect(inferDescription(v)).toBe("Database Url");
  });
});
