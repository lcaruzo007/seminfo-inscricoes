<div align="center">

# SEMINFO

### Inscrições organizadas. Vagas controladas. Programação em um só lugar.

Sistema de inscrições da **XXI Semana da Informática**.<br>
Google Forms · Google Sheets · Google Apps Script

![Google Apps Script](https://img.shields.io/badge/Google_Apps_Script-V8-4285F4?style=flat-square)
![Google Forms](https://img.shields.io/badge/Google_Forms-integrado-7248B9?style=flat-square)
![Google Sheets](https://img.shields.io/badge/Google_Sheets-centralizado-188038?style=flat-square)
![Testes](https://img.shields.io/badge/testes-node%3Atest-17324D?style=flat-square)

**26 a 29 de outubro de 2026** · Centro Acadêmico Alan Turing

[Instalação](#instalação) · [Uso](#uso) · [Estrutura](#estrutura) · [Testes](#testes) · [Documentação](#documentação)

</div>

---

O SEMINFO conecta os formulários do evento a uma planilha central. Cada solicitação passa por validação de identidade, CPF, disponibilidade e conflito de horário. O participante recebe o resultado por e-mail, e a organização acompanha inscrições, equipes e ocupação pelo menu **SEMINFO**.

O projeto inclui **11 Forms por ID e 2 novos Forms por URL pública**, o Form histórico da CSP e os **18 itens da programação final**, incluindo a oficina de C com 40 vagas. A preparação resolve os IDs de edição dos novos Forms na conta instaladora. Títulos visíveis e nomes dos arquivos usam **PALESTRA - Nome da atividade** ou **OFICINA - Nome da atividade**. A CSP continua no fluxo de importação por equipes. Atividades com informações incompletas aparecem como **pendentes** e recebem inscrições depois que seus dados forem completados e a abertura for autorizada.

## O que o sistema faz

| Recurso | Comportamento |
|---|---|
| Inscrições | Vários Forms compartilham o mesmo controle de CPF e identidade. |
| Vagas | A ocupação considera inscrições confirmadas, com processamento sob bloqueio. |
| Horários | Sobreposições são verificadas entre todas as atividades do participante. |
| Trocas | Uma troca autorizada substitui as inscrições conflitantes somente quando há vaga. |
| Cancelamentos | O participante usa um Form; a organização também pode cancelar com justificativa. |
| Equipes CSP | A capacidade pode ser contada por equipe, com integrantes identificados. |
| E-mails | Fila persistente com novas tentativas; o CA recebe avisos de problemas e lotação. |
| Administração | Cadastro, exclusão de atividades sem inscrições, exportação e recuperação das visões. |

## Como funciona

```mermaid
flowchart LR
    A[Google Forms] --> B[Validação de CPF, identidade, vagas e horários]
    B --> C[Livro de operações]
    C --> D[Visões no Google Sheets]
    C --> E[Fila de e-mails]
    E --> F[Participante e organização]
```

`Operacoes` guarda as decisões oficiais. As abas de consulta são reconstruídas a partir desse livro; as respostas brutas do Forms permanecem separadas das inscrições confirmadas.

## Instalação

**Você precisa de uma conta Google com acesso aos Forms e à planilha, um projeto Apps Script e a Google Forms API habilitada.** O sistema usa os formulários nativos; a instalação não exige publicar um aplicativo web.

1. Abra a planilha central e acesse **Extensões → Apps Script**.
2. Crie os **sete arquivos `.gs`** com os nomes de [`src/`](src), colando o conteúdo completo de cada arquivo no correspondente. Todos pertencem ao **mesmo projeto**.
3. Habilite a exibição do manifesto nas configurações do projeto e use [`src/appsscript.json`](src/appsscript.json). O fuso é `America/Sao_Paulo`.
4. Confira os IDs e o e-mail da organização em [`src/Config.gs`](src/Config.gs). Habilite a **Google Forms API** no projeto Cloud associado.
5. Execute `instalarSistema` com a conta que ficará responsável pelo sistema e autorize as permissões.
6. Execute `configurarEmailVerificadoFormularios` para definir **Coletar endereços de e-mail → Verificado** em todos os Forms configurados, ou escolha essa opção manualmente em cada Form. Confira o acesso dos participantes.
7. Execute `atualizarProgramacaoSeminfo2026` para integrar os Forms e cadastrar a programação. Complete as pendências, confira o sistema e use **Abrir inscrições** quando estiver pronto.

> Os arquivos mantêm a configuração do evento. Depois da instalação, os valores persistidos são lidos da aba `Configuracoes`; mudar os padrões do código não substitui automaticamente essa configuração.

O passo a passo da API, permissões, publicação dos Forms e recuperação está no [manual completo](docs/MANUAL.md).

### Qual conteúdo vai em cada arquivo?

| Arquivo em `src/` | Responsabilidade |
|---|---|
| [`Config.gs`](src/Config.gs) | `SEMINFO_CONFIG`, tabelas, configurações, bloqueio e acesso à planilha. |
| [`Domain.gs`](src/Domain.gs) | Regras de CPF, identidade, atividades, vagas, conflitos e equipes. |
| [`Persistence.gs`](src/Persistence.gs) | Livro oficial, processamento e reconstrução das visões. |
| [`Forms.gs`](src/Forms.gs) | Integração com Forms, perguntas, identidade e opções. |
| [`Notifications.gs`](src/Notifications.gs) | Fila e modelos de e-mail, cotas e novas tentativas. |
| [`Admin.gs`](src/Admin.gs) | Menu, instalação, programação e administração. |
| [`Importacao.gs`](src/Importacao.gs) | Prévia e importação administrativa das inscrições anteriores da CSP. |

## Uso

Depois de reabrir a planilha, o menu **SEMINFO** reúne as ações de operação.

| Objetivo | Função |
|---|---|
| Atualizar Forms e acrescentar a programação, preservando inscrições | `atualizarProgramacaoSeminfo2026` |
| Aplicar os novos títulos aos Forms e atividades existentes | `atualizarFormularios` |
| Criar ou consultar os três Meets, com reserva de 3 horas | `criarMeetsSeminfo2026` |
| Cadastrar ou atualizar uma atividade | `salvarAtividade` |
| Excluir uma atividade sem inscrições no histórico | `apagarAtividade` |
| Conferir configurações, gatilhos e cotas | `conferirSistema` |
| Consultar a cota de e-mail sem conferir Forms ou gatilhos | `consultarCotaEmails` |
| Recuperar somente os gatilhos de uma instalação existente | `repararGatilhos` |
| Abrir ou encerrar inscrições | `abrirInscricoes` / `encerrarInscricoes` |
| Encerrar o evento, cancelar e-mails pendentes e gerar presenças por dia/sala | `encerrarEventoSeminfo` |
| Gerar novamente listas de presença, preservando as anteriores | `gerarListasPresencaPorDiaESala` |
| Cancelar e-mails pendentes e suspender novos envios | `cancelarEmailsPendentes` |
| Consultar ocupação | `consultarOcupacao` |
| Corrigir capacidade e reavaliar recusas de uma atividade encerrada | `menuReavaliarInscricoes` |
| Exportar uma lista de confirmados | `exportarConfirmados` |
| Recuperar as abas de consulta | `reconstruirVisoes` |

**Encerramento após o evento:** atualize `Admin.gs`, `Notifications.gs`, `Forms.gs` e `Persistence.gs` no Apps Script, salve e execute **`encerrarEventoSeminfo`** com a conta instaladora. A função encerra as inscrições, fecha os Forms de inscrição/cancelamento e o histórico da CSP, cancela os e-mails ainda pendentes e bloqueia novos envios. Cria listas dos **confirmados por dia e sala**, com presença e assinatura em branco, incluindo os integrantes das equipes. A aba `Presencas_Indice_…` reúne os links. Inscrições, respostas e histórico são preservados. O [guia de encerramento](docs/ENCERRAMENTO.md) explica a execução, as falhas parciais e os envios que já estavam em andamento.

**Atualizar a programação** aplica os nomes, ministrantes, salas, horários e capacidades finais em `Atividades` e `Programacao`, incorpora os novos Forms e atualiza títulos e descrições. A migração mantém inscrições e registra a mudança no livro oficial; recusa o lote se uma capacidade ficar abaixo da ocupação ou os novos horários causarem conflitos. Consulte o [roteiro da programação final](docs/PROGRAMACAO_FINAL.md) para aplicar a atualização existente e conferir pendências.

**Criar os Meets** reserva das **19h às 22h** no calendário principal da conta instaladora para as palestras online dos dias 26, 28 e 29/10. A função salva os links na aba `Meets` e no registro de execução, reaproveitando os eventos e ajustando seus horários em novas execuções. O [guia dos Meets](docs/MEETS.md) explica a autorização e a consulta dos links.

Se **Conferir configuração e cotas** pedir reinstalação e o instalador atingir o tempo máximo, use **Consultar somente cota de e-mail** (`consultarCotaEmails` no editor). Essa consulta só lê o MailApp, exige a conta instaladora e mostra `destinatariosRestantes` e `cotaEsgotada`, mesmo com Forms inacessíveis ou uma instalação interrompida. Não envia mensagens nem aumenta a cota. Se o erro da conferência identificar gatilhos ausentes, duplicados ou de origem incorreta, execute **Reparar somente gatilhos** (`repararGatilhos`). O reparo preserva os gatilhos de outras automações e exige os mapeamentos já instalados. Não reconfigura perguntas, respostas, opções, inscrições ou fila. Ações de instalação/limpeza ainda ativas continuam bloqueando esse reparo; aguarde sua conclusão. Se a instalação terminou por tempo máximo, o marcador expira após oito minutos contados do início dessa instalação. O instalador completo continua sendo necessário para configurar Forms novos ou corrigir suas configurações.

**Reavaliar inscrições recusadas / corrigir capacidade** recebe, por exemplo, `{"activityId":"OFICINA_IA_ALEM_CHAT","capacity":25,"reason":"Correção da capacidade e reavaliação das solicitações já enviadas."}`. A atividade individual deve estar `encerrada`. A prévia usa a última solicitação de cada CPF no livro oficial e considera somente recusas já registradas por fechamento (`closed`) ou lotação (`full`), em ordem de envio. Preserva confirmações, cancelamentos e trocas; não reutiliza uma autorização antiga para cancelar outras atividades e não aceita divergências de identidade ou respostas fora do período verificado. Respostas brutas ainda sem decisão e recusas por outros motivos não são importadas por essa ação. A prévia mostra nomes, motivos, ocupação prevista e vagas ainda livres. Após a confirmação pela organização, grava a capacidade e somente as novas confirmações elegíveis, com vínculo às recusas originais e novos avisos na fila. O Form continua encerrado. Alterações no livro ou no período verificado invalidam a prévia; após uma interrupção, prepare outra prévia para continuar sem duplicar confirmações. A operação pode deixar vagas livres se não houver candidatos elegíveis suficientes. O cadastro padrão da oficina de IA foi corrigido para 25 vagas; instalações existentes precisam aplicar a correção pelo menu.

**Começar do zero** é uma operação separada: `comecarSeminfo2026DoZero` apaga os dados operacionais, limpa as respostas dos Forms de inscrição/cancelamento e mantém as respostas do Form histórico da CSP para permitir sua importação após o reinício. Cria backups ocultos e carrega a programação novamente. Os IDs, links e perguntas dos Forms são mantidos. Consulte o [guia de reinicialização](docs/COMECAR_DO_ZERO.md) antes de usar essa função.

Cancelamentos administrativos, cadastro de atividades, consulta de ocupação e processamento manual de e-mails podem continuar durante a atualização rotineira das opções dos Forms. As decisões são gravadas sob bloqueio no livro oficial. Se as opções estiverem em atualização ou falharem depois de um cancelamento, o retorno indica `atualizacaoFormularios.adiada`; a vaga já foi liberada e a confirmação segue para processamento. A manutenção periódica ou **Atualizar opções dos Forms** sincroniza o formulário depois. Instalação, limpeza e alterações administrativas dos Forms continuam bloqueando essas operações.

A coluna **SITUACAO** de `Atividades` e **Consultar ocupação** mostram a situação atual das inscrições: `lotada` quando todas as vagas estão ocupadas, `encerrada` quando o recebimento global ou a atividade está encerrado e `aberta` quando há vagas e a abertura está autorizada. Cadastros `pendente` e `cancelada` mantêm essas situações. Uma vaga liberada volta a indicar `aberta` somente se o recebimento continuar autorizado. A CSP conta equipes, não integrantes. O cadastro oficial continua separado; `consultarOcupacao` também informa `situacaoCadastro`. Para aplicar essa correção em uma instalação existente, copie `Persistence.gs` e `Admin.gs`, salve e use **Atualizar opções dos Forms** para reconstruir a consulta.

Para corrigir falhas recorrentes de `manutencaoPeriodica` por tempo máximo, atualize `Domain.gs`, `Persistence.gs`, `Forms.gs`, `Notifications.gs` e `Admin.gs` e salve todos no Apps Script. A manutenção passa a dividir recuperação, Forms e e-mails em etapas com prazo, retoma as opções em lotes e evita trabalho simultâneo ou repetido. Execute `manutencaoPeriodica` e acompanhe as durações em **Execuções**. O [manual](docs/MANUAL.md#falhas-por-tempo-máximo-na-manutenção) explica a aplicação e a retomada na instalação existente.

## Programação do evento

| Data | Programação de referência |
|---|---|
| **26/10 · Segunda-feira** | Das 13h às 17h: credenciamento, palestra de Douglas e coffee break, no Auditório Novo. Às 19h: Troubleshooting e dados no mundo real, com Ana Carolina Brazão, via Google Meet. |
| **27/10 · Terça-feira** | GameMaker (tarde e noite), Pipeline de Dados, Blender (20 vagas), Ollama, IA Além do Chat, Introdução à linguagem C (40 vagas) e palestra ABREU às 13h30. |
| **28/10 · Quarta-feira** | Oficina Segurança da Informação e palestra online de Daniele Tavares. |
| **29/10 · Quinta-feira** | CSP das 13h às 15h30; encerramento das 15h30 às 17h; palestra online de Johnatan Alves de Oliveira às 19h30. |

Os dados de referência estão em [`data/`](data):

- [Programação e pendências](data/PROGRAMACAO_SEMINFO_2026.json).
- [Cadastros das atividades](data/ATIVIDADES_SEMINFO_2026.json).
- [Forms, nomes e vínculos](data/FORMULARIOS_SEMINFO_2026.json).
- [Novos Forms por URL pública](data/FORMULARIOS_PUBLICOS_SEMINFO_2026.json).
- [Configuração da importação de equipes CSP](data/CONFIG_IMPORTACAO_CSP_EQUIPES.json).

## Estrutura

```text
seminfo-inscricoes/
├── src/                    # Sete módulos .gs e manifesto do Apps Script
├── data/                   # Programação, atividades e configuração dos Forms
├── docs/                   # Manual, reinicialização e homologação
├── tests/                  # Testes locais com serviços Google simulados
├── scripts/
│   └── build_delivery.py   # Validação e geração do pacote
├── .gitattributes          # Padronização de arquivos de texto
├── .gitignore              # Artefatos e configurações locais fora do Git
└── README.md
```

A pasta `dist/` é criada pelo empacotamento e fica fora do versionamento.

## Testes

As quatro suítes usam **Node.js**, sem dependências externas. Execute na raiz do projeto:

```sh
node tests/domain.test.cjs
node tests/notifications.test.cjs
node tests/forms-install.test.cjs
node tests/persistence.test.cjs
```

Elas cobrem regras de inscrição, múltiplos Forms, programação, equipes, notificações, concorrência simulada, falhas de gravação e retomada da limpeza. O resultado detalhado e o roteiro de homologação estão em [docs/TESTES.md](docs/TESTES.md).

Os serviços Google são simulados nos testes locais. A publicação, as permissões, a entrega de e-mails e os gatilhos reais precisam ser conferidos na conta do evento.

### Gerar o pacote de entrega

Com **Python 3** e **Node.js** disponíveis:

```sh
python -X utf8 scripts/build_delivery.py
```

O comando valida a sintaxe, executa as suítes, atualiza os JSONs de referência e gera em `dist/` o ZIP do projeto, a entrega integral, os exemplos de cadastro e o relatório dos testes. O ZIP contém os fontes, dados, documentação e testes; a pasta `dist/` fica fora dele.

## Documentação

| Guia | Conteúdo |
|---|---|
| [Manual completo](docs/MANUAL.md) | Instalação detalhada, configuração, operação, persistência e recuperação. |
| [Começar do zero](docs/COMECAR_DO_ZERO.md) | Limpeza, backups, retomada e manutenção dos Forms. |
| [Testes e homologação](docs/TESTES.md) | Evidências locais e verificações necessárias no Google. |
| [Notificações](docs/NOTIFICACOES.md) | Conta remetente, fila de e-mails e limites operacionais. |

---

<div align="center">

**XXI SEMINFO · Centro Acadêmico Alan Turing**<br>
Organização e controle das inscrições da Semana da Informática.

</div>

Para aplicar os novos títulos nos Forms já integrados, copie `Config.gs` e `Admin.gs` atualizados para o Apps Script, salve e reabra a planilha. Use **SEMINFO → Atualizar nomes dos formulários** (ou execute `atualizarFormularios`). O título visível e o arquivo no Drive usam `PALESTRA - Nome da atividade` ou `OFICINA - Nome da atividade`, preservando respostas, inscrições, horários e vagas. Para também incorporar o Form de linguagem C à instalação, atualize os arquivos `.gs` do pacote e execute `atualizarProgramacaoSeminfo2026`.

A atualização também renomeia os arquivos dos Forms no Drive e as abas de respostas vinculadas. Copie também `src/appsscript.json` para o manifesto do projeto e autorize o acesso de edição ao Drive solicitado na próxima execução.
