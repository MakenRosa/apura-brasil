// CSV always quotes fields and escapes spreadsheet formulas, including formulas
// preceded by whitespace. Unknown values remain empty; a known zero remains 0.
export function csvCell(value) {
 let text=value===null||value===undefined?'':typeof value==='number'?String(value).replace('.',','):String(value);
 if(/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;
 return `"${text.replace(/"/g,'""')}"`;
}
export function exportFilename(query,extension,electionId=query.electionId) {
 const region=query.region?`-r${query.region.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z-]+/g,'-')}`:'';
 return `apura-${query.cycle}-t${query.turn}-c${query.office}-${query.uf}-m${query.municipality||'geral'}${region}-e${electionId||'desconhecida'}.${extension}`;
}
export function resultsCsv(envelope) {
 const {query,data,source}=envelope;
 const headers=['Ciclo','Turno','Eleição TSE','Eleição','Cargo TSE','Cargo','UF','Município TSE','Região','Abrangência','Fonte URL','Fase','Estado da fonte','Geração ID','Gerado em TSE (horário original)','Coletado em','Consultado em','HTTP','Avisos','Candidato ID','UF do candidato','Nome','Número','Partido','Partido número','Coligação','Votos computados',query.region?'Percentual regional calculado dos votos computados':'Percentual TSE dos votos computados','Situação TSE','Eleito confirmado','Destinação dos votos','Vice ou suplentes'];
 const context=[query.cycle,query.turn,data.election.id,data.election.name,query.office,data.office.name,query.uf,query.municipality,query.region,data.scope.name,source.url,source.phase,source.state,source.generationId,source.generatedAt,source.fetchedAt,source.checkedAt,source.httpStatus,(source.warnings||[]).join(' | ')];
 const candidates=data.candidates.length?data.candidates:[null];
 const rows=candidates.map(c=>[...context,c?.id,c?.uf,c?.name,c?.number,c?.party,c?.partyNumber,c?.coalition,c?.votes,c?.percent,c?.status,c?.elected===null||c?.elected===undefined?null:c.elected?'Sim':'Não',c?.destination,c?.runningMate]);
 return '\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
