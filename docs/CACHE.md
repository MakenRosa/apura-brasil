# Cache da aplicação

O cache é separado por origem e pelo recorte completo: ciclo, eleição, turno, cargo, UF, região e município. A prévia IBGE do segundo turno tem uma chave própria e contém apenas cartografia. Nenhum cache transfere votos ou candidaturas entre turnos. Resultados com 100% de seções continuam sujeitos a revalidação e correções do TSE.

## Navegador

O cache JSON é compartilhado pelos componentes, agrupa solicitações simultâneas e usa descarte LRU, com até 64 entradas, 24 MiB estimados e 24 transportes concorrentes. Cancelar um consumidor não cancela os demais; uma resposta atrasada de um transporte cancelado não substitui uma consulta nova. Dados consultados podem aparecer imediatamente durante a revalidação, com o último horário e indicação de cache antigo quando vencidos. Não são persistidos novos resultados no armazenamento do navegador.

| Recurso | Validade no cache JSON |
| --- | --- |
| Resultados e progresso territorial | 5 segundos |
| Diagnóstico local | 2 segundos |
| Eleições/configuração do painel | 60 segundos |
| Lista de municípios e mapa municipal vinculado | 5 minutos |
| Prévia municipal IBGE | 15 minutos |
| Cartografia nacional e proveniência estáticas | 30 minutos |

URLs eleitorais sem identificador explícito de eleição não entram no cache JSON. Respostas de espera/indisponibilidade e mapas sem geometria invalidam o positivo anterior; não ganham uma validade longa. `nextRetryAt` limita a validade de conteúdo antigo. A camada municipal usa o mesmo prazo do cache compartilhado, sem somar dois TTLs.

**Atualizar** e **Tentar novamente** ignoram a validade do navegador e revalidam a API local. Um miss ou expiração da API usa `fetch(..., {cache:'no-cache'})`, permitindo confirmação por ETag e evitando renovar um snapshot HTTP antigo sem consultar o servidor. Isso não ignora as esperas, os limites de acesso ou o TTL do cliente TSE. A atualização automática continua no intervalo configurado, com pausa/aba oculta respeitadas.

Falhas de retratos ficam em um cache negativo de até 128 URLs por 60 segundos. A nova tentativa exige retrato visível e aba em primeiro plano; usa a URL oficial original, sem parâmetros artificiais nem varredura de imagens.

## Servidor e disco

| Camada | Limites e política |
| --- | --- |
| Arquivos TSE | LRU de 64 payloads / 64 MiB; resultados 15 segundos, EA11 5 minutos, EA12 1 hora |
| Histórico TSE e regional | Até 16 MiB globais, com limites de recortes/versões/candidaturas existentes; histórico/backoff de payloads descartados também tem retenção limitada |
| Cartografia IBGE | 6 UFs / 32 MiB em memória, 128 MiB no disco, validade de 30 dias |
| Mapas municipais montados | 6 mapas / 16 MiB |
| Somas regionais calculadas | 32 recortes / 8 MiB |
| Fotografias TSE | 24 horas após validação positiva; 500 entradas / 50 MiB no disco, 100 imagens / 16 MiB em memória |
| Arquivos HTTP | 64 arquivos / 32 MiB, mais até 64 representações comprimidas / 32 MiB |

Payloads iguais e respostas 304 preservam a identidade para reutilizar validação, normalização e montagem. Uma alteração de conteúdo, mesmo com o mesmo identificador de geração, provoca novo processamento. Resultados devolvidos aos consumidores são separados para evitar que um componente altere o cache de outro. Escritas concorrentes são agrupadas por revisão e substituem os manifestos de forma atômica; `flush()` aguarda as revisões pendentes.

Uma falha atualiza o registro da tentativa e o backoff, mas **não renova a última validação positiva**. `checkedAt` informa a última tentativa efetiva da fonte e pode ser nulo antes da primeira tentativa; hits em memória não inventam um novo horário. O último dado recebido pode ser exibido como `stale`. ETag/Last-Modified só são usados quando o corpo guardado continua válido; um arquivo rejeitado ou JPEG ausente não entra num ciclo de respostas 304 sem conteúdo.

## HTTP local

Resultados, regiões e bootstrap usam ETag com `private, no-cache`: a confirmação é feita pelo servidor antes de devolver 304. Municípios/mapas com eleição explícita podem usar `max-age=300`; a prévia geográfica, `max-age=900`. Fontes indisponíveis/antigas e URLs eleitorais implícitas voltam a `no-cache`. Diagnóstico, erros e exportações mantêm `no-store`.

JavaScript/CSS e demais assets com hash no nome usam cache de um ano e `immutable`; cada build altera seu endereço. HTML exige revalidação, portanto recebe a versão nova após recompilar. Os demais arquivos estáticos usam até uma hora com revalidação. Conteúdo textual negociado pode usar gzip; a representação comprimida é reutilizada, com `Vary: Accept-Encoding` e ETag próprio. Fotografias têm ETag calculado dos bytes recebidos e cache HTTP de até uma hora; fotos antigas exigem revalidação.

Host, método, filtros eleitorais, identidade de candidatura e confinamento dos arquivos por `realpath` são verificados antes de servir conteúdo em cache ou 304. O cache não substitui essas validações.

`/api/health` expõe contadores locais de hits, leituras, compressões, respostas 304 e memória das camadas HTTP/fotos, além dos contadores TSE. Não provoca consulta eleitoral externa.

## Evidência de desempenho

Os testes offline com relógio e transporte controlados comprovaram 15 leituras JSON equivalentes com uma única requisição; três atualizações TSE paralelas com uma gravação; dez hits sem repetir validação/normalização; e uma única montagem para mapas/somas repetidos. São medições controladas, não uma promessa de redução idêntica em qualquer navegação.

Os testes também cobrem limites LRU/bytes, troca de recorte, resposta fora de ordem, cancelamento compartilhado, expiração após falha, atualização manual, restart/persistência, 304 sem corpo válido, compressão, HTML de um novo build e negação de um diretório aquecido que passa a apontar para fora de `dist`.
