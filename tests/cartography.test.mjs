import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GeographyClient,MunicipalMapService,assertIbgeUrl,geographyUrls,normalizeGeography,normalizeLocalities,linkMunicipalities,normalizedName} from '../server/geography.mjs';
import {normalizeMunicipalities} from '../server/normalize.mjs';
import {CONFIG_URL} from '../server/constants.mjs';
import {TseClient} from '../server/client.mjs';
import {ElectionService} from '../server/service.mjs';
import {createServer} from '../server/index.mjs';

const read=async name=>JSON.parse(await readFile(new URL(`fixtures/${name}`,import.meta.url),'utf8'));
const [rawGeometry,rawLocalities,ea11,ea12]=await Promise.all(['ibge-sp-malha.json','ibge-sp-localidades.json','ea11-official.json','ea12-official.json'].map(read));
const geometry=normalizeGeography(rawGeometry,'sp'),localities=normalizeLocalities(rawLocalities,'sp'),municipalities=normalizeMunicipalities(ea12,'sp');
const response=(value,status=200,headers={})=>new Response(typeof value==='string'?value:JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
const copy=value=>structuredClone(value);
const query={cycle:'ele2026',turn:1,office:'1',uf:'sp',electionId:'6257'};
const ibgeFetch=async url=>response(url.includes('/malhas/')?rawGeometry:rawLocalities);
const geoClient=(fetchImpl=ibgeFetch,options={})=>new GeographyClient({fetchImpl,minInterval:0,dataDir:null,...options});
const tseClient=fetchImpl=>new TseClient({fetchImpl,minInterval:0,dataDir:null});

test('SP oficial: 645 polígonos e municípios casam por cdi completo inclusive São Luís/Luiz',()=>{
 const result=linkMunicipalities(geometry,localities,municipalities,'sp');assert.deepEqual(result.coverage,{total:645,linked:645,unmatched:0});
 assert.deepEqual(result.collection.features.find(f=>f.properties.ibge==='3550308').properties,{ibge:'3550308',name:'São Paulo',tseId:'71072'});
 assert.deepEqual(result.collection.features.find(f=>f.properties.ibge==='3550001').properties,{ibge:'3550001',name:'São Luiz do Paraitinga',tseId:'71013'});
 assert.ok(result.warnings.some(w=>w.includes('nomes diferem')));assert.equal(result.collection.features[0].geometry,geometry.features[0].geometry);
});
test('nome normalizado único só é fallback quando código IBGE utilizável não foi informado',()=>{
 const rows=copy(municipalities),saoPaulo=rows.find(m=>m.id==='71072');saoPaulo.ibge='';saoPaulo.name=' SÃO---PAULO  ';
 const result=linkMunicipalities(geometry,localities,rows,'sp');assert.equal(result.coverage.linked,645);assert.ok(result.warnings.some(w=>w.includes('1 municípios vinculados por nome')));
 assert.equal(normalizedName(' SÃO---PAULO  '),'sao paulo');
 saoPaulo.ibge='9999999';const conflict=linkMunicipalities(geometry,localities,rows,'sp');assert.equal(conflict.collection.features.find(f=>f.properties.ibge==='3550308').properties.tseId,null);assert.equal(conflict.coverage.unmatched,1);
 saoPaulo.uf='ac';assert.equal(linkMunicipalities(geometry,localities,rows,'sp').coverage.unmatched,1);
});
test('cdi e nomes ambíguos ficam sem vínculo; nunca reutiliza um TSE para dois polígonos',()=>{
 const saoPaulo=municipalities.find(m=>m.id==='71072');const rows=[...municipalities,{...saoPaulo,id:'99999'}];
 const duplicated=linkMunicipalities(geometry,localities,rows,'sp');assert.equal(duplicated.coverage.unmatched,1);assert.ok(duplicated.warnings.some(w=>w.includes('ambíguas')));
 const withoutCode=[...municipalities.filter(m=>m.id!=='71072'),{...saoPaulo,ibge:''},{...saoPaulo,id:'99999',ibge:''}];
 assert.equal(linkMunicipalities(geometry,localities,withoutCode,'sp').coverage.unmatched,1);
 const reused=copy(municipalities);reused[1].id=reused[0].id;assert.equal(linkMunicipalities(geometry,localities,reused,'sp').coverage.unmatched,2);
});
test('geometria ausente é declarada sem polígono inventado nem atribuição ao vizinho',()=>{
 const reduced={...geometry,features:geometry.features.slice(1)};const result=linkMunicipalities(reduced,localities,municipalities,'sp');
 assert.equal(result.coverage.total,644);assert.equal(result.coverage.linked,644);assert.ok(result.warnings.some(w=>w.includes('1 municípios participantes do TSE não possuem polígono')));
 assert.ok(!result.collection.features.some(f=>f.properties.ibge===geometry.features[0].properties.codarea));
});
test('allowlist separada e validação de geometria rejeitam UF errada, duplicata e coordenadas inválidas',()=>{
 const urls=geographyUrls('sp');assert.equal(assertIbgeUrl(urls.geometry),urls.geometry);assert.equal(assertIbgeUrl(urls.localities),urls.localities);
 for(const url of ['https://evil.test/map','http://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios','https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios?url=http://evil.test','https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3550308'])assert.throws(()=>assertIbgeUrl(url));
 assert.throws(()=>geographyUrls('../sp'));assert.throws(()=>normalizeGeography(rawGeometry,'ac'));assert.throws(()=>normalizeLocalities(rawLocalities,'ac'));
 const duplicate=copy(rawGeometry);duplicate.features.push(duplicate.features[0]);assert.throws(()=>normalizeGeography(duplicate,'sp'));
 const invalid=copy(rawGeometry);invalid.features[0].geometry={type:'Polygon',coordinates:[[[181,0],[0,0],[1,1],[181,0]]]};assert.throws(()=>normalizeGeography(invalid,'sp'));
});
test('requisições IBGE concorrentes por UF coalescem; cartografia fica em cache longo',async()=>{
 let calls=0;const client=geoClient(async url=>{calls++;await new Promise(r=>setTimeout(r,5));return ibgeFetch(url);});
 const [first,second]=await Promise.all([client.get('sp'),client.get('sp')]);assert.equal(first,second);assert.equal(first.geography.state,'live');assert.equal(calls,2);
 const cached=await client.get('sp');assert.equal(cached.geography.state,'cached');assert.equal(calls,2);
});
test('cache em disco restaura e erro de atualização conserva última cartografia como stale',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-geography-'));let now=100000,calls=0;
 try {
  const client=geoClient(async url=>{calls++;return ibgeFetch(url);},{dataDir:directory,now:()=>now,ttl:100});await client.get('sp');assert.equal(calls,2);
  const restored=geoClient(async()=>{throw new Error('Offline');},{dataDir:directory,now:()=>now,ttl:100});assert.equal((await restored.get('sp')).geography.state,'cached');
  now+=101;const stale=await restored.get('sp');assert.equal(stale.geography.state,'stale');assert.equal(stale.collection.features.length,645);assert.match(stale.geography.message,/Offline/);
  const again=await restored.get('sp');assert.equal(again.geography.state,'stale');assert.equal(again.collection.features.length,645);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('falha inicial, timeout, bytes excessivos ou cadastro desalinhado não produzem mapa falso',async()=>{
 const offline=geoClient(async()=>{throw new Error('Offline');});assert.equal((await offline.get('sp')).geography.state,'unavailable');assert.equal((await offline.get('sp')).collection,null);
 const oversized=geoClient(async()=>response('{}',200,{'content-length':'99999999'}));assert.match((await oversized.get('sp')).geography.message,/limite de tamanho/);
 const misaligned=geoClient(async url=>response(url.includes('/malhas/')?rawGeometry:rawLocalities.slice(0,1)));const mismatch=await misaligned.get('sp');assert.equal(mismatch.collection,null);assert.match(mismatch.geography.message,/alinhamento/);
 const timeout=geoClient(async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),{timeout:5});const keepAlive=setTimeout(()=>{},100);
 try{assert.match((await timeout.get('sp')).geography.message,/Tempo limite/);}finally{clearTimeout(keepAlive);}
});
test('mapa usa somente EA11/EA12 e bloqueio IBGE não afeta o cliente de votos TSE',async()=>{
 const urls=[];const elections=new ElectionService(tseClient(async url=>{urls.push(url);return response(url===CONFIG_URL?ea11:ea12);}));
 const map=new MunicipalMapService(elections,geoClient());const result=await map.map(query);
 assert.equal(result.coverage.linked,645);assert.equal(result.municipalitiesSource.phase,'official');assert.equal(urls.length,2);assert.ok(urls.every(u=>!u.endsWith('-u.json')&&!u.endsWith('-ab.json')));
 let calls=0;const blocked=geoClient(async()=>{calls++;return response('',429);});await blocked.get('sp');const before=calls;assert.equal((await blocked.get('ac')).geography.state,'unavailable');assert.equal(calls,before);assert.equal(elections.client.cooldownUntil,0);
});
test('EA11 recorte suplementar habilita somente municípios participantes no mapa completo',async()=>{
 const config=copy(ea11);const federal=config.pl.flatMap(p=>p.e).find(e=>e.cd==='6257');federal.abr=[{cd:'sp',mu:[{cd:'71072',cdi:'3550308'}],cp:[{cd:'1',ds:'Presidente',tp:'1'}]}];
 const elections=new ElectionService(tseClient(async url=>response(url===CONFIG_URL?config:ea12)));
 const result=await new MunicipalMapService(elections,geoClient()).map(query);assert.deepEqual(result.coverage,{total:645,linked:1,unmatched:644});
 assert.equal(result.collection.features.find(f=>f.properties.ibge==='3550308').properties.tseId,'71072');assert.ok(result.collection.features.filter(f=>f.properties.ibge!=='3550308').every(f=>f.properties.tseId===null));
});
test('HTTP /api/map valida entrada, aceita descoberta municipal e informa Brasil/Exterior sem busca',async()=>{
 let tseCalls=0,ibgeCalls=0;const client=tseClient(async url=>{tseCalls++;return response(url===CONFIG_URL?ea11:ea12);});const geographyClient=geoClient(async url=>{ibgeCalls++;return ibgeFetch(url);});
 const server=createServer({client,geographyClient});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try {
  for(const uf of ['br','zz']){const result=await(await fetch(`${base}/api/map?uf=${uf}`)).json();assert.equal(result.collection,null);assert.equal(result.geography.state,'unavailable');assert.ok(result.geography.message);}
  assert.equal(tseCalls,0);assert.equal(ibgeCalls,0);
  assert.equal((await fetch(base+'/api/map?uf=xx')).status,400);assert.equal((await fetch(base+'/api/map?uf=sp&url=https://evil.test')).status,400);
  const result=await(await fetch(base+'/api/map?uf=sp&office=11&cycle=ele2024&turn=1&electionId=619')).json();assert.equal(result.coverage.linked,645);assert.equal(result.collection.features.length,645);assert.equal(tseCalls,2);assert.equal(ibgeCalls,2);
 }finally{await new Promise(r=>server.close(r));}
});
