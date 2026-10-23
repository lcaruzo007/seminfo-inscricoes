# Validação e roteiro de homologação

## Executados localmente

Em 23/10/2026 foram executadas quatro suítes com Node.js, carregando os arquivos `.gs` reais em um contexto JavaScript. Resultado final: **189 testes aprovados, nenhuma falha**. Serviços de planilha, Forms, gatilhos, lock e e-mail são simulados; os resultados não representam execução no Google Apps Script nem envio de mensagens reais. O total é atualizado pelo empacotamento.

| Suíte | Testes | Evidência |
|---|---:|---|
| `tests/domain.test.cjs` | 32 | Regras puras de CPF, identidade, vagas, intervalos, trocas, replay e administração |
| `tests/notifications.test.cjs` | 20 | Cota incluindo CC, deduplicação, leases, falhas, modelos, prazo e duplicação após envio interrompido |
| `tests/forms-install.test.cjs` | 122 | `instalarSistema` real com mocks, preservação dos dados, Forms/opções, modo verificado e quarentena |
| `tests/persistence.test.cjs` | 15 | Injeção de falhas antes/depois do append, recuperação, corrupção e releitura sob lock simulado |

As suítes usam `node:test`/`assert`, `vm` e `crypto`, todos nativos do Node, e carregam os módulos de `src/`. Execute cada arquivo na raiz do projeto conforme o [README](../README.md). São apropriados também para ambientes que não permitem subprocessos do executor `node --test`. O empacotamento gera `dist/test-results.txt` com a saída da execução final; os relatórios e pacotes de `dist/` ficam fora do Git.

A atualização de reinício cobre exclusão de atividade, recusa quando há inscrições, manutenção do Form fixo fechado, nomes explícitos, migração de vínculos, cadastro da programação sem inventar dados, limpeza de livro/fila/respostas/abas nativas/equipes, backups ocultos protegidos, manutenção dos IDs e perguntas, bloqueio durante limpeza, falha de backup, retomada após exclusão parcial, recusa durante envio de e-mail e invalidação de importação iniciada antes do reinício. Ainda é necessária homologação em uma cópia no Google para confirmar as permissões reais e o comportamento das abas vinculadas.

A correção de Form sem destino reproduz a mensagem **“O formulário não tem nenhum destino de resposta no momento.”** e a equivalente em inglês, com e sem ponto e com prefixo `Exception:`. A limpeza completa conserva as perguntas, faz backup e apaga as respostas mesmo sem planilha vinculada; a instalação consegue criar o destino central. Erros de acesso, recuperação de dados e mensagens diferentes continuam sendo propagados.

O cadastro completo cobre os 18 itens da programação final, incluindo C com 40 vagas e horário das 13h às 17h, Pipeline, Blender com 20 vagas, ministrantes completos e os novos horários da CSP e encerramento. Testa a atualização atômica com inscrições existentes e snapshots, a recusa integral por conflito ou excesso de inscritos e a repetição sem operações extras. Os dois Forms públicos são incorporados sem duplicar perguntas ou respostas; a busca no Drive verifica a URL para evitar vincular homônimos. Descrições antigas são corrigidas preservando o restante dos textos, e a fila reconhece as capacidades alteradas na programação final. Também cobre cadastros pendentes, integração da abertura, retirada da homenagem e manutenção de fechamentos administrativos.

A suíte de Forms também reproduz a falha da mensagem opcional de fechamento em português e inglês durante fechamento e reabertura de Forms publicados. Confere que esse erro isolado permite continuar, que outros erros não são ignorados e que falhas reais em publicação/recebimento informam a etapa e o ID do Form. Os IDs da configuração de produção são substituídos apenas no ambiente simulado dos testes.

A configuração administrativa de e-mail verificado cobre vários Forms, incluindo cancelamento e coleta desativada, repetição sem novas escritas e preservação de IDs, perguntas, respostas e inscrições. Confere a releitura após atualização, falhas HTTP, recusa de alteração por outra conta, Forms fechados até a abertura e quarentena das respostas anteriores à correção. `onOpen` cria o menu com interface e orienta pelo log quando executado sem ela, propagando erros diferentes. A alteração real de `emailCollectionType` pela API ainda exige homologação no Google.

A política de notificações é verificada com confirmação sem CC, problemas com CC, aviso direto ao CA na última vaga, deduplicação, prioridade com cota curta, nova lotação após cancelamento, troca entre atividades, redução de capacidade e remoção do CC de sucessos pendentes. Um teste de integração carrega também `Notifications.gs` real junto do livro de operações e confere confirmação, conflito e aviso de capacidade sem repetir envios na reconstrução.

A importação administrativa da CSP tem testes de prévia sem efeitos sobre inscrições/e-mails, restrição à conta instaladora, origem auditada de e-mail informado, lotes retomáveis, duplicidade, lotação, CPF inválido, identidade incompatível, conflito sem autorizar troca, prévia invalidada por edição das respostas ou mudança do estado, data-limite da prévia, detecção de perguntas e mapeamentos ambíguos. Também testa a recuperação por uma aba de backup e a preservação das respostas da fonte CSP durante a limpeza completa. A integração com a fila real confere confirmação sem CC e aviso de capacidade ao CA, preservando a exigência de coleta nativa nos gatilhos normais.

A recuperação de uma cópia de `IntegrantesEquipes` testa o agrupamento por ID original, CPF com zero inicial, coach, texto multilinha, origem e ausência de data/situação histórica. Cobre restauração sem respostas ou perguntas, backup protegido que não é sobrescrito, inclusão de novas respostas preservando equipes recuperadas, deduplicação entre cópia e Form, manutenção de cancelamentos, recusa de IDs divergentes, pendências de CPF/coach e bloqueio após alterações na fonte. Dados pessoais usados para preparar uma entrega privada ficam em `dist/`, fora dos testes e do ZIP do projeto.

A regressão de **“Inscrição ativa duplicada.”** reproduz o bloqueio causado por equipe incompleta com CPF já inscrito, tanto no Form quanto no backup. Confere que novas equipes continuam entrando em `Equipes` e `IntegrantesEquipes`, que as já importadas permanecem e que repetir não acrescenta operações. Também cobre CPF repetido dentro de uma equipe com outro membro incompleto, nome repetido sem CPF e conflito de horário com CPF conhecido; CPFs vazios de equipes diferentes não geram duplicidade.

Os títulos e os arquivos dos Forms são conferidos com `PALESTRA - Nome` e `OFICINA - Nome`, inclusive na palestra `NOITE_26`, cujo ID histórico não indica o tipo. A integração do Form de linguagem C cobre detecção das perguntas existentes, manutenção de IDs, 40 vagas, recebimento de inscrição e repetição sem novas operações ou prefixos duplicados.

A renomeação isolada também confere a preservação do cadastro e do nome próprio da CSP, do título/arquivo, descrição, destino, recebimento e da guia vinculada ao seu Form. O cadastro por JSON e a ação de renomear arquivos são caminhos separados.

## Correspondência com os 16 requisitos de teste

Todos os cenários abaixo têm verificação local. A coluna final descreve a confirmação com serviços reais que ainda **não foi executada**.

| Nº | Cenário | Verificação local executada | Homologação real proposta |
|---:|---|---|---|
| 1 | Inscrição com vaga | Confirmação, vínculo e ocupação | Enviar Forms, conferir livro/projeções e e-mail recebido |
| 2 | Lotação | Conta apenas confirmações e rejeita nova | Manter formulário antigo aberto; esgotar vagas por outra conta; enviar opção antiga |
| 3 | CPF inválido e zero inicial | Máscara, tamanho, dígitos, repetidos e zero | Enviar CPF inválido; conferir recusa. Usar zero inicial com conta de teste e conferir texto em Participantes |
| 4 | Duplicada | Preserva inscrição e uma só vaga | Reenviar a mesma atividade e conferir ocupação estável |
| 5 | Conflito total/parcial | Comparação nos dois sentidos | Cadastrar sobreposições e enviar solicitações sem autorização |
| 6 | Consecutivas/dias distintos | Intervalos completos e limites abertos | Confirmar 14–16 + 16–18 e 14–16 no dia seguinte |
| 7 | Troca autorizada/não autorizada | Somente `true` permite troca | Usar as duas opções nativas obrigatórias e conferir resultados |
| 8 | Vários conflitos | Cancela todos e confirma uma nova | Confirmar DEMO_GO e DEMO_IA; solicitar DEMO_LONGA autorizando |
| 9 | Nova lotada preserva anteriores | Nenhum cancelamento em `full` | Ocupar DEMO_LONGA por outra pessoa e repetir o cenário 8 |
| 10 | Última vaga simultânea | Releitura serializada com lock simulado dá `confirmed`/`full` | Duas contas/CPFs distintos enviam quase simultaneamente para capacidade 1; repetir em atividade nova. Esperado: uma confirmação, uma recusa, ocupação 1 |
| 11 | Cancelamento/liberação | Cancela uma vez, nova tentativa estável, opção retorna | Cancelar pelo segundo Forms mesmo com atividade lotada e verificar retorno no primeiro |
| 12 | Mesma resposta | Chave formId:responseId idempotente | Rodar recuperação repetidamente e conferir uma operação/inscrição/notificação por chave |
| 13 | Interrupção na troca | Falhas antes da gravação, após célula persistida e após projeções/fila/opções | Em cópia isolada, inserir temporariamente exceção antes do `range.setValue` e, em outro teste, após `SpreadsheetApp.flush` do commit; restaurar código e reprocessar. Antes: antiga válida; depois: troca integral; nenhum append duplicado |
| 14 | E-mail sem cota | Pendência e CC exige duas unidades; inscrição independente | Conferir cota real e pendência quando houver falta legítima; não esgotar a conta de produção só para testar. Usar conta de testes/injeção em cópia |
| 15 | Outro e-mail para CPF | Recusa genérica sem dados originais; mantém vagas | Após vínculo, outra Conta Google tenta inscrição/cancelamento com mesmo CPF; conferir e-mail genérico e nenhuma alteração |
| 16 | Reinstalação | Instalação repetida cria 2 Forms, 3 gatilhos, nenhuma aba/pergunta/destino/proteção duplicada; preserva confirmação | Rodar instalar duas vezes pela mesma conta; comparar IDs, gatilhos, itens, abas e livro antes/depois |

## Preparação e evidências para o Google

A adaptação para vários Forms também tem testes locais de preservação de títulos/perguntas/respostas/destinos; IDs de pergunta iguais em origens diferentes; atividades fixas e seletoras; conflitos e vagas compartilhados; cancelamento opcional; migração da instalação original; mapeamentos congelados; pré-validação sem alterar o primeiro Form ao falhar no segundo; excesso de Forms processados pela varredura; rotação entre origens e ativação segura de Forms adicionados depois.

Na homologação real dessa configuração, envie solicitações por **dois Forms de inscrição diferentes** usando a mesma Conta Google/CPF. Confira que atividades conflitantes exigem autorização e que uma atividade consecutiva pode permanecer. Se dois Forms apontarem para a mesma atividade, confira que compartilham a mesma capacidade e que a duplicação não ocupa outra vaga. Reinstale e compare os IDs, perguntas adicionais, destinos brutos e respostas originais. Para Form fixo, confira título/data/horário visíveis antes de abrir. Se o cancelamento for adiado pela opção `false`, confira que nenhum Form adicional foi criado e registre que o atendimento ao cancelamento será administrativo enquanto essa função não for instalada.

Use **uma planilha e um projeto de homologação separados**, nunca a base com inscrições reais. Instale pela conta que fará os envios, configure os dois Forms em Verificado, confira a API e abra depois da data de corte segura. Carregue as atividades fictícias e use contas de teste disponíveis à organização; CPF sintético validado matematicamente pode ser usado apenas nesse ambiente.

Registre, por caso, data/hora, protocolo, chave da resposta, resultado esperado/observado, ocupação antes/depois, linha de operação, situação da fila e recebimento de e-mail no participante e no CA. Não inclua CPF completo em relatórios de homologação compartilhados. A repetição pode continuar na mesma base mantendo histórico; para comparar casos independentes, crie uma nova atividade com ID novo ou uma base de testes nova.

Antes de publicar para o público, valide também:

- Conta externa e conta do domínio conseguem responder conforme audiência pretendida; links de edição e planilha permanecem privados.
- E-mail da confirmação corresponde à conta conectada, a resposta vai ao CA, CC obedece à configuração e o remetente corresponde ao instalador.
- Nenhum resumo público de respostas nem link para editá-las está disponível. Não gere `getEditResponseUrl` manualmente.
- Todos os indisponíveis fecham temporariamente inscrição; vaga liberada reabre quando o modo global continua aberto. Encerramento administrativo mantém cancelamento disponível.
- Queda da API de Forms bloqueia decisões, e mudar para Entrada do participante fecha a recepção/invalida o período; reativação não aceita respostas históricas inseguras.
- Execuções periódicas terminam dentro da cota real e o número de pendentes converge no volume esperado do evento.
- Restauração de projeções mantém estados enviados na fila. Uma interrupção após envio pode duplicar a mensagem, mas nunca a inscrição.

Não simule concorrência chamando `FormResponse.submit()` esperando um evento: submissões por script/API não disparam o gatilho nativo. Para concorrência real, use a interface dos Forms em sessões Google independentes. A documentação que fundamenta essa restrição está em [gatilhos instaláveis](https://developers.google.com/apps-script/guides/triggers/installable).
