# env-from-example

Interactive and non-interactive CLI to set up `.env` from `.env.example`.

Walks you through each variable, validates types, auto-generates secrets, and prints a summary of what was configured. All type detection and validation are driven by a bundled [`schema.json`](schema.json).

## Quick Start

```bash
# Run without installing
npx env-from-example

# Don't have a .env.example yet? Create one:
npx env-from-example --init            # starter template
npx env-from-example --init .env       # from your existing .env
```

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

Add a `.env.example` in your project root (or run `env-from-example --init` to create one). The CLI reads variable names, optional defaults, and comment annotations (`[REQUIRED]`, `[TYPE: ...]`, `[CONSTRAINTS: ...]`, `# ENV_SCHEMA_VERSION`). Sections use a multi-line banner; variables without a group are listed under **Other** when any group is used (see [REFERENCE.md](REFERENCE.md)).

**Sample `.env.example`**:

```env
# ENV_SCHEMA_VERSION="1.0"

# ----- Database -----
# Postgres connection URL [REQUIRED] [TYPE: network/uri]
DATABASE_URL=postgres://localhost:5432/myapp

# Pool size [TYPE: integer] [CONSTRAINTS: min=1,max=100] Default: 10
DATABASE_POOL_SIZE=10

# ----- API -----
# External API key [TYPE: credentials/secret]
API_KEY=

# Base URL [TYPE: network/https_url]
API_BASE_URL=https://api.example.com/v1

# ----- App -----
# Node environment [TYPE: structured/enum] [CONSTRAINTS: pattern=^(development|staging|production)$]
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

| Flag                   | Description                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `-y, --yes`            | Non-interactive: accept existing values or defaults without prompting               |
| `-f, --force`          | Force re-run even if `.env` is already up-to-date                                   |
| `-e, --env <name>`     | Target environment (e.g., `local`, `test`, `production`)                            |
| `--cwd <path>`         | Project root directory (default: current working directory)                         |
| `--init [source]`      | Create `.env.example` from an existing env file or from scratch                     |
| `--polish`             | Polish `.env.example`: add descriptions, types, defaults (`-y` for non-interactive) |
| `--version [bump]`     | Bump or set `ENV_SCHEMA_VERSION` (`patch`, `minor`, `major`, or exact semver)       |
| `--sync-package`       | With `--version`: also update `package.json` version                                |
| `--validate [envFile]` | Validate `.env` against `.env.example` schema (exit 1 if invalid)                   |
| `--dry-run`            | Preview what would be written without creating/modifying files                      |

**Examples:**

```bash
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
env-from-example --version minor --sync-package

# Validate .env against .env.example schema
env-from-example --validate
```

## Annotations

Each variable in `.env.example` can be annotated with structured tags in the comment line above it:

```env
# <description> [REQUIRED] [TYPE: <schema-type>] [CONSTRAINTS: key=value,...] Default: <value>
VARIABLE_NAME=default_value
```

| Annotation  | Syntax                         | Purpose                                              |
| ----------- | ------------------------------ | ---------------------------------------------------- |
| Description | Free text at start of comment  | Human-readable explanation                           |
| Required    | `[REQUIRED]`                   | Variable must be non-empty                           |
| Type        | `[TYPE: <schema-type>]`        | Type from `schema.json` for validation and detection |
| Constraints | `[CONSTRAINTS: key=value,...]` | Constraints (min, max, pattern, etc.)                |
| Default     | `Default: <value>`             | Documented default (informational)                   |

All annotations are optional. The `--polish` command auto-detects and adds them.

For the full list of supported types, constraints, enum syntax, auto-generation behavior, and the polish workflow, see [REFERENCE.md](REFERENCE.md).

## CI / CD

**GitHub Actions** -- generate `.env.test` before running tests:

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

**Pre-commit hook** -- validate `.env` stays in sync:

```bash
# .husky/pre-commit
npx env-from-example --validate
```

## Requirements

- A `.env.example` file in the project root (or the path given by `--cwd`). Run `env-from-example --init` to create one.
- `schema.json` is bundled with the package and used automatically.

## License

ISC
