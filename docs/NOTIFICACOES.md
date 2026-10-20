# Notificações e limites operacionais

Consulta à documentação oficial do Google: 08/10/2026. Esta nota serve de apoio às instruções de instalação; os limites devem ser conferidos novamente antes do evento.

## Conta responsável e endereços

Os gatilhos instaláveis executam com a autorização da conta que os criou e os e-mails são enviados por essa conta. Use a mesma conta escolhida para instalar e reinstalar o sistema. Uma conta não vê os gatilhos criados por outra; portanto, a organização deve evitar instalar cópias paralelas. Os envios gerados por `FormResponse.submit()` ou por chamadas de API não acionam o gatilho de formulário: use a rotina de processamento para recuperar esses envios. [Gatilhos instaláveis — Google](https://developers.google.com/apps-script/guides/triggers/installable).

`EMAIL_CA` configura o endereço de resposta, a cópia dos problemas e o destinatário dos avisos de capacidade; `NOME_REMETENTE` configura o nome exibido. `ENVIAR_COPIA_CA=true` inclui o CA em CC somente em conflitos e demais problemas. Confirmações de inscrição, trocas concluídas e cancelamentos concluídos são enviados apenas ao participante. A cópia é removida se o endereço for igual ao destinatário. `replyTo` não altera o remetente. O serviço usado, `MailApp`, não oferece parâmetro `from`; um endereço alternativo exigiria um serviço que o aceite e a autorização correspondente. O sistema não lê a caixa de entrada nem transforma respostas de texto livre em alterações de inscrição. [MailApp — Google](https://developers.google.com/apps-script/reference/mail/mail-app).

## Cotas antes da abertura

| Limite do Apps Script | Conta pessoal | Google Workspace |
| --- | ---: | ---: |
| Destinatários de e-mail/dia | 100 | 1.500 |
| Destinatários/dia dentro do domínio | 100 | 2.000 |
| Tempo acumulado de gatilhos/dia | 90 minutos | 6 horas |
| Tempo máximo por execução | 6 minutos | 6 minutos |
| Gatilhos por usuário/projeto | 20 | 20 |
| Destinatários por mensagem | 50 | 50 |

As cotas são por usuário, reiniciam 24 horas após a primeira solicitação e podem mudar sem aviso. Contas de avaliação têm restrições adicionais; limites do produto associado também podem se aplicar. Confirmações usam uma unidade de destinatário; avisos de problemas com participante e CA distintos usam duas. Cada aviso direto de capacidade ao CA usa uma unidade. Outros projetos da mesma conta compartilham o orçamento. Use **Conferir configuração e cotas** para consultar `MailApp.getRemainingDailyQuota()` pela conta instaladora, confirme o tipo de conta e consulte a tabela oficial antes de abrir. [Cotas — Google](https://developers.google.com/apps-script/guides/services/quotas).

## Fila, concorrência e recuperação

`FilaEmails` é um registro durável, protegido e separado das projeções. A coluna `ID` contém `MAIL:<chave da operação>` nos resultados ao participante e `MAIL:CAPACIDADE:<chave da operação>:<atividade>` nos avisos diretos ao CA. `syncNotificationQueueLocked_` acrescenta mensagens ausentes. Também retira CC de sucessos ainda pendentes ao aplicar a nova política; mensagens já enviadas ou com claim ativo são preservadas. O corpo usa os detalhes registrados no evento e não contém CPF completo. Recusas por identidade incompatível não divulgam dados do cadastro original.

Os avisos de capacidade usam o livro de operações validado para acompanhar inscrições confirmadas, cancelamentos, trocas e alterações de capacidade. A contagem não usa respostas brutas. Há um aviso por ciclo de lotação ainda vigente, com prioridade na reivindicação da fila. Reconstruir repetidamente não repete o aviso; liberar uma vaga e voltar a lotar gera uma nova identidade. A recuperação omite ciclos históricos de lotação já desfeitos, evitando uma sequência de avisos atrasados. Os avisos diretos de capacidade são enviados ao CA mesmo se `ENVIAR_COPIA_CA=false`.

O processamento reivindica cada mensagem dentro do `ScriptLock`, registra situação `processando`, incrementa a tentativa e grava um lease de dez minutos em uma única atualização de linha. A cota considera os destinatários distintos em To e CC e as reservas de outras execuções ativas do mesmo projeto. O envio acontece fora do lock; seu resultado é gravado com nova atualização protegida. O orçamento pode mudar por outros projetos da conta, por isso também é conferido imediatamente antes do envio.

Sem cota, o item permanece `pendente`; se a mensagem nem chega a ser reivindicada, o contador não aumenta. Falhas de envio mantêm o item pendente, classificam o erro sem endereços ou dados pessoais e programam nova tentativa com atraso de cinco minutos, que aumenta até seis horas; falta de cota aguarda pelo menos quinze minutos. O gatilho periódico retoma o processamento. Se a autorização falhar repetidamente, reautorize pela conta instaladora e examine a aba `Erros`/o histórico de execuções. Não apague a fila para tentar reenviar.

Mensagens com lease ativo não podem ser reivindicadas novamente. Depois de uma interrupção, leases expirados voltam a `pendente`. Ainda há uma janela inevitável: se o envio teve sucesso e a execução terminou antes de marcar `enviada`, a nova tentativa poderá repetir o e-mail. `MailApp` não fornece chave idempotente nem transação conjunta com a planilha. Os identificadores e leases reduzem duplicidades; não garantem entrega exatamente uma vez. O protocolo permite ao CA reconhecer repetições. Falhas de e-mail nunca desfazem uma decisão já persistida de inscrição, troca ou cancelamento.

O lote padrão é de dez mensagens; `MAX_EMAILS_POR_EXECUCAO` admite até cinquenta. O processamento tem limite interno de quatro minutos e aceita um prazo global para respeitar a execução compartilhada de manutenção. As inscrições continuam decididas pelo livro oficial mesmo que a fila aguarde cota.

## Validação local executada

`node --test --test-isolation=none tests/notifications.test.cjs` verifica deduplicação, estado enviado, To+CC e cópia suprimida, falta de cota, backoff, erro sem dados pessoais, lease/reserva de concorrência, finalização atrasada, mensagens de troca, recusa por identidade, modelos de resultado, limite de lote, identificação duplicada, prazo global e a janela de duplicata após envio sem registro do sucesso. Os serviços Google são simulados; estes testes não provam entrega real, autorização, cota da conta ou comportamento da interface do Forms. Esses pontos exigem teste de instalação na conta escolhida.
