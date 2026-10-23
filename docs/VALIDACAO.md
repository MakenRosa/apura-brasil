# Evidências e validação

Este arquivo separa leitura documental, funcionamento local e disponibilidade da fonte. Um layout válido ou um teste com fixture não demonstra que o TSE já publicou votação oficial para uma eleição.

## Conferência documental — 04/10/2026

Foram abertas a [página técnica 2026 do TSE](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados), as instruções de download e as especificações EA11, EA12, EA14, EA15 e EA20 vinculadas na página. As versões e os pontos interpretativos estão em [FONTES.md](FONTES.md). Foram confirmados os códigos oficiais publicados, a fase dos arquivos, o significado de IDG, o cargo Senado com duas vagas, a distinção entre segundo turno/eleito e as restrições de acesso.

Esta conferência foi documental, sem varredura de endpoints ou consultas adicionais aos arquivos de votação. A disponibilidade efetiva das fontes deverá constar abaixo a partir das consultas limitadas feitas pelo backend.

## Arquivos oficiais coletados pelo backend — 04/10/2026

O backend realizou consultas pontuais e informou HTTP 200 nos cinco arquivos abaixo. Os JSONs salvos em `tests/fixtures/` foram inspecionados independentemente. A hora exata da coleta inicial não foi registrada; os horários abaixo são **geração do TSE**, sem fuso explicitado no leiaute.

| Arquivo | URL oficial | Fase | IDG | Geração TSE |
| --- | --- | --- | --- | --- |
| EA11 | [ele-c.json](https://resultados.tse.jus.br/oficial/comum/config/ele-c.json) | `o` | `980407` | 02/10/2026 18:30:57 |
| EA12 | [mun-e006257-cm.json](https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json) | `o` | `963009` | 02/10/2026 18:30:22 |
| EA14 | [br-e006257-ab.json](https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-e006257-ab.json) | `o` | `1079359` | 03/10/2026 15:36:16 |
| EA15 | [sp-e006257-ab.json](https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp-e006257-ab.json) | `o` | `1079361` | 03/10/2026 15:36:17 |
| EA20 | [br-c0001-e006257-u.json](https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json) | `o` | `1070425` | 03/10/2026 14:47:37 |

O EA20 coletado refere-se a Presidente, Brasil, eleição 6257, primeiro turno. Possui `dv=s`, `and=n`, `tf=n` e `s.pstn=0`: fonte disponível, totalização ainda não iniciada nesse arquivo. Não é evidência de votos durante a apuração nem de conclusão. Nenhuma consulta em massa foi feita para verificar todas as UFs, municípios, cargos ou segundo turno.

A inspeção independente da normalização desses arquivos produziu 12 candidaturas presidenciais com votos zero publicados e nenhum eleito; 28 linhas de acompanhamento de UFs (27 UFs e Exterior), 645 municípios de SP no EA12 e 645 linhas municipais de SP no EA15. O mapa representa as 27 UFs brasileiras. Foi conferido também que o percentual decimal `1.234` permanece `1.234`, sem interpretação como milhar.

## Verificações locais — 04/10/2026

`node scripts/validate.mjs` executado às **15h30 (UTC−03)** com Node.js 24.20.0, após a compilação de produção: **14 verificações aprovadas**, processo encerrado com código 0.

- Saúde do serviço, bootstrap em contingência e dados desconhecidos preservados.
- Regiões/municípios sem lista ou votação inventada na falta de fonte.
- UF inválida e resultado nacional de Senado rejeitados com HTTP 400.
- Exportação bruta sem fonte retornando HTTP 503, API desconhecida HTTP 404 e método de escrita HTTP 405.
- Host externo rejeitado com HTTP 403.
- GeoJSON local servido, 27 geometrias de UFs com códigos distintos e HTML de produção servido.

A execução criou um servidor próprio em porta efêmera de `127.0.0.1`, com rede externa substituída por uma função que rejeita consultas. Foram interceptadas quatro tentativas do cliente, **zero chamadas externas**, sem gravar em `data/` nem reutilizar o histórico real. O servidor de teste foi encerrado ao final. Isso valida o contrato e os estados sem rede; não simula a publicação em tempo real.

`npm test` foi executado independentemente após os ajustes do backend: **27 testes aprovados, zero falhas**, código 0. Cobertura inclui normalização oficial, divulgação oculta, segundo turno, destinação, escopo, ausência/zero, cache e coalescência, validação condicional, 404, bloqueio global 403/429, timeout, regressão de geração da CDN, persistência, limite do histórico, exportações completas e proteção HTTP/arquivos. Os testes não fazem consultas externas ao TSE.

A compilação final TypeScript/Vite foi aprovada. A revisão em navegador foi concluída, conforme os registros abaixo.

## Conferência final no navegador — 04/10/2026

Foi utilizada a compilação de produção servida em `http://127.0.0.1:4178`. Foram conferidos:

- Painel presidencial nacional: 12 candidaturas, 499.248 seções, fase oficial e aviso de totalização ainda não iniciada. Sem declarar eleitos ou liderança com votação zero.
- Consulta de SP, seus 645 municípios e o município de São Paulo (código TSE 71072). A busca por `sao paulo` encontra `SÃO PAULO`.
- Deputado Federal/SP: 1.045 candidaturas e 70 vagas, 25 candidatos por página e navegação entre as 42 páginas.
- Busca de candidato, detalhes da candidatura, comparação entre duas candidaturas, salvar/remover favorito e reabrir o recorte salvo.
- Tabela de municípios: busca e paginação com 645 registros; consulta a partir da linha da tabela.
- Recorte Exterior e lista publicada de 186 localidades eleitorais, mantendo a identificação de abrangência.
- Preferências de tema claro/escuro, intervalo de 60 segundos, pausa/retomada e entrada/saída do modo telão. Ao encerrar a revisão, foram restaurados tema claro e intervalo de 30 segundos.
- Layouts de 1440 × 1000, 390 × 844 e 360 × 800: sem rolagem horizontal global; menu móvel e controles operacionais. As barras dos cargos e as tabelas mantêm sua rolagem interna quando necessário. Nenhum erro ou aviso JavaScript foi registrado nos fluxos conferidos.
- CSV baixado pela interface: 1.045 linhas de candidatos, além do cabeçalho, com dados de fonte e contexto. JSON baixado pela interface: original EA20, fase `o`, eleição 6259, 1.045 candidatos, sem envelope da aplicação. Downloads foram inspecionados no disco.
- Interface sem acesso externo, em servidor separado sem cache real: os quatro indicadores ficaram como `—`, nenhuma candidatura foi inventada e o estado mostrou fonte indisponível. Esse servidor de teste foi encerrado.
- Inicialização em segundo plano, reabertura da execução existente e encerramento por identidade do processo foram conferidos. O serviço principal ficou ativo somente em 127.0.0.1:4178; a porta de teste 4180 foi encerrada.

As exportações de SP vieram do arquivo [sp-c0006-e006259-u.json](https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0006-e006259-u.json), gerado pelo TSE em 02/10/2026 18:34:48 (fuso não declarado), IDG 1024241. Ainda continha zero seções totalizadas no momento da consulta, às 15h48 (UTC−03). Os dados presidenciais e municipais conferidos também estavam antes da totalização; **a evolução durante a apuração depende de novas publicações oficiais e não foi observada nesta validação**.

A execução final de `npm test` aprovou **27/27**, incluindo exportações completas, proteção de fórmulas, ausência/zero e reutilização de cache sem novos downloads. `npm run validate` aprovou novamente **14/14**, com zero chamadas externas. `npm run build` compilou sem erros. A captura visual da entrega está em `test-results/painel-desktop.jpg`; as exportações de conferência estão no mesmo diretório.

## Ampliação do mapa, retratos e densidade — 04/10/2026

Esta revisão corresponde às melhorias posteriores à primeira entrega, incluindo a redução do bloco de contexto solicitada a partir da captura do usuário. As contagens de 27 testes e 14 verificações acima descrevem a entrega anterior.

- `npm test`: **48/48 testes aprovados**, incluindo vínculo IBGE/TSE, restrições municipais do pleito, contingência de cartografia, autorização das fotos pelo sequencial da candidatura, validação de JPEG, cache, coalescência e bloqueios da fonte.
- `npm run validate`: **18/18 verificações aprovadas**, com zero chamadas externas. Foram interceptadas quatro tentativas do cliente TSE e duas do cliente IBGE. O servidor isolado foi encerrado.
- Compilação final TypeScript/Vite aprovada. A compilação com os filtros móveis em duas linhas gerou `index-D6nJCnHN.css` e `index-CQls1ow6.js`.
- Conferência real de cartografia: **645 polígonos de SP, 645 vínculos confirmados e nenhum sem correspondência**; DF com uma localidade, vinculada a Brasília. São Paulo: IBGE `3550308` → TSE `71072`. Brasília: IBGE `5300108` → TSE `97012`. Os envelopes e a procedência estão em `test-results/mapa-e-fotos-api.json`.
- Navegação Brasil → estado → município, busca sem acentos, seleção da consulta de São Paulo e Guarulhos, lista de 645 localidades, destaque do município e enquadramento do território ou da cidade. A navegação por teclado confirmou uma única geometria no ciclo de Tab, deslocamento com as setas e seleção com Enter. A visão nacional preserva cargo e UF da consulta quando se abre o caminho “Brasil”.
- Tela cheia nativa do atlas, com entrada, saída e transição do Brasil para SP e para o município mantendo o mapa ampliado. Zoom e arraste conferidos: um arraste real alterou o `viewBox` de `140 98 720 504` para `80.38809831824062 68.19404915912031 720 504`, sem trocar a consulta eleitoral. Gestos de pinça foram revisados no código, sem validação em dispositivo de toque nesta execução.
- **12 retratos presidenciais distintos carregados e decodificados pelo navegador**, nas consultas nacional e municipal; imagens oficiais do TSE com largura natural de 161 pixels. Foram conferidos também retratos e créditos nos detalhes e na comparação. A amostra registrada em `tests/fixtures/tse-photo-evidence.json` aponta para o JPEG oficial de Lula e registra HTTP 200; ela não alimenta a interface como dado simulado.
- Contexto lateral compacto: nome, estado da fonte e avanço da totalização permanecem visíveis. Eleitorado/comparecimento e fonte/horários começam recolhidos. Em 1440 × 1000, o bloco de candidaturas ocupou aproximadamente **80% da altura lateral do atlas ampliado**. A altura do mapa fica estável enquanto os resultados carregam.
- Layouts de **1440 × 1000, 390 × 844 e 360 × 800**, além da janela normal de 640 pixels: sem rolagem horizontal global. No celular, seleção municipal, fotos, menu, atlas ampliado e painéis recolhidos funcionaram. O ajuste final dos filtros manteve município, favorito e atualização na mesma linha; em 390 e 360 pixels a barra mediu cerca de 138 pixels de altura, em duas linhas.
- Contraste dos seletores da comparação conferido pelo estilo computado no tema escuro; avisos de contexto acompanham o tema. Nenhum aviso ou erro JavaScript foi registrado nos fluxos finais.
- Contingência em servidor separado sem rede nem cache real: selecionar SP mostrou cartografia indisponível, zero polígonos municipais, zero candidaturas/retratos e indicadores `—`. O processo foi encerrado e a porta efêmera 55566 ficou fechada; o serviço principal permaneceu acessível em `127.0.0.1:4178`.

A captura da interface ampliada, com São Paulo selecionado, fotografias e lateral compacta, está em `test-results/mapa-municipios-compacto.jpg`. Tema claro e intervalo de 30 segundos foram restaurados ao concluir a revisão. Foram verificadas as malhas de SP e DF e os retratos presidenciais; isso não demonstra disponibilidade de cada imagem, cargo ou malha de todas as UFs. Os arquivos eleitorais conferidos continuavam anteriores ao início da totalização; nenhuma evolução real de votação foi observada nesta execução.

## Barra lateral e retorno ao Brasil — 04/10/2026

Revisão posterior solicitada pelo usuário: sidebar recolhível e correção da seleção que permanecia na UF após voltar ao mapa nacional. O comportamento anterior que preservava a UF na visão “Brasil”, descrito na revisão acima, foi substituído pelo retorno efetivo ao recorte nacional.

- Compilação TypeScript/Vite aprovada após as duas alterações. Backend e contrato HTTP permanecem os mesmos; a revisão desta alteração foi feita na interface real, sem criar testes que apenas repetem a implementação.
- Em 1440 × 1000, a barra recolheu de **218 para 72 pixels** e a margem do conteúdo acompanhou a mudança. Foi possível expandir novamente, navegar pela comparação usando o ícone e recolher pelo teclado. Nomes acessíveis e dicas visuais dos ícones foram conferidos; a preferência continuou recolhida após recarregar a página.
- Presidente/SP/São Paulo (`71072`) → **Brasil**: filtro de abrangência `br`, município vazio e desabilitado, zero polígonos com seleção ativa, contexto “Brasil”, mapa nacional e enquadramento inicial `0 0 1000 700`.
- Deputado Federal/SP → **Brasil**: cargo preservado, nenhuma UF selecionada, nenhuma candidatura estadual anterior e orientação para escolher um estado. O filtro também permite abrir essa visão nacional. A interface não solicita EA20 nacional para cargos incompatíveis.
- Deputado Distrital na visão nacional: apenas o Distrito Federal habilitado para seleção, sem erro de consulta nacional. As consultas nacionais de resultado e de regiões incompatíveis são omitidas; ausência de publicação não recebe valores fabricados.
- Em 390 × 844, o menu móvel abriu completo, mesmo com a preferência de desktop recolhida; o botão de fechar e `Esc` fecharam o menu e devolveram foco a “Abrir navegação”. Em 390 e 360 pixels, não houve rolagem horizontal global.
- A captura das duas alterações está em `test-results/sidebar-recolhida-brasil.jpg`: barra de ícones, filtros em Brasil e mapa nacional sem seleção de UF. Foram removidas as dimensões temporárias de teste ao concluir a conferência.

## Filtro regional, soma de votos e temperatura — 04/10/2026

Revisão solicitada pelo usuário: explorar as regiões, incluir seus votos no recorte e usar uma escala contínua de temperatura.

- Compilação final TypeScript/Vite aprovada: `index-BEtpCjEG.js` e `index-DI3raRIL.css`. **63 testes passaram**, sem falhas, incluindo 15 testes regionais de pesos diferentes, campos ausentes, identidade presidencial, colisões por UF, `dv=n`, fases incompatíveis, cache, elegibilidade e exportações HTTP.
- Os cinco conjuntos geográficos foram conferidos: Norte **7**, Nordeste **9**, Centro-Oeste **4**, Sudeste **4** e Sul **3**. O filtro enquadra a região e restringe busca/lista; mantém um único polígono na sequência de Tab. Reenquadrar depois de aproximar restaura o enquadramento da região.
- A seleção regional atualiza também abrangência, contexto, votos, candidaturas e indicadores. Ao trocar o recorte, a interface não mantém os votos da consulta anterior durante o carregamento. Os percentuais são calculados com as somas dos numeradores e denominadores, sem média simples entre estados.
- **Conferência independente com arquivos oficiais reais** no pacote JSON exportado: no Sul, **72.015 seções totais**, **43.287 totalizadas**, **60,1083107686%** e **10.397.402 votos computados**; no Nordeste, **140.828 seções totais**, **46.963 totalizadas**, **33,3477717499%** e **10.496.071 votos computados**. Os votos e percentuais das **12 candidaturas presidenciais** foram comparados à soma dos arquivos brutos de cada UF nos dois recortes. São capturas transitórias, não valores usados para alimentar a aplicação. Evidências em `test-results/soma-regional-sul.json` e `test-results/soma-regional-nordeste.json`.
- No navegador, Sul mostrou **3/3 estados** e Nordeste **9/9**; a lista de fontes exibiu os nove arquivos oficiais individuais. Entrar na Bahia limpou a região, exibiu votação estadual e carregou **417 municípios, com 417/417 vínculos confirmados**. Brasil restaurou `br`, município vazio, todas as regiões, 27 UFs e zero seleção ativa. O fluxo anterior de SP/645 municípios/São Paulo `71072` também foi conferido nesta revisão.
- Trocar de Nordeste/Presidente para Deputado Distrital limpou a região incompatível, não exibiu candidaturas anteriores nem erro de consulta nacional, e habilitou somente Centro-Oeste no seletor regional. O backend foi testado para usar apenas DF nesse cargo, sem solicitar acompanhamento nacional incompatível.
- Temperatura contínua: **0% `#3478d4`**, **50% `#f4d55c`**, **75% `#f38b37`**, **100% `#d9363e`**. Verificação direta da interpolação: **74% `#f38e38`**, **75% `#f38b37`**, **76% `#f28837`**; **7% `#428fd0`** e **21% `#5dbec7`**. O contraste mínimo das siglas foi **4,585:1** numa amostragem de 10.001 valores. A legenda usa os mesmos pontos e mantém 0%, 25%, 50%, 75% e 100% legíveis no celular. Evidência em `test-results/escala-temperatura.json`.
- Conferidos desktop **1440 × 1000/1100**, celulares **390 × 844** e **360 × 800**, mapa ampliado, votos regionais e saída da tela cheia: sem rolagem horizontal global. Nenhum erro ou aviso JavaScript nos fluxos finais. As dimensões temporárias do navegador foram removidas ao concluir.
- Captura final em `test-results/regiao-votos-temperatura.jpg`, com contexto Nordeste, cobertura 9/9 e candidaturas regionais; leitura do DOM em `test-results/regiao-votos-temperatura.json`. A captura inicial do filtro geográfico, antes da soma de votos e da mudança para temperatura, permanece em `test-results/filtro-regiao-e-cores.jpg` e não representa o comportamento final.

## Cache da aplicação — 05/10/2026

- Compilação TypeScript/Vite aprovada; **163 testes aprovados, sem falhas**, incluindo 37 novos casos de cache no navegador, clientes TSE/IBGE, fotos e HTTP. `npm run validate`: **18 verificações aprovadas e zero chamadas externas**.
- Testes controlados confirmaram coalescência: 15 leituras equivalentes resultaram em uma requisição; três alterações paralelas compartilharam uma gravação; dez acessos ao mesmo arquivo reaproveitaram validação e normalização; doze leituras simultâneas de uma foto persistida fizeram uma leitura de disco. Essas medidas pertencem aos testes, não representam um percentual medido de economia na sessão do usuário.
- Conferidos limites de memória e disco, descarte LRU, restauração após reinício, cancelamento individual, alteração de arquivos, resposta HTTP 304, compressão, falha de revalidação sem renovação indevida da validade, recuperação de foto ausente e autorização antes de responder do cache.
- No navegador real: Brasil → Santa Catarina → Brasil → Santa Catarina reaproveitou a malha de **295 municípios**, sem mensagem de carregamento e com **um único SVG**. A seleção de Florianópolis manteve o contexto municipal correto; o retorno restaurou Brasil, 27 UFs e todas as regiões.
- O filtro Nordeste exibiu os votos regionais e nove estados. O retorno ao Brasil limpou esse filtro. A troca para o segundo turno mostrou apenas cartografia e o estado de espera pela configuração TSE, sem candidaturas, fotos ou votação do primeiro turno; retornar ao primeiro turno recuperou somente seu cache correspondente.
- Atualização manual conferida com o servidor reiniciado e acesso à fonte oficial; o serviço ficou disponível em `http://127.0.0.1:4178/`. Na conferência final, `/api/health` mostrou `ok: true`, nenhum erro da fonte, nenhum bloqueio ativo e nenhuma requisição pendente. Nenhum erro JavaScript foi registrado nos fluxos conferidos.
- Captura final: `test-results/cache-aplicacao.png`, com mapa nacional, dados e retratos carregados. A aplicação foi deixada no primeiro turno, Brasil, fora do atlas ampliado. Políticas e limites estão documentados em [CACHE.md](CACHE.md).

## Roteiro reproduzível

1. Executar os testes de normalização, especialmente: ausência diferente de zero, `dv=n`, candidato em segundo turno, votação anulada/sub judice, seções a 100% sem atribuição de eleito e Senado com duas vagas.
2. Compilar TypeScript e frontend para produção.
3. Subir o servidor em `127.0.0.1` e verificar HTML, bootstrap, health, filtros inválidos e envelopes sem fonte.
4. Fazer apenas consultas oficiais necessárias, respeitando cache e bloqueios. Registrar URL, HTTP, data/hora, fase e se havia votação; não repetir um 404 em laço.
5. Conferir no navegador filtros, busca, favoritos, comparação, estados vazios/erro/cache, histórico e exportações. Checar foco/teclado, títulos acessíveis, contraste e adaptação em telas menores.
6. Conferir que interface não atribui vencedor por liderança, porcentagem de seções ou `e=s` isolado e não anuncia simulado como oficial.

## Limitações permanentes

- A aplicação depende da publicação e da sincronização dos arquivos do TSE.
- Polling e histórico local deixam lacunas; não são um registro completo nem uma atualização instantânea.
- Um ambiente sem rede pode validar o funcionamento de erro/cache, mas não a atualização oficial.
- Testes de acessibilidade automatizados e revisão de código não substituem uso com leitores de tela e avaliação humana.
