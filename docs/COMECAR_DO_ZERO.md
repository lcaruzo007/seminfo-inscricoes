# XXI Seminfo — começar do zero mantendo os Forms

Esta atualização prepara o reinício completo. A limpeza na conta Google acontece somente quando você executar a função abaixo. Nenhuma limpeza no Google foi executada pela entrega local.

**Para aplicar a programação final na instalação existente:** atualize os arquivos `.gs` e execute **`atualizarProgramacaoSeminfo2026`**. Ela atualiza os dados finais, incorpora os Forms novos e preserva inscrições e respostas. Consulte o [roteiro da programação final](PROGRAMACAO_FINAL.md). As atividades incompletas ficam pendentes e fechadas.

1. No **mesmo projeto Apps Script**, substitua o conteúdo dos sete arquivos `.gs` pelos da pasta [`src/`](../src). Mantenha a mesma planilha, projeto e conta instaladora. O manifesto permanece igual.
2. Salve e execute **`comecarSeminfo2026DoZero`** no editor. Também há a opção **SEMINFO → Começar do zero com os mesmos Forms** após reabrir a planilha.
3. Confira a aba **Programacao**, os nomes dos Forms e as pendências mostradas na instalação. Nos Forms novos para o sistema, confira as perguntas com `listarPerguntasDosFormularios`; se houver nome/CPF ambíguos, preencha os IDs em `FORMULARIOS_INSCRICAO_JSON` na aba `Configuracoes` e execute `instalarSistema` novamente.
4. Configure a coleta nativa como **Verificado** em cada Form, confira as informações e use **Conferir configuração e cotas**. Quando estiver pronto, execute **Abrir inscrições**. A limpeza deixa o recebimento fechado.

## O que é zerado

- Atividades antigas, inclusive demonstrações; participantes; inscrições individuais; equipes e integrantes; solicitações; operações; histórico; erros; fila de e-mails; exportações e prévias anteriores da CSP.
- As respostas dos Forms de inscrição e cancelamento configurados, exceto o Form de importação histórica da CSP. A fonte CSP fica fechada, mas suas respostas e a aba nativa vinculada são preservadas para a importação posterior. As demais abas nativas vinculadas também têm as linhas de dados limpas, inclusive quando ficam em outra planilha acessível à conta instaladora.
- Datas de abertura, cursores de varredura e prévia de importação. Uma execução antiga da importação não pode gravar depois do reinício.

Os mesmos Forms continuam existindo, com os mesmos IDs, links, perguntas, mapeamentos e destinos. Configurações administrativas, IDs da planilha e conta instaladora são preservados. Abas independentes da organização são mantidas.

Antes de apagar, a rotina faz cópias protegidas e ocultas, com prefixo **Backup_**, das abas afetadas e das respostas dos Forms que serão limpos. São cópias na própria planilha, sujeitas ao acesso do proprietário e dos editores; não ampliam o compartilhamento. Os Forms limpos ficam com zero respostas; a fonte CSP permanece intacta para que suas equipes possam ser importadas após o reinício. As cópias não são reprocessadas automaticamente e podem ser consultadas pelo menu de abas ocultas do Sheets.

`deleteAllResponses` apaga as respostas no Forms; as cópias nas planilhas precisam ser limpas separadamente, como faz esta rotina. Referências oficiais: [Form](https://developers.google.com/apps-script/reference/forms/form#deleteAllResponses()), [Sheet e cópia de abas](https://developers.google.com/apps-script/reference/spreadsheet/sheet#copyTo(Spreadsheet)).

Se a limpeza for interrompida, execute **`limparTudoERecomecar`** para retomar. O sistema fica bloqueado durante a limpeza, preserva os backups já concluídos e não libera envios ou inscrições antes do fim. Depois execute `carregarProgramacaoSeminfo2026` e `instalarSistema`. Se houver e-mail em envio, a limpeza aguarda a conclusão ou expiração da reserva antes de começar.

Se o Apps Script falhar ao abrir um Form com timeout do Drive ou `Unexpected error while getting the method or property openById on object FormApp`, a abertura repete automaticamente até três tentativas. Falhas persistentes são exibidas sem gravar a nova lista de Forms nem iniciar a limpeza. A validação dos Forms acontece fora do bloqueio global; o bloqueio é adquirido somente para salvar a lista já conferida. A renomeação das abas de respostas também não segura o bloqueio global. As respostas ficam armazenadas no próprio Form, portanto apagar apenas as linhas da planilha não remove as respostas do Forms.

Se aparecer **“Tempo limite do bloqueio: outro processo manteve o bloqueio por muito tempo”**, não inicie outra limpeza em paralelo. Aguarde a execução anterior terminar e tente novamente. A instalação e a recuperação periódica não mantêm mais o bloqueio global durante chamadas lentas ao Forms; enquanto essas etapas externas rodam, um marcador impede operações concorrentes. Se uma execução for encerrada à força, aguarde até oito minutos antes de tentar novamente para que o marcador expirado seja liberado. A limpeza continua serializada para evitar que respostas ou operações sejam gravadas durante o reinício.

Se a fonte CSP já tiver sido apagada por uma limpeza anterior, recupere as respostas da aba oculta **Backup_…_Form_…** correspondente (ou coloque o TSV de backup em uma aba da planilha central) e informe o nome dessa aba em `backupSheetName` dentro de `IMPORTACAO_CSP_JSON`. O [manual de importação](./MANUAL.md#importação-das-inscrições-anteriores-da-csp) descreve o procedimento. Não apague o backup até conferir a prévia e concluir a importação.

Se aparecer **“O formulário não tem nenhum destino de resposta no momento.”** em `formDestinationId_`, atualize somente `Forms.gs` com a versão corrigida e execute `comecarSeminfo2026DoZero` novamente. Um Form sem planilha vinculada é válido: suas respostas também recebem backup e são apagadas, exceto a fonte histórica CSP. A instalação posterior cria o vínculo com a planilha central. A correção reconhece a mensagem em português e inglês, sem ignorar outros erros.

## Programação e formulários

Os onze Forms por ID e os dois novos por URL pública constam em `Config.gs`, incluindo o Form de linguagem C. A fonte histórica da CSP também está configurada em `IMPORTACAO_CSP_JSON` e aparece em **Listar perguntas dos Forms existentes** como `IMPORTACAO_CSP`, sem ser instalada como inscrição individual. Na próxima instalação, o destino de respostas futuras da CSP será alterado para a planilha principal; a guia e as respostas antigas permanecem na planilha anterior. A nova guia recebe o nome **Respostas — Competição Seminfo de Programação — CSP**. `prepararFormulariosSeminfo2026` transfere a lista para a instalação existente, preservando os Forms e mapeamentos anteriores. A atualização final aplica `PALESTRA - Nome` e `OFICINA - Nome` ao título e ao arquivo do Form, corrige abas nativas e as linhas de programação nas descrições; os demais textos são conservados.

| Form | Atividade | Vagas | Horário |
|---|---|---:|---|
| Abertura — XXI Seminfo | `ABERTURA_2026` | Pendente | 26/10, 13h–17h |
| Troubleshooting — Ana Carolina Brazão | `NOITE_26` | Pendente | 26/10, 19h; término pendente |
| GameMaker — Ricardo José Martins — Tarde | `OFICINA_GAMEMAKER` | 30 | 27/10, 13h–17h |
| GameMaker — Ricardo José Martins — Noite | `OFICINA_JOGOS_NOITE` | 30 | 27/10, 19h–23h |
| Pipeline de Dados — Tiago Fernandes Moraes | `OFICINA_YASMIN_GABRIEL` | 30 | 27/10, 13h–17h |
| Blender — Caio Henrique Magalhães | `OFICINA_BLENDER` | 20 | 27/10, 13h–17h |
| Ollama — Gabriel Madeira | `OFICINA_OLLAMA` | 15 | 27/10, 13h–17h |
| IA Além do Chat — Rafaela e Felipe | `OFICINA_IA_ALEM_CHAT` | 30 | 27/10, 13h–17h |
| Introdução à linguagem C | `OFICINA_C` | 40 | 27/10, 13h–17h; Form incluído |
| ABREU | `PALESTRA_BIO` | Pendente | 27/10, 13h30; término pendente |
| Segurança — Rafaela e Nycollas | `OFICINA_SEGURANCA` | 30 | 28/10, 13h–17h, Sala 15 |
| Online — Daniele Nazaré Tavares | `PALESTRA_DANIELE` | Pendente | 28/10, 19h30; término pendente |
| Online — Johnatan Alves de Oliveira | `PALESTRA_JOHNATAN` | Pendente | 29/10, 19h30; término pendente |

As abas **Programacao** e **Atividades** listam os 18 itens finais, incluindo abertura, credenciamento, coffee break, CSP, encerramento e a nova oficina de C. A homenagem não faz parte da programação final. Pipeline de Dados substitui o cadastro provisório de Yasmin e Gabriel. A CSP termina às 15h30 e o encerramento começa às 15h30. Os dados desconhecidos ficam vazios e a situação fica **pendente** quando início, término ou capacidade ainda não estão completos.

O Form da abertura é `1gD2e10L3Zx4cL56TkEIkpgnaP7uX6Qfo1PnAsGYg5fs`, vinculado somente a `ABERTURA_2026`. Os Forms de palestras e da abertura ficam fechados enquanto seus dados estiverem pendentes. Para ativá-los, use **Cadastrar / atualizar atividade** com início, término e capacidade completos, o mesmo ID e `status: "aberta"`. A programação define a CSP com capacidade de **60 equipes**. Confira esse limite antes de preparar a importação. Não foram inventados horários, capacidades ou links ausentes além da capacidade definida pela organização.

`carregarProgramacaoSeminfo2026` pode ser repetida sem duplicar atividades, sobrescrever cadastros existentes ou restaurar uma atividade excluída. Os dados de referência na aba Programacao reproduzem a programação enviada; mudanças posteriores no cadastro aparecem na aba Atividades.

## Apagar uma atividade

Use **SEMINFO → Apagar atividade** e informe o ID, ou execute `apagarAtividade('ID_DA_ATIVIDADE')`. A atividade sai do catálogo e das opções. Seu Form continua instalado e fica fechado. Atividades com inscrições no histórico exigem cancelamento/encerramento; a exclusão individual não apaga inscrições de participantes. A limpeza completa acima zera esse histórico para o reinício solicitado.
