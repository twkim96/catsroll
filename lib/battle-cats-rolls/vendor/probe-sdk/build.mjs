// Install only in an ephemeral directory; the deployed Ruby app needs no Node.
import {mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'catsroll-probe-sdk-'));
try {
  for (const name of ['package.json', 'package-lock.json', 'probe.js']) copyFileSync(join(root, name), join(work, name));
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: work, stdio: 'inherit'});
  const {build} = await import(pathToFileURL(join(work, 'node_modules/esbuild/lib/main.js')));
  const result = await build({entryPoints: [join(work, 'probe.js')], bundle: true,
    format: 'iife', platform: 'browser', target: 'es2020', minify: true,
    legalComments: 'inline', write: false});
  writeFileSync(join(root, 'probe.bundle.js'), result.outputFiles[0].text);
  const licenses = [
    ['@modelcontextprotocol/ext-apps', 'LICENSE'],
    ['@modelcontextprotocol/client', 'LICENSE'],
    ['@modelcontextprotocol/core', 'LICENSE'],
    ['zod', 'LICENSE'],
    ['@standard-schema/spec', 'LICENSE']
  ].map(([name, license]) => `${name}\n${readFileSync(join(work, 'node_modules', name, license), 'utf8')}`);
  writeFileSync(join(root, 'LICENSES.txt'), licenses.join('\n\n---\n\n'));
} finally {
  rmSync(work, {recursive: true, force: true});
}
