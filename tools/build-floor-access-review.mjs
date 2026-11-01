// Build the isolated floor-access review without changing the main app or dist.
import {build} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({root,configFile:false,envFile:false,publicDir:false,base:'./',build:{outDir:'runtime/floor-access/2026-10-25/dist',emptyOutDir:true,rollupOptions:{input:fileURLToPath(new URL('../floor-access-review.html',import.meta.url))}}});
