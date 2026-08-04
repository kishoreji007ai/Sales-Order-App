/* Copies the web app (../www) into ./app so Electron can bundle it. */
const fs = require('fs');
const path = require('path');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const src = path.join(__dirname, '..', 'www');
const dst = path.join(__dirname, 'app');
fs.rmSync(dst, { recursive: true, force: true });
copyDir(src, dst);
console.log('Copied www -> desktop/app');
