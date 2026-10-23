# Fontes e metodologia

Apura Brasil é uma aplicação independente. Os votos vêm dos arquivos públicos de divulgação do Tribunal Superior Eleitoral. A aplicação não pertence ao TSE e não certifica resultados. Consulta documental realizada em **04/10/2026**.

## Referências primárias

| Documento | Versão/data indicada | Uso |
| --- | --- | --- |
| [Página técnica e FAQ de 2026](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados) | Consultada em 04/10/2026 | Ambiente, códigos, limites e esclarecimentos |
| [Instruções de download](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-instrucoes-para-download-dos-arquivos-da-divulgacao-2026) | 1.0, 25/05/2026 | Construção de URLs |
| [EA11 — Eleições](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea11-arquivo-de-configuracao-de-eleicoes) | 23/06/2026 | Eleições, turnos, cargos e diretórios |
| [EA12 — Municípios](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea12-arquivo-de-configuracao-de-municipios) | 22/05/2026 | Municípios e localidades do exterior |
| [EA14 — Acompanhamento Brasil](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea14-arquivo-de-acompanhamento-brasil) | 10/06/2026 | Resumo nacional e UFs |
| [EA15 — Acompanhamento UF](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea15-arquivo-de-acompanhamento-uf) | 10/06/2026 | Resumo da UF e municípios |
| [EA20 — Resultado unificado](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea20-arquivo-de-resultado-unificado) | 10/07/2026 | Votação, situação, vagas e indicadores |
| [Candidatos — Dados Abertos 2026](https://dadosabertos.tse.jus.br/dataset/candidatos-2026) | Consultado em 04/10/2026 | Cadastro e recursos oficiais de fotos por UF/BR |
| [Fotos BR — Presidente](https://dadosabertos.tse.jus.br/dataset/candidatos-2026/resource/e8f0a648-b438-4117-814a-f32f4c4977c8) | Metadados de 03/08/2026 | Formato JPEG e licença declarada |

O ambiente oficial usa `https://resultados.tse.jus.br/oficial`. O TSE publica para 04/10/2026 o pleito `3220` e as eleições `6257` (federal), `6259` (estaduais) e `6261` (Conselho Distrital). São códigos de contingência documentados; a configuração EA11 é a referência operacional. Segundo turno e outros ciclos dependem da configuração disponível. [Página técnica](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados).

O mapa usa uma malha simplificada oficial do IBGE, obtida em 04/10/2026 pela [API de malhas v3](https://servicodados.ibge.gov.br/api/docs/malhas?versao=3), com 27 UFs. `public/brasil-uf.geojson` contém a geometria local e `public/map-source.json` registra a [URL de origem](https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF), data e finalidade. Cartografia não fornece nem estima votos; os recortes eleitorais vêm do TSE.

## Aquisição e atualização

A aplicação consulta periodicamente arquivos JSON; não recebe uma transmissão instantânea. O padrão local é 30 segundos, com mínimo de 15 segundos. O intervalo é uma escolha da aplicação. O TSE não promete cadência fixa: publicação e sincronização da CDN podem atrasar ou apresentar gerações diferentes entre arquivos. [FAQ: atualização](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados).

O backend agrupa consultas simultâneas, mantém cache e registra a URL exata, a fase, a geração TSE e a hora de consulta local. `idg` serve para reconhecer uma geração; não ordenar versões numericamente. EA14/EA15 não contêm resultados individuais de candidatos. Uma região sem líder publicado permanece sem líder. [EA14](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea14-arquivo-de-acompanhamento-brasil), [EA15](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea15-arquivo-de-acompanhamento-uf).

URLs preservam UF minúscula, eleição com seis dígitos, cargo com quatro e município TSE com cinco, incluindo zeros iniciais. Município TSE não deve ser tratado como código IBGE completo. A associação cartográfica exige conversão ou correspondência documentada. [Instruções, pp. 6–9](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-instrucoes-para-download-dos-arquivos-da-divulgacao-2026), [EA12, p. 2](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea12-arquivo-de-configuracao-de-municipios).

## Cartografia municipal e associação de códigos

O IBGE fornece a divisão de uma UF em municípios pela [API de malhas v3](https://servicodados.ibge.gov.br/api/docs/malhas?versao=3): `estados/{idUF}` com `intrarregiao=municipio`, formato GeoJSON e qualidade mínima. Os identificadores e nomes são consultáveis separadamente pela [API de localidades](https://servicodados.ibge.gov.br/api/docs/localidades), em `api/v1/localidades/estados/{idUF}/municipios`. As fontes servem à cartografia; municípios participantes da eleição e indicadores de seções continuam sendo definidos por EA12 e EA15 do TSE.

A captura de SP em `tests/fixtures/` contém 645 localidades e 645 geometrias únicas provenientes das URLs oficiais de [localidades de SP](https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios) e [malha municipal de SP](https://servicodados.ibge.gov.br/api/v3/malhas/estados/35?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio). A verificação independente encontrou correspondência exata para os 645 valores `cdi` do EA12, sem duplicações. Essa cobertura de SP não demonstra cobertura de todas as demais UFs.

`cd` do EA12 é o código TSE usado nas consultas eleitorais; `cdi` identifica o IBGE e deve corresponder ao `id` da API de localidades e a `properties.codarea` do GeoJSON. O PDF EA12 descreve `cdi` com cinco dígitos, mas os arquivos oficiais capturados em 2026 têm códigos completos de sete dígitos. A implementação preserva o valor recebido; não deve truncá-lo nem completar valores insuficientes por suposição. A [tabela de códigos do IBGE](https://www.ibge.gov.br/explica/codigos-dos-municipios.php) descreve sete dígitos, com prefixo de UF.

| Recorte inspecionado no EA12 de 2026 | Entradas | Exemplo TSE → IBGE |
| --- | --- | --- |
| SP | 645 | São Paulo: `71072` → `3550308` |
| MG | 853 | Cada entrada possui `cdi`; malha municipal não auditada nesta conferência |
| DF | 1 | Brasília: `97012` → `5300108` |
| PE | 185 | Fernando de Noronha: `30015` → `2605459` |

Regras de associação e apresentação:

- Priorizar código IBGE completo, existente na fonte cartográfica, pertencente à mesma UF e com relação única entre código TSE e geometria. O identificador eleitoral permanece o código TSE original.
- Normalizar caixa, acentos, espaços e pontuação para busca e auditoria. Uma associação por nome somente pode ser alternativa explícita e única dentro da mesma UF, com identificação do método; não é uma correspondência de códigos publicada pelo TSE. Sem correspondência única, conservar o item como não associado.
- Não aplicar aproximação textual, remoção de partes do nome, escolha do vizinho, interpolação ou criação de polígonos. Renomeações e novos municípios exigem correspondência oficial verificável ou permanecem sem geometria associada.
- Não confundir geometrias disponíveis com dados de apuração disponíveis: uma cidade com malha e sem EA15 não recebe zero nem cor de avanço. O EA15 indica seções; não declara liderança de candidatura. A votação de um município depende de uma consulta específica ao EA20.
- Manter a localidade eleitoral mesmo sem polígono. Mostrar a cobertura da associação e a indisponibilidade da cartografia; consultar um município pela lista continua sendo uma operação eleitoral independente do desenho do mapa.

Um exemplo concreto de divergência de grafia é `SÃO LUÍS DO PARAITINGA` no TSE e `São Luiz do Paraitinga` no IBGE. O código `3550001` resolve a associação de forma exata; a busca de nomes normalizados sozinha resolve apenas 644 das 645 entradas de SP nesta captura.

O recorte DF do EA12 representa Brasília; não fornece uma lista de regiões administrativas para inventar municípios. Fernando de Noronha pertence ao recorte PE e tem geometria insular distante do continente. Exterior (`zz`) contém localidades sem `cdi` brasileiro e não deve ser sobreposto à malha nacional. A captura também contém Boa Esperança do Norte/MT (`73709` → `5101837`); a presença no cadastro eleitoral não garante que todas as versões da malha já tenham a geometria correspondente. O [IBGE documenta a instalação desse município em 2025](https://educa.ibge.gov.br/criancas/voce-sabia/22741-novo-municipio.html).

O endpoint local `/api/map` entrega a cartografia municipal da UF e mantém metadados do IBGE separados da fonte eleitoral EA12. A cobertura informa o total de polígonos da malha, quantos receberam um código TSE único e quantos ficaram sem associação. Não é uma porcentagem de seções nem uma declaração de participação de todos os municípios na eleição. Em eleições suplementares, o cadastro participante pode ser menor que a malha da UF.

O mapa ocupa a área principal do painel e permite passar de Brasil para UF e município, buscar localidades, ajustar o enquadramento e expandir a exploração em tela cheia. Sua escala de cores representa o percentual publicado de seções totalizadas do EA14/EA15; não representa votos nem liderança de candidatos. Selecionar um município consulta seu recorte eleitoral individual. O desenho, a ampliação e o enquadramento não modificam os dados de origem.

As fontes podem ter datas de atualização distintas. A cartografia é carregada por UF, com cache de até 30 dias em `data/cartography/{uf}.json`; falhas preservam a última malha identificada como antiga (`stale`) ou informam indisponibilidade. URL e data de consulta acompanham o recorte. Consultas simultâneas da mesma UF são agrupadas; erros de acesso ao IBGE têm espera própria, separada do bloqueio TSE. Brasil e Exterior não disparam a consulta de malha municipal. A extensão municipal não exige baixar todas as malhas ou consultar todos os resultados municipais de uma vez.

## Recortes regionais e escala de temperatura

Selecionar Norte, Nordeste, Centro-Oeste, Sudeste ou Sul consulta o EA20 das UFs elegíveis para o mesmo pleito, turno e cargo. Os arquivos são obtidos pelo cliente TSE existente, com cache, agrupamento de chamadas e fila de acesso. Exterior não pertence a esses agrupamentos. Não são feitas varreduras municipais para formar a soma regional; cargos que exigem município continuam exigindo esse recorte.

A soma é um cálculo local identificado, sem atribuir ao TSE um arquivo regional que não existe. Cada contador é somado somente quando todas as UFs esperadas têm o campo conhecido. Percentual de seções: `100 × soma(s.st) / soma(s.ts)`; candidatura presidencial: `100 × soma(cand.vap) / soma(v.vvc)`; comparecimento: `100 × soma(e.c) / soma(e.esi)`. Os percentuais das UFs não são promediados. Cobertura de arquivos completa não significa que todos os campos foram publicados. `dv=n`, candidatura ausente, sequencial insuficiente e campos desconhecidos não são substituídos por zero.

Presidente é associado por `sqcand`, exigindo presença única e voto conhecido em cada UF. Candidaturas estaduais permanecem separadas por UF e identidade, inclusive quando os números se repetem; seu percentual regional considera os votos computados do recorte inteiro, enquanto a disputa e a situação eleitoral continuam pertencendo à UF. Não existe declaração de eleito regional presidencial nem distribuição fictícia de cadeiras por região. Fases incompatíveis impedem a agregação; cache antigo permanece identificado.

Os metadados incluem cobertura, UFs não incluídas, URLs oficiais individuais e intervalo dos horários de geração conhecidos, sem criar uma geração TSE única. O JSON exportado é um pacote local identificado como `regional-aggregation`, com o resultado calculado e os arquivos originais estaduais. O CSV diferencia o percentual regional calculado do percentual diretamente publicado pelo TSE e identifica a UF das candidaturas estaduais. O histórico regional registra somente snapshots completos oficiais observados por esta instalação, com vetor das gerações por UF e intervalo dos horários de geração. Não recompõe publicações estaduais anteriores nem presume geração simultânea. Ausência, fase simulada/incompatível, voto oculto/desconhecido ou fonte stale preservam a série anterior sem acrescentar um ponto.

No mapa, temperatura representa **seções totalizadas**, não votos ou liderança: azul em 0%, ciano em 25%, amarelo em 50%, laranja em 75% e vermelho em 100%. Os valores entre as âncoras são interpolados continuamente, na mesma escala em todos os recortes. Ausência de dados tem cor separada. Para Deputado Distrital, o recorte regional elegível é Centro-Oeste/DF; sua linha cartográfica pode usar os contadores do EA20 estadual já coletado, sem inventar um EA14 nacional desse cargo.

## Fotos oficiais de candidaturas

As [instruções de 2026, p. 5](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-instrucoes-para-download-dos-arquivos-da-divulgacao-2026) definem o caminho `https://resultados.tse.jus.br/oficial/{ciclo}/{eleicao}/fotos/{br|uf|zz}/{sqcand}.jpeg`. O diretório é obtido de `arq` com `tp=ft` no EA11. O [EA20, pp. 12–13](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea20-arquivo-de-resultado-unificado) define `sqcand` como o sequencial usado para baixar a fotografia. A associação usa essa identidade exata; nome, número de urna e partido não substituem o sequencial.

Para Presidente, a aplicação usa `br` mesmo quando o recorte de votação é uma UF ou município; o [Portal de Dados Abertos](https://dadosabertos.tse.jus.br/dataset/candidatos-2026) identifica o recurso de fotos BR como Presidente. Nos demais cargos, usa a UF da candidatura. Não há pasta de município dentro do diretório de fotos. Fotografias somente são solicitadas para candidaturas presentes no EA20 oficial (`f=o`) já coletado para o recorte; a solicitação de uma foto não baixa outro resultado nem percorre candidatos de outras localidades.

O [recurso oficial de fotos BR](https://dadosabertos.tse.jus.br/dataset/candidatos-2026/resource/e8f0a648-b438-4117-814a-f32f4c4977c8) declara formato JPEG e licença **Creative Commons Atribuição**, sem especificar uma versão. O crédito adotado é **Fotos: TSE**, com referência à origem oficial. A imagem é servida sem transformação; a interface pode recortar sua apresentação para ajustar o retrato ao cartão. Essa declaração de licença pertence ao recurso publicado pelo TSE; não é uma licença presumida para fotografias encontradas em outros sites.

O endpoint local `/api/photo` recebe o recorte eleitoral e `candidate=sqcand`. Aceita somente o host e o caminho documentados do TSE, não segue redirecionamentos e verifica tipo e assinatura JPEG. Fotos são carregadas sob demanda; enquanto carregam ou quando faltam, a interface usa iniciais. Não se atribui uma imagem de outra pessoa nem se gera um retrato sintético.

O cache de fotos fica em `data/photos/`, com validade local de 24 horas, limite de 500 entradas e 50 MiB no disco; cada imagem aceita até 2 MiB e tem tempo limite de seis segundos. Consultas da mesma foto são agrupadas. A fila aceita até 32 solicitações pendentes, baixa uma foto por vez e espaça os inícios em pelo menos 1,1 segundo, dando prioridade aos dados de apuração na fila TSE compartilhada. Revalidação usa ETag/Last-Modified quando disponíveis. Em falha, o serviço pode conservar o último JPEG; os cabeçalhos da resposta identificam estado, URL e hora de obtenção, sem prometer um aviso visual individual de cache em cada retrato.

Erros 404 têm espera crescente de um a 30 minutos; três fotos consecutivamente ausentes pausam novas fotos por dez minutos. Erros 403/429 aplicam a espera global TSE de dez minutos, compartilhada com a consulta eleitoral. Não há download automático dos pacotes completos de fotos do Portal de Dados Abertos.

A evidência local `tests/fixtures/tse-photo-evidence.json` registra uma consulta real feita pelo backend em 04/10/2026 às 19:15:28.664 UTC: [JPEG de sequencial 280002542548](https://resultados.tse.jus.br/oficial/ele2026/6257/fotos/br/280002542548.jpeg), HTTP 200, `image/jpeg`, 6.969 bytes. Esta conferência documental revisou a evidência sem repetir o download. Um teste positivo não comprova disponibilidade de todas as fotos, UFs ou eleições.

## Interpretação do EA20

| Campo | Interpretação e regra local |
| --- | --- |
| `f` | `o`: oficial; `s`: simulado; ausente/desconhecido: fase desconhecida |
| `dv=n`, Presidente | Votação ocultada: zeros de publicação não representam votação conhecida |
| `cand.vap`, `pvapn` | Votos computados e percentual sobre `v.vvc`, não sobre comparecimento |
| `cand.dvt` | Preservar a destinação; votos computados podem ser anulados/sub judice/legenda |
| `cand.e=s` | Pode significar segundo turno; exige ler `cand.st` |
| `cand.st` | Situação oficial; liderança não atribui vitória |
| `and`, `tf` | Andamento e totalização final são distintos |
| `md` | Definição informada pelo TSE; nenhuma previsão local |
| `esae=s` | Totalização sem atribuição de eleito |
| `carg.nv` | Vagas do cargo; `vag` é distribuição proporcional |
| `v.tvn` | Nulos agregados, inclusive técnicos |
| `s.pstn` | Percentual de seções totalizadas |
| `e.pcn`, `pan` | Comparecimento/abstenção sobre eleitorado das seções instaladas |

Fonte: [EA20, pp. 8–13 e 15–21](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-ea20-arquivo-de-resultado-unificado).

Na tabela de partidos, a aplicação soma votos válidos nominais e de legenda publicados e calcula sua participação nos votos válidos. Esse percentual é derivado local, com denominador diferente do percentual oficial da candidatura. Cadeiras de federações não são repartidas por suposição entre partidos integrantes.

Nas gerais, `and=f` municipal depende de `snt=0`. Para Presidente, isso também vale na UF; no Brasil exige totalização final. Para cargos estaduais, UF exige totalização final e Brasil exige todas as UFs. Em 2026, Senado é um cargo com duas vagas; não dois cargos e não uma eleição de vencedor único. [FAQ: andamento e Senado](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados).

## Integridade e disponibilidade

Campos ausentes, vazios ou inválidos permanecem desconhecidos (`null`); a interface exibe um traço ou estado de espera. Zero exige valor efetivamente publicado e divulgável. Percentuais oficiais não são recalculados para produzir uma aparência de conclusão. Não há geração automática de amostra nem substituição da fonte por dados sintéticos.

`live` indica uma resposta recém-consultada; `cached`, um dado em cache; `stale`, um último dado conservado após falha; `waiting`, publicação ainda não disponível; `unavailable`, impossibilidade de consulta. A fase é independente desse estado. Uma resposta recente não demonstra conclusão da eleição.

O limite TSE é 100 requisições/segundo/IP; 304 também conta. Excesso pode bloquear por dez minutos e novas tentativas antecipadas renovar o bloqueio. Erros 404 repetidos também podem bloquear, sem limiar divulgado. A aplicação evita varredura e adota espera conservadora para arquivos ausentes; 403/429 suspendem consultas globalmente por pelo menos dez minutos. [FAQ: limites](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados).

## Histórico, exportação e privacidade local

Os caches de payloads, histórico, cartografia, imagens e respostas HTTP têm limites por quantidade e bytes. A revalidação preserva os horários efetivos da fonte; hits não inventam uma nova consulta, e falhas não renovam a validade positiva. A política por recurso, a retenção e os testes estão em [Cache da aplicação](CACHE.md).

O [calendário oficial do TSE para 2026](https://www.tse.jus.br/comunicacao/noticias/2026/Marco/eleicoes-2026-confira-as-principais-datas-do-calendario-eleitoral) prevê votação em eventual segundo turno em 25 de outubro. Essa data aparece em `Bootstrap.scheduledRounds`, separada das eleições publicadas no EA11. A data não cria códigos de eleição, UFs elegíveis, candidatos, classificados ou resultados. O estado muda para disponível quando uma configuração oficial do turno é observada; os cargos e recortes realmente consultáveis continuam limitados ao EA11. Sua revalidação usa TTL de cinco minutos e requisição condicional, com limites/backoff preservados.

Enquanto a configuração do segundo turno não estiver disponível, `/api/map-preview?uf=...` permite explorar municípios com geometria e nomes oficiais do IBGE. Essa rota não consulta TSE, não vincula códigos eleitorais e não apresenta votação. Reutiliza o cache cartográfico existente, com os estados cached/stale/unavailable identificados. É uma prévia geográfica, sem afirmar que qualquer município participa do eventual segundo turno. A navegação nacional continua usando a geometria estática local, sem baixar todas as UFs.

O histórico registra somente gerações observadas desde a coleta desta instalação; não recompõe toda a apuração. Mantém até 120 versões por arquivo e até 50 candidaturas por versão, priorizadas pela votação observada, com indicação de corte no registro. Os pontos novos preservam os votos válidos (`v.vv`), votos computados (`v.vvc`) e os metadados de candidatura disponíveis. Percentual de candidatura publicado pelo TSE continua sendo sobre votos computados; voto válido não é inferido a partir desse percentual. Pontos legados sem denominadores continuam utilizáveis pelo percentual registrado; somente a geração atualmente carregada pode receber denominadores/metadados ausentes, sem preenchimento retroativo das demais gerações.

O cache mantém até 64 arquivos. O histórico regional tem até 64 recortes separados por ciclo, turno, cargo, eleição, região e conjunto de UFs, com os mesmos limites de 120 snapshots e 50 candidaturas; ele permanece independente do descarte de arquivos individuais. O conteúdo oficial e o vetor de gerações são usados para deduplicar os snapshots, sem ordenar IDG numericamente. Uma correção em geração mais recente pode diminuir votos. Cada ponto regional tem data única de geração nula, horário local de observação, cobertura completa e intervalo/vetor dos horários originais das UFs. Escritas de cache e histórico são serializadas e substituem o arquivo local de forma atômica, permitindo recuperação após reinício. Pode haver lacunas entre consultas, reinicializações, descarte por limite ou indisponibilidade. Exportações refletem o recorte e a geração exibidos; JSON bruto preserva o arquivo de origem quando disponível.

O serviço deve ouvir somente `127.0.0.1`, sem exposição automática à rede. Cache/histórico ficam em `data/`; favoritos e preferências podem ficar no armazenamento do navegador. Não há envio automático de favoritos ou histórico a um serviço externo. É necessário acesso à internet para atualizar os arquivos oficiais. Sem fonte acessível, o último cache é identificado ou a aplicação informa a indisponibilidade.
