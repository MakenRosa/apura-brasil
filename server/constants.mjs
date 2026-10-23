export const BASE = 'https://resultados.tse.jus.br';
export const CONFIG_URL = `${BASE}/oficial/comum/config/ele-c.json`;
export const VERSION = '1.0.0';
export const DOC_URL = 'https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados';
export const CALENDAR_URL = 'https://www.tse.jus.br/comunicacao/noticias/2026/Marco/eleicoes-2026-confira-as-principais-datas-do-calendario-eleitoral';
export const CONFIG_TTL = 5*60*1000;
const stateRows = [
 ['ac','Acre','Norte','12'],['al','Alagoas','Nordeste','27'],['ap','Amapá','Norte','16'],['am','Amazonas','Norte','13'],['ba','Bahia','Nordeste','29'],['ce','Ceará','Nordeste','23'],['df','Distrito Federal','Centro-Oeste','53'],['es','Espírito Santo','Sudeste','32'],['go','Goiás','Centro-Oeste','52'],['ma','Maranhão','Nordeste','21'],['mt','Mato Grosso','Centro-Oeste','51'],['ms','Mato Grosso do Sul','Centro-Oeste','50'],['mg','Minas Gerais','Sudeste','31'],['pa','Pará','Norte','15'],['pb','Paraíba','Nordeste','25'],['pr','Paraná','Sul','41'],['pe','Pernambuco','Nordeste','26'],['pi','Piauí','Nordeste','22'],['rj','Rio de Janeiro','Sudeste','33'],['rn','Rio Grande do Norte','Nordeste','24'],['rs','Rio Grande do Sul','Sul','43'],['ro','Rondônia','Norte','11'],['rr','Roraima','Norte','14'],['sc','Santa Catarina','Sul','42'],['sp','São Paulo','Sudeste','35'],['se','Sergipe','Nordeste','28'],['to','Tocantins','Norte','17']
];
export const STATES = stateRows.map(([uf,name,region,ibge])=>({uf,name,region,ibge}));
export const OFFICES = [
 {id:'1',name:'Presidente',type:'majority'}, {id:'3',name:'Governador',type:'majority'}, {id:'5',name:'Senador',type:'majority'}, {id:'6',name:'Deputado Federal',type:'proportional'}, {id:'7',name:'Deputado Estadual',type:'proportional'}, {id:'8',name:'Deputado Distrital',type:'proportional'}, {id:'11',name:'Prefeito',type:'majority'}, {id:'13',name:'Vereador',type:'proportional'}, {id:'25',name:'Conselheiro Distrital',type:'majority'}
];
export const officeById = id => OFFICES.find(x=>x.id===String(Number(id)));
export const UF_CODES = new Set(['br',...STATES.map(x=>x.uf),'zz']);
export const scopeName = uf => uf==='br'?'Brasil':uf==='zz'?'Exterior':STATES.find(x=>x.uf===uf)?.name||uf.toUpperCase();
// Only the first-turn codes and date published by the TSE; no guessed second-turn election.
export const FALLBACK_ELECTIONS = [
 {id:'6257',cycle:'ele2026',turn:1,name:'Eleição Geral Federal 2026',date:'2026-10-04',offices:OFFICES.filter(x=>x.id==='1'),ufs:['br',...STATES.map(x=>x.uf)],fallback:true},
 {id:'6259',cycle:'ele2026',turn:1,name:'Eleições Gerais Estaduais 2026',date:'2026-10-04',offices:OFFICES.filter(x=>['3','5','6','7','8'].includes(x.id)),ufs:STATES.map(x=>x.uf),fallback:true},
 {id:'6261',cycle:'ele2026',turn:1,name:'Eleição Conselho Distrital 2026',date:'2026-10-04',offices:OFFICES.filter(x=>x.id==='25'),ufs:['pe'],fallback:true}
];
