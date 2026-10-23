# Como o painel funciona

Detalhes de cada área do painel. Visão geral no [README](../README.md).

## Mapas e municípios

A página inicial abre o mapa da apuração, com o segundo turno de 2026 selecionado na primeira utilização. O turno escolhido fica salvo no navegador. O topo compacto permite trocar turno, buscar localidades com **Ctrl/Cmd + K**, abrir o menu, alternar tema e usar tela cheia. No desktop, o recorte fica à esquerda, o mapa ao centro e o progresso regional e as versões coletadas à direita; em telas menores, os painéis se reorganizam. A navegação lateral é recolhida em um menu.

Selecione uma UF para explorar seus municípios; clique em uma cidade ou use a busca e a lista de localidades para consultar o recorte. Aproximar, afastar, enquadrar, selecionar regiões e entrar em estados/municípios usam transições suaves. Arraste para mover e use **Ctrl/Cmd + rolagem** para zoom no ponto do cursor. Novos gestos cancelam movimentos anteriores; a preferência de reduzir movimento do sistema é respeitada. **Expandir mapa** abre a exploração em tela cheia, com retorno pelo botão de saída ou `Esc`; o modo telão do painel continua disponível nos ajustes.

O eventual segundo turno está previsto para **25/10/2026**, conforme o [calendário oficial do TSE](https://www.tse.jus.br/comunicacao/noticias/2026/Marco/eleicoes-2026-confira-as-principais-datas-do-calendario-eleitoral). Enquanto o cargo correspondente não aparecer na configuração oficial EA11, o painel indica espera e disponibiliza somente navegação cartográfica IBGE, sem consultar resultados, candidaturas, seções ou cadastro municipal daquele turno. A cartografia não presume participação eleitoral de cada UF. O cadastro EA11 é revalidado em cinco minutos e o navegador consulta sua disponibilidade a cada minuto, salvo pausa ou aba oculta. A ativação exige configuração oficial do cargo; não reaproveita identificadores ou registros do primeiro turno.

No segundo turno, os painéis apresentam registros individuais, seções totalizadas, fontes e horários. O seletor regional mostra siglas e progresso territorial. A trilha abaixo do mapa permite explorar as versões oficiais realmente observadas no recorte, sem reproduzir um mapa passado: a cartografia continua na consulta atual. Não há histórico sintético anterior à coleta.

O caminho **Brasil** limpa a UF e o município selecionados e sincroniza os filtros com o mapa nacional. Para Presidente, retorna ao resultado do Brasil. Nos cargos que exigem uma UF, mantém o cargo e pede a escolha de um estado; não apresenta candidaturas de uma consulta estadual anterior nem solicita um resultado nacional incompatível.

No mapa geral, **Selecionar recorte regional da apuração** permite explorar Norte, Nordeste, Centro-Oeste, Sudeste e Sul. O mapa enquadra a região, a busca e a lista ficam restritas aos seus estados, e votos, candidaturas e indicadores passam a considerar a **soma dos arquivos estaduais do TSE**. A abrangência no topo acompanha a região. Selecionar uma UF abre seus municípios e sua votação; **Brasil** restaura o recorte nacional.

As cores representam o percentual de **seções totalizadas**, em uma escala contínua de temperatura: **azul em 0%, amarelo em 50%, laranja em 75% e vermelho em 100%**. Cada percentual é interpolado: 74%, 75% e 76% recebem tons distintos, assim como 7% e 21%. A legenda usa a mesma escala do mapa, e as siglas alternam entre texto claro e escuro conforme o contraste. **Sem dados** tem cor própria e permanece diferente de zero. A escala é fixa nos mapas nacional, regional e municipal.

O percentual regional de uma candidatura divide seus votos somados pelos votos computados somados (`v.vvc`), e o de seções divide seções totalizadas somadas por seções totais somadas; percentuais estaduais não são simplesmente promediados. A cobertura e os arquivos de cada UF ficam em **Fonte e horários**, com suas gerações independentes. Valores sem soma integral segura continuam desconhecidos, e fases incompatíveis não são misturadas. Candidaturas de cargos estaduais mantêm sua UF de origem. Prefeito, vereador e conselheiro exigem consulta municipal, sem agregação regional automática. Favoritos, comparação e exportações respeitam o recorte; o JSON regional contém a soma calculada e os arquivos originais das UFs. O histórico regional registra e preserva as somas completas oficialmente observadas desde sua ativação, com cobertura e gerações das UFs; não recompõe publicações anteriores.

Os seletores regionais usam as siglas **N, NE, CO, SE e S**, seguidas pelo percentual de seções totalizadas. Os controles existentes do primeiro turno preservam sua apresentação; no segundo turno, o seletor informa somente o progresso territorial.

Os controles existentes do primeiro turno permanecem disponíveis naquele contexto. Abaixo do mapa, a trilha de versões acompanha Brasil, região, UF e município e utiliza apenas dados explicitamente oficiais observados nesta instalação. Uma única parcial permanece uma única versão, e valores desconhecidos continuam lacunas.

O botão ao lado da navegação no topo permite **recolher ou expandir a barra lateral**. Recolhida, ela mantém os ícones, a identificação da página ativa e os nomes ao passar o mouse ou focar com o teclado. A preferência fica salva neste navegador. No celular, a navegação abre como menu completo e pode ser fechada pelo botão de saída ou por `Esc`.

A cartografia nacional contém as 27 UFs. Para a exploração municipal, a malha é obtida por UF no IBGE e associada à lista eleitoral do TSE, priorizando o campo oficial `cdi` do EA12. Código TSE e código IBGE permanecem distintos. A associação deve ser única e pertencer à mesma UF; municípios sem correspondência segura ficam identificados como não associados.

A cobertura municipal depende da disponibilidade da malha e do cadastro eleitoral. A existência de um polígono não demonstra publicação de apuração. Os dados de avanço vêm do EA15; votos de candidatos exigem o resultado específico do município. Brasília e Fernando de Noronha seguem os recortes publicados, e localidades do exterior não são desenhadas na malha brasileira. Os critérios e as fontes estão em [Fontes e metodologia](FONTES.md).

As malhas municipais são carregadas por UF e mantidas no cache local por até 30 dias. O estado e a origem da cartografia são separados do estado dos dados eleitorais. Se a malha faltar ou a associação não for segura, isso não autoriza preencher votos ou avançar a apuração por suposição.

## Fotos de candidatos

Os retratos são fotografias oficiais do TSE, vinculadas ao sequencial da candidatura no resultado recebido. São carregados sob demanda e mantidos no cache local; durante o carregamento ou se a imagem não estiver disponível, o cartão mostra iniciais. A apuração continua tendo prioridade nas consultas ao TSE.

Crédito: **Fotos: TSE**. O [recurso oficial de fotos de 2026](https://dadosabertos.tse.jus.br/dataset/candidatos-2026/resource/e8f0a648-b438-4117-814a-f32f4c4977c8) declara licença Creative Commons Atribuição. A disponibilidade depende da publicação oficial; critérios de identidade, limites de cache e tratamento de falhas estão em [Fontes e metodologia](FONTES.md).

## Cache e atualização

Dados, cartografia e imagens são reutilizados entre consultas. Requisições simultâneas iguais são agrupadas; os caches têm limites de memória/disco e preservam o recorte eleitoral completo. Navegar de volta a um lugar conhecido reaproveita seus dados enquanto verifica a atualização, com fonte e horários preservados. O botão **Atualizar** revalida o servidor local; pausas e limites do TSE continuam respeitados. A política e os testes estão em [Cache da aplicação](CACHE.md).


## Uso

Selecione eleição, turno, cargo e UF. A consulta municipal depende da lista publicada e do cargo. Observe a identificação da fase, a origem, a geração TSE e o estado do cache antes de interpretar uma atualização. Favoritos guardam recortes; a comparação usa a votação do mesmo recorte. O histórico começa quando esta instalação observa os dados, e não no início da eleição. Exportações representam dados realmente recebidos e seu contexto.

Uma liderança parcial não equivale a vitória. Segundo turno e situação de eleito seguem os campos oficiais. Ausência não vira zero, e votação não liberada permanece indisponível. Senado tem duas vagas em 2026. A aplicação não é um produto do TSE.

As áreas disponíveis dependem do turno e da configuração oficial. Incluem mapa das 27 UFs e exploração municipal, listas paginadas, busca sem acentos, situação e destinação de cada candidatura, contadores de seções/eleitorado/votos, temas claro/escuro/sistema, pausa, quatro intervalos de atualização e modo telão. Pleitos são descobertos na configuração oficial, incluindo eleições suplementares disponíveis. A área agendada do segundo turno aparece em espera; somente uma publicação correspondente na configuração oficial habilita consultas eleitorais.

O CSV exporta todos os candidatos do recorte, mesmo que a tela mostre somente 25 por página. O JSON preserva os dados brutos recebidos do TSE. Ambos identificam cargo, UF, município, turno e eleição no nome do arquivo.

