import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';

const compress=promisify(gzip);
export const contentTag=body=>'"'+createHash('sha256').update(body).digest('base64url')+'"';
export const fileStamp=info=>[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
const matches=(header,tag)=>typeof header==='string'&&header.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===tag.replace(/^W\//,''));
const acceptsGzip=header=>typeof header==='string'&&header.split(',').some(value=>{
 const [name,...parameters]=value.trim().toLowerCase().split(';');
 return name==='gzip'&&!parameters.some(parameter=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(parameter));
});

/** Immutable representations, bounded by both entry count and retained bytes. */
export class HttpResourceCache {
 constructor({maxEntries=64,maxBytes=32*1024*1024,maxFileBytes=8*1024*1024}={}) {
  Object.assign(this,{maxEntries,maxBytes,maxFileBytes});this.files=new Map();this.encodings=new Map();this.inflight=new Map();this.bytes=0;this.encodingBytes=0;this.hits=0;this.reads=0;this.notModified=0;this.compressions=0;
 }
 async file(path,info) {
  const stamp=fileStamp(info),old=this.files.get(path);
  if(old?.stamp===stamp){this.hits++;this.files.delete(path);this.files.set(path,old);return old;}
  const key=path+'\0'+stamp;
  if(this.inflight.has(key))return this.inflight.get(key);
  const promise=(async()=>{
   this.reads++;const body=await readFile(path),entry={stamp,body,etag:contentTag(body),lastModified:info.mtime.toUTCString()};
   if(old&&this.files.get(path)===old){this.files.delete(path);this.bytes-=old.body.length;}
   if(body.length<=this.maxFileBytes&&body.length<=this.maxBytes){
    const replaced=this.files.get(path);if(replaced)this.bytes-=replaced.body.length;
    this.files.delete(path);this.files.set(path,entry);this.bytes+=body.length;
    while(this.files.size>this.maxEntries||this.bytes>this.maxBytes){const first=this.files.keys().next().value;this.bytes-=this.files.get(first).body.length;this.files.delete(first);}
   }
   return entry;
  })().finally(()=>this.inflight.delete(key));
  this.inflight.set(key,promise);return promise;
 }
 async representation(body,etag,encoding) {
  if(!encoding||body.length<1024)return {body,etag};
  const key=etag+':gzip',old=this.encodings.get(key);
  if(old){this.encodings.delete(key);this.encodings.set(key,old);return old;}
  if(this.inflight.has(key))return this.inflight.get(key);
  const promise=(async()=>{
   this.compressions++;const compressed=await compress(body,{level:6});
   if(compressed.length>=body.length)return {body,etag};
   const entry={body:compressed,etag:contentTag(compressed),encoding:'gzip'};
   if(compressed.length<=this.maxFileBytes&&compressed.length<=this.maxBytes){
    this.encodings.set(key,entry);this.encodingBytes+=compressed.length;
    while(this.encodings.size>this.maxEntries||this.encodingBytes>this.maxBytes){const first=this.encodings.keys().next().value;this.encodingBytes-=this.encodings.get(first).body.length;this.encodings.delete(first);}
   }
   return entry;
  })().finally(()=>this.inflight.delete(key));
  this.inflight.set(key,promise);return promise;
 }
 async send(request,response,{body,contentType,cacheControl='private, no-cache',headers={},etag=contentTag(body),lastModified,compressible=true}) {
  const representation=await this.representation(body,etag,compressible&&acceptsGzip(request.headers['accept-encoding']));
  const common={'Content-Type':contentType,'Cache-Control':cacheControl,'X-Content-Type-Options':'nosniff',ETag:representation.etag,...(lastModified?{'Last-Modified':lastModified}:{}),...(compressible?{Vary:'Accept-Encoding'}:{}),...headers};
  if(matches(request.headers['if-none-match'],representation.etag)){
   this.notModified++;response.writeHead(304,common);response.end();return;
  }
  response.writeHead(200,{...common,'Content-Length':representation.body.length,...(representation.encoding?{'Content-Encoding':representation.encoding}:{})});
  response.end(request.method==='HEAD'?undefined:representation.body);
 }
 metrics(){return {fileEntries:this.files.size,fileBytes:this.bytes,encodedEntries:this.encodings.size,encodedBytes:this.encodingBytes,fileHits:this.hits,fileReads:this.reads,notModified:this.notModified,compressions:this.compressions,inFlight:this.inflight.size};}
}
