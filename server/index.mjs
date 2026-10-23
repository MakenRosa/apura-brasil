import { createServer as httpCreateServer } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TseClient } from './client.mjs';
import { ElectionService, parseQuery } from './service.mjs';
import { exportFilename, resultsCsv } from './export.mjs';
import { GeographyClient, MunicipalMapService, parsePreviewUf } from './geography.mjs';
import {PhotoClient,CandidatePhotoService} from './photos.mjs';
import {HttpResourceCache} from './http-cache.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const inside=(root,file)=>{const rel=relative(root,file);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
function json(response,status,value,extra={}) {
 const body=JSON.stringify(value);
 response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});response.end(body);
}
export function createServer({client,service,geographyClient,mapService,photoClient,photoService,distDir=join(ROOT,'dist'),dataDir=process.env.APURA_DATA_DIR||join(ROOT,'data')}={}) {
 client ||= new TseClient({dataDir,...(process.env.APURA_OFFLINE==='1'?{fetchImpl:async()=>{throw new Error('Modo de validação offline.');}}:{})});
 service ||= new ElectionService(client);
 geographyClient ||= new GeographyClient({dataDir:dataDir?join(dataDir,'cartography'):null,...(process.env.APURA_OFFLINE==='1'?{fetchImpl:async()=>{throw new Error('Modo de validação offline.');}}:{})});
 mapService ||= new MunicipalMapService(service,geographyClient);
 photoClient ||= new PhotoClient(client,{dataDir:dataDir?join(dataDir,'photos'):null});
 photoService ||= new CandidatePhotoService(service,photoClient);
 const httpCache=new HttpResourceCache();
 const cachedJSON=(request,response,value,cacheControl='private, no-cache')=>{
  // Failures remain retryable: a successful HTTP envelope does not make its source fresh.
  const interrupted=[value.source,value.municipalitiesSource,value.geography].some(source=>source&&['waiting','unavailable','stale'].includes(source.state))||value.collection===null;
  return httpCache.send(request,response,{body:Buffer.from(JSON.stringify(value)),contentType:'application/json; charset=utf-8',cacheControl:interrupted?'private, no-cache':cacheControl});
 };
 const server=httpCreateServer(async(request,response)=>{
  try {
   const host=request.headers.host||'';
   if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)){json(response,403,{error:'Host local inválido.'});return;}
   const url=new URL(request.url,'http://127.0.0.1');
   if(url.pathname.startsWith('/api/')) {
    if(request.method!=='GET'){json(response,405,{error:'Método não permitido.'},{Allow:'GET'});return;}
    if(url.pathname==='/api/health'){await client.ready;json(response,200,{...client.health(),cache:{http:httpCache.metrics(),photos:photoClient.metrics?.()}});return;}
    if(url.pathname==='/api/bootstrap'){if(url.search)throw Object.assign(new Error('Bootstrap não aceita parâmetros.'),{status:400});await cachedJSON(request,response,await service.bootstrap());return;}
    if(url.pathname==='/api/map-preview'){await cachedJSON(request,response,await mapService.preview(parsePreviewUf(url.searchParams)),'private, max-age=900, must-revalidate');return;}
    if(url.pathname==='/api/photo') {
     if(url.searchParams.getAll('candidate').length!==1||!/^\d{1,20}$/.test(url.searchParams.get('candidate')||''))throw Object.assign(new Error('Sequencial oficial de candidatura inválido.'),{status:400});
     const sequence=url.searchParams.get('candidate'),filters=new URLSearchParams(url.searchParams);filters.delete('candidate');const query=parseQuery(filters);
     if(query.region)throw Object.assign(new Error('Foto exige a consulta original da candidatura, sem agrupamento regional.'),{status:400});
     const result=await photoService.get(query,sequence);
     if(!result.body){json(response,result.httpStatus===404?404:503,{error:result.message||'Foto oficial indisponível.',source:{provider:'TSE',state:result.state,url:result.url,nextRetryAt:result.nextRetryAt}});return;}
     await httpCache.send(request,response,{body:result.body,etag:result.etag,contentType:'image/jpeg',cacheControl:result.state==='stale'?'private, no-cache':'private, max-age=3600, must-revalidate',compressible:false,headers:{'X-Apura-Source-State':result.state,'X-Apura-Source-URL':result.url,...(result.fetchedAt?{'X-Apura-Fetched-At':result.fetchedAt}:{})}});return;
    }
    const known=['/api/results','/api/municipalities','/api/regions','/api/raw','/api/export.csv','/api/export.json','/api/map'];
    if(!known.includes(url.pathname)){json(response,404,{error:'Rota não encontrada.'});return;}
    const query=parseQuery(url.searchParams,{discovery:['/api/municipalities','/api/regions','/api/map'].includes(url.pathname),aggregate:['/api/regions','/api/map'].includes(url.pathname)});
    if(url.pathname==='/api/map'){await cachedJSON(request,response,await mapService.map(query),query.electionId?'private, max-age=300, must-revalidate':'private, no-cache');return;}
    if(url.pathname==='/api/raw'||url.pathname==='/api/export.json') {
     const result=await service.results(query,{raw:true});
     if(!result.raw){json(response,503,{raw:null,source:result.source});return;}
     json(response,200,result.raw,{'Content-Disposition':`attachment; filename="${exportFilename(query,'json',String(result.raw.ele||result.raw.query?.electionId||query.electionId||''))}"`,'X-Apura-Source-State':result.source.state,'X-Apura-Source-URL':result.source.url});return;
    }
    if(url.pathname==='/api/export.csv') {
     const result=await service.results(query);
     if(!result.data){json(response,503,{data:null,source:result.source});return;}
     const body=resultsCsv(result);
     response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Length':Buffer.byteLength(body),'Content-Disposition':`attachment; filename="${exportFilename(result.query,'csv')}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Apura-Source-State':result.source.state,'X-Apura-Source-URL':result.source.url});response.end(body);return;
    }
    const result=url.pathname==='/api/results'?await service.results(query):url.pathname==='/api/regions'?await service.regions(query):await service.municipalities(query);
    await cachedJSON(request,response,result,url.pathname==='/api/municipalities'&&query.electionId?'private, max-age=300, must-revalidate':'private, no-cache');return;
   }
   if(!['GET','HEAD'].includes(request.method)){json(response,405,{error:'Método não permitido.'},{Allow:'GET, HEAD'});return;}
   let pathname;
   try{pathname=decodeURIComponent(url.pathname);}catch{json(response,400,{error:'Caminho inválido.'});return;}
   if(pathname.includes('\0')||pathname.includes('\\')||pathname.split('/').some(part=>part==='..')){json(response,400,{error:'Caminho inválido.'});return;}
   const root=resolve(distDir);let target=resolve(root,'.'+pathname);
   if(!inside(root,target)){json(response,403,{error:'Caminho proibido.'});return;}
   if(pathname==='/'||!extname(pathname))target=join(root,'index.html');
   try {
    const actual=await realpath(target),actualRoot=await realpath(root);
    if(!inside(actualRoot,actual)){json(response,403,{error:'Caminho proibido.'});return;}
    const info=await stat(actual);if(!info.isFile())throw new Error('Not file');
    const resource=await httpCache.file(actual,info),extension=extname(actual);
    const fingerprint=/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2|png|svg|jpg|jpeg|webp)$/.test(pathname);
    await httpCache.send(request,response,{...resource,contentType:MIME[extension]||'application/octet-stream',cacheControl:extension==='.html'?'no-cache':fingerprint?'public, max-age=31536000, immutable':'public, max-age=3600, must-revalidate',compressible:['.html','.js','.css','.json','.geojson','.svg','.txt'].includes(extension),headers:{'Referrer-Policy':'strict-origin-when-cross-origin'}});
   }catch(error){json(response,404,{error:error.code==='ENOENT'?'Interface não compilada ou arquivo não encontrado. Execute npm run build.':'Arquivo não encontrado.'});}
  }catch(error){json(response,error.status||500,{error:error.status?error.message:'Falha interna ao processar a consulta.'});}
 });
 server.headersTimeout=15000;server.requestTimeout=20000;server.keepAliveTimeout=5000;
 server.on('close',()=>{void client.flush?.();void geographyClient.flush?.();void photoClient.flush?.();});
 server.apura={client,service,geographyClient,mapService,photoClient,photoService,httpCache};return server;
}
export async function start({port=Number(process.env.PORT)||4178,...options}={}) {
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Porta inválida.');
 const server=createServer(options);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 console.log(`Apura Brasil: http://127.0.0.1:${server.address().port}`);
 return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 start().catch(error=>{console.error(error.code==='EADDRINUSE'?'A porta local já está em uso.':error.message);process.exitCode=1;});
}
