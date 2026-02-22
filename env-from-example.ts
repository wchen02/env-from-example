#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { Command } from 'commander';
import { input, confirm, select } from '@inquirer/prompts';
import pc from 'picocolors';
import dotenv from 'dotenv';

// ─── Schema loading ─────────────────────────────────────────────────────────

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

let _schema: EnvSchema | null = null;

export function loadSchema(customPath?: string): EnvSchema {
  if (_schema && !customPath) return _schema;
  if (customPath) {
    return JSON.parse(fs.readFileSync(customPath, 'utf-8')) as EnvSchema;
  }
  const selfPath = fileURLToPath(import.meta.url);
  const dir = path.dirname(selfPath);
  for (const candidate of [
    path.join(dir, '..', 'schema.json'),
    path.join(dir, 'schema.json'),
  ]) {
    if (fs.existsSync(candidate)) {
      _schema = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as EnvSchema;
      return _schema;
    }
  }
  throw new Error('schema.json not found');
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
  if (m) return m[1].split('|').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Return the available method descriptors for a type.
 * If the type itself defines constraints, use those.
 * Otherwise, fall back to the constraints of the corresponding primitive type.
 */
export function getAvailableConstraints(typeName: string): Record<string, string> {
  const st = findSchemaType(typeName);
  if (!st) return {};
  if (st.constraints) return st.constraints;
  const baseName: Record<string, string> = {
    number: 'float',
    integer: 'integer',
    boolean: 'boolean',
    string: 'string',
  };
  const base = baseName[st.type];
  if (base) {
    const bt = findSchemaType(base);
    return bt?.constraints || {};
  }
  return {};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getRootDirFromArgv(): string {
  const argv = process.argv;
  const cwdIdx = argv.indexOf('--cwd');
  if (cwdIdx !== -1 && argv[cwdIdx + 1]) {
    return path.resolve(argv[cwdIdx + 1]);
  }
  return process.cwd();
}

// ─── EnvVarSchema ────────────────────────────────────────────────────────────

export interface EnvVarSchema {
  key: string;
  defaultValue: string;
  comment: string;
  required: boolean;
  isCommentedOut: boolean;
  /** Full schema type name, e.g. "network/url", "integer", "credentials/secret". */
  type?: string;
  /** Constraint values parsed from [CONSTRAINTS: k=v,...] in comment. */
  constraints?: Record<string, string>;
}

// ─── Comment parsing ─────────────────────────────────────────────────────────

/**
 * Parse [TYPE: full/name] and [CONSTRAINTS: k=v,k=v] from comment text.
 * Also parses [REQUIRED] (handled separately in caller).
 */
function parseSchemaMeta(
  comment: string,
  _key: string,
): Pick<EnvVarSchema, 'type' | 'constraints'> {
  const full = comment.replace(/\s+/g, ' ');
  const out: Pick<EnvVarSchema, 'type' | 'constraints'> = {};

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
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        constraints[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim();
      }
    }
    if (Object.keys(constraints).length > 0) out.constraints = constraints;
  }

  return out;
}

// ─── File parsing ────────────────────────────────────────────────────────────

export function parseEnvExample(
  rootDir: string,
): { version: string | null; variables: EnvVarSchema[] } {
  const envExamplePath = path.join(rootDir, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    throw new Error(`.env.example not found at ${envExamplePath}`);
  }

  const content = fs.readFileSync(envExamplePath, 'utf-8');
  const lines = content.split('\n');
  const variables: EnvVarSchema[] = [];
  let currentComments: string[] = [];
  let currentSection = '';
  let version = null;
  let inBannerBlock = false;
  let bannerGroupName = '';

  const buildComment = (comments: string[]): string => {
    const parts = currentSection
      ? [currentSection, ...comments]
      : comments;
    return parts.join('\n');
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#\s*={5,}\s*$/.test(trimmed)) {
      if (!inBannerBlock) {
        inBannerBlock = true;
        bannerGroupName = '';
      } else {
        if (bannerGroupName) {
          currentSection = `# ------ ${bannerGroupName} ------`;
        }
        currentComments = [];
        inBannerBlock = false;
      }
      continue;
    }

    if (inBannerBlock) {
      bannerGroupName = trimmed.replace(/^#\s*/, '').trim();
      continue;
    }

    if (trimmed.startsWith('# ENV_SCHEMA_VERSION=')) {
      const match = trimmed.match(/# ENV_SCHEMA_VERSION="?([^"]+)"?/);
      if (match) version = match[1];
      continue;
    }

    if (trimmed.startsWith('#')) {
      const maybeVarMatch = trimmed.match(/^#\s*([A-Z0-9_]+)=(.*)$/);
      if (maybeVarMatch && !trimmed.includes('------')) {
        let val = maybeVarMatch[2].trim();
        val = val.split(' #')[0].trim();
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
          ...meta,
        });
        currentComments = [];
        continue;
      }

      if (trimmed.includes('------')) {
        currentSection = trimmed;
        currentComments = [];
      } else {
        currentComments.push(trimmed.replace(/^#\s*/, ''));
      }
      continue;
    }

    if (!trimmed) {
      currentComments = [];
      continue;
    }

    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      val = val.split(' #')[0].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      const fullComment = currentComments.join(' ');
      const required = fullComment.toUpperCase().includes('[REQUIRED]');
      const commentStr = buildComment(currentComments);
      const meta = parseSchemaMeta(commentStr, match[1]);

      variables.push({
        key: match[1],
        defaultValue: val,
        comment: commentStr,
        required,
        isCommentedOut: false,
        ...meta,
      });
      currentComments = [];
    } else {
      currentComments = [];
    }
  }

  return { version, variables };
}

export function getExistingEnvVersion(content: string): string | null {
  const match = content.match(/# ENV_SCHEMA_VERSION="?([^"\n]+)"?/);
  return match ? match[1] : null;
}

const ENV_FROM_EXAMPLE_CREDIT =
  '# env-from-example (https://www.npmjs.com/package/env-from-example)';

/** Serialize variables and optional version to .env.example content. */
export function serializeEnvExample(
  version: string | null,
  variables: EnvVarSchema[],
): string {
  const lines: string[] = [ENV_FROM_EXAMPLE_CREDIT, ''];
  if (version !== null && version !== undefined) {
    lines.push(`# ENV_SCHEMA_VERSION="${version}"`);
    lines.push('');
  }
  const grouped = groupVariablesBySection(variables);
  let lastGroup = '';
  for (const v of grouped) {
    const hdr = v.comment.split('\n').find((l) => l.includes('------'));
    const group = hdr ? extractGroupName(hdr) : '';
    if (group && group !== lastGroup) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      lines.push(...renderGroupBanner(group));
      lines.push('');
      lastGroup = group;
    }
    const commentLines = v.comment
      .split('\n')
      .filter((l) => l && !l.includes('------'));
    for (const c of commentLines) {
      lines.push('# ' + c.replace(/^#\s*/, ''));
    }
    const needsQuotes =
      /[\s#"']/.test(v.defaultValue) || v.defaultValue === '';
    const value =
      needsQuotes && v.defaultValue !== ''
        ? `"${v.defaultValue.replace(/"/g, '\\"')}"`
        : v.defaultValue;
    if (v.isCommentedOut) {
      lines.push(`# ${v.key}=${value}`);
    } else {
      lines.push(`${v.key}=${value}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ─── Dedup ───────────────────────────────────────────────────────────────────

function dedupeVariables(variables: EnvVarSchema[]): EnvVarSchema[] {
  const seen = new Set<string>();
  return variables.filter((v) => {
    if (seen.has(v.key)) return false;
    seen.add(v.key);
    return true;
  });
}

// ─── Description helpers ─────────────────────────────────────────────────────

function humanizeEnvKey(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Strip [REQUIRED], [TYPE: ...], [CONSTRAINTS: ...], Default: ... from comment
 * to get the plain description text.
 */
function stripMetaFromComment(comment: string): string {
  return comment
    .replace(/^.*------.*$/gm, '')
    .replace(/\s*\[REQUIRED\]\s*/gi, ' ')
    .replace(/\s*\[TYPE:\s*[^\]]+\]\s*/gi, ' ')
    .replace(/\s*\[CONSTRAINTS:\s*[^\]]+\]\s*/gi, ' ')
    .replace(/\s*Default:\s*[^\n]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferDescription(v: EnvVarSchema): string {
  const plain = stripMetaFromComment(v.comment);
  if (plain) return plain;
  return humanizeEnvKey(v.key);
}

// ─── Type detection ──────────────────────────────────────────────────────────

/**
 * Detect the schema type for a value by iterating schema.types in order.
 * Returns the type name or undefined if nothing matches (shouldn't happen
 * because "string" is the final fallback).
 */
export function detectType(
  value: string,
  key: string,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const types = getSchemaTypes();
  for (const t of types) {
    if (matchesSchemaType(t, trimmed, key)) return t.name;
  }
  return undefined;
}

function matchesSchemaType(
  t: SchemaType,
  value: string,
  key: string,
): boolean {
  // Pattern-based types
  if (t.pattern) {
    // file/path pattern is very broad; require path-like characters
    if (t.name === 'file/path' && !/[/\\]|^[.~]/.test(value)) return false;
    // locale/langtag matches short alpha strings (2-3 chars); exclude booleans
    if (t.name === 'locale/langtag' && /^(true|false|yes|no|on|off|ok)$/i.test(value)) return false;

    try {
      if (!new RegExp(t.pattern).test(value)) return false;
    } catch {
      return false;
    }
    // structured/json needs JSON.parse validation too
    if (t.name === 'structured/json') {
      try {
        JSON.parse(value);
      } catch {
        return false;
      }
    }
    return true;
  }

  // credentials/secret: key-name heuristic + minLength
  if (t.name === 'credentials/secret' && t.minLength !== undefined) {
    return (
      /SECRET|KEY|TOKEN|PASSWORD|SALT|BEARER|CREDENTIAL|AUTH/i.test(key) &&
      value.length >= t.minLength
    );
  }

  // Primitive fallbacks
  if (t.name === 'float' && t.type === 'number') {
    return /^-?\d*\.\d+$/.test(value) && !isNaN(parseFloat(value));
  }
  if (t.name === 'integer' && t.type === 'integer') {
    return /^-?\d+$/.test(value) && !isNaN(parseInt(value, 10));
  }
  if (t.name === 'boolean' && t.type === 'boolean') {
    return /^(true|false|1|0|yes|no)$/i.test(value);
  }
  if (t.name === 'string' && t.type === 'string' && !t.pattern) {
    return true;
  }

  return false;
}

// ─── Grouping helpers ────────────────────────────────────────────────────────

function extractGroupName(sectionHeader: string): string {
  const m = sectionHeader.match(/------\s*(.+?)\s*------/);
  return m ? m[1].trim() : '';
}

/** Internal single-line marker stored in comment field. */
function buildSectionHeader(groupName: string): string {
  return `# ------ ${groupName} ------`;
}

/** Visual multi-line banner for serialized output. */
function renderGroupBanner(groupName: string): string[] {
  const W = 40;
  const bar = '# ' + '='.repeat(W);
  const padLen = Math.max(1, Math.floor((W - groupName.length) / 2));
  const center = '#' + ' '.repeat(padLen) + groupName;
  return [bar, center, bar];
}

/** Reorder variables so same-group variables are contiguous, preserving first-appearance order. */
function groupVariablesBySection(variables: EnvVarSchema[]): EnvVarSchema[] {
  const groups = new Map<string, EnvVarSchema[]>();
  const groupOrder: string[] = [];
  for (const v of variables) {
    const hdr = v.comment.split('\n').find((l) => l.includes('------'));
    const group = hdr ? extractGroupName(hdr) : '';
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

// ─── Comment building ────────────────────────────────────────────────────────

function buildCommentLine(parts: {
  description: string;
  required: boolean;
  type?: string;
  constraints?: Record<string, string>;
  defaultValue: string;
}): string {
  const meta: string[] = [];
  if (parts.required) meta.push('[REQUIRED]');
  if (parts.type) meta.push(`[TYPE: ${parts.type}]`);
  if (parts.constraints && Object.keys(parts.constraints).length > 0) {
    const constraintsStr = Object.entries(parts.constraints)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    meta.push(`[CONSTRAINTS: ${constraintsStr}]`);
  }
  meta.push(
    parts.defaultValue === '' ? 'Default: (empty)' : `Default: ${parts.defaultValue}`,
  );
  return parts.description + '\n' + meta.join(' ');
}

function enrichVariablesForPolish(variables: EnvVarSchema[]): EnvVarSchema[] {
  return variables.map((v) => {
    const commentLines = v.comment
      .split('\n')
      .filter((l) => l && !l.includes('------'));
    const sectionHeader = v.comment
      .split('\n')
      .find((l) => l.includes('------'));
    let description =
      commentLines
        .find((l) => !l.toUpperCase().includes('[REQUIRED]'))
        ?.trim() || '';
    if (!description) description = humanizeEnvKey(v.key);

    const type = v.type || detectType(v.defaultValue, v.key);

    const line = buildCommentLine({
      description,
      required: v.required,
      type,
      constraints: v.constraints,
      defaultValue: v.defaultValue,
    });
    const newComment = [sectionHeader, line].filter(Boolean).join('\n');
    return { ...v, comment: newComment, type };
  });
}

// ─── Version management ──────────────────────────────────────────────────────

function getDefaultSchemaVersion(rootDir: string): string {
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        version?: string;
      };
      if (pkg.version && typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* ignore */
    }
  }
  return '1.0.0';
}

// ─── Polish (non-interactive) ────────────────────────────────────────────────

export function polishEnvExample(rootDir: string): void {
  const envExamplePath = path.join(rootDir, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    throw new Error(`.env.example not found at ${envExamplePath}`);
  }
  const { version, variables } = parseEnvExample(rootDir);
  const deduped = dedupeVariables(variables);
  const enriched = enrichVariablesForPolish(deduped);
  const effectiveVersion = version ?? getDefaultSchemaVersion(rootDir);
  const content = serializeEnvExample(effectiveVersion, enriched);
  fs.writeFileSync(envExamplePath, content, 'utf-8');
}

// ─── Interactive polish ──────────────────────────────────────────────────────

function printVariableSummary(
  key: string,
  index: number,
  total: number,
  fields: {
    description: string;
    descSource: string;
    type: string | undefined;
    typeSource: string;
    schemaType: SchemaType | undefined;
    constraints: Record<string, string>;
    required: boolean;
    reqSource: string;
    defaultValue: string;
    group: string;
  },
): number {
  const progress = `[${index}/${total}]`;
  const W = 60;
  const keyPart = `── ${key} `;
  const progPart = ` ${progress} ──`;
  const fill = Math.max(0, W - keyPart.length - progPart.length);
  const header = keyPart + '─'.repeat(fill) + progPart;

  console.log('');
  console.log(pc.cyan(pc.bold(header)));

  const L = 16;
  const pad = (s: string) => s.padEnd(L);
  const row = (label: string, value: string, source: string) => {
    const src = source ? '  ' + pc.dim(pc.yellow(source)) : '';
    console.log(`  ${pc.gray(pad(label))}${value}${src}`);
  };

  row('Group', fields.group ? pc.white(fields.group) : pc.dim('(none)'), '');
  row('Description', pc.white(fields.description), fields.descSource);

  if (fields.type && fields.schemaType) {
    const desc = fields.schemaType.description;
    const short = desc.length > 50 ? desc.substring(0, 47) + '...' : desc;
    row('Type', pc.cyan(fields.type), fields.typeSource);
    console.log(`  ${' '.repeat(L)}${pc.dim(short)}`);
  } else if (fields.type) {
    row('Type', pc.cyan(fields.type), fields.typeSource);
  } else {
    row('Type', pc.dim('(none)'), '');
  }

  if (fields.schemaType?.examples && fields.schemaType.examples.length > 0) {
    const exStr = fields.schemaType.examples
      .map((e) => String(e))
      .join(', ');
    const short = exStr.length > 50 ? exStr.substring(0, 47) + '...' : exStr;
    row('Examples', pc.dim(short), '');
  }

  if (fields.type === 'structured/enum' && fields.constraints.pattern) {
    const choices = parseEnumChoices(fields.constraints.pattern);
    if (choices.length > 0) {
      row('Choices', choices.join(pc.dim(' | ')), '');
    }
  }

  const methodEntries = Object.entries(fields.constraints).filter(([k]) => {
    if (k === 'pattern' && fields.type !== 'string') return false;
    if (k === 'pattern' && fields.type === 'structured/enum') return false;
    return true;
  });
  if (methodEntries.length > 0) {
    const mStr = methodEntries.map(([k, v]) => `${k}=${v}`).join(', ');
    row('Constraints', pc.white(mStr), 'from [CONSTRAINTS]');
  }

  row(
    'Required',
    fields.required ? pc.green('yes') : pc.dim('no'),
    fields.reqSource,
  );

  const autoGen = fields.schemaType?.auto_generate;
  if (autoGen && !fields.defaultValue) {
    row(
      'Default',
      pc.magenta(`auto (${autoGen})`),
      'from schema type',
    );
  } else if (fields.defaultValue) {
    row('Default', pc.white(fields.defaultValue), '');
  } else {
    row('Default', pc.dim('(empty)'), '');
  }

  console.log(pc.gray('─'.repeat(W)));
  return W;
}

export async function polishEnvExampleInteractive(
  rootDir: string,
): Promise<void> {
  const envExamplePath = path.join(rootDir, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    throw new Error(`.env.example not found at ${envExamplePath}`);
  }
  const { version, variables } = parseEnvExample(rootDir);
  const deduped = dedupeVariables(variables);
  const effectiveVersion = version ?? getDefaultSchemaVersion(rootDir);
  const polished: EnvVarSchema[] = [];
  const total = deduped.length;

  const knownGroups = new Set<string>();
  for (const v of deduped) {
    const hdr = v.comment.split('\n').find((l) => l.includes('------'));
    if (hdr) {
      const name = extractGroupName(hdr);
      if (name) knownGroups.add(name);
    }
  }

  console.log(
    pc.cyan(pc.bold('  Interactive polish')) +
      pc.dim(` — ${total} variables to review\n`),
  );

  for (let i = 0; i < deduped.length; i++) {
    const v = deduped[i];
    const existingHeader = v.comment
      .split('\n')
      .find((l) => l.includes('------'));
    let group = existingHeader ? extractGroupName(existingHeader) : '';

    let description = inferDescription(v);
    let descSource = stripMetaFromComment(v.comment)
      ? 'from comment'
      : 'inferred from key';

    let type: string | undefined =
      v.type || detectType(v.defaultValue, v.key);
    let typeSource: string;
    if (v.type) typeSource = 'from [TYPE] tag';
    else if (type) typeSource = 'detected';
    else typeSource = '';

    let schemaType = type ? findSchemaType(type) : undefined;

    let required = v.required;
    let reqSource = v.required ? 'from [REQUIRED] tag' : '';

    let constraints: Record<string, string> = v.constraints
      ? { ...v.constraints }
      : {};

    let defaultValue = v.defaultValue;

    let accepted = false;
    while (!accepted) {
      printVariableSummary(v.key, i + 1, total, {
        description,
        descSource,
        type,
        typeSource,
        schemaType,
        constraints,
        required,
        reqSource,
        defaultValue,
        group,
      });

      const availableConstraints = type ? getAvailableConstraints(type) : {};
      const methodEntries = Object.entries(availableConstraints).filter(
        ([mKey]) => !(type === 'structured/enum' && mKey === 'pattern'),
      );

      const actionChoices: { name: string; value: string }[] = [
        { name: pc.green('Accept'), value: 'accept' },
        { name: 'Edit description', value: 'edit_desc' },
        { name: 'Edit type', value: 'edit_type' },
        { name: 'Edit default', value: 'edit_default' },
        { name: required ? 'Mark as optional' : 'Mark as required', value: 'edit_required' },
        { name: 'Edit group', value: 'edit_group' },
      ];
      for (const [mKey] of methodEntries) {
        const current = constraints[mKey];
        const label = current
          ? `Set ${mKey} ${pc.dim(`(${current})`)}`
          : `Set ${mKey}`;
        actionChoices.push({ name: label, value: `set_method:${mKey}` });
      }

      const action = await select({
        message: 'Action',
        choices: actionChoices,
        default: 'accept',
      });

      if (action === 'accept') {
        accepted = true;
      } else if (action === 'edit_desc') {
        description = await input({
          message: 'Description',
          default: description,
        });
        descSource = '';
      } else if (action === 'edit_type') {
        const allTypes = getSchemaTypes();
        const trimmedValue = defaultValue.trim();
        const matchingTypes = trimmedValue
          ? allTypes.filter((t) => matchesSchemaType(t, trimmedValue, v.key))
          : [];
        const matchingNames = new Set(matchingTypes.map((t) => t.name));
        const otherTypes = allTypes.filter((t) => !matchingNames.has(t.name));

        const formatType = (t: SchemaType) => ({
          name: `${t.name}${pc.dim(' — ' + t.description.substring(0, 50))}`,
          value: t.name,
        });

        let newType: string;
        if (matchingTypes.length > 0) {
          const picked = await select({
            message: 'Type',
            choices: [
              { name: pc.dim('(none)'), value: '' },
              ...matchingTypes.map(formatType),
              { name: pc.cyan('Other...'), value: '__other__' },
            ],
            default: type ?? '',
          });
          if (picked === '__other__') {
            newType = await select({
              message: 'Type',
              choices: [
                { name: pc.dim('(none)'), value: '' },
                ...otherTypes.map(formatType),
              ],
              default: '',
            });
          } else {
            newType = picked;
          }
        } else {
          newType = await select({
            message: 'Type',
            choices: [
              { name: pc.dim('(none)'), value: '' },
              ...allTypes.map(formatType),
            ],
            default: type ?? '',
          });
        }

        if (newType === 'structured/enum') {
          const currentChoices = constraints.pattern
            ? parseEnumChoices(constraints.pattern)
            : [];
          const choicesStr = await input({
            message:
              'Enum values (pipe-separated, e.g. debug|info|warn|error)',
            default: currentChoices.join('|'),
            validate: (val) =>
              val.trim().length > 0 || 'At least one value is required',
          });
          const values = choicesStr
            .split(/[|,]/)
            .map((s) => s.trim())
            .filter(Boolean);
          constraints = { pattern: `^(${values.join('|')})$` };
        } else if (newType) {
          const newAvailable = getAvailableConstraints(newType);
          const cleaned: Record<string, string> = {};
          for (const [k, val] of Object.entries(constraints)) {
            if (k in newAvailable) cleaned[k] = val;
          }
          constraints = cleaned;
        } else {
          constraints = {};
        }

        type = newType || undefined;
        schemaType = type ? findSchemaType(type) : undefined;
        typeSource = '';
      } else if (action === 'edit_default') {
        const autoGen = schemaType?.auto_generate;
        if (autoGen) {
          const defaultChoices = [
            { name: 'Enter a static value', value: 'static' },
            {
              name:
                pc.magenta(`auto:${autoGen}`) +
                pc.dim(' — auto-generate when empty'),
              value: 'auto',
            },
          ];
          const choice = await select({
            message: 'Default value',
            choices: defaultChoices,
            default: defaultValue ? 'static' : 'auto',
          });
          if (choice === 'auto') {
            defaultValue = '';
          } else {
            defaultValue = await input({
              message: 'Value',
              default: defaultValue,
            });
          }
        } else {
          defaultValue = await input({
            message: 'Value',
            default: defaultValue,
          });
        }
      } else if (action === 'edit_required') {
        required = !required;
        reqSource = '';
      } else if (action === 'edit_group') {
        const groupChoices: { name: string; value: string }[] = [
          { name: pc.dim('(none)'), value: '' },
          ...[...knownGroups].map((g) => ({ name: g, value: g })),
          { name: pc.cyan('+ New group...'), value: '__new__' },
        ];
        const picked = await select({
          message: 'Group',
          choices: groupChoices,
          default: group || '',
        });
        if (picked === '__new__') {
          const newGroup = await input({
            message: 'Group name (e.g. Database, Auth, App)',
            validate: (val) =>
              val.trim().length > 0 || 'Group name is required',
          });
          group = newGroup.trim();
          knownGroups.add(group);
        } else {
          group = picked;
        }
      } else if (action.startsWith('set_method:')) {
        const mKey = action.slice('set_method:'.length);
        if (mKey === 'pattern') {
          const patternStr = await input({
            message: 'Pattern (regex, e.g. ^[a-z0-9-]+$) [empty to clear]',
            default: constraints.pattern || '',
          });
          if (patternStr.trim()) {
            constraints.pattern = patternStr.trim();
          } else {
            delete constraints.pattern;
          }
        } else {
          const current = constraints[mKey] || '';
          const val = await input({
            message: `${mKey} [empty to clear]`,
            default: current,
          });
          if (val.trim()) {
            constraints[mKey] = val.trim();
          } else {
            delete constraints[mKey];
          }
        }
      }
    }

    const commentLine = buildCommentLine({
      description,
      required,
      type,
      constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
      defaultValue,
    });
    const sectionHeader = group ? buildSectionHeader(group) : undefined;
    const newComment = [sectionHeader, commentLine]
      .filter(Boolean)
      .join('\n');
    polished.push({
      ...v,
      comment: newComment,
      defaultValue,
      required,
      type,
      constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
    });
  }

  const content = serializeEnvExample(effectiveVersion, polished);
  fs.writeFileSync(envExamplePath, content, 'utf-8');
}

// ─── Semver helpers ──────────────────────────────────────────────────────────

function parseSemver(s: string): [number, number, number] {
  const parts = s.replace(/^v/i, '').split('.');
  const major = Math.max(0, parseInt(parts[0] || '0', 10) || 0);
  const minor = Math.max(0, parseInt(parts[1] || '0', 10) || 0);
  const patch = Math.max(0, parseInt(parts[2] || '0', 10) || 0);
  return [major, minor, patch];
}

export function bumpSemver(
  current: string,
  bump: 'patch' | 'minor' | 'major',
): string {
  const [major, minor, patch] = parseSemver(current);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function updateEnvSchemaVersion(
  rootDir: string,
  newVersion: string,
  options: { syncPackage?: boolean } = {},
): void {
  const envExamplePath = path.join(rootDir, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    throw new Error(`.env.example not found at ${envExamplePath}`);
  }
  const { variables } = parseEnvExample(rootDir);
  const content = serializeEnvExample(newVersion, variables);
  fs.writeFileSync(envExamplePath, content, 'utf-8');

  if (options.syncPackage) {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        version?: string;
      };
      pkg.version = newVersion;
      fs.writeFileSync(
        pkgPath,
        JSON.stringify(pkg, null, 2) + '\n',
        'utf-8',
      );
    }
  }
}

// ─── Env file operations ─────────────────────────────────────────────────────

export function getExistingEnvVariables(
  envPath: string,
): Record<string, string> {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    return dotenv.parse(content);
  }
  return {};
}

// ─── Auto-generation ─────────────────────────────────────────────────────────

const AUTO_GENERATORS: Record<string, () => string> = {
  rsa_private_key: () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return privateKey as string;
  },
  uuidv4: () => crypto.randomUUID(),
  random_secret_32: () => crypto.randomBytes(32).toString('base64'),
};

export function generateAutoValue(kind: string): string {
  const gen = AUTO_GENERATORS[kind];
  if (!gen) return '';
  return gen();
}

// ─── Coercion ────────────────────────────────────────────────────────────────

export function coerceToType(value: string, typeName?: string): string {
  if (!typeName) return value;
  const st = findSchemaType(typeName);
  if (!st) return value;

  const trimmed = value.trim();

  if (st.type === 'number' || st.name === 'float') {
    const n = Number(trimmed);
    if (isNaN(n)) return value;
    return String(n);
  }
  if (st.type === 'integer' || st.name === 'integer') {
    const n = Number(trimmed);
    if (isNaN(n)) return value;
    return String(Math.floor(n));
  }
  if (st.type === 'boolean' || st.name === 'boolean') {
    const lower = trimmed.toLowerCase();
    if (['true', '1', 'yes'].includes(lower)) return 'true';
    if (['false', '0', 'no', ''].includes(lower)) return 'false';
    return value;
  }
  if (st.type === 'string') return trimmed;

  return value;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function validateValue(
  value: string,
  v: EnvVarSchema,
): string | null {
  const trimmed = value.trim();
  if (v.required && !trimmed) return `${v.key} is required.`;
  if (!trimmed && !v.required) return null;

  if (!v.type) return null;
  const st = findSchemaType(v.type);
  if (!st) return null;

  // structured/enum with constraints.pattern
  if (v.type === 'structured/enum' && v.constraints?.pattern) {
    try {
      if (!new RegExp(v.constraints.pattern).test(trimmed)) {
        const choices = parseEnumChoices(v.constraints.pattern);
        if (choices.length > 0) {
          return `${v.key} must be one of: ${choices.join(', ')}`;
        }
        return `${v.key} must match pattern ${v.constraints.pattern}`;
      }
    } catch {
      return `${v.key} has an invalid enum pattern: ${v.constraints.pattern}`;
    }
    return null;
  }

  // Validate against the type's schema pattern
  if (st.pattern) {
    try {
      if (!new RegExp(st.pattern).test(trimmed)) {
        return `${v.key} must be a valid ${st.name} (${st.description}).`;
      }
    } catch {
      /* invalid pattern in schema, skip */
    }
  }

  // structured/json also needs JSON.parse
  if (v.type === 'structured/json') {
    try {
      JSON.parse(trimmed);
    } catch {
      return `${v.key} must be valid JSON.`;
    }
  }

  // Primitive numeric validation
  if (st.type === 'number' || st.name === 'float') {
    const n = Number(trimmed);
    if (isNaN(n)) return `${v.key} must be a number.`;
    const m = v.constraints || {};
    if (m.min !== undefined && n < Number(m.min))
      return `${v.key} must be >= ${m.min}.`;
    if (m.max !== undefined && n > Number(m.max))
      return `${v.key} must be <= ${m.max}.`;
    if (m.precision !== undefined) {
      const prec = Number(m.precision);
      const decPart = trimmed.split('.')[1];
      if (decPart && decPart.length > prec) {
        return `${v.key} must have at most ${prec} decimal places.`;
      }
    }
  }

  if (st.type === 'integer' || st.name === 'integer') {
    const n = Number(trimmed);
    if (isNaN(n) || Math.floor(n) !== n)
      return `${v.key} must be an integer.`;
    const m = v.constraints || {};
    if (m.min !== undefined && n < Number(m.min))
      return `${v.key} must be >= ${m.min}.`;
    if (m.max !== undefined && n > Number(m.max))
      return `${v.key} must be <= ${m.max}.`;
  }

  if (st.type === 'boolean' || st.name === 'boolean') {
    if (!/^(true|false|1|0|yes|no)$/i.test(trimmed)) {
      return `${v.key} must be a boolean (true/false/1/0/yes/no).`;
    }
  }

  // minLength on the schema type itself (e.g. credentials/secret)
  if (st.minLength !== undefined && trimmed.length < st.minLength) {
    return `${v.key} must be at least ${st.minLength} characters.`;
  }

  // String-type constraints constraints
  if (st.type === 'string') {
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

export interface ValidateEnvResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnv(
  rootDir: string,
  options: { envFile?: string } = {},
): ValidateEnvResult {
  const { version, variables } = parseEnvExample(rootDir);
  const envFileName = options.envFile || '.env';
  const envPath = path.join(rootDir, envFileName);
  const existing = getExistingEnvVariables(envPath);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (fs.existsSync(envPath) && version) {
    const schemaVersionInEnv = getExistingEnvVersion(
      fs.readFileSync(envPath, 'utf-8'),
    );
    if (schemaVersionInEnv !== null && schemaVersionInEnv !== version) {
      warnings.push(
        `ENV_SCHEMA_VERSION mismatch: ${envFileName} has "${schemaVersionInEnv}", .env.example has "${version}".`,
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

// ─── Init ────────────────────────────────────────────────────────────────────

export function initEnvExample(
  rootDir: string,
  options: { from?: string } = {},
): void {
  const envExamplePath = path.join(rootDir, '.env.example');
  if (fs.existsSync(envExamplePath)) {
    throw new Error(
      `.env.example already exists at ${envExamplePath}. Use --polish to update it.`,
    );
  }

  let variables: EnvVarSchema[] = [];
  const sourceFile = options.from || '.env';
  const sourcePath = path.join(rootDir, sourceFile);

  if (fs.existsSync(sourcePath)) {
    const existingVars = dotenv.parse(fs.readFileSync(sourcePath, 'utf-8'));
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
        schema.defaultValue = '';
      }
      variables.push(schema);
    }
  } else {
    variables = [
      {
        key: 'NODE_ENV',
        defaultValue: 'development',
        comment: 'Node environment',
        required: false,
        isCommentedOut: false,
      },
      {
        key: 'PORT',
        defaultValue: '3000',
        comment:
          'Server port [TYPE: integer] [CONSTRAINTS: min=1,max=65535]',
        required: false,
        isCommentedOut: false,
        type: 'integer',
        constraints: { min: '1', max: '65535' },
      },
    ];
  }

  const version = getDefaultSchemaVersion(rootDir);
  const enriched = enrichVariablesForPolish(variables);
  const content = serializeEnvExample(version, enriched);
  fs.writeFileSync(envExamplePath, content, 'utf-8');
}

// ─── CLI helpers ─────────────────────────────────────────────────────────────

function commanderKeyToEnvKey(camelKey: string): string {
  return camelKey
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
}

function buildEnvContent(
  schemaVersion: string | null,
  variables: EnvVarSchema[],
  finalValues: Record<string, string>,
): string {
  let content = `# ==============================================\n`;
  content += `# Environment Variables\n`;
  content += `# ==============================================\n`;
  if (schemaVersion) {
    content += `# ENV_SCHEMA_VERSION="${schemaVersion}"\n`;
  }
  content += `# Generated on ${new Date().toISOString()}\n`;
  content += `# Generated by env-from-example (https://www.npmjs.com/package/env-from-example)\n`;
  content += `# ==============================================\n\n`;

  const grouped = groupVariablesBySection(variables);
  let lastGroup = '';
  for (const v of grouped) {
    const hdr = v.comment.split('\n').find((l) => l.includes('------'));
    const group = hdr ? extractGroupName(hdr) : '';
    if (group && group !== lastGroup) {
      content += '\n' + renderGroupBanner(group).join('\n') + '\n\n';
      lastGroup = group;
    }

    const desc = inferDescription(v);
    if (desc) {
      content += `# ${desc}\n`;
    }

    if (v.key in finalValues) {
      const val = finalValues[v.key];
      const needsQuotes = /[\s#"']/.test(val) || val === '';
      const safeValue =
        needsQuotes && val !== ''
          ? `"${val.replace(/"/g, '\\"')}"`
          : val;
      content += `${v.key}=${safeValue}\n`;
    } else {
      content += `# ${v.key}=\n`;
    }
  }
  return content;
}

interface SetupSummary {
  fromExisting: string[];
  fromDefault: string[];
  autoGenerated: string[];
  fromCli: string[];
  skippedCommented: string[];
  requiredMissing: string[];
}

function printSummary(
  summary: SetupSummary,
  envFileName: string,
  schemaVersion: string | null,
): void {
  console.log('');
  console.log(
    pc.green(pc.bold(`✅ ${envFileName} successfully created/updated!`)),
  );
  if (schemaVersion) {
    console.log(pc.gray(`   Schema version: ${schemaVersion}`));
  }

  console.log('');
  const total =
    summary.fromExisting.length +
    summary.fromDefault.length +
    summary.autoGenerated.length +
    summary.fromCli.length +
    summary.skippedCommented.length;
  console.log(pc.bold(`   ${total} variables configured:`));

  if (summary.fromCli.length > 0) {
    console.log(
      pc.cyan(`   ⮑  ${summary.fromCli.length} from CLI flags: `) +
        pc.dim(summary.fromCli.join(', ')),
    );
  }
  if (summary.fromExisting.length > 0) {
    console.log(
      pc.green(
        `   ⮑  ${summary.fromExisting.length} from existing ${envFileName}: `,
      ) + pc.dim(summary.fromExisting.join(', ')),
    );
  }
  if (summary.fromDefault.length > 0) {
    console.log(
      pc.blue(`   ⮑  ${summary.fromDefault.length} from defaults: `) +
        pc.dim(summary.fromDefault.join(', ')),
    );
  }
  if (summary.autoGenerated.length > 0) {
    console.log(
      pc.magenta(
        `   ⮑  ${summary.autoGenerated.length} auto-generated: `,
      ) + pc.dim(summary.autoGenerated.join(', ')),
    );
  }
  if (summary.skippedCommented.length > 0) {
    console.log(
      pc.gray(
        `   ⮑  ${summary.skippedCommented.length} commented-out (kept as-is): `,
      ) + pc.dim(summary.skippedCommented.join(', ')),
    );
  }
  if (summary.requiredMissing.length > 0) {
    console.log(
      pc.yellow(
        `   ⚠  ${summary.requiredMissing.length} required but empty: `,
      ) + pc.dim(summary.requiredMissing.join(', ')),
    );
  }
  console.log('');
}

// ─── Main CLI ────────────────────────────────────────────────────────────────

async function run() {
  const program = new Command();
  program
    .name('env-from-example')
    .description(
      'Interactive and non-interactive CLI to set up .env from .env.example',
    )
    .option(
      '-y, --yes',
      'Non-interactive: accept existing values or defaults without prompting',
    )
    .option('-f, --force', 'Force re-run even if .env is already up-to-date')
    .option(
      '-e, --env <environment>',
      'Target environment (e.g., local, test, production)',
    )
    .option(
      '--cwd <path>',
      'Project root directory (default: current working directory)',
    )
    .option(
      '--init [source]',
      'Create .env.example from an existing env file (default: .env) or from scratch',
    )
    .option(
      '--polish',
      'Polish .env.example: add descriptions, types, defaults (use -y for non-interactive)',
    )
    .option(
      '--version [bump]',
      'Bump or set ENV_SCHEMA_VERSION (patch|minor|major or exact semver)',
    )
    .option(
      '--sync-package',
      'With --version: also update package.json version',
    )
    .option(
      '--validate [envFile]',
      'Validate .env against .env.example schema (exit 1 if invalid)',
    )
    .option(
      '--dry-run',
      'Preview what would be written without creating/modifying files',
    );

  const earlyRoot = getRootDirFromArgv();
  try {
    const { variables: earlyVars } = parseEnvExample(earlyRoot);
    earlyVars.forEach((v) => {
      const optName = `--${v.key.toLowerCase().replace(/_/g, '-')}`;
      const desc = stripMetaFromComment(v.comment) || `Set ${v.key}`;
      program.option(`${optName} <value>`, desc);
    });
  } catch {
    /* .env.example may not exist yet */
  }

  program.parse();
  const options = program.opts();
  const ROOT_DIR = path.resolve(options.cwd || process.cwd());

  // --- --init ---
  if (options.init !== undefined) {
    try {
      const source =
        typeof options.init === 'string' ? options.init : undefined;
      initEnvExample(ROOT_DIR, { from: source });
      console.log(pc.green(pc.bold('✅ .env.example created.')));
      if (options.yes) {
        polishEnvExample(ROOT_DIR);
        console.log(
          pc.green(pc.bold('✅ .env.example polished (non-interactive).')),
        );
      } else {
        await polishEnvExampleInteractive(ROOT_DIR);
        console.log(pc.green(pc.bold('✅ .env.example polished.')));
      }
      return;
    } catch (e) {
      console.error(pc.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  }

  // --- --polish ---
  if (options.polish) {
    try {
      if (options.yes) {
        polishEnvExample(ROOT_DIR);
        console.log(
          pc.green(
            pc.bold('✅ .env.example polished (non-interactive).'),
          ),
        );
      } else {
        console.log(
          pc.cyan(
            pc.bold(
              'Interactive polish: conform .env.example to convention (description, default, type, etc.)\n',
            ),
          ),
        );
        await polishEnvExampleInteractive(ROOT_DIR);
        console.log(pc.green(pc.bold('✅ .env.example polished.')));
      }
      return;
    } catch (e) {
      console.error(pc.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  }

  // --- --validate ---
  if (options.validate !== undefined) {
    const envFile =
      options.validate === true ? '.env' : `.env.${options.validate}`;
    try {
      const result = validateEnv(ROOT_DIR, { envFile });
      if (result.warnings.length > 0) {
        result.warnings.forEach((w) =>
          console.warn(pc.yellow('Warning:'), w),
        );
      }
      if (result.valid) {
        console.log(
          pc.green(
            pc.bold(
              `✅ ${envFile} is valid against .env.example schema.`,
            ),
          ),
        );
        return;
      }
      result.errors.forEach((e) => console.error(pc.red('Error:'), e));
      process.exit(1);
    } catch (e) {
      console.error(pc.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  }

  // --- --version ---
  if (options.version !== undefined) {
    try {
      const { version } = parseEnvExample(ROOT_DIR);
      const current = version || '1.0.0';
      const bump =
        options.version === true ? undefined : options.version;
      let newVersion: string;
      if (bump === 'patch' || bump === 'minor' || bump === 'major') {
        newVersion = bumpSemver(current, bump);
      } else if (bump && typeof bump === 'string') {
        newVersion = bump;
      } else {
        newVersion = bumpSemver(current, 'patch');
      }
      updateEnvSchemaVersion(ROOT_DIR, newVersion, {
        syncPackage: options.syncPackage,
      });
      console.log(
        pc.green(
          pc.bold(`✅ ENV_SCHEMA_VERSION set to ${newVersion}`),
        ),
      );
      if (options.syncPackage) {
        console.log(pc.gray('   package.json version updated.'));
      }
      return;
    } catch (e) {
      console.error(pc.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  }

  // --- Main: generate .env ---
  let schemaVersion: string | null;
  let variables: EnvVarSchema[];
  try {
    const result = parseEnvExample(ROOT_DIR);
    schemaVersion = result.version;
    variables = result.variables;
  } catch {
    const examplePath = path.join(ROOT_DIR, '.env.example');
    console.error(pc.red(`No .env.example found at ${examplePath}`));
    console.error('');
    console.error(pc.bold('To get started:'));
    console.error(
      pc.cyan('  env-from-example --init') +
        pc.gray('          Create a starter .env.example'),
    );
    console.error(
      pc.cyan('  env-from-example --init .env') +
        pc.gray('     Create .env.example from existing .env'),
    );
    console.error('');
    console.error(
      pc.gray(
        'Or create .env.example manually — see https://www.npmjs.com/package/env-from-example',
      ),
    );
    process.exit(1);
  }

  const activeVars = variables.filter((v) => !v.isCommentedOut);
  const totalPromptable = activeVars.length;

  console.log('');
  console.log(
    pc.cyan(pc.bold('  env-from-example')) +
      pc.gray(` — ${totalPromptable} variables from .env.example`),
  );
  console.log('');

  let targetEnv = options.env;

  if (!targetEnv && !options.yes) {
    const envChoice = await select({
      message: 'Select target environment to generate:',
      choices: [
        { name: 'default (.env)', value: 'default' },
        { name: 'local (.env.local)', value: 'local' },
        { name: 'test (.env.test)', value: 'test' },
        { name: 'staging (.env.stage)', value: 'stage' },
        { name: 'production (.env.production)', value: 'production' },
        { name: 'custom', value: 'custom' },
      ],
    });

    if (envChoice === 'custom') {
      targetEnv = await input({
        message: 'Enter custom environment name (e.g., ci, demo):',
        validate: (val) =>
          val.trim().length > 0 || 'Environment name is required',
      });
    } else {
      targetEnv = envChoice === 'default' ? '' : envChoice;
    }
  } else if (!targetEnv) {
    targetEnv = '';
  }

  const envFileName = targetEnv ? `.env.${targetEnv}` : '.env';
  const envPath = path.join(ROOT_DIR, envFileName);

  const existingEnvExists = fs.existsSync(envPath);
  const existingVars = getExistingEnvVariables(envPath);

  let existingVersion: string | null = null;
  if (existingEnvExists) {
    const content = fs.readFileSync(envPath, 'utf-8');
    existingVersion = getExistingEnvVersion(content);
  }

  if (
    existingEnvExists &&
    existingVersion === schemaVersion &&
    !options.force &&
    !options.yes
  ) {
    const proceed = await confirm({
      message: pc.green(
        `${envFileName} is already up-to-date (v${schemaVersion}). Re-run setup?`,
      ),
      default: false,
    });
    if (!proceed) {
      console.log(pc.gray('Nothing changed.'));
      process.exit(0);
    }
  }

  const finalValues: Record<string, string> = {};
  const summary: SetupSummary = {
    fromExisting: [],
    fromDefault: [],
    autoGenerated: [],
    fromCli: [],
    skippedCommented: [],
    requiredMissing: [],
  };

  let promptIndex = 0;
  for (const v of variables) {
    const camelKey = v.key
      .toLowerCase()
      .replace(/_([a-z0-9])/gi, (_, c) => c.toUpperCase());
    const valFromCli = options[camelKey];
    if (
      valFromCli !== undefined &&
      valFromCli !== null &&
      typeof valFromCli === 'string'
    ) {
      finalValues[v.key] = valFromCli;
      summary.fromCli.push(v.key);
      continue;
    }

    const hasExisting = v.key in existingVars;
    let currentDefault = existingVars[v.key] ?? v.defaultValue;

    const schemaType = v.type ? findSchemaType(v.type) : undefined;
    const autoGen = schemaType?.auto_generate;
    let wasAutoGenerated = false;
    if (autoGen && !currentDefault) {
      currentDefault = generateAutoValue(autoGen);
      wasAutoGenerated = true;
    }

    if (v.isCommentedOut) {
      finalValues[v.key] = currentDefault;
      summary.skippedCommented.push(v.key);
      continue;
    }

    if (options.yes) {
      if (v.required && !currentDefault) {
        console.warn(
          pc.yellow(
            `  ⚠ [REQUIRED] ${v.key} has no value — set it manually in ${envFileName}`,
          ),
        );
        summary.requiredMissing.push(v.key);
      }
      finalValues[v.key] = currentDefault;
      if (wasAutoGenerated) summary.autoGenerated.push(v.key);
      else if (hasExisting) summary.fromExisting.push(v.key);
      else summary.fromDefault.push(v.key);
      continue;
    }

    // Interactive mode
    promptIndex++;
    const progress = pc.dim(`[${promptIndex}/${totalPromptable}]`);
    const desc = stripMetaFromComment(v.comment);
    if (desc) {
      console.log(pc.gray(`  ${desc}`));
    }

    let answer: string;

    const isEnum =
      v.type === 'structured/enum' && v.constraints?.pattern;
    const enumChoices = isEnum
      ? parseEnumChoices(v.constraints!.pattern!)
      : [];

    if (enumChoices.length > 0) {
      const choiceValue =
        currentDefault && enumChoices.includes(currentDefault)
          ? currentDefault
          : enumChoices[0];
      answer = await select({
        message:
          `${progress} ${v.key}` +
          (v.required ? pc.bold(pc.yellow(' REQUIRED')) : ''),
        choices: enumChoices.map((c) => ({ name: c, value: c })),
        default: choiceValue,
      });
    } else {
      const hint = wasAutoGenerated ? pc.dim(' (auto-generated)') : '';
      answer = await input({
        message:
          `${progress} ${v.key}` +
          (v.required ? pc.bold(pc.yellow(' REQUIRED')) : '') +
          hint,
        default: currentDefault,
        validate: (val) => validateValue(val, v) ?? true,
      });
    }
    const coerced = coerceToType(answer, v.type);
    finalValues[v.key] = coerced;

    if (wasAutoGenerated && coerced === currentDefault)
      summary.autoGenerated.push(v.key);
    else if (hasExisting && coerced === existingVars[v.key])
      summary.fromExisting.push(v.key);
    else summary.fromDefault.push(v.key);
  }

  const newEnvContent = buildEnvContent(
    schemaVersion,
    variables,
    finalValues,
  );

  if (options.dryRun) {
    console.log('');
    console.log(
      pc.bold(
        pc.cyan(`--- Dry run: ${envFileName} (not written) ---`),
      ),
    );
    console.log(pc.dim(newEnvContent));
    console.log(pc.bold(pc.cyan('--- End dry run ---')));
    printSummary(summary, envFileName, schemaVersion);
    return;
  }

  fs.writeFileSync(envPath, newEnvContent, 'utf-8');
  printSummary(summary, envFileName, schemaVersion);
}

// ─── Entry ───────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  run().catch((err) => {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'ExitPromptError'
    ) {
      console.log(pc.gray('\nCancelled.'));
      process.exit(0);
    }
    console.error(pc.red('Error:'), err);
    process.exit(1);
  });
}
