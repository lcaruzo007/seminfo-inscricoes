# Meets das palestras — XXI SEMINFO 2026

As três palestras online recebem eventos separados, com **3 horas de reserva**, incluindo margem para atrasos. Horários de Brasília (`America/Sao_Paulo`):

| Data | Palestrante | Reserva no Google Agenda |
|---|---|---|
| 26/10/2026 | Ana Carolina Brazão | 19h–22h |
| 28/10/2026 | Daniele Nazaré Tavares | 19h–22h |
| 29/10/2026 | Prof. Dr. Johnatan Alves de Oliveira | 19h–22h |

## Executar

1. No mesmo projeto Apps Script do sistema, atualize `Admin.gs` e `appsscript.json` com os arquivos de `src/`.
2. Confira o serviço **Google Calendar API**, versão **v3**, identificador **Calendar**. O manifesto fornecido já inclui esse serviço e a permissão `calendar.events`. Se o projeto estiver associado a um projeto Cloud padrão gerenciado manualmente, habilite também a Google Calendar API no Cloud. [Configuração oficial](https://developers.google.com/apps-script/guides/services/advanced).
3. Pela **conta que instalou o sistema**, execute **`criarMeetsSeminfo2026`** e autorize o acesso solicitado. Os eventos são criados no calendário principal dessa conta. Também é possível recarregar a planilha e usar **SEMINFO → Criar / consultar Meets (3 horas)**.
4. Copie os links da coluna `MEET` na aba **`Meets`**. Os links também aparecem no registro de execução. `PRONTO` indica link disponível; `PENDENTE` pede nova execução para consultar a geração; `ERRO` informa o problema.

Cada evento solicita sua própria conferência, conforme a [API do Google Calendar](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert). Se o Google ainda estiver gerando o link, execute a mesma função novamente. Eventos criados por essa função são identificados por IDs estáveis e reaproveitados, inclusive quando uma execução perde a resposta da criação. Os testes locais simulam esses casos; a criação real exige executar na conta Google.

Novas execuções ajustam os eventos existentes para **19h–22h**, mantendo os mesmos links e os demais dados. Para antecipar as reservas anteriores das 19h30, basta atualizar `Admin.gs` e executar `criarMeetsSeminfo2026` novamente. Um evento excluído exige conferir a lixeira no Google Agenda; a função não o recria automaticamente. Eventos criados manualmente fora desta função não são identificados por ela.

A reserva se aplica ao Agenda. A função não modifica os horários das inscrições, não adiciona convidados nem distribui os links aos participantes.
