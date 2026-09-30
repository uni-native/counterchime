import assert from 'node:assert/strict';
const {default:worker}=await import('../dist/server/index.js');
for(const route of ['/','/favicon.svg','/pcm-capture.js']){
 const response=await worker.fetch(new Request(`https://counterchime.example${route}`),{});assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>0);
}
const status=await worker.fetch(new Request('https://counterchime.example/api/voice-status'),{});assert.equal((await status.json()).configured,false);
assert.equal((await worker.fetch(new Request('https://counterchime.example/missing'),{})).status,404);
console.log('Worker artifact checks passed; provider calls: 0');
