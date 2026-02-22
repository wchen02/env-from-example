import fs from 'fs';
import path from 'path';
import { input, select } from '@inquirer/prompts';
import pc from 'picocolors';
import {
  type SchemaType,
  type EnvVarSchema,
  getSchemaTypes,
  findSchemaType,
  parseEnumChoices,
  getAvailableConstraints,
} from './schema.js';
import {
  parseEnvExample,
  serializeEnvExample,
  dedupeVariables,
  enrichVariablesForPolish,
  getGroup,
  inferDescription,
  stripMetaFromComment,
  buildCommentLine,
  getDefaultSchemaVersion,
} from './parse.js';
import { detectType, matchesSchemaType } from './validate.js';

// ─── Summary card ────────────────────────────────────────────────────────────

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
): void {
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
    row('Default', pc.magenta(`auto (${autoGen})`), 'from schema type');
  } else if (fields.defaultValue) {
    row('Default', pc.white(fields.defaultValue), '');
  } else {
    row('Default', pc.dim('(empty)'), '');
  }

  console.log(pc.gray('─'.repeat(W)));
}

// ─── Non-interactive polish ──────────────────────────────────────────────────

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
    const g = getGroup(v);
    if (g) knownGroups.add(g);
  }
  if (knownGroups.size > 0 && deduped.some((v) => !getGroup(v))) {
    knownGroups.add('Other');
  }

  console.log(
    pc.cyan(pc.bold('  Interactive polish')) +
      pc.dim(` — ${total} variables to review\n`),
  );

  for (let i = 0; i < deduped.length; i++) {
    const v = deduped[i];
    let group = getGroup(v) || (knownGroups.size > 0 ? 'Other' : '');

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
        const groupChoices: { name: string; value: string }[] = [];
        if (!knownGroups.has('Other')) {
          groupChoices.push({ name: pc.dim('(none)'), value: '' });
        }
        groupChoices.push(...[...knownGroups].map((g) => ({ name: g, value: g })));
        groupChoices.push({ name: pc.cyan('+ New group...'), value: '__new__' });
        const picked = await select({
          message: 'Group',
          choices: groupChoices,
          default: group || (knownGroups.has('Other') ? 'Other' : ''),
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
    polished.push({
      ...v,
      comment: commentLine,
      defaultValue,
      required,
      type,
      constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
      group: group || undefined,
    });
  }

  const content = serializeEnvExample(effectiveVersion, polished);
  fs.writeFileSync(envExamplePath, content, 'utf-8');
}
