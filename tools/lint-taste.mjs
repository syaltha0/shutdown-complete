import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const script = '.claude/skills/design-taste-frontend/scripts/lint.mjs';
if (existsSync(script)) {
  const result = spawnSync(process.execPath, [script, '--app', 'client/src'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  console.log('SKIP lint:taste: optional local .claude design-taste skill is not installed.');
}
