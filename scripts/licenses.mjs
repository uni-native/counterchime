import {readFile,writeFile,readdir,mkdir,copyFile} from 'node:fs/promises';import path from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));const inventory=[];await mkdir('docs/third-party-licenses',{recursive:true});
for(const [location,entry]of Object.entries(lock.packages)){
 if(!location)continue;
 let pkg;try{pkg=JSON.parse(await readFile(path.join(location,'package.json'),'utf8'));}catch{continue;}
 const name=pkg.name||location.split('node_modules/').at(-1);const files=await readdir(location);const licenseFiles=files.filter(x=>/^(licen[sc]e|copying|ofl)(\.|$)/i.test(x));
 const notices=[];for(const file of licenseFiles){const target=`${name.replaceAll('/','__')}--${pkg.version}--${file}`;try{await copyFile(path.join(location,file),path.join('docs/third-party-licenses',target));notices.push(target);}catch{}}
 inventory.push({name,version:pkg.version,license:pkg.license||entry.license||'NOT DECLARED',developmentOnly:Boolean(entry.dev),noticeFiles:notices});
}
inventory.sort((a,b)=>a.name.localeCompare(b.name));await writeFile('docs/dependency-inventory.json',JSON.stringify(inventory,null,2)+'\n');
await writeFile('THIRD_PARTY_NOTICES.md','# Third-party notices\n\nGenerated from installed package metadata and the committed lockfile. Dependencies retain their original licenses; the application MIT license does not replace them. Full available license texts are in docs/third-party-licenses/.\n\n| Package | Version | License | Development only |\n|---|---|---|---|\n'+inventory.map(x=>`| ${x.name} | ${x.version} | ${typeof x.license==='string'?x.license:JSON.stringify(x.license)} | ${x.developmentOnly?'yes':'no'} |`).join('\n')+'\n\nDM Sans and IBM Plex Mono are self-hosted, licensed under the SIL Open Font License. Protocol documentation was consulted, not copied as application source. Original code-native artwork and an AI-generated design concept are described in README.md.\n');
console.log(`Inventoried ${inventory.length} installed packages`);
