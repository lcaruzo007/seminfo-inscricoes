# Encerramento da XXI SEMINFO

O evento ocorreu de 26 a 29/10/2026. A rotina `encerrarEventoSeminfo` encerra a operação e cria listas para a organização conferir a presença dos inscritos confirmados.

## Aplicar na instalação existente

1. Na planilha central, abra **Extensões → Apps Script** pela conta que instalou o sistema.
2. Substitua o conteúdo integral dos quatro arquivos pelos correspondentes atualizados: `src/Admin.gs`, `src/Notifications.gs`, `src/Forms.gs` e `src/Persistence.gs`.
3. Salve todos os arquivos. Não precisa reinstalar o sistema ou atualizar a programação.
4. Selecione **`encerrarEventoSeminfo`** e execute. Também pode recarregar a planilha e usar **SEMINFO → Encerrar evento, cancelar e-mails e gerar presenças**.
5. Confira o retorno em **Registro de execução**. Abra o link `presencas.indice`, ou a nova aba `Presencas_Indice_…` na planilha.

Copiar o código para o repositório local não altera a instalação no Google. Os dados reais e as listas são processados quando a conta instaladora executa essa função no Apps Script.

## Resultado

- O recebimento global fica encerrado no livro oficial. Os Forms de inscrição, cancelamento e o Form histórico da CSP deixam de receber respostas, sem apagá-las.
- O encerramento persiste nas propriedades do projeto. Manutenção e gatilhos deixam de processar novas respostas; atualizar os Forms ou reinstalar o sistema não reabre o evento. As respostas brutas ainda sem decisão permanecem nos Forms e não entram nas listas de confirmados.
- `FilaEmails` mantém o histórico. Mensagens `pendente` e reservas `processando` já expiradas passam a `cancelada`, sem novas tentativas. Mensagens `enviada` permanecem como estavam. Reconstruir visões não recria notificações e novas operações administrativas não geram avisos enquanto a suspensão estiver ativa.
- As inscrições confirmadas e as decisões anteriores são preservadas. Não se cancela a inscrição de nenhum participante para encerrar o evento.

O MailApp informa a aceitação do envio pelo Google, não a chegada à caixa de entrada. Uma mensagem já enviada não pode ser recolhida por essa rotina. Se houver envio reservado em outra execução, `emails.emEnvio` informa a quantidade e `parcial` fica `true`: a mensagem pode já ter sido aceita. O worker confere a suspensão antes de chamar o MailApp; se já tiver enviado, registra o resultado real. Aguarde a execução terminar e repita o encerramento. Reservas abandonadas podem levar até dez minutos para expirar.

## Listas de presença

Cada aba `Presenca_…` corresponde a **um dia e uma sala/local**, incluindo atividades online identificadas como Google Meet. Há colunas de data, sala, horário, atividade, nome, equipe, papel, presença, assinatura e observações. CPF, telefone e e-mail não são incluídos. As abas permanecem na planilha existente, com as mesmas permissões de acesso; a geração não compartilha arquivos.

Somente inscrições confirmadas entram como participantes. Cada integrante confirmado de equipe CSP recebe uma linha, incluindo o coach, identificado pelo papel. A mesma pessoa em duas atividades tem uma linha para cada atividade; os totais contam esses vínculos, não pessoas únicas. Os horários e atividades distinguem turnos que usaram a mesma sala. Presença e assinatura começam vazias: inscrição não comprova comparecimento.

As atividades são ordenadas por horário e seus participantes por nome. Atividades sem confirmados recebem uma linha identificada com nome vazio. Quando falta data/horário no cadastro, usa-se a programação de referência daquela atividade; dados desconhecidos ficam como `Sem data`, `Sala não informada` ou `A confirmar`, sem descartar a atividade.

Para gerar outro conjunto sem repetir o encerramento, execute **`gerarListasPresencaPorDiaESala`** ou use **SEMINFO → Gerar listas de presença por dia e sala**. Cada execução cria abas e índice novos; as listas anteriores e suas marcações permanecem intactas. As colunas de presença e assinatura podem ser preenchidas pela organização com permissão de edição na planilha.

## Retomada e conferência

O resultado informa `formularios.falhas`, `erroVisoes`, `presencas.falhas` e `parcial`. Uma falha em um Form ou em uma sala não impede a tentativa dos demais. Corrija o acesso ou a falha indicada e execute novamente. Se a execução atingir o tempo máximo, os marcadores de encerramento/suspensão já gravados continuam protegendo a operação; aguarde a liberação do marcador administrativo (até oito minutos desde o início) e repita a função. A nova execução reaplica o fechamento e cria outro conjunto de listas, preservando o anterior.

Para apenas suspender e cancelar os e-mails da fila, existe **`cancelarEmailsPendentes`**. Essa função também bloqueia a criação de novos avisos até um reinício completo do sistema.

`abrirInscricoes` recusa a reabertura após o encerramento definitivo. Uma limpeza completa autorizada pela organização, usando a rotina existente de reinicialização, remove os marcadores de encerramento/suspensão somente ao concluir a limpeza. Essa limpeza é uma operação separada que apaga dados operacionais e não deve ser usada para encerrar o evento.
