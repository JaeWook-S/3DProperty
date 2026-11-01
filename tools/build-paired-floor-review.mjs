// Build only the local paired review; existing application outputs stay intact.
import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {copyFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const outDir=process.env.PAIRED_BUILD_OUT || 'runtime/paired-floor-review/2026-10-26/dist';
await build({root,configFile:false,envFile:false,publicDir:false,base:'./',build:{outDir,emptyOutDir:true,rollupOptions:{input:fileURLToPath(new URL('../paired-floor-review.html',import.meta.url))}}});

for(const name of ['OFL.txt','provenance.json'])await copyFile(new URL(`../src/paired-floor/fonts/${name}`,import.meta.url),new URL(`${outDir}/assets/NanumGothic-${name}`,new URL('../',import.meta.url)));
