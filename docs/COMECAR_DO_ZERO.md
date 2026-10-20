# XXI Seminfo — começar do zero mantendo os Forms

Esta atualização prepara o reinício completo. A limpeza na conta Google acontece somente quando você executar a função abaixo. Nenhuma limpeza no Google foi executada pela entrega local.

**Se você já fez a limpeza e quer acrescentar palestras e abertura:** atualize os arquivos `.gs` e execute **`atualizarProgramacaoSeminfo2026`**. Ela cadastra os itens faltantes, incorpora o Form da abertura e preserva inscrições e ajustes existentes. As 18 atividades aparecem em `Atividades`; as incompletas ficam pendentes e fechadas.

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

Se a fonte CSP já tiver sido apagada por uma limpeza anterior, recupere as respostas da aba oculta **Backup_…_Form_…** correspondente (ou coloque o TSV de backup em uma aba da planilha central) e informe o nome dessa aba em `backupSheetName` dentro de `IMPORTACAO_CSP_JSON`. O [manual de importação](./MANUAL.md#importação-das-inscrições-anteriores-da-csp) descreve o procedimento. Não apague o backup até conferir a prévia e concluir a importação.

Se aparecer **“O formulário não tem nenhum destino de resposta no momento.”** em `formDestinationId_`, atualize somente `Forms.gs` com a versão corrigida e execute `comecarSeminfo2026DoZero` novamente. Um Form sem planilha vinculada é válido: suas respostas também recebem backup e são apagadas, exceto a fonte histórica CSP. A instalação posterior cria o vínculo com a planilha central. A correção reconhece a mensagem em português e inglês, sem ignorar outros erros.

## Programação e formulários

Os dez links enviados já constam em `Config.gs`, associados a atividades diferentes e com o campo `title` preenchido. `prepararFormulariosSeminfo2026` transfere essa lista para uma instalação existente, preservando os Forms anteriores e os mapeamentos já usados. O título visível do Forms é aplicado na instalação; as descrições existentes são preservadas. As abas nativas vinculadas também recebem o nome da atividade, como **Respostas — Oficina de Jogos — Ricardo Martins — Tarde**, preservando seu vínculo com o Form.

| Form | Atividade | Vagas | Horário |
|---|---|---:|---|
| Abertura — XXI Seminfo | `ABERTURA_2026` | Pendente | Horários pendentes |
| Jogos — Ricardo Martins — Tarde | `OFICINA_GAMEMAKER` | 30 | 27/10, 13h–17h |
| Jogos — Ricardo Martins — Noite | `OFICINA_JOGOS_NOITE` | 30 | 27/10, 19h–23h |
| 3D — Caio H. | `OFICINA_BLENDER` | 30 | 27/10, 13h–17h |
| Ollama — Darosa | `OFICINA_OLLAMA` | 15 | 27/10, 13h–17h |
| IA Além do Chat — Rafaela | `OFICINA_IA_ALEM_CHAT` | 30 | 27/10, 13h–17h |
| Bio | `PALESTRA_BIO` | Pendente | Início e término pendentes |
| Segurança da Informação — Rafaela | `OFICINA_SEGURANCA` | 30 | 28/10, 13h–17h; confirmar sala 15 |
| Online — Daniele Tavares | `PALESTRA_DANIELE` | Pendente | 28/10, 19h30; término pendente |
| Online — Johnatan UFLA | `PALESTRA_JOHNATAN` | Pendente | 29/10, 19h30; término pendente |

As abas **Programacao** e **Atividades** listam os 18 itens, inclusive abertura, credenciamento, homenagem, coffee break, CSP e encerramento. As seis oficinas com Form e intervalo/capacidade informados ficam aptas à abertura administrativa. Todos os demais itens também são cadastrados: dados desconhecidos ficam vazios e a situação fica **pendente**. A oficina de Yasmin e Gabriel também fica pendente até completar tema e Form. Cadastros existentes preservam seu estado e os ajustes da organização.

O Form da abertura é `1gD2e10L3Zx4cL56TkEIkpgnaP7uX6Qfo1PnAsGYg5fs`, vinculado somente a `ABERTURA_2026`. Os Forms de palestras e da abertura ficam fechados enquanto seus dados estiverem pendentes. Para ativá-los, use **Cadastrar / atualizar atividade** com início, término e capacidade completos, o mesmo ID e `status: "aberta"`. Para a CSP, complete a capacidade em equipes antes de preparar a importação. Não foram inventados horários, capacidades ou links ausentes.

`carregarProgramacaoSeminfo2026` pode ser repetida sem duplicar atividades, sobrescrever cadastros existentes ou restaurar uma atividade excluída. Os dados de referência na aba Programacao reproduzem a programação enviada; mudanças posteriores no cadastro aparecem na aba Atividades.

## Apagar uma atividade

Use **SEMINFO → Apagar atividade** e informe o ID, ou execute `apagarAtividade('ID_DA_ATIVIDADE')`. A atividade sai do catálogo e das opções. Seu Form continua instalado e fica fechado. Atividades com inscrições no histórico exigem cancelamento/encerramento; a exclusão individual não apaga inscrições de participantes. A limpeza completa acima zera esse histórico para o reinício solicitado.
