const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'apps/goarrive/node_modules/typescript'));

function renderGuestShell({ syntheticFixture = false } = {}) {
  const sources = ['guestMediaClient.ts', 'guestWorkoutShell.ts'].map(name => fs.readFileSync(path.join(root, 'apps/goarrive/lib', name), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
  const body = ts.transpileModule(sources, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const script = `(() => {\n${body}\nmountGuestWorkoutShell(document.getElementById('workout'), { enabled: ${syntheticFixture === true} });\n})();`;
  const style = 'body{font:18px system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:1rem;color:#18222b;background:#fafafa}button{font:inherit;padding:.75rem;margin:.25rem}video,img{width:100%;max-height:65vh;object-fit:contain}button:focus-visible{outline:3px solid #176b88}[hidden]{display:none!important}';
  const hash = value => crypto.createHash('sha256').update(value).digest('base64');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow,noarchive"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'self'; media-src blob:; img-src blob:; base-uri 'none'; form-action 'none'"><title>Guest workout</title><style>${style}</style></head><body><main id="workout"></main><script>${script}</script></body></html>\n`;
}
module.exports = { renderGuestShell };
if (require.main === module) {
  // No CLI option can enable issuance or the shipped player.
  fs.writeFileSync(path.join(root, 'apps/goarrive/public/guest-workout.html'), renderGuestShell());
  console.log('Generated disabled isolated guest shell. No endpoints enabled.');
}
