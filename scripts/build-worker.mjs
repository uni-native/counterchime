import {build} from 'esbuild';import {readdir,readFile,copyFile,mkdir} from 'node:fs/promises';import path from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.png':'image/png','.wav':'audio/wav'};
const assets={};async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await walk(file);else{const key='/'+path.relative('dist/client',file).split(path.sep).join('/');assets[key]={body:(await readFile(file)).toString('base64'),type:types[path.extname(file)]||'application/octet-stream'};}}}
await walk('dist/client');
await build({entryPoints:['server/worker.ts'],bundle:true,format:'esm',platform:'neutral',target:'es2022',outfile:'dist/server/index.js',define:{__STATIC_ASSETS__:JSON.stringify(assets)}});
await mkdir('dist/.openai',{recursive:true});try{await copyFile('.openai/hosting.json','dist/.openai/hosting.json')}catch{/* Local builds do not require a Sites registration. */}
