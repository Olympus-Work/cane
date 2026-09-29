// Run by `pnpm install` (prepare). Points git at .githooks; does nothing outside a git work tree
// (e.g. a tarball or a Docker build context) so installs never fail there.
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
