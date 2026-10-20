# SEMINFO — inscrições com Google Forms, Sheets e Apps Script

Este é o manual detalhado. Consulte o [README](../README.md) para a apresentação e o início rápido. Os módulos e o manifesto ficam em [`src/`](../src); os dados de referência ficam em [`data/`](../data).

Um ou vários formulários nativos recebem solicitações de inscrição. Um formulário adicional pode receber cancelamentos. Um único projeto Apps Script valida CPF, identidade, vagas e horários de todos eles sob `ScriptLock`. A aba `Operacoes` guarda cada decisão inteira em uma célula JSON: uma troca cancela todas as inscrições conflitantes e confirma a nova no mesmo registro. As demais abas de inscrições são visões reconstruíveis. Uma fila persistente envia os resultados por e-mail fora do bloqueio, com resposta para o CA, cópia ao CA somente de problemas e aviso direto quando uma atividade atinge sua capacidade.

O pacote contém todos os arquivos `.gs`, o manifesto, a programação de 26 a 29/10/2026, os dez Forms informados (incluindo abertura) com nomes preenchidos e testes locais executáveis sem dependências. Não é necessário publicar um aplicativo web. Os participantes usam somente Google Forms. A instalação no Google e os testes com serviços reais devem ser realizados pela organização; nenhuma conta Google foi acessada nesta entrega.

## Acrescentar todas as atividades e o Form da abertura sem repetir a limpeza

Atualize os arquivos `.gs` no mesmo projeto Apps Script e execute **`atualizarProgramacaoSeminfo2026`**, ou use **SEMINFO → Carregar programação XXI Seminfo**. Essa atualização incorpora os dez Forms, cadastra os itens que faltam e reinstala as integrações, preservando os cadastros e inscrições existentes. O Form de abertura `1gD2e10L3Zx4cL56TkEIkpgnaP7uX6Qfo1PnAsGYg5fs` corresponde à atividade `ABERTURA_2026` e recebe o título **Abertura — XXI Seminfo**.

As abas `Atividades` e `Programacao` passam a listar as **18 atividades**, incluindo palestras, abertura, credenciamento, homenagem, coffee break, competição e encerramento. Dados ainda desconhecidos permanecem vazios, com `capacity: null` e `status: "pendente"` quando necessário. Os Forms de atividades pendentes ficam fechados; complete início, término e capacidade pelo cadastro e altere a situação para `aberta` quando estiverem prontos. Repetir a atualização conserva os ajustes manuais e as atividades excluídas.

## Reiniciar tudo com os mesmos Forms — atualização de 20/10/2026

Atualize os sete arquivos `.gs` no **mesmo projeto** e execute **`comecarSeminfo2026DoZero`** pela conta instaladora. Esse atalho incorpora os dez links à configuração existente, cria backups ocultos, zera os dados operacionais e as respostas dos Forms configurados, carrega a programação real e reinstala usando os mesmos IDs e perguntas. A recepção fica fechada até **Abrir inscrições**. A fonte de importação da CSP, quando configurada, também tem as respostas zeradas. Os backups permanecem disponíveis em abas ocultas. Para acrescentar atividades a um sistema já em uso, utilize a atualização descrita acima.

O menu **Começar do zero com os mesmos Forms** executa esse atalho. Para somente zerar, use `limparTudoERecomecar`; depois cadastre/carregue atividades e reinstale. Uma limpeza interrompida bloqueia as operações até a retomada por essa mesma função. O menu **Apagar atividade** permite excluir do catálogo uma atividade sem inscrições no histórico, mantendo seu Form instalado e fechado.

A aba `Programacao` reúne os 18 itens, incluindo a abertura acrescentada depois da programação inicial. Palestras sem término/capacidade e a oficina de Yasmin e Gabriel são cadastradas como pendentes; seus Forms ficam fechados até completar os dados. Consulte o [guia de reinicialização](COMECAR_DO_ZERO.md) para o roteiro completo. Os JSONs de [formulários](../data/FORMULARIOS_SEMINFO_2026.json), [programação](../data/PROGRAMACAO_SEMINFO_2026.json) e [atividades](../data/ATIVIDADES_SEMINFO_2026.json) ficam em `data/`, mantendo vazios os dados desconhecidos. O empacotamento gera `dist/EXEMPLOS_JSON.txt` com objetos separados para cadastro manual.

Se a limpeza falhar em `formDestinationId_` com **“O formulário não tem nenhum destino de resposta no momento.”**, substitua **somente `Forms.gs`** pela versão atual e execute `comecarSeminfo2026DoZero` novamente. O código agora reconhece a ausência de destino em português e inglês. Um Form sem planilha vinculada continua tendo suas respostas copiadas e apagadas; apenas a etapa de limpar sua planilha de destino é dispensada. A instalação posterior vincula o Form à planilha central. Erros de acesso ou de recuperação de dados continuam sendo propagados. O erro na identificação do destino ocorre antes da exclusão nessa execução; não é necessário remover IDs, perguntas, backups ou propriedades para corrigir.

## Já tem vários Forms criados?

Use **uma planilha central e um único projeto Apps Script** para todos eles. Pode haver um Form por oficina/palestra, Forms com seleção de atividade, ou os dois tipos. A vaga e os conflitos são verificados entre todas as inscrições do CPF, independentemente do formulário utilizado.

Antes da primeira instalação, preencha `FORMULARIOS_INSCRICAO_JSON` em `Config.gs` com os Forms existentes. Para um Form por atividade, use `activityId`; nesse caso o sistema sabe a atividade pelo próprio Form e não cria uma pergunta adicional de atividade. Se o Form já permite escolher, omita `activityId` e mapeie também `ACTIVITY`.

```javascript
FORMULARIOS_INSCRICAO_JSON: JSON.stringify([
  {
    id: 'ID_DO_FORM_DE_GO',
    activityId: 'OFICINA_GO_01',
    items: { NAME: 123456, CPF: 234567 }
  },
  {
    id: 'ID_DO_FORM_DE_PALESTRAS',
    items: { NAME: 345678, CPF: 456789, ACTIVITY: 567890 }
  }
]),
CRIAR_FORM_CANCELAMENTO: true
```

Substitua os exemplos por IDs reais. O ID do formulário vem do **link de edição** `https://docs.google.com/forms/d/ID_DO_FORM/edit`, não do link público `.../d/e/.../viewform` nem de um link curto `forms.gle`. Os números de `items` são IDs das perguntas, não suas posições. Primeiro informe apenas os IDs dos Forms na lista e execute `listarPerguntasDosFormularios` no editor: ela apenas lê os títulos, tipos e IDs e não exige instalação prévia. Depois complete o mapeamento e execute a instalação. Se o sistema já foi instalado, edite a chave na aba `Configuracoes`; os defaults do código não sobrescrevem configurações persistidas.

`NAME` e `CPF` aceitam texto curto ou parágrafo. `ACTIVITY` aceita lista suspensa ou múltipla escolha com uma única seleção; caixas de seleção com várias atividades por envio não atendem a este fluxo. `SWAP`, quando já existir, deve apontar à pergunta de autorização de troca de múltipla escolha. Se ela faltar, a instalação acrescenta apenas essa pergunta obrigatória com o texto de autorização. Perguntas essenciais sem mapeamento claro exigem conferência antes da adoção para evitar duplicatas.

As descrições dos Forms existentes, perguntas mapeadas de identificação e perguntas adicionais são preservadas. O campo opcional `title` define o título visível do Form durante a instalação; os dez vínculos desta entrega já vêm nomeados. Sem `title`, o título existente é preservado. A instalação ajusta obrigatoriedade, configurações de respostas, mensagem final e a autorização de troca. Nos Forms com escolha de atividade, as opções passam a ser mantidas pelo catálogo central, com ID permanente, data, horário e disponibilidade; cadastre as atividades reais antes de abrir. Nos Forms de atividade fixa, confira manualmente que a descrição mostra a data, os horários e as demais informações corretas para o `activityId`; os e-mails usam o catálogo central. Um destino de respostas já vinculado a outra planilha é preservado: ele continua sendo a cópia bruta, enquanto `Operacoes` e as inscrições oficiais ficam na planilha central. Um Form sem destino ganha o destino central.

As abas nativas de respostas recebem o nome **Respostas — [atividade]**, inclusive a guia CSP identificada por `CSP_RESPONSE_SPREADSHEET_ID` e `CSP_RESPONSE_SHEET_ID` (ID da planilha e `gid` da guia). Antes de renomear essa guia, o instalador confirma que ela está vinculada ao Form CSP configurado; em caso de divergência, informa o erro e não altera a guia. Como o Google só cria a aba quando chega a primeira resposta, a instalação não consegue renomeá-la antes disso: o gatilho de envio tenta nomeá-la após a resposta e a manutenção periódica tenta novamente. Se já existir uma aba com nome padrão, atualize os arquivos `.gs` e execute **Instalar / reinstalar com segurança** uma vez para renomeá-la imediatamente. A mudança altera apenas o nome da aba, sem apagar respostas nem desfazer o vínculo com o Form.

Você não precisa criar o Form de cancelamento manualmente: com `CRIAR_FORM_CANCELAMENTO: true` e `ID_FORM_CANCELAMENTO` vazio, a instalação cria somente esse Form adicional. Para adiar a criação, use `false`; inscrições, trocas e cancelamento administrativo continuam disponíveis, e o cancelamento pelo participante fica pendente de instalação. Se já houver um Form de cancelamento, informe seu ID. Formulários e seus vínculos de atividade já adotados não devem ser removidos, substituídos ou remapeados silenciosamente, pois podem conter solicitações pendentes.

Com vários Forms, os gatilhos são identificados pelo formulário de origem e usam o mesmo processador. Dentro do limite de 20 gatilhos por usuário/projeto, o instalador reserva um para manutenção e dá prioridade ao cancelamento; Forms que não couberem nos slots disponíveis são processados pela varredura periódica. `conferirSistema` informa esses IDs em `formsViaVarredura`. O resultado desses Forms pode demorar cinco minutos ou mais, dependendo do volume/cotas. A data de corte segura é individual por Form: respostas históricas anteriores à adoção não são importadas automaticamente como confirmações. Para os dados da CSP conferidos pela organização, existe a importação administrativa descrita abaixo.

Ao acrescentar um Form a um sistema que já está aberto, execute `instalarSistema`, cadastre sua atividade fixa quando aplicável, configure `Verificado` e execute **Abrir inscrições** novamente. Essa ação estabelece a data de corte somente para a origem nova; preserva os cortes dos Forms anteriores. O Form novo permanece fechado até essa abertura explícita. O formulário primário de uma instalação antiga é preservado mesmo que a ordem da lista mude.

## Arquivos completos

| Arquivo | Responsabilidade |
|---|---|
| `Config.gs` | Parâmetros, acesso à planilha, tabelas, bloqueio e erros |
| `Domain.gs` | CPF, identidade, disponibilidade, intervalos e decisões |
| `Persistence.gs` | Livro oficial, commit, reconstrução e recuperação |
| `Forms.gs` | Criação, configuração, verificação de identidade e opções |
| `Notifications.gs` | Modelos de e-mail, cota, fila, reservas e novas tentativas |
| `Admin.gs` | Instalação, gatilhos, menu, atividades e administração |
| `Importacao.gs` | Prévia e importação administrativa de inscrições antigas da CSP conferidas pela organização |
| `appsscript.json` | V8, fuso e permissões explícitas |
| `tests/*.test.cjs` | Testes locais com serviços Google simulados |
| `TESTES.md` | Evidências e roteiro dos testes reais |

Os arquivos em `src/` são módulos globais do mesmo projeto: não crie projetos separados para cancelamento ou notificação. O comando `python -X utf8 scripts/build_delivery.py`, executado na raiz do repositório, gera `dist/ENTREGA_COMPLETA.md` com o manual e o conteúdo integral dos arquivos de instalação, sem trechos omitidos.

## Instalação

1. Escolha uma conta Google administrada pelo CA que continuará disponível durante o evento. Os gatilhos e envios usarão essa conta. Crie uma planilha privada nessa conta, abra **Extensões → Apps Script** e dê ao projeto o nome `SEMINFO`.
2. No editor, crie os sete arquivos de script com os nomes indicados acima e cole seu conteúdo integral. Remova apenas um `Code.gs` vazio criado pelo editor. Em **Configurações do projeto**, habilite **Mostrar o arquivo de manifesto appsscript.json no editor**; substitua seu conteúdo pelo manifesto fornecido. O fuso deve ser `America/Sao_Paulo`.
3. Em `SEMINFO_CONFIG`, preencha `EMAIL_CA`, por exemplo `ca.alanturing@universidade.edu.br`. Ajuste `NOME_REMETENTE`. Mantenha `ENVIAR_COPIA_CA: true` para receber cópia de conflitos e demais problemas; confirmações, trocas concluídas e cancelamentos concluídos vão apenas ao participante. Avisos de capacidade atingida vão diretamente ao CA. Para vários Forms existentes, configure a lista e o mapeamento descritos acima. Para apenas um existente, ainda é possível usar `ID_FORM_INSCRICAO`. Deixe a lista e esse ID vazios somente se desejar criar um novo Form de inscrição. `CRIAR_FORM_CANCELAMENTO` controla a criação do cancelamento quando seu ID está vazio.
4. Habilite a **Google Forms API** no projeto Google Cloud associado. Caminho para configurar explicitamente: crie/selecione um projeto no [Google Cloud Console](https://console.cloud.google.com/); em **APIs e serviços → Biblioteca**, habilite **Google Forms API**; configure o aplicativo de consentimento OAuth em **Google Auth Platform** de acordo com a conta (interno no domínio quando disponível, ou externo com a conta instaladora como usuário de teste). Copie o **número** do projeto, abra **Apps Script → Configurações do projeto → Projeto do Google Cloud Platform → Alterar projeto**, informe o número e confirme. O acesso REST usa o token do próprio Apps Script; não crie uma chave de API nem uma conta de serviço. Essa integração segue as instruções de [projetos Cloud padrão do Apps Script](https://developers.google.com/apps-script/guides/cloud-platform-projects#standard_cloud_platform_projects).
5. Execute `instalarSistema` pela conta escolhida e autorize as permissões apresentadas para Forms, planilha, leitura do Drive, requisições REST, gatilhos e e-mail. O acesso de leitura ao Drive recupera formulários criados durante uma instalação interrompida. Se o consentimento ou a API ainda não estiver configurado, o relatório informará a pendência e manterá os Forms fechados.
6. Execute `configurarEmailVerificadoFormularios` no editor com a conta instaladora, ou use **SEMINFO → Configurar e-mail verificado nos Forms**. A função define `VERIFIED` pela API em todos os Forms de inscrição/cancelamento configurados e confirma o resultado por leitura. Para instalações existentes, copie o manifesto atualizado, com o escopo `https://www.googleapis.com/auth/forms.body`, e autorize novamente. Os Forms ficam fechados até executar `conferirSistema` e `abrirInscricoes`. IDs, perguntas, respostas e inscrições são preservados; as respostas anteriores à correção continuam em quarentena. Também é possível abrir os links de edição e selecionar **Configurações → Respostas → Coletar endereços de e-mail → Verificado** em cada um. Essa modalidade vincula o endereço à Conta Google conectada. **Entrada do participante** e uma pergunta de e-mail digitado não atendem ao requisito. Defina **Enviar uma cópia das respostas → Desativado**, para que a confirmação de inscrição venha somente da automação. O procedimento é descrito na [ajuda oficial do Forms](https://support.google.com/docs/answer/139706?hl=pt-BR); a configuração automática usa [updateSettings](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/batchUpdate#UpdateSettingsRequest).
7. Confira que **Limitar a 1 resposta** está desativado, **Permitir a edição de respostas** desativado e o resumo de resultados não está acessível aos participantes. O código configura esses itens e usa `getRespondentEmail()`; a modalidade `VERIFIED` é conferida na [API oficial de Forms](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms), porque `setCollectEmail(true)` sozinho não distingue as modalidades.
8. Verifique a audiência dos participantes em **Publicar / Gerenciar acesso** de cada Forms: conceda acesso de **respondente** ao público pretendido e confira restrições do domínio Workspace. Publique quando a interface pedir. Use acesso geral por link apenas quando a audiência for externa e isso for desejado. Nunca compartilhe edição do Forms ou da planilha com participantes. O script publica Forms compatíveis ao abrir o recebimento, mas não amplia permissões de compartilhamento. A distinção entre publicação e recebimento é documentada em [Form](https://developers.google.com/apps-script/reference/forms/form).
9. Reabra a planilha para mostrar o menu **SEMINFO**. Carregue a demonstração em uma cópia de testes ou cadastre as atividades reais, incluindo todos os IDs associados a Forms fixos. Execute **Conferir configuração e cotas** e depois **Abrir inscrições**. A primeira abertura estabelece o início seguro da coleta verificada por Form. Respostas anteriores ficam em quarentena e precisam ser reenviadas pelos participantes depois da abertura.
10. Em **Apps Script → Gatilhos**, confira `aoEnviarInscricao` para cada Form que recebeu um gatilho, `aoEnviarCancelamento` quando houver cancelamento e `manutencaoPeriodica` a cada cinco minutos. No modo padrão de um Form de inscrição e um de cancelamento são três gatilhos. Todos são criados automaticamente; `conferirSistema` identifica os Forms tratados pela varredura por limite de slots. Envie uma resposta real de cada formulário e confira o resultado na planilha e no e-mail antes de divulgar os links públicos.

IDs e configurações persistidos passam a ser lidos da aba `Configuracoes`; alterar os defaults no código depois da instalação não sobrescreve valores existentes. Não modifique IDs de recursos já instalados. Reexecutar a instalação preserva respostas, registros, IDs e configurações, reutiliza abas e perguntas, e remove duplicações somente dos gatilhos SEMINFO que ela gerencia, visíveis à conta instaladora.

`onOpen` apenas cria o menu na interface da planilha vinculada. Se for executado em um contexto sem essa interface, registra a orientação no log e encerra. Reabra a planilha para ver o menu; pelo editor, execute diretamente as funções administrativas.

Se **Abrir inscrições** falhar com `Dados inválidos ao atualizar o formulário`, atualize `Forms.gs` no projeto Apps Script e execute `abrirInscricoes` novamente. O código reconhece esse erro em português e inglês somente na atualização da mensagem opcional de formulário fechado, permitindo continuar a abertura. Erros na publicação ou no recebimento continuam interrompendo a execução, agora com o ID do Form e a etapa (`setPublished(true)` ou `setAcceptingResponses(true)`). Consulte o detalhe da execução para identificar qual chamada falhou.

**Identidade e respostas históricas.** Não altere a modalidade de e-mail depois da abertura nem envie respostas por scripts/APIs. A API de respostas não fornece um comprovante individual de que uma resposta histórica foi coletada em `VERIFIED`; por isso o fluxo automático exige uma data de corte e controle dos editores. Se o sistema detectar modalidade incompatível, desativa a recepção, invalida a data de corte desse formulário e exige nova abertura administrativa. Respostas anteriores à nova ativação ficam em quarentena. Uma troca indevida de modalidade feita e revertida entre verificações não pode ser detectada retrospectivamente: mantenha o acesso de edição exclusivamente com a organização e confira o histórico antes de reativar. Os gatilhos não usam respostas em quarentena para vincular CPF ou enviar mensagens. A importação da CSP é uma operação administrativa explícita, com dados conferidos pela organização e origem registrada no livro, que preserva a coleta automática e sua data de corte.

## Atividades e administração

A aba `Atividades` é uma visão protegida. Cadastre/atualize pelo menu **Cadastrar / atualizar atividade**, colando um objeto JSON completo:

```json
{
  "id": "OFICINA_GO_01",
  "title": "Introdução a Go",
  "type": "oficina",
  "description": "Fundamentos da linguagem e prática orientada.",
  "instructor": "Nome do ministrante",
  "location": "Laboratório 1",
  "start": "2026-11-09T14:00:00-03:00",
  "end": "2026-11-09T16:00:00-03:00",
  "capacity": 25,
  "status": "aberta"
}
```

Campos de texto e datas são strings; a capacidade conhecida é um inteiro positivo. Tipos: `oficina`, `palestra`, `competicao` e `programacao`; situações: `aberta`, `encerrada`, `cancelada`, `pendente`. Somente `pendente` permite início/término vazios e capacidade desconhecida (`null`), mantendo as inscrições fechadas. Para abrir, complete todos os campos obrigatórios. A CSP conta capacidade em `equipes`. IDs têm 1–64 letras ASCII, números, hífens ou sublinhados. O mesmo ID atualiza a mesma atividade; ele não é renomeável. Para excluir uma atividade sem inscrições no histórico, use **Apagar atividade** ou `apagarAtividade(id)`. Datas conhecidas incluem fuso e um término informado precisa ser posterior ao início. O armazenamento usa instantes ISO em UTC; Forms/e-mails mostram o fuso São Paulo.

Uma redução da capacidade abaixo da ocupação confirmada é bloqueada. Alterações do horário com inscritos são bloqueadas. Para reagendamento, a organização precisa atender os inscritos, cancelar com justificativa e comunicar o novo plano antes de criar/alterar uma atividade. Mudar a situação para encerrada/cancelada retira a opção de inscrição, mas preserva as inscrições existentes e o histórico; cancelamentos de inscrições devem ser realizados explicitamente.

O menu oferece ocupação, lista de inscritos, exportação privada, abertura/encerramento, cancelamento administrativo com justificativa, correção auditada do e-mail, reprocessamento, envio da fila, erros e histórico. As funções públicas correspondentes são `salvarAtividade`, `consultarOcupacao`, `consultarInscritos`, `exportarConfirmados`, `cancelarInscricaoAdministrativa` e `alterarEmailParticipante`. A conta instaladora deve executar as alterações; demais organizadores podem receber acesso de leitura. Para exportar CSV, abra a aba `Lista_...` criada e use **Arquivo → Fazer download → Valores separados por vírgulas (aba atual)**.

A lista confirmada contém `NOME`, `EMAIL`, `CPF` completo (11 dígitos, como texto, preservando zeros iniciais) e `INSCRICAO`. Inclui somente inscrições com situação `confirmada` na atividade escolhida. Cada exportação cria uma nova aba; listas exportadas anteriormente são fotografias da situação daquele momento.

`carregarDemonstracao` permanece disponível somente pelo editor para homologação em uma cópia isolada; foi retirada do menu de produção. Ela cria cinco atividades fictícias de novembro de 2026 e não sobrescreve IDs já existentes. Para este evento, use **Carregar programação XXI Seminfo**. Os CPFs sintéticos dos testes são dados matemáticos de demonstração; não representam pessoas e não devem ser cadastrados em produção.

## Importação das inscrições anteriores da CSP

O Form `1oXixuiIIJ1sGVdTgs0uEQVSEaqxEO5NqupTi-4xv2ww` recebe os dados antigos da atividade `CSP_2026`. Como o e-mail era digitado, a importação registra a origem `REVISAO_ADMINISTRATIVA_EMAIL_INFORMADO`, a conta instaladora e a justificativa da conferência pela organização. Ela não atribui coleta nativa `VERIFIED` a esses dados nem altera a data de corte dos gatilhos.

1. Em uma instalação existente, crie `Importacao.gs` no mesmo projeto Apps Script e copie seu conteúdo. Atualize `Admin.gs` e acrescente `IMPORTACAO_CSP_JSON` ao objeto de configuração, conforme `Config.gs`. Reabra a planilha para carregar o menu.
2. Confira que `CSP_2026` está cadastrada para **60 equipes**, com horários e situação corretos. O importador não modifica esse cadastro e respeita sua situação. A recepção geral pode estar fechada durante a migração.
3. Use **SEMINFO → Preparar prévia das inscrições antigas da CSP**. A prévia cria uma aba privada com dados e resultados previstos, sem gerar inscrições nem e-mails. Ela ordena respostas por data e identifica as que já constam no livro.
4. Se os títulos das perguntas não permitirem identificar nome, CPF e e-mail sem ambiguidade, use **Listar perguntas do Form antigo da CSP** e informe os IDs em `IMPORTACAO_CSP_JSON.items`. São IDs de perguntas, não posições. A importação exige uma resposta individual de nome, CPF e e-mail.
5. Confira a prévia e execute **Importar inscrições antigas da CSP conferidas**. Repita até `restantes` chegar a zero. Cada lote respeita `MAX_SOLICITACOES_POR_EXECUCAO`. As respostas posteriores ao momento da prévia não entram naquele lote de migração. Se as respostas antigas forem editadas ou o estado do sistema mudar antes de iniciar a importação, prepare uma nova prévia.
6. Consulte `Inscricoes`, `Solicitacoes`, `Historico` e `FilaEmails`. A fila normal envia os resultados ao participante; somente problemas têm cópia ao CA, e a lotação vigente gera o aviso próprio de capacidade.

Se as respostas já tiverem sido apagadas do Form, mas houver backup, coloque a tabela de respostas em uma aba da planilha central e acrescente o nome da aba ao objeto, por exemplo: `"backupSheetName": "Backup_XXXXXXXX_Form_0"`. O importador aceita o formato de backup com cabeçalho `FORM_ID, RESPOSTA_ID, DATA, EMAIL, PERGUNTA_ID, PERGUNTA, RESPOSTA_JSON`, confere que `FORM_ID` corresponde à fonte CSP e usa os mesmos IDs das respostas para evitar duplicidade. Para o backup oculto criado pela limpeza, use diretamente o nome da aba `Backup_…_Form_…`; para TSV exportado, cole os dados em uma aba mantendo cabeçalho e valores. Confira a prévia antes de importar e preserve o backup até validar o resultado.

### Recuperar pelo texto salvo de IntegrantesEquipes

Se o backup de respostas também foi apagado, uma cópia de `IntegrantesEquipes` permite recuperar as equipes. O cabeçalho deve ser `EQUIPE_ID, EQUIPE, CPF, NOME, PAPEL, TURMA, TELEFONE, TEXTO_ORIGINAL`. Cada `EQUIPE_ID` precisa manter o identificador original `formId:responseId:equipe`; o agrupamento conserva essa identidade e evita repetir inscrições já processadas. CPFs devem ser texto, preservando zeros iniciais. Esse formato funciona sem as respostas e, quando `includeLiveResponses` não estiver habilitado, também sem as perguntas originais.

Para recuperar uma versão histórica do Google Sheets, exporte as abas `IntegrantesEquipes` e `Equipes` como TSV, sem alterar cabeçalhos ou IDs. Execute localmente `python -X utf8 scripts/build_csp_recovery.py "caminho/IntegrantesEquipes.tsv" --teams "caminho/Equipes.tsv" --output dist/outputs/recuperacao-csp`. O auxiliar `RecuperacaoCspSalva.gs` gerado contém as duas tabelas. Copie-o para o mesmo projeto Apps Script, atualize `Importacao.gs` e execute `prepararBackupCspSalvo`. A função confere os IDs, nomes, coach e quantidade de integrantes entre as abas; preserva tipo, situação confirmada e data original; cria backups privados protegidos; e prepara a prévia. Sem a aba `Equipes`, ainda é possível recuperar usando somente `IntegrantesEquipes`, mas sem tipo e data originais. Reexecutar o auxiliar não reescreve backups existentes. Uma edição divergente nos backups bloqueia a recuperação para conferência.

Confira a prévia e execute `importarInscricoesAnterioresCsp` até `restantes` chegar a zero. As equipes entram no livro `Operacoes`; assim, novas inscrições e reconstruções mantêm as recuperadas. Não restaure somente colando nas abas `Equipes` ou `IntegrantesEquipes`, pois ambas são visões desse livro. O auxiliar habilita `includeLiveResponses: true`: as próximas prévias/importações reúnem a cópia salva e novas respostas do Form, sem duplicar IDs ou substituir os dados das equipes recuperadas. Novas inscrições da CSP continuam passando pelo fluxo de prévia e importação administrativa. Cancelamentos já registrados não são desfeitos por repetir a importação.

A cópia de integrantes não informa data original, tipo de equipe ou situação anterior. A prévia deixa a data original vazia e mostra a data da recuperação separadamente; a importação registra essa origem e reavalia vagas, conflitos e dados conforme o estado atual. Confira esses dados antes de confirmar a importação. Uma equipe de um integrante permanece com um integrante; o sistema não inventa integrantes, e-mail, capacidade ou datas históricas. Guarde também o arquivo local como cópia independente.

Configuração padrão, já preenchida em `Config.gs`:

```json
{
  "formId": "1oXixuiIIJ1sGVdTgs0uEQVSEaqxEO5NqupTi-4xv2ww",
  "activityId": "CSP_2026",
  "items": {}
}
```

O mapeamento pode ser automático pelos títulos comuns ou explícito, por exemplo `"items": {"NAME": 123456, "CPF": 234567, "EMAIL": 345678}` após substituir esses números pelos IDs reais. `backupSheetName` é opcional; use-o somente para importar de uma cópia quando o Form já não tiver as respostas. No código esse objeto fica dentro de `JSON.stringify(...)`; na aba `Configuracoes`, o valor da chave `IMPORTACAO_CSP_JSON` é o objeto JSON inteiro.

Para apontar para uma cópia, acrescente `"backupSheetName": "NOME_EXATO_DA_ABA"` ao objeto existente, sem remover `formId`, `activityId`, `schema` nem `items`.

A importação aplica validação de CPF e e-mail, duplicidade, capacidade, conflito e vínculo de identidade existente. Não autoriza trocas nem substitui e-mails já vinculados. Não altera inscrições que já foram confirmadas no sistema para dar prioridade retroativa a respostas antigas. Repetir usa a mesma chave original `formId:responseId`, sem gerar uma segunda decisão ou vaga.

O campo `formularioIntegrado` indica se esse Form já está na configuração do fluxo automático. A importação administrativa não o adiciona a `FORMULARIOS_INSCRICAO_JSON`, não instala gatilhos nele e não muda suas permissões ou configurações. Para receber e fechar automaticamente novos envios da CSP, acrescente esse Form à lista existente com `activityId: "CSP_2026"` e os IDs de `NAME`/`CPF`, instale com segurança, configure a coleta nativa como **Verificado** e abra as inscrições. As respostas antigas continuam disponíveis para a importação administrativa; as novas seguem o fluxo automático.

## Planilha e fontes oficiais

| Aba | Colunas | Fonte / papel |
|---|---|---|
| `Configuracoes` | CHAVE, VALOR | Configuração administrativa; IDs também em ScriptProperties para recuperação |
| `Atividades` | ID, TITULO, TIPO, DESCRICAO, MINISTRANTE, LOCAL, INICIO, TERMINO, CAPACIDADE, SITUACAO, OCUPACAO | Projeção de CATALOG + inscrições confirmadas |
| `Participantes` | CPF, NOME, EMAIL_VERIFICADO | Primeiro vínculo por coleta nativa ou revisão administrativa da importação; origem registrada em Operacoes |
| `Solicitacoes` | CHAVE, PROTOCOLO, FORM_ID, RESPOSTA_ID, RECEBIDA_EM, PROCESSADA_EM, TIPO, CPF, EMAIL, ATIVIDADE_ID, RESULTADO | Projeção das respostas decididas; pendentes permanecem nos Forms |
| `Inscricoes` | ID, CPF, ATIVIDADE_ID, SITUACAO, CRIADA_EM, ATUALIZADA_EM, JUSTIFICATIVA | Projeção, preservando canceladas e canceladas por troca |
| `Operacoes` | REGISTRO_JSON | Livro oficial de decisões e cadastros; não editar/reconstruir |
| `Historico` | OPERACAO, DATA, TIPO, RESUMO | Visão legível do livro oficial |
| `FilaEmails` | ID, OPERACAO, CRIADA_EM, DESTINATARIO, CC, ASSUNTO, CORPO, SITUACAO, TENTATIVAS, ERRO, PROXIMA_TENTATIVA, LEASE_ATE, ENVIADA_EM | Estado durável de entrega; não apagar nem recriar |
| `Erros` | DATA, CONTEXTO, CHAVE, ERRO | Diagnóstico operacional sanitizado |
| Abas nativas de respostas | Geradas pelo Google Forms | Cópia bruta; não são contagem nem fonte de inscrições confirmadas |

`Operacoes` é a fonte de inscrições, atividades e participantes. Os Forms são a caixa de entrada durável das respostas ainda não decididas. `FilaEmails` é a fonte do estado de envio. Uma projeção parcialmente reconstruída não decide ocupação: todas as operações releem e reproduzem o livro sob bloqueio. CPF é normalizado no domínio e armazenado como string, com formato de texto nas projeções; o campo bruto da solicitação pode conservar a máscara para auditoria.

Os registros operacionais têm proteção real de edição pela conta instaladora, seguindo [Protection](https://developers.google.com/apps-script/reference/spreadsheet/protection). Isso reduz alterações acidentais; o proprietário da planilha continua tendo poderes de edição. Remova compartilhamento público, confira grupos/domínio, restrinja os editores dos Forms e do projeto e mantenha backups. A instalação não revoga compartilhamentos preexistentes: os IDs usados devem apontar para recursos previamente privados. Listas exportadas contêm CPF completo, nome e e-mail e também permanecem privadas.

## Persistência, concorrência e recuperação

O bloqueio é exclusivo do projeto e exige que todos os formulários usem esse mesmo projeto. Ele serializa validação e gravação, mas **não é uma transação nem desfaz gravações parciais**. Uso e liberação com `flush()` seguem a referência de [Lock](https://developers.google.com/apps-script/reference/lock/lock).

Cada resposta tem chave `formId:responseId` e um protocolo derivado por SHA-256. Uma decisão oficial inclui vínculo inicial, cancelamentos e confirmação como um único payload. O livro armazena um envelope JSON em **uma única célula**, com hash e referência ao hash anterior, escrito em uma chamada e relido antes de reconstruir as visões. O código não cancela inscrições em células separadas antes de confirmar a nova. Há limite preventivo de 45.000 caracteres no envelope; uma troca que o ultrapasse precisa de atendimento e preserva as inscrições anteriores.

Se a execução parar antes da gravação oficial, nenhum cancelamento da troca é aplicado. Se parar depois da gravação, a reconstrução reproduz a troca inteira. Se a gravação devolver erro após efetivamente persistir, a próxima tentativa procura a chave existente e não grava novamente. Registro ilegível, vazio no meio do livro, encadeamento inválido ou estado inconsistente bloqueia novas decisões para atendimento. Essa estratégia limita a superfície de gravação parcial; não atribui garantia transacional ao Sheets. O hash detecta corrupção/reordenação acidental, não adulteração por um editor com acesso ao código nem remoção do final inteiro do livro. Proteções, histórico de versões e backups privados continuam necessários.

A rotina periódica varre as respostas de todos os Forms e procura chaves ausentes do livro, em lotes configuráveis. O início da varredura gira entre Forms e respostas para que falhas antigas não bloqueiem permanentemente as posteriores; nenhum cursor descarta respostas e todas são revisitadas. As visões, a fila e as opções são recompostas no fim do lote. Os indicadores `varreduraParcial` e `loteCheio` informam quando ainda pode haver trabalho além do lote observado. A disputa pela última vaga é decidida na ordem em que cada operação obtém o bloqueio e lê os dados atuais; não há promessa de ordem cronológica exata dos envios. Falha ao obter o bloqueio deixa a resposta pendente para recuperação. Em uma troca recusada por lotação, toda inscrição anterior permanece válida.

Procedimento operacional de recuperação:

1. Na conta instaladora, confira **Execuções** no Apps Script, `Erros`, `FilaEmails` e `Operacoes`. Se houver suspeita de corrupção manual, feche o recebimento pelos próprios Forms imediatamente e mantenha backups antes de corrigir.
2. Corrija permissões, API, cota ou configuração. Confira `VERIFIED` em todos os Forms. Não apague respostas nem registros oficiais e não refaça o sistema em outro projeto.
3. Execute **Processar solicitações pendentes**. Repita até os lotes terminarem; a execução periódica também continuará. Respostas anteriores ao corte seguro ficam em quarentena: solicite novo envio pela conta Google correta.
4. Execute **Reconstruir visões / recuperar** para restaurar abas de consulta e gerar itens de fila que faltam. Execute **Processar e-mails pendentes**. Falhas de fila/opções após uma decisão não desfazem o registro oficial.
5. Se `Operacoes` for inválida, restaure a célula/versão exata a partir de backup ou histórico de versões após conferência pela organização. Não exclua uma linha inválida para simplesmente continuar e não restaure uma versão que descarte confirmações posteriores sem reconciliar os participantes. Depois execute a reconstrução.
6. Após três falhas registradas para uma resposta já obtida com e-mail verificado, é criado um aviso de atendimento com o mesmo protocolo. Esse aviso não declara uma inscrição recusada nem modifica ocupação; a resposta continua pendente.

## E-mail, cota e limites

Confirmações de inscrição, trocas concluídas e cancelamentos concluídos são enviados somente ao participante. Com `ENVIAR_COPIA_CA=true`, conflitos, lotação, duplicidade, dados inválidos, identidade incompatível, atividade indisponível e solicitações que exigem atendimento incluem o CA em CC. Ao atualizar o código, execute **Reconstruir visões / recuperar** para retirar a cópia dos avisos de sucesso ainda pendentes. Mensagens já enviadas e envios em andamento são preservados.

Quando as inscrições confirmadas atingem a capacidade, o CA recebe um aviso próprio **Capacidade atingida**, com atividade, ocupação e data do evento, sem CPF. Esse aviso tem prioridade sobre os demais itens pendentes da fila e independe de `ENVIAR_COPIA_CA`. O ID combina a operação que preencheu a capacidade e a atividade, evitando repetir o aviso a cada manutenção. Se uma vaga for liberada e a atividade voltar a lotar, há um novo aviso. A recuperação comunica apenas ciclos de lotação ainda vigentes, evitando recriar avisos de lotações históricas que já foram desfeitas. Na primeira atualização, atividades atualmente lotadas podem gerar esse aviso mesmo que a última vaga tenha sido preenchida antes da mudança.

O e-mail de conflito de horário inclui o link de preenchimento configurado em `URL_FORM_CANCELAMENTO_EMAIL` e orienta a aguardar a confirmação do cancelamento antes de enviar uma nova inscrição, sujeita a vagas. Use o link destinado aos participantes, em vez da URL de edição. A chave pode ser ajustada na aba `Configuracoes`; deixá-la vazia omite esse parágrafo. Essa URL controla o texto do e-mail: o Form processado pelo sistema continua sendo o de `ID_FORM_CANCELAMENTO`. Confira que o link aponta para o formulário que a organização atende. A mudança vale para mensagens criadas na fila após a atualização; mensagens já existentes preservam seu conteúdo.

As mensagens usam `MailApp`: **Para** = e-mail verificado da solicitação, **CC** = CA somente nos problemas quando configurado e diferente do destinatário, **Responder para** = CA, **Nome** = `NOME_REMETENTE`. Os avisos de capacidade são enviados diretamente ao CA. Protocolos e detalhes de atividades aparecem quando pertinentes; CPF completo não aparece nos modelos. Uma tentativa com e-mail diferente do cadastro recebe uma mensagem genérica sem dados do cadastro original.

Gatilhos executam como quem os instalou, conforme [gatilhos instaláveis](https://developers.google.com/apps-script/guides/triggers/installable). O endereço de resposta e o nome exibido não mudam a conta remetente. `MailApp` não aceita `from`; um alias exigiria outro serviço, como Gmail, e autorização desse alias. A implementação usa os campos documentados em [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app). Respostas por e-mail são atendidas pelo CA; não são interpretadas para alterar inscrições automaticamente.

A fila tem ID determinístico `MAIL:chaveDaOperacao`, situação `pendente`, `processando` ou `enviada`, tentativas, erro, próxima tentativa e lease de dez minutos. A reserva é feita sob bloqueio; o envio acontece fora dele. Falta de cota mantém pendente sem alterar a inscrição. Falhas recebem novas tentativas com espera crescente de cinco minutos até seis horas. A cota contabiliza destinatário e CC distintos e reservas de outros envios deste projeto; outras aplicações da conta podem consumir a mesma cota entre as verificações.

**Entrega de e-mail não é exatamente uma vez.** Se o envio for aceito e a execução parar antes de marcar `enviada`, a lease expira e a mensagem poderá ser reenviada. O protocolo/ID permite reconhecer a duplicação. `enviada` significa aceitação pelo serviço, não comprovação de leitura ou chegada à caixa de entrada. Não limpe linhas enviadas, pois isso causaria sua recriação pelo livro oficial.

Na [tabela oficial de cotas](https://developers.google.com/apps-script/guides/services/quotas), consultada em 08/10/2026: 100 destinatários/dia em contas pessoais e 1.500 em Workspace; há limite separado de 2.000 destinatários internos do domínio. As cotas são por usuário e renovam 24 horas após a primeira solicitação, não necessariamente à meia-noite. Com participante externo e CC, uma mensagem consome duas unidades. Limites relevantes: seis minutos por execução; execução diária de gatilhos de 90 minutos em conta pessoal ou seis horas Workspace; 20 gatilhos por usuário/projeto; 50 destinatários por mensagem. Contas de teste podem ter limites adicionais e os valores podem mudar.

Antes da abertura, execute `conferirSistema` para ler a cota efetiva com `MailApp.getRemainingDailyQuota()`, confirme a edição/tipo da conta com o administrador e consulte novamente a tabela oficial. Para 200 confirmações com CC em uma conta pessoal, a demanda de 400 destinatários ultrapassa a cota diária; a fila continuará nos períodos seguintes. Dimensione a conta e os lotes antes da divulgação.

O processamento de recuperação tenta respeitar um orçamento total de 4,5 minutos por execução periódica; chamadas individuais lentas aos serviços ainda podem causar interrupção e serão recuperadas. A varredura completa dos Forms e replay do livro crescem com o volume: faça teste de carga na conta real e acompanhe duração/pendências antes de ampliar o público. A arquitetura é adequada a um evento acadêmico com volume validado; não oferece SLA ou capacidade ilimitada. Não reduza as regras de integridade para contornar cota/tempo.

## Testes

Consulte `TESTES.md`. Execute localmente, com Node.js:

```powershell
node tests/domain.test.cjs
node tests/notifications.test.cjs
node tests/forms-install.test.cjs
node tests/persistence.test.cjs
```

São testes do código real com serviços simulados. O roteiro identifica explicitamente as verificações ainda necessárias no Google, incluindo simultaneidade real de gatilhos, modalidade verificada, permissões/publicação, entrega de e-mails e repetição da instalação. Enviar respostas por `FormResponse.submit()` não dispara o gatilho instalável; use a interface nativa para o teste real ou chame o processador explicitamente em ambiente isolado, conforme as restrições oficiais dos gatilhos.
