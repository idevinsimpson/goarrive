import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const src = execFileSync('git', ['-C', '/home/user/goarrive', 'show', 'dc639571b69ac77f42c97bd094cc15a5c4b9bdb2:.github/wsf-staging/hosted-package-e-smoke.mjs'], { encoding: 'utf8' });
function fnBlock(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3);
}
const a = fnBlock('function assert(condition, message) {');
const v = fnBlock('async function visible(locator, timeout = 20_000) {');
const s = src.indexOf('// --- manage surface helpers'); const e = src.indexOf('// --- end manage surface helpers ---');
if (s < 0 || e < 0) throw new Error('markers');
const block = src.slice(s, e + '// --- end manage surface helpers ---'.length);
const out = `// AUTO-EXTRACTED verbatim from dc639571:.github/wsf-staging/hosted-package-e-smoke.mjs\n${a}\n${v}\n${block}\nexport { assert, visible, MANAGE_SURFACES, MANAGE_PANEL, manageSurface, openManage, assertMemberHasNoManage };\n`;
writeFileSync(process.argv[2], out);
const h = (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);
console.log('assert', h(a), 'visible', h(v), 'block', h(block), 'blockLines', block.split('\n').length);
