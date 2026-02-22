# Reference

Detailed reference for `env-from-example` types, constraints, auto-generation, and workflows.

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

### Type Usage Examples

```env
# Server port [TYPE: integer] [CONSTRAINTS: min=1,max=65535]
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

## Constraints

The `[CONSTRAINTS: key=value,...]` annotation sets validation constraints for a variable. Available constraints depend on the type's base primitive.

### Available Constraints by Base Type

| Base type | Key | Constraint |
|-----------|--------|-----------|
| `number` (float) | `min` | Value >= min |
| `number` (float) | `max` | Value <= max |
| `number` (float) | `precision` | Max decimal places |
| `integer` | `min` | Value >= min |
| `integer` | `max` | Value <= max |
| `string` | `minLength` | Value length >= minLength |
| `string` | `maxLength` | Value length <= maxLength |
| `string` | `pattern` | Value must match regex |
| `boolean` | _(none)_ | Validates true/false/1/0/yes/no |

String sub-types (like `network/url`, `visual/hex_color`, etc.) inherit string constraints.

### Examples

```env
# Server port [TYPE: integer] [CONSTRAINTS: min=1024,max=49151]
PORT=3000

# Rate limit [TYPE: float] [CONSTRAINTS: min=0.1,max=1000,precision=1]
RATE_LIMIT=100.0

# Project slug [TYPE: string] [CONSTRAINTS: minLength=3,maxLength=50,pattern=^[a-z0-9-]+$]
PROJECT_SLUG=my-app

# Pool size [TYPE: integer] [CONSTRAINTS: min=1,max=100]
DATABASE_POOL_SIZE=10
```

### Validation Behavior

- During `env-from-example` (interactive setup): values are validated as the user types
- With `--validate`: constraints are checked and violations reported
- During `--polish`: constraints are preserved and can be set individually from the action menu (e.g., "Set min", "Set max")

---

## Enum Type (`structured/enum`)

The `structured/enum` type restricts a variable to a fixed set of values. Valid options are encoded as a regex pattern in the constraints.

### Syntax

```env
# Description [TYPE: structured/enum] [CONSTRAINTS: pattern=^(option1|option2|option3)$]
VARIABLE=option1
```

### Behavior

- **Interactive setup** — A select menu is shown with the enum choices
- **Interactive polish** — Choosing `structured/enum` prompts for the pipe-separated values
- **Validation** — `--validate` rejects values not in the set
- **Detection** — Not auto-detected; must be explicitly set via `[TYPE: structured/enum]`

### Examples

```env
# Application environment [TYPE: structured/enum] [CONSTRAINTS: pattern=^(development|staging|production)$]
NODE_ENV=development

# Log verbosity [TYPE: structured/enum] [CONSTRAINTS: pattern=^(debug|info|warn|error)$]
LOG_LEVEL=info

# Database engine [TYPE: structured/enum] [CONSTRAINTS: pattern=^(postgres|mysql|sqlite)$]
DB_ENGINE=postgres
```

---

## Auto-generation

Some types in `schema.json` have an `auto_generate` field that tells the CLI to auto-generate a value when the variable is empty.

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

The `--polish` flag normalizes `.env.example` to follow the annotation convention. It dedupes keys, preserves section headers, and ensures every variable has a description, default documentation, and applicable type/constraints annotations.

### Interactive Mode (default)

```bash
env-from-example --polish
```

For each variable, a **summary card** is displayed showing all detected fields:

```
── DATABASE_URL ────────────────────────── [1/9] ──
  Group           Database
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
| **Mark as required/optional** | Toggle whether the variable is required |
| **Edit group** | Change or create a section group |
| **Set min**, **Set max**, **Set precision**, etc. | Shown per-type; directly set or clear individual constraints |

Constraint actions appear only when relevant to the current type (e.g., `Set min` and `Set max` for integers, `Set pattern` for strings). Current values are shown inline. After any edit, the summary card is re-displayed so you can review before accepting.

### Non-interactive Mode

```bash
env-from-example --polish -y
```

Applies detection and normalization in one pass without prompts.

---

## `.env.example` Conventions Reference

| In `.env.example` | Behavior |
|-------------------|----------|
| `# ENV_SCHEMA_VERSION="1.0"` | Stored in generated `.env`; used for "up-to-date" checks |
| Comment line above a variable | Shown as description; `[REQUIRED]` triggers validation |
| `[TYPE: <name>]` in comment | Type from `schema.json` for detection and validation |
| `[CONSTRAINTS: key=value,...]` in comment | Constraints (min, max, pattern, etc.) |
| `VAR=value` | Default used if user doesn't change it |
| `VAR=` | No default; user must enter (or CLI override) |
| `# VAR=value` (commented-out) | Included in output with default; not prompted interactively |
| Lines with `------` | Section header; copied as-is into the generated `.env` |
