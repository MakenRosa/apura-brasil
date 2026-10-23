# Fixtures oficiais

Os cinco arquivos `ea*-official.json` são respostas originais HTTP 200 do TSE, coletadas em 04/10/2026. Não foi registrado o horário exato inicial da coleta. Não contêm votos fabricados. Todos indicavam fase oficial `f=o`; o EA20 indicava `and=n`, `tf=n`, `dv=s` e zero seções totalizadas. Demonstram disponibilidade da fonte e pré-totalização, sem indicar início da apuração.

URLs de coleta:

- EA11: https://resultados.tse.jus.br/oficial/comum/config/ele-c.json
- EA12: https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json
- EA14: https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-e006257-ab.json
- EA15: https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp-e006257-ab.json
- EA20: https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json

Leiautes documentados em https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados, PDFs EA11/12/14/15 e EA20 2026. Casos de borda nos testes fazem alterações explicitamente locais destas fixtures, sem apresentá-las como respostas reais ou carregá-las no aplicativo. O servidor nunca importa esta pasta.

## Cartografia IBGE

`ibge-sp-malha.json` e `ibge-sp-localidades.json` são respostas oficiais HTTP 200 coletadas em 04/10/2026. Ambas contêm 645 municípios. Documentação primária: https://servicodados.ibge.gov.br/api/docs/malhas?versao=3 e https://servicodados.ibge.gov.br/api/docs/localidades .

- Malha GeoJSON simplificada: https://servicodados.ibge.gov.br/api/v3/malhas/estados/35?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima
- Nomes e identificadores: https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios

A correspondência paulista foi validada em 645/645 polígonos: `properties.codarea` IBGE → `EA12.abr[].mu[].cdi` completo de sete dígitos → `cd` TSE. São Luiz do Paraitinga (IBGE) e SÃO LUÍS DO PARAITINGA (TSE) diferem no nome, mas identificador IBGE `3550001` confirma TSE `71013`. Nenhum identificador foi truncado ou inferido pela posição.

## Fotografia oficial TSE

Foi realizado um único download para validar o padrão documentado de fotografias: `tse-photo-280002542548.jpeg`, associado ao `sqcand=280002542548` de LULA na fixture EA20 oficial. A aplicação não importa esta fixture nem procura imagens por nome.

- URL: https://resultados.tse.jus.br/oficial/ele2026/6257/fotos/br/280002542548.jpeg
- Coleta: 04/10/2026 às 19:15:28.664Z (16:15:28.664 no horário de Brasília).
- Resposta: HTTP 200, `image/jpeg`, 6.969 bytes, 189 ms; início JPEG `FFD8FFE0`.
- Evidência original: `tse-photo-evidence.json`.
- Padrão: documento oficial TSE “Instruções para download dos arquivos da Divulgação de resultados das Eleições 2026”, página 5, arquivo `[sqcand].jpeg` dentro de `fotos/{br|uf|zz}`; diretório parametrizado `arq[].tp=ft` no EA11.

Fotos de candidaturas a Presidente usam abrangência nacional `br`, inclusive ao consultar votos por UF ou município. Demais candidaturas usam a UF oficial da consulta. Casos de falha, cache e proteção nos testes reutilizam somente estes bytes reais.
