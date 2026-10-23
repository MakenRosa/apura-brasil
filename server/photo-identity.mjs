import {BASE,UF_CODES} from './constants.mjs';
export function assertPhotoUrl(url) {
 const parsed=new URL(url),match=parsed.pathname.match(/^\/oficial\/(ele\d{4})\/(\d{1,6})\/fotos\/([a-z]{2})\/(\d{1,20})\.jpeg$/);
 if(parsed.origin!==BASE||parsed.username||parsed.password||parsed.search||parsed.hash||!match||!UF_CODES.has(match[3]))throw new Error('URL de foto fora do padrão oficial TSE.');
 return parsed.href;
}
export function photoUpstream(query,sequence,rawConfig) {
 if(!/^\d{1,20}$/.test(sequence))throw new Error('Sequencial oficial de candidatura inválido.');
 // Presidential candidatures are national, including result queries for a UF or municipality.
 const uf=query.office==='1'?'br':query.uf;
 let directory=rawConfig?.arq?.find(row=>row.tp==='ft')?.dir||'<base>/<ambiente>/<ciclo>/<cd_eleicao>/fotos/<uf>';
 for(const [token,value] of Object.entries({'<base>':BASE,'<ambiente>':'oficial','<ciclo>':query.cycle,'<cd_eleicao>':query.electionId,'<uf>':uf}))directory=directory.split(token).join(value);
 return assertPhotoUrl(`${directory}/${sequence}.jpeg`);
}
export function photoLocalUrl(query,sequence) {
 const parameters=new URLSearchParams({...query,candidate:sequence});return `/api/photo?${parameters}`;
}
