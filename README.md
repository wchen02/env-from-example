# env-from-example

Interactive and non-interactive CLI to set up `.env` from `.env.example`.

All type detection, validation, and auto-generation are driven by [`schema.json`](schema.json) — an ordered array of type definitions with patterns, descriptions, examples, defaults, and constraints.

## Quick Start

```bash
# Run without installing
npx env-from-example

# Don't have a .env.example yet? Create one:
npx env-from-example --init            # starter template
npx env-from-example --init .env       # from your existing .env
```

That's it. The CLI walks you through each variable, showing progress, auto-generating secrets, and printing a summary of what was configured.

## Installation

```bash
npm install -g env-from-example
# or
pnpm add -g env-from-example
# or as a dev dependency
pnpm add -D env-from-example
```

**Recommended: add a setup script** to your `package.json` so new developers can run `pnpm setup:env`:

```json
{
  "scripts": {
    "setup:env": "env-from-example",
    "setup:env:ci": "env-from-example -y"
  }
}
```

## Setup

Add a `.env.example` in your project root (or run `env-from-example --init` to create one). The CLI reads variable names, optional defaults, and comments (including `[REQUIRED]`, `[TYPE: ...]`, `[METHODS: ...]`, and `# ENV_SCHEMA_VERSION`). Section headers (lines containing `------`) are preserved in the generated `.env`.

**Sample `.env.example`**:

```env
# ENV_SCHEMA_VERSION="1.0"

# ----- Database -----
# Postgres connection URL [REQUIRED] [TYPE: network/uri]
DATABASE_URL=postgres://localhost:5432/myapp

# Pool size [TYPE: integer] [METHODS: minimum=1,maximum=100] Default: 10
DATABASE_POOL_SIZE=10

# ----- API -----
# External API key [TYPE: credentials/secret]
API_KEY=

# Base URL [TYPE: network/https_url]
API_BASE_URL=https://api.example.com/v1

# ----- App -----
# Node environment [TYPE: structured/enum] [METHODS: pattern=^(development|staging|production)$]
NODE_ENV=development

# Session secret (auto-generates when empty) [TYPE: credentials/secret]
SESSION_SECRET=

# Optional feature flag
# FEATURE_BETA=false

# Optional port
# PORT=3000
```

## Usage

Run from your project root (where `.env.example` lives):

```bash
env-from-example
```

**Options:**

| Flag | Description |
|------|-------------|
| `-y, --yes` | Non-interactive: accept existing values or defaults without prompting |
| `-f, --force` | Force re-run even if `.env` is already up-to-date |
| `-e, --env <name>` | Target environment (e.g., `local`, `test`, `production`) |
| `--cwd <path>` | Project root directory (default: current working directory) |
| `--init [source]` | Create `.env.example` from an existing env file or from scratch |
| `--polish` | Polish `.env.example`: add descriptions, types, defaults (`-y` for non-interactive) |
| `--version [bump]` | Bump or set `ENV_SCHEMA_VERSION` (`patch`, `minor`, `major`, or exact semver) |
| `--sync-package` | With `--version`: also update `package.json` version |
| `--validate [envFile]` | Validate `.env` against `.env.example` schema (exit 1 if invalid) |
| `--dry-run` | Preview what would be written without creating/modifying files |

**Examples:**

```bash
# First time? Create .env.example from an existing .env
env-from-example --init
env-from-example --init .env.local

# Interactive setup (default .env)
env-from-example

# Non-interactive: create/update .env with defaults or existing values
env-from-example -y

# Preview what would be generated (no files written)
env-from-example -y --dry-run

# Create .env.local with prompts
env-from-example -e local

# Create .env.test without prompts (e.g. CI)
env-from-example -y -e test

# Force re-run even if .env is up-to-date
env-from-example -f

# Run from another directory (e.g. monorepo package)
env-from-example --cwd ./apps/api

# Override a variable via CLI
env-from-example --database-url "postgres://prod:5432/db" -y

# Bump ENV_SCHEMA_VERSION
env-from-example --version patch
env-from-example --version 2.0.0
env-from-example --version minor --sync-package

# Validate .env against .env.example schema
env-from-example --validate
env-from-example --validate local
```

### CI / CD

**GitHub Actions** — generate `.env.test` before running tests:

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx env-from-example -y -e test
      - run: npm test
```

**Pre-commit hook** — validate `.env` stays in sync:

```bash
# .husky/pre-commit
npx env-from-example --validate
```

---

## `.env.example` Annotation Reference

Each variable in `.env.example` can be annotated with structured tags in the comment line above it. Tags are enclosed in square brackets.

### Annotation Syntax

```env
# <description> [REQUIRED] [TYPE: <schema-type>] [METHODS: <key=value,...>] Default: <value>
VARIABLE_NAME=default_value
```

All annotations are optional. The `--polish` command auto-detects and adds them.

### Summary Table

| Annotation | Syntax | Purpose |
|-----------|--------|---------|
| Description | Free text at start of comment | Human-readable explanation |
| Required | `[REQUIRED]` | Variable must be non-empty |
| Type | `[TYPE: <schema-type>]` | Type from `schema.json` for validation and detection |
| Methods | `[METHODS: key=value,...]` | Constraints for the type (min, max, pattern, etc.) |
| Default | `Default: <value>` | Documented default (informational, used by `--polish`) |

### Full Example

```env
# ENV_SCHEMA_VERSION="1.0"

# ----- Server -----
# Server port [REQUIRED] [TYPE: integer] [METHODS: minimum=1024,maximum=49151] Default: 3000
PORT=3000

# ----- Logging -----
# Log level [TYPE: structured/enum] [METHODS: pattern=^(debug|info|warn|error)$] Default: info
LOG_LEVEL=info

# ----- Security -----
# Session signing secret [TYPE: credentials/secret] Default: (empty)
SESSION_SECRET=

# ----- Database -----
# Max connection pool size [TYPE: integer] [METHODS: minimum=1,maximum=100] Default: 10
DATABASE_POOL_SIZE=10

# Connection URL [REQUIRED] [TYPE: network/uri] Default: postgres://localhost:5432/myapp
DATABASE_URL=postgres://localhost:5432/myapp

# ----- Appearance -----
# Hex color code [TYPE: visual/hex_color] Default: #3b82f6
BRAND_COLOR=#3b82f6
```

---

## Types (from `schema.json`)

Types are defined in `schema.json` as an ordered array. During type detection (`--polish` or `--init`), values are tested against each type in order — the **first match wins**.

### Type Detection Order

| # | Type name | Base type | Description |
|---|-----------|-----------|-------------|
| 1 | `credentials/private_key_pem` | string | PEM private key block |
| 2 | `network/https_url` | string | HTTPS-only URL |
| 3 | `network/url` | string | HTTP or HTTPS URL |
| 4 | `network/uri` | string | Non-HTTP service URI (postgres://, redis://, etc.) |
| 5 | `network/domain` | string | Domain/hostname with TLD |
| 6 | `network/ip` | string | IPv4 address |
| 7 | `network/ipv6` | string | IPv6 address |
| 8 | `version/semver` | string | Semantic version (MAJOR.MINOR.PATCH) |
| 9 | `id/uuid` | string | UUID (v1–v5) |
| 10 | `structured/json` | string | JSON string (validated with JSON.parse) |
| 11 | `structured/key_value_pairs` | string | Comma-separated key=value pairs |
| 12 | `locale/langtag` | string | BCP-47 language tag (en, en-US, zh-Hant-TW) |
| 13 | `structured/email_list` | string | Comma-separated emails |
| 14 | `structured/csv` | string | Comma-separated values |
| 15 | `file/windows_path` | string | Windows absolute path (C:\...) |
| 16 | `file/path` | string | POSIX file/directory path |
| 17 | `temporal/cron` | string | 5-field cron expression |
| 18 | `temporal/time_hhmm` | string | 24-hour time (HH:MM) |
| 19 | `temporal/duration` | string | Duration (30s, 5m, 1h, 7d) |
| 20 | `credentials/secret` | string | API key / token / secret (>= 16 chars) |
| 21 | `visual/hex_color` | string | Hex color (#RGB, #RRGGBB, #RRGGBBAA) |
| 22 | `structured/enum` | string | Enumerated value from fixed set |
| 23 | `float` | number | Floating-point number |
| 24 | `integer` | integer | Whole number |
| 25 | `boolean` | boolean | true/false/1/0/yes/no |
| 26 | `string` | string | Final fallback |

### How Detection Works

1. **Explicit tag** — `[TYPE: network/url]` in the comment (highest priority)
2. **Pattern matching** — Value is tested against each type's regex pattern in order
3. **Primitive fallbacks** — If no pattern matches, float/integer/boolean checks are applied
4. **String fallback** — Everything else is `string`

The interactive `--polish` shows the detected type and its source so you can verify and override.

### Usage Examples

```env
# Server port [TYPE: integer] [METHODS: minimum=1,maximum=65535]
PORT=3000

# Enable debug mode [TYPE: boolean]
DEBUG=false

# API endpoint [TYPE: network/https_url]
API_URL=https://api.example.com

# Connection string [TYPE: network/uri]
DATABASE_URL=postgres://localhost:5432/mydb

# Feature flags as JSON [TYPE: structured/json]
FEATURES={"darkMode":true}

# Timeout duration [TYPE: temporal/duration]
REQUEST_TIMEOUT=30s

# Build version [TYPE: version/semver]
APP_VERSION=1.0.0
```

---

## Methods (Constraints)

The `[METHODS: key=value,...]` annotation sets validation constraints for a variable. Available methods depend on the type's base primitive.

### Available Methods by Base Type

| Base type | Method | Constraint |
|-----------|--------|-----------|
| `number` (float) | `minimum` | Value >= minimum |
| `number` (float) | `maximum` | Value <= maximum |
| `number` (float) | `precision` | Max decimal places |
| `integer` | `minimum` | Value >= minimum |
| `integer` | `maximum` | Value <= maximum |
| `string` | `minLength` | Value length >= minLength |
| `string` | `maxLength` | Value length <= maxLength |
| `string` | `pattern` | Value must match regex |
| `boolean` | _(none)_ | Validates true/false/1/0/yes/no |

String sub-types (like `network/url`, `visual/hex_color`, etc.) inherit string methods.

### Examples

```env
# Server port [TYPE: integer] [METHODS: minimum=1024,maximum=49151]
PORT=3000

# Rate limit [TYPE: float] [METHODS: minimum=0.1,maximum=1000,precision=1]
RATE_LIMIT=100.0

# Project slug [TYPE: string] [METHODS: minLength=3,maxLength=50,pattern=^[a-z0-9-]+$]
PROJECT_SLUG=my-app

# Pool size [TYPE: integer] [METHODS: minimum=1,maximum=100]
DATABASE_POOL_SIZE=10
```

### Validation Behavior

- During `env-from-example` (interactive setup): values are validated as the user types
- With `--validate`: constraints are checked and violations reported
- During `--polish`: constraints are preserved and can be edited via "Edit methods/constraints"

---

## Enum Type (`structured/enum`)

The `structured/enum` type restricts a variable to a fixed set of values. Valid options are encoded as a regex pattern in the methods.

### Syntax

```env
# Description [TYPE: structured/enum] [METHODS: pattern=^(option1|option2|option3)$]
VARIABLE=option1
```

### Behavior

- **Interactive setup** — A select menu is shown with the enum choices
- **Interactive polish** — Choosing `structured/enum` prompts for the pipe-separated values
- **Validation** — `--validate` rejects values not in the set
- **Detection** — Not auto-detected; must be explicitly set via `[TYPE: structured/enum]`

### Examples

```env
# Application environment [TYPE: structured/enum] [METHODS: pattern=^(development|staging|production)$]
NODE_ENV=development

# Log verbosity [TYPE: structured/enum] [METHODS: pattern=^(debug|info|warn|error)$]
LOG_LEVEL=info

# Database engine [TYPE: structured/enum] [METHODS: pattern=^(postgres|mysql|sqlite)$]
DB_ENGINE=postgres
```

---

## Auto-generation

Some types in `schema.json` have an `auto_generate` field that tells the CLI to auto-generate a value when the variable is empty. This is useful for secrets, keys, and UUIDs that should be unique per environment.

### Types with Auto-generation

| Type | auto_generate | Output |
|------|--------------|--------|
| `credentials/private_key_pem` | `rsa_private_key` | RSA 2048-bit PEM private key |
| `id/uuid` | `uuidv4` | UUID v4 (36 chars) |
| `credentials/secret` | `random_secret_32` | 32-byte base64 string (~44 chars) |

### How It Works

1. During `env-from-example` (setup), if a variable's type has `auto_generate` and the current value is empty, a random value is generated and used as the default
2. With `-y` (non-interactive), auto-generated values are written directly
3. The generated value is shown in the summary as "auto-generated"

### Examples

```env
# Session signing secret [TYPE: credentials/secret]
SESSION_SECRET=

# Request tracking ID [TYPE: id/uuid]
TRACE_ID=

# Service private key [TYPE: credentials/private_key_pem]
SERVICE_KEY=
```

---

## Defaults

The default value for a variable is specified directly in the assignment:

```env
# Description
VARIABLE=default_value
```

### Default Behavior

| Scenario | What happens |
|----------|-------------|
| `VAR=value` | `value` is shown as the default in prompts; used with `-y` |
| `VAR=` | No default; user must enter a value (or it stays empty). Required if `[REQUIRED]` |
| `VAR=` with auto_generate type | A random value is generated and shown as the default |
| `# VAR=value` (commented out) | Variable is included in output with that default; **not** prompted interactively |

### Schema Type Defaults

Each type in `schema.json` may have a `default` field. These are used as documentation references but not applied automatically — the value in `.env.example` takes precedence.

### Resolving the Final Value

During `env-from-example` (setup), the final value is resolved in this order:

1. **CLI flag** (`--database-url "..."`) — highest priority
2. **Existing `.env`** — if the variable already exists in the target `.env` file
3. **Auto-generated** — if the type has `auto_generate` and the value is empty
4. **Default from `.env.example`** — the value after `=`
5. **User input** — prompted in interactive mode

---

## Interactive Polish (`--polish`)

The `--polish` flag normalizes `.env.example` to follow the annotation convention. It dedupes keys, preserves section headers, and ensures every variable has a description, default documentation, and applicable type/methods annotations.

### Interactive Mode (default)

```bash
env-from-example --polish
```

For each variable, a **summary card** is displayed showing all detected fields:

```
── DATABASE_URL ────────────────────────── [1/9] ──
  Description     Postgres connection URL           from comment
  Type            network/uri                        detected
                  Non-HTTP service URI (postgres://, redis://, s3://)
  Examples        postgres://user:pass@db:5432/mydb, redis://...
  Required        yes                                from [REQUIRED] tag
  Default         postgres://localhost:5432/myapp
──────────────────────────────────────────────────────
? Action › Accept
```

### Available Actions

| Action | What it does |
|--------|-------------|
| **Accept** | Keep all detected values and move to the next variable |
| **Edit description** | Change the human-readable description text |
| **Edit type** | Select a type from the full `schema.json` list |
| **Edit default** | Choose between a static value or auto-generation (if type supports it) |
| **Edit required** | Toggle whether the variable is required |
| **Edit methods/constraints** | Set min/max/precision/minLength/maxLength/pattern based on type |

After any edit, the summary card is re-displayed so you can review before accepting.

### Non-interactive Mode

```bash
env-from-example --polish -y
```

Applies detection and normalization in one pass without prompts.

---

### Initialize .env.example (`--init`)

```bash
# Create a starter .env.example (NODE_ENV + PORT)
env-from-example --init

# Create .env.example from an existing .env (infers types from values)
env-from-example --init .env
```

If a source file exists, the tool reads its variables and detects types using the `schema.json` type detection order. If no source file exists, a minimal template is created.

### Dry Run (`--dry-run`)

Preview what would be written without modifying any files:

```bash
env-from-example -y --dry-run
env-from-example -y -e test --dry-run
```

### Validate (`--validate`)

Check that an env file conforms to the schema defined in `.env.example`:

- **Required variables** must be present and non-empty
- **Type patterns** from `schema.json` are validated (e.g., URL format, hex color)
- **Methods constraints** (minimum, maximum, minLength, maxLength, pattern, precision) are checked
- **Enum values** must match one of the defined options

Exits with code 1 if any validation error is found. Useful in CI or pre-commit hooks.

---

## `.env.example` Conventions Reference

| In `.env.example` | Behavior |
|-------------------|----------|
| `# ENV_SCHEMA_VERSION="1.0"` | Stored in generated `.env`; used for "up-to-date" checks |
| Comment line above a variable | Shown as description; `[REQUIRED]` triggers validation |
| `[TYPE: <name>]` in comment | Type from `schema.json` for detection and validation |
| `[METHODS: key=value,...]` in comment | Constraints (min, max, pattern, etc.) |
| `VAR=value` | Default used if user doesn't change it |
| `VAR=` | No default; user must enter (or CLI override) |
| `# VAR=value` (commented-out) | Included in output with default; not prompted interactively |
| Lines with `------` | Section header; copied as-is into the generated `.env` |

## Requirements

- A `.env.example` file in the project root (or the path given by `--cwd`). Run `env-from-example --init` to create one.
- Optional: `schema.json` is bundled with the package and used automatically.

## License

ISC
