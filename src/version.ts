import fs from 'fs';
import path from 'path';
import { parseEnvExample, serializeEnvExample } from './parse.js';

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
