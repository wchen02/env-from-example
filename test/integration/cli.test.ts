import { describe, it, expect, beforeAll, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FIXTURES_DIR = path.join(PROJECT_ROOT, "test", "fixtures");
const CLI_PATH = path.join(PROJECT_ROOT, "dist", "env-from-example.ts");

function runCli(
  args: string[],
  _cwd: string
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PATH: process.env.PATH },
    encoding: "utf-8",
    timeout: 15000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("CLI integration", () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `CLI not built at ${CLI_PATH}. Run "pnpm run build" before integration tests.`
      );
    }
  });

  afterEach(() => {
    const envFiles = [
      path.join(FIXTURES_DIR, "full", ".env"),
      path.join(FIXTURES_DIR, "full", ".env.test"),
      path.join(FIXTURES_DIR, "minimal", ".env"),
      path.join(FIXTURES_DIR, "required-only", ".env"),
    ];
    for (const p of envFiles) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  });

  it("exits with error when .env.example is missing", () => {
    const result = runCli(["-y", "--cwd", "/nonexistent/dir"], PROJECT_ROOT);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/No \.env\.example found/);
  });

  it("creates .env with -y (non-interactive) from full fixture", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const result = runCli(["-y", "--cwd", fixtureDir], PROJECT_ROOT);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/successfully created\/updated/);

    const envPath = path.join(fixtureDir, ".env");
    expect(fs.existsSync(envPath)).toBe(true);

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toMatch(/# ENV_SCHEMA_VERSION="1.0"/);
    expect(content).toMatch(/DATABASE_URL=postgres:\/\/localhost:5432\/myapp/);
    expect(content).toMatch(/NODE_ENV=development/);
    expect(content).toMatch(/SESSION_SECRET=/);
  });

  it("creates .env.test with -y -e test", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const result = runCli(
      ["-y", "-e", "test", "--cwd", fixtureDir],
      PROJECT_ROOT
    );

    expect(result.status).toBe(0);

    const envPath = path.join(fixtureDir, ".env.test");
    expect(fs.existsSync(envPath)).toBe(true);

    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toMatch(/DATABASE_URL=/);
    expect(content).toMatch(/NODE_ENV=/);
  });

  it("preserves section headers in generated .env", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    runCli(["-y", "--cwd", fixtureDir], PROJECT_ROOT);

    const content = fs.readFileSync(path.join(fixtureDir, ".env"), "utf-8");
    expect(content).toMatch(/#\s+Database/);
    expect(content).toMatch(/#\s+API/);
    expect(content).toMatch(/#\s+App/);
  });

  it("uses CLI override when provided", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    runCli(
      [
        "-y",
        "--cwd",
        fixtureDir,
        "--database-url",
        "postgres://custom:5432/db",
      ],
      PROJECT_ROOT
    );

    const content = fs.readFileSync(path.join(fixtureDir, ".env"), "utf-8");
    expect(content).toMatch(/DATABASE_URL=postgres:\/\/custom:5432\/db/);
  });

  it("minimal fixture: creates .env with version and vars", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "minimal");
    const result = runCli(["-y", "--cwd", fixtureDir], PROJECT_ROOT);

    expect(result.status).toBe(0);
    const content = fs.readFileSync(path.join(fixtureDir, ".env"), "utf-8");
    expect(content).toMatch(/# ENV_SCHEMA_VERSION="2.0"/);
    expect(content).toMatch(/NODE_ENV=development/);
    expect(content).toMatch(/SOME_KEY=default_value/);
  });

  it("required-only fixture: creates .env with empty required var", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "required-only");
    const result = runCli(["-y", "--cwd", fixtureDir], PROJECT_ROOT);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/successfully created\/updated/);
    const content = fs.readFileSync(path.join(fixtureDir, ".env"), "utf-8");
    expect(content).toMatch(/REQUIRED_VAR=/);
  });

  it("--polish -y normalizes .env.example (non-interactive)", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(fixtureDir, ".env.example");
    const before = fs.readFileSync(envPath, "utf-8");
    const result = runCli(
      ["--polish", "-y", "--cwd", fixtureDir],
      PROJECT_ROOT
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\.env\.example polished/);
    const after = fs.readFileSync(envPath, "utf-8");
    expect(after).toMatch(/# ENV_SCHEMA_VERSION="1.0"/);
    expect(after).toMatch(/DATABASE_URL=postgres:\/\/localhost:5432\/myapp/);
    fs.writeFileSync(envPath, before, "utf-8");
  });

  it("--polish -y enriches comments with Default: and preserves sections", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(fixtureDir, ".env.example");
    const before = fs.readFileSync(envPath, "utf-8");
    try {
      runCli(["--polish", "-y", "--cwd", fixtureDir], PROJECT_ROOT);
      const after = fs.readFileSync(envPath, "utf-8");
      expect(after).toMatch(/Default: postgres:\/\/localhost:5432\/myapp/);
      expect(after).toMatch(/#\s+Database/);
      expect(after).toMatch(/#\s+API/);
    } finally {
      fs.writeFileSync(envPath, before, "utf-8");
    }
  });

  it("--polish exits with error when .env.example is missing", () => {
    const result = runCli(
      ["--polish", "--cwd", "/nonexistent/dir"],
      PROJECT_ROOT
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/\.env\.example not found/);
  });

  it("--version updates ENV_SCHEMA_VERSION", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "minimal");
    const envPath = path.join(fixtureDir, ".env.example");
    const before = fs.readFileSync(envPath, "utf-8");
    const result = runCli(
      ["--version", "9.9.9", "--cwd", fixtureDir],
      PROJECT_ROOT
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ENV_SCHEMA_VERSION set to 9.9.9/);
    const after = fs.readFileSync(envPath, "utf-8");
    expect(after).toMatch(/# ENV_SCHEMA_VERSION="9.9.9"/);
    fs.writeFileSync(envPath, before, "utf-8");
  });

  it("--validate exits 0 when .env conforms to schema", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(fixtureDir, ".env");
    fs.writeFileSync(
      envPath,
      '# ENV_SCHEMA_VERSION="1.0"\nDATABASE_URL=postgres://localhost:5432/myapp\nNODE_ENV=development\n',
      "utf-8"
    );
    try {
      const result = runCli(["--validate", "--cwd", fixtureDir], PROJECT_ROOT);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/valid against .env.example schema/);
    } finally {
      try {
        fs.unlinkSync(envPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("--validate exits 1 when required var is missing", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(fixtureDir, ".env");
    fs.writeFileSync(envPath, "NODE_ENV=development\n", "utf-8");
    try {
      const result = runCli(["--validate", "--cwd", fixtureDir], PROJECT_ROOT);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/DATABASE_URL|required/);
    } finally {
      try {
        fs.unlinkSync(envPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("--init creates .env.example from scratch", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-cli-init");
    fs.mkdirSync(tmpDir, { recursive: true });
    const envExamplePath = path.join(tmpDir, ".env.example");
    try {
      const result = runCli(["--init", "-y", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/\.env\.example created/);
      expect(fs.existsSync(envExamplePath)).toBe(true);
      const content = fs.readFileSync(envExamplePath, "utf-8");
      expect(content).toMatch(/NODE_ENV/);
    } finally {
      try {
        fs.unlinkSync(envExamplePath);
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  });

  it("--init fails when .env.example already exists", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const result = runCli(["--init", "--cwd", fixtureDir], PROJECT_ROOT);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already exists/);
  });

  it("--dry-run previews output without writing file", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const envPath = path.join(fixtureDir, ".env");
    try {
      const result = runCli(
        ["-y", "--dry-run", "--cwd", fixtureDir],
        PROJECT_ROOT
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Dry run/);
      expect(result.stdout).toMatch(/DATABASE_URL=/);
      expect(fs.existsSync(envPath)).toBe(false);
    } finally {
      try {
        fs.unlinkSync(envPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("shows helpful error when .env.example is missing", () => {
    const result = runCli(["-y", "--cwd", "/nonexistent/dir"], PROJECT_ROOT);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--init/);
    expect(result.stderr).toMatch(/To get started/);
  });

  it("shows post-generation summary", () => {
    const fixtureDir = path.join(FIXTURES_DIR, "full");
    const result = runCli(["-y", "--cwd", fixtureDir], PROJECT_ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/variables configured/);
  });

  it("--validate passes when hex_color values match schema pattern", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-hex-valid");
    const envExamplePath = path.join(tmpDir, ".env.example");
    const envPath = path.join(tmpDir, ".env");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      envExamplePath,
      "# Hex color [TYPE: visual/hex_color]\nBRAND_COLOR=#000000\n",
      "utf-8"
    );
    fs.writeFileSync(envPath, "BRAND_COLOR=#3b82f6\n", "utf-8");
    try {
      const result = runCli(["--validate", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/valid/);
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

  it("--validate fails when hex_color value does not match", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-hex-invalid");
    const envExamplePath = path.join(tmpDir, ".env.example");
    const envPath = path.join(tmpDir, ".env");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      envExamplePath,
      "# Hex color [TYPE: visual/hex_color]\nBRAND_COLOR=#000000\n",
      "utf-8"
    );
    fs.writeFileSync(envPath, "BRAND_COLOR=not-a-color\n", "utf-8");
    try {
      const result = runCli(["--validate", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/valid visual\/hex_color/);
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

  it("--validate passes for structured/enum with matching value", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-enum-valid");
    const envExamplePath = path.join(tmpDir, ".env.example");
    const envPath = path.join(tmpDir, ".env");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      envExamplePath,
      "# Log level [TYPE: structured/enum] [CONSTRAINTS: pattern=^(debug|info|warn|error)$]\nLOG_LEVEL=info\n",
      "utf-8"
    );
    fs.writeFileSync(envPath, "LOG_LEVEL=debug\n", "utf-8");
    try {
      const result = runCli(["--validate", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/valid/);
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

  it("--validate fails for structured/enum with non-matching value", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-enum-invalid");
    const envExamplePath = path.join(tmpDir, ".env.example");
    const envPath = path.join(tmpDir, ".env");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      envExamplePath,
      "# Log level [TYPE: structured/enum] [CONSTRAINTS: pattern=^(debug|info|warn|error)$]\nLOG_LEVEL=info\n",
      "utf-8"
    );
    fs.writeFileSync(envPath, "LOG_LEVEL=verbose\n", "utf-8");
    try {
      const result = runCli(["--validate", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/one of/);
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

  it("--polish -y preserves [TYPE] and [CONSTRAINTS] annotations", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-constraints-polish");
    const envExamplePath = path.join(tmpDir, ".env.example");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      envExamplePath,
      "# Server port [TYPE: integer] [CONSTRAINTS: min=1,max=65535]\nPORT=3000\n",
      "utf-8"
    );
    try {
      const result = runCli(["--polish", "-y", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).toBe(0);
      const after = fs.readFileSync(envExamplePath, "utf-8");
      expect(after).toMatch(/\[TYPE: integer\]/);
      expect(after).toMatch(/\[CONSTRAINTS: min=1,max=65535\]/);
      expect(after).toMatch(/PORT=3000/);
    } finally {
      try {
        fs.unlinkSync(envExamplePath);
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  });

  it("--validate with integer constraints constraints", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-int-constraints");
    const envExamplePath = path.join(tmpDir, ".env.example");
    const envPath = path.join(tmpDir, ".env");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      envExamplePath,
      "# Port [TYPE: integer] [CONSTRAINTS: min=1,max=65535]\nPORT=3000\n",
      "utf-8"
    );
    fs.writeFileSync(envPath, "PORT=8080\n", "utf-8");
    try {
      const result = runCli(["--validate", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).toBe(0);
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

  it("--validate fails for integer outside constraints bounds", () => {
    const tmpDir = path.join(FIXTURES_DIR, "..", "fixtures-int-oob");
    const envExamplePath = path.join(tmpDir, ".env.example");
    const envPath = path.join(tmpDir, ".env");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      envExamplePath,
      "# Port [TYPE: integer] [CONSTRAINTS: min=1,max=65535]\nPORT=3000\n",
      "utf-8"
    );
    fs.writeFileSync(envPath, "PORT=0\n", "utf-8");
    try {
      const result = runCli(["--validate", "--cwd", tmpDir], PROJECT_ROOT);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/>= 1/);
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
});
