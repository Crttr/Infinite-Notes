import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root,p),'utf8');
const app=read('src/App.tsx'), rich=read('src/RichText.tsx'), cargo=read('src-tauri/Cargo.toml');
const checks=[
 ['Tauri project manifest',existsSync(join(root,'src-tauri/tauri.conf.json')) && cargo.includes('[package]')],
 ['Internal links mark exists',rich.includes('internalNoteLink')],
 ['Legacy list link button removed',!rich.includes('Связать пункт')],
 ['Card anchored edges available',app.includes('CardAnchoredEdge') && existsSync(join(root,'src/CardAnchoredEdge.tsx'))],
 ['Project backup/export implementation present',existsSync(join(root,'src/Backup.ts'))],
 ['Package build command exists',JSON.parse(read('package.json')).scripts?.build?.includes('tsc')],
];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`); if(!ok) failed++;}
console.log(`\n${checks.length-failed}/${checks.length} static checks passed.`);
if(failed)process.exitCode=1;
