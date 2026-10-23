import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This smoke test starts its own loopback server with an injected offline client.
// It never calls the TSE, does not touch data/, and closes only its own server.
const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(existsSync(resolve(root, 'dist/index.html')), 'Interface ainda não compilada. Execute npm run build antes de npm run validate.');
const { createServer } = await import('../server/index.mjs');
const { TseClient } = await import('../server/client.mjs');
const { GeographyClient } = await import('../server/geography.mjs');
let preventedRequests = 0;
let preventedCartographyRequests = 0;
const client = new TseClient({
  dataDir: null,
  minInterval: 0,
  fetchImpl: async () => {
    preventedRequests++;
    throw new Error('Validação offline: rede externa desativada.');
  }
});
const geographyClient = new GeographyClient({ dataDir:null, minInterval:0, fetchImpl:async()=>{preventedCartographyRequests++;throw new Error('Validação offline: cartografia externa desativada.');} });
const server = createServer({ client, geographyClient, dataDir:null, distDir: resolve(root, 'dist') });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let checks = 0;
const check = (name, callback) => {
  callback();
  checks++;
  console.log(`OK ${name}`);
};
const get = async path => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
  return { response, body: await response.json() };
};
try {
  const health = await get('/api/health');
  check('health local', () => {
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);
  });
  const bootstrap = await get('/api/bootstrap');
  check('bootstrap sem rede e sem amostra', () => {
    assert.equal(bootstrap.response.status, 200);
    assert.ok(Array.isArray(bootstrap.body.elections));
    assert.equal(bootstrap.body.status.state, 'unavailable');
    assert.ok(bootstrap.body.elections.every(election => election.fallback === true));
    assert.equal(bootstrap.body.defaultQuery.cycle, 'ele2026');
  });
  const query = '?cycle=ele2026&turn=1&office=1&uf=br';
  const results = await get(`/api/results${query}`);
  check('resultado desconhecido preservado', () => {
    assert.equal(results.response.status, 200);
    assert.equal(results.body.data, null);
    assert.equal(results.body.source.state, 'unavailable');
    assert.deepEqual(results.body.history, []);
  });
  const regions = await get(`/api/regions${query}`);
  check('regiões sem dados inventados', () => {
    assert.equal(regions.response.status, 200);
    assert.deepEqual(regions.body.rows, []);
    assert.equal(regions.body.source.state, 'unavailable');
  });
  const municipalities = await get('/api/municipalities?cycle=ele2026&turn=1&office=1&uf=sp');
  check('municípios dependem da fonte', () => {
    assert.equal(municipalities.response.status, 200);
    assert.deepEqual(municipalities.body.municipalities, []);
    assert.equal(municipalities.body.source.state, 'unavailable');
  });
  const municipalMap = await get('/api/map?cycle=ele2026&turn=1&office=1&uf=sp');
  check('cartografia ausente sem polígonos ou vínculos inventados', () => {
    assert.equal(municipalMap.response.status, 200);
    assert.equal(municipalMap.body.collection, null);
    assert.equal(municipalMap.body.geography.state, 'unavailable');
    assert.deepEqual(municipalMap.body.coverage, {total:0,linked:0,unmatched:0});
    assert.equal(municipalMap.body.municipalitiesSource.state, 'unavailable');
  });
  const geographyRequestsAfterSP = preventedCartographyRequests;
  const nationalMap = await get('/api/map?cycle=ele2026&turn=1&office=1&uf=br');
  check('visão Brasil não dispara download de malha municipal', () => {
    assert.equal(nationalMap.response.status, 200);
    assert.equal(nationalMap.body.collection, null);
    assert.ok(nationalMap.body.geography.message);
    assert.equal(preventedCartographyRequests, geographyRequestsAfterSP);
  });
  const malformed = await get('/api/results?cycle=ele2026&turn=1&office=1&uf=../../x');
  check('filtro inválido rejeitado', () => {
    assert.equal(malformed.response.status, 400);
    assert.equal(typeof malformed.body.error, 'string');
  });
  const senateNational = await get('/api/results?cycle=ele2026&turn=1&office=5&uf=br');
  check('Senado exige UF', () => {
    assert.equal(senateNational.response.status, 400);
  });
  const raw = await get(`/api/raw${query}`);
  check('exportação bruta indisponível não vira amostra', () => {
    assert.equal(raw.response.status, 503);
    assert.equal(raw.body.raw, null);
  });
  const photoWithoutResult = await get('/api/photo?cycle=ele2026&turn=1&office=1&uf=br&electionId=6257&candidate=280002542548');
  check('foto exige identidade recebida em resultado oficial', () => {
    assert.equal(photoWithoutResult.response.status, 503);
    assert.match(photoWithoutResult.response.headers.get('content-type'), /application\/json/);
    assert.equal(typeof photoWithoutResult.body.error, 'string');
  });
  const invalidPhoto = await get('/api/photo?cycle=ele2026&turn=1&office=1&uf=br&candidate=../arbitraria');
  check('identificador de foto arbitrário rejeitado', () => assert.equal(invalidPhoto.response.status, 400));
  const unknown = await get('/api/inexistente');
  check('API desconhecida rejeitada', () => assert.equal(unknown.response.status, 404));
  const method = await fetch(`${base}/api/health`, { method: 'POST' });
  check('API somente leitura', () => assert.equal(method.status, 405));
  const hostStatus = await new Promise((resolveStatus, rejectStatus) => {
    const request = httpGet(`${base}/api/health`, { headers: { Host: 'exemplo.invalid' } }, response => {
      response.resume();
      response.once('end', () => resolveStatus(response.statusCode));
    });
    request.once('error', rejectStatus);
  });
  check('Host externo rejeitado', () => assert.equal(hostStatus, 403));
  const map = await fetch(`${base}/brasil-uf.geojson`);
  check('mapa oficial local com 27 UFs', () => assert.equal(map.status, 200));
  const geometry = await map.json();
  check('geometria de UFs completa', () => {
    assert.equal(geometry.type, 'FeatureCollection');
    assert.equal(geometry.features.length, 27);
    assert.equal(new Set(geometry.features.map(feature => feature.properties.codarea)).size, 27);
  });
  const index = await fetch(base);
  const html = await index.text();
  check('HTML de produção servido', () => {
    assert.equal(index.status, 200);
    assert.match(html, /Apura Brasil/);
    assert.match(html, /<div id="root"><\/div>/);
  });
  console.log(JSON.stringify({ ok: true, checks, mode: 'offline', externalNetworkCalls: 0, preventedRequests, preventedCartographyRequests }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
}
