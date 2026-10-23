# Atualizar a programação final — XXI SEMINFO 2026

IFSULDEMINAS — Campus Muzambinho, de 26 a 29 de outubro de 2026.

## Aplicar na instalação existente

1. No mesmo projeto Apps Script, substitua os sete arquivos `.gs` pelos de [`src/`](../src), incluindo `Config.gs`, `Domain.gs`, `Admin.gs` e `Notifications.gs`. A correção da importação CSP em `Importacao.gs` também faz parte desta entrega.
2. Execute **`atualizarProgramacaoSeminfo2026`** pela conta instaladora. Ela aplica os dados finais aos cadastros existentes, atualiza os horários das inscrições confirmadas, incorpora os novos Forms e corrige títulos, arquivos, abas e descrições. As respostas, IDs de inscrição, CPFs e integrantes são preservados. As decisões anteriores permanecem no livro para auditoria.
3. Confira `Atividades`, `Programacao` e o relatório retornado. A alteração do catálogo é registrada em uma única operação `PROGRAM_UPDATE`. Se Blender já tiver mais de 20 inscritos, ou os horários finais criarem um conflito para algum inscrito, o lote é recusado antes de gravar qualquer alteração do catálogo. A organização precisa resolver essa divergência antes de repetir.
4. Para abrir os novos Forms, execute **Configurar e-mail verificado nos Forms**, confira as pendências e use **Abrir inscrições**. A integração preserva as perguntas e respostas existentes.

Os títulos visíveis e os nomes dos arquivos no Drive seguem **PALESTRA - Nome da atividade** e **OFICINA - Nome da atividade**. Exemplos: `PALESTRA - Computação Quântica: Entendendo o contexto para inovar no futuro` e `OFICINA - Introdução à linguagem C`. Abertura e competição mantêm seus títulos próprios. Para reaplicar somente os nomes nos Forms já integrados, use **SEMINFO → Atualizar nomes dos formulários** ou `atualizarFormularios`.

Salvar um JSON em **Cadastrar / atualizar atividade** atualiza o cadastro e as opções; esse caminho não renomeia o arquivo no Drive. Para renomear o título e o arquivo, execute `atualizarFormularios` pela conta instaladora após salvar `Admin.gs` atualizado. Essa função atua somente nas atividades com Forms de inscrição vinculados e exclui a CSP; conserva horários, capacidades e inscrições existentes.

`carregarProgramacaoSeminfo2026` continua sendo a função que somente acrescenta cadastros ausentes. Para atualizar os valores existentes, use `atualizarProgramacaoSeminfo2026`.

## Alterações aplicadas

| Atividade | Programação final |
|---|---|
| Abertura | 26/10, 13h–17h, Auditório Novo; credenciamento, palestra de Douglas e coffee break |
| Palestra da tarde de segunda | “Inteligência Artificial e Inovação: muito além de um prompt e um conjunto de dados”, Prof. Dr. Douglas Donizeti de Castilho Braz |
| Segunda à noite | “Troubleshooting e dados no mundo real”, Ana Carolina Brazão, 19h, via Google Meet |
| GameMaker | Ricardo José Martins; Sala 14; 30 vagas por turma; 27/10, 13h–17h e 19h–23h |
| Pipeline de Dados | Tiago Fernandes Moraes; Sala 16; 30 vagas; 27/10, 13h–17h |
| Blender | Caio Henrique Magalhães; Sala 15; **20 vagas**; 27/10, 13h–17h |
| Ollama | Gabriel Madeira; Sala 5 — Redes; 15 vagas; 27/10, 13h–17h |
| IA Além do Chat | Título completo com Gemini; Rafaela Alves Magalhães e Felipe Antony Baquião Avelar; Sala 13; 30 vagas; 27/10, 13h–17h |
| Introdução à linguagem C | Matheus Matias dos Santos, Matheus Henrique Dias e Felipe Augusto de Melo Lozano; Cesário Coimbra — Sala 09; **40 vagas**, conforme correção posterior da organização; 27/10, **13h–17h** |
| Palestra ABREU | 27/10, 13h30, Auditório H |
| Segurança da Informação | Rafaela Alves Magalhães e Nycollas Icrad Luz Machado; Sala 15; 30 vagas; 28/10, 13h–17h |
| Computação Quântica | Daniele Nazaré Tavares; 28/10, 19h30, Google Meet |
| CSP | 29/10, **13h–15h30**, Prédio da Informática; mantida a capacidade anterior de 60 equipes |
| Encerramento | 29/10, **15h30–17h**, Auditório H |
| Palestra de Johnatan | Prof. Dr. Johnatan Alves de Oliveira; 29/10, 19h30, Google Meet |

Os horários individuais do credenciamento, da palestra de Douglas e do coffee break não foram informados dentro do bloco de segunda-feira. Os horários provisórios anteriores desses itens foram removidos. A homenagem foi retirada da programação; um cadastro histórico dela permanece fechado.

Os IDs `PALESTRA_RENATO`, `OFICINA_YASMIN_GABRIEL` e `NOITE_26` são mantidos para conservar o histórico. Os títulos visíveis passam a corresponder à programação final. Atividades encerradas, canceladas ou excluídas administrativamente continuam fechadas. Repetir a atualização não duplica inscrições nem a operação de catálogo.

## Novos Forms e pendências

Os links [Troubleshooting](https://forms.gle/1DgMW8A67AYL9XGd7) e [Pipeline de Dados](https://forms.gle/cqNfxjiGQfii2BjQ8) foram incluídos em `FORMULARIOS_PUBLICOS_SEMINFO_JSON`. A preparação procura o Form acessível pela conta instaladora e confere sua URL publicada antes de salvar o ID de edição. O ID público `1FAIpQL...` não é tratado como ID de edição. Se o Form não for localizado, a mensagem informa o `activityId` para cadastrar seu ID de edição manualmente em `FORMULARIOS_INSCRICAO_JSON`. A busca usa os métodos oficiais [FormApp.openByUrl](https://developers.google.com/apps-script/reference/forms/form-app#openByUrl(String)) e [DriveApp.getFilesByName](https://developers.google.com/apps-script/reference/drive/drive-app#getFilesByName(String)).

O [Form existente de linguagem C](https://docs.google.com/forms/d/1tgltFxUPnZ6yuXuYi6TCE3aoms4Cu_CkCLRl-r-wHv8/edit) foi incluído em `FORMULARIOS_INSCRICAO_JSON`, vinculado a `OFICINA_C`, com título `OFICINA - Introdução à linguagem C`, 40 vagas e horário das 13h às 17h. A preparação mantém as perguntas originais e a instalação identifica nome e CPF pelos títulos; se houver ambiguidade, use o inventário para informar os IDs em `items`.

Ainda faltam término/capacidade das palestras e a capacidade da abertura. Os campos desconhecidos permanecem pendentes; a atualização aproveita capacidades já preenchidas e términos cadastrados no mesmo dia quando não há substitutos na programação final. Na palestra de Ana, prevalece o início **19h** enviado na programação final; o texto público antigo do Form indicava 19h30 e será corrigido ao executar a atualização.

Os testes locais simulam os serviços Google. A alteração na conta e a conferência das permissões dos Forms precisam ser realizadas na instalação Google.
