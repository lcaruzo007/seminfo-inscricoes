/**
 * Importação administrativa de respostas antigas da CSP conferidas pela organização.
 * Formatos individual e por equipe. Equipes sem e-mail conservam essa ausência.
 * Os gatilhos automáticos continuam exigindo a coleta nativa e a data de corte.
 */
function getCspImportSource_() {
  var source;
  try { source = JSON.parse(String(getConfig_().IMPORTACAO_CSP_JSON || '{}')); }
  catch (_) { throw new Error('IMPORTACAO_CSP_JSON deve ser um objeto JSON válido.'); }
  if (!source || !/^[A-Za-z0-9_-]+$/.test(String(source.formId || '')) ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(String(source.activityId || ''))) {
    throw new Error('Configure formId e activityId em IMPORTACAO_CSP_JSON.');
  }
  source.schema = source.schema || (source.formId === '1oXixuiIIJ1sGVdTgs0uEQVSEaqxEO5NqupTi-4xv2ww' ? 'equipes' : 'individual');
  if (['individual', 'equipes'].indexOf(source.schema) < 0) throw new Error('schema deve ser individual ou equipes.');
  if (source.backupSheetName !== undefined &&
      (typeof source.backupSheetName !== 'string' || !source.backupSheetName.trim() || source.backupSheetName.length > 100)) {
    throw new Error('backupSheetName deve ser o nome de uma aba de backup com até 100 caracteres.');
  }
  if (source.backupTeamSheetName !== undefined &&
      (typeof source.backupTeamSheetName !== 'string' || !source.backupTeamSheetName.trim() || source.backupTeamSheetName.length > 100)) {
    throw new Error('backupTeamSheetName deve ser o nome da aba de backup Equipes com até 100 caracteres.');
  }
  if (source.includeLiveResponses !== undefined && typeof source.includeLiveResponses !== 'boolean') throw new Error('includeLiveResponses deve ser true ou false.');
  source.items = source.items || {};
  if (typeof source.items !== 'object' || Array.isArray(source.items)) throw new Error('items deve conter os IDs das perguntas.');
  var allowed = source.schema === 'equipes' ? ['TEAM_TYPE', 'TEAM_NAME', 'TEAM_SIZE', 'MEMBER1', 'MEMBER2', 'MEMBER3'] : ['NAME', 'CPF', 'EMAIL'];
  if (Object.keys(source.items).some(function (key) { return allowed.indexOf(key) < 0; })) throw new Error('Mapeamento incompatível com o formato ' + source.schema + '. Use: ' + allowed.join(', ') + '.');
  if (source.schema === 'equipes' && source.formId === '1oXixuiIIJ1sGVdTgs0uEQVSEaqxEO5NqupTi-4xv2ww') {
    source.items = Object.assign({TEAM_TYPE: 742351656, TEAM_NAME: 396811097, TEAM_SIZE: 1358170985, MEMBER1: 98572697, MEMBER2: 1537440165, MEMBER3: 1869818828}, source.items);
  }
  return source;
}

/** Recupera equipes pelo detalhe dos integrantes e, opcionalmente, pelos metadados da aba Equipes. */
function cspRequestsFromMemberBackup_(source, rows, recoveredAt, teamRows) {
  var headers = SEMINFO_TABLES.IntegrantesEquipes;
  if (!rows.length || JSON.stringify(rows[0].map(String)) !== JSON.stringify(headers)) {
    throw new Error('Backup de integrantes CSP com cabeçalho incompatível. Esperado: ' + headers.join(', ') + '.');
  }
  if (!isFinite(Date.parse(recoveredAt))) throw new Error('Data da recuperação inválida.');
  var teamsById = {};
  if (teamRows) {
    var teamHeaders = SEMINFO_TABLES.Equipes;
    if (!teamRows.length || JSON.stringify(teamRows[0].map(String)) !== JSON.stringify(teamHeaders)) {
      throw new Error('Backup de Equipes com cabeçalho incompatível. Esperado: ' + teamHeaders.join(', ') + '.');
    }
    teamRows.slice(1).forEach(function(row, index) {
      if (!row.some(function(value) { return value !== '' && value !== null; })) return;
      if (row.length !== teamHeaders.length) throw new Error('Backup de Equipes com número de colunas inválido na linha ' + (index + 2) + '.');
      row = row.map(function(value) { return value === null || value === undefined ? '' : String(value).trim(); });
      if (!/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:equipe$/.test(row[0]) || row[0].indexOf(source.formId + ':') !== 0) {
        throw new Error('ID de equipe incompatível com o Form CSP na linha ' + (index + 2) + '.');
      }
      if (row[1] !== source.activityId) throw new Error('Atividade incompatível na linha ' + (index + 2) + ' da aba Equipes.');
      if (row[6].toLowerCase() !== 'confirmada') throw new Error('A equipe ' + row[0] + ' não está confirmada na versão histórica; confira a situação antes de recuperar.');
      if (!isFinite(Date.parse(row[7]))) throw new Error('Data CRIADA_EM inválida na linha ' + (index + 2) + ' da aba Equipes.');
      if (!/^\d+$/.test(row[5]) || Number(row[5]) < 1) throw new Error('QTD_INTEGRANTES inválida na linha ' + (index + 2) + ' da aba Equipes.');
      if (teamsById[row[0]]) throw new Error('ID de equipe repetido na aba Equipes: ' + row[0] + '.');
      teamsById[row[0]] = {id: row[0], activityId: row[1], teamName: row[2], teamType: row[3],
        coachCpf: row[4], declaredSize: Number(row[5]), status: row[6].toLowerCase(), createdAt: new Date(row[7]).toISOString()};
    });
  }
  var groups = {}, order = [];
  rows.slice(1).forEach(function (row, index) {
    if (!row.some(function (value) { return value !== '' && value !== null; })) return;
    if (row.length !== headers.length) throw new Error('Backup de integrantes com número de colunas inválido na linha ' + (index + 2) + '.');
    row = row.map(function (value) { return value === null || value === undefined ? '' : String(value); });
    var id = row[0].trim(), prefix = source.formId + ':';
    if (id.indexOf(prefix) !== 0 || !/:equipe$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(id.slice(prefix.length, -7))) {
      throw new Error('EQUIPE_ID incompatível com o Form CSP na linha ' + (index + 2) + '.');
    }
    if (!groups[id]) { groups[id] = {id: id, name: row[1].trim(), members: [], errors: []}; order.push(id); }
    var group = groups[id], role = row[4].trim().toLowerCase(), cpf = row[2].trim();
    if (group.name !== row[1].trim()) throw new Error('Nomes de equipe divergentes para o mesmo EQUIPE_ID na linha ' + (index + 2) + '.');
    if (role !== 'coach' && role !== 'integrante') group.errors.push('Papel inválido na linha ' + (index + 2) + '.');
    try { cpf = SemDomain.normalizeCpf(cpf); }
    catch (_) { group.errors.push('CPF inválido na linha ' + (index + 2) + '; preserve os zeros iniciais.'); }
    group.members.push({cpf: cpf, name: row[3].trim(), role: role, turma: row[5], telefone: row[6], raw: row[7]});
  });
  var requests = order.map(function (id) {
    var group = groups[id], key = id.slice(0, -7);
    var summary = teamsById[id];
    if (teamRows && !summary) throw new Error('Equipe sem linha correspondente na aba Equipes: ' + id + '.');
    if (summary) {
      if (summary.teamName !== group.name) throw new Error('Nome divergente entre Equipes e IntegrantesEquipes para ' + id + '.');
      if (summary.declaredSize !== group.members.length) throw new Error('QTD_INTEGRANTES divergente dos membros para ' + id + '.');
      if (summary.coachCpf) {
        var summaryCoachCpf;
        try { summaryCoachCpf = SemDomain.normalizeCpf(summary.coachCpf); }
        catch (_) { throw new Error('COACH_CPF inválido na aba Equipes para ' + id + '.'); }
        if (summaryCoachCpf !== group.members.filter(function(member) { return member.role === 'coach'; })[0].cpf) {
          throw new Error('COACH_CPF divergente dos integrantes para ' + id + '.');
        }
      }
    }
    if (teamsById[id]) delete teamsById[id];
    if (group.members.filter(function (member) { return member.role === 'coach'; }).length !== 1) group.errors.push('A equipe precisa ter exatamente um coach.');
    group.members.sort(function (a, b) { return Number(b.role === 'coach') - Number(a.role === 'coach'); });
    var submittedAt = summary ? summary.createdAt : recoveredAt;
    return {key: key, kind: 'INSCRICAO_EQUIPE', cpf: group.members[0].cpf, name: group.name, email: '',
      activityId: source.activityId, teamName: group.name, teamType: summary ? summary.teamType : '', members: group.members,
      declaredSize: summary ? summary.declaredSize : null,
      rawMembers: group.members.map(function (member) { return member.raw; }), invalidAnswer: group.errors.length > 0,
      importErrors: group.errors, protocol: protocol_(key), submittedAt: submittedAt, recoveredAt: recoveredAt,
      originalSubmittedAt: summary ? summary.createdAt : null, originalStatus: summary ? summary.status : null,
      backupSheetName: source.backupSheetName || '', backupTeamSheetName: source.backupTeamSheetName || '',
      formId: source.formId, responseId: key.slice(source.formId.length + 1),
      identitySource: summary ? 'RECUPERACAO_ADMINISTRATIVA_BACKUP_COMPLETO' : 'RECUPERACAO_ADMINISTRATIVA_BACKUP_INTEGRANTES'};
  });
  if (teamRows && Object.keys(teamsById).length) throw new Error('Há equipes sem integrantes correspondentes na aba IntegrantesEquipes.');
  return {requests: requests, items: {}, signature: hash_(JSON.stringify(requests)), missingOriginalMetadata: !teamRows};
}

function readCspMemberBackup_(source, until) {
  if (!source.backupSheetName) return null;
  var sheet = db_().getSheetByName(source.backupSheetName);
  if (!sheet) throw new Error('Aba de backup CSP não encontrada: ' + source.backupSheetName + '.');
  var rows = sheet.getDataRange().getDisplayValues();
  if (!rows.length || rows[0][0] !== 'EQUIPE_ID') return null;
  var teamRows = null;
  if (source.backupTeamSheetName) {
    var teamSheet = db_().getSheetByName(source.backupTeamSheetName);
    if (!teamSheet) throw new Error('Aba de backup Equipes não encontrada: ' + source.backupTeamSheetName + '.');
    teamRows = teamSheet.getDataRange().getDisplayValues();
  }
  return cspRequestsFromMemberBackup_(source, rows, until, teamRows);
}

/** Cria uma fonte privada imutável; inscrições só entram após conferir a prévia. */
function prepararRecuperacaoEquipesCsp(rows, teamRows) {
  requireInstaller_();
  if (!Array.isArray(rows) || rows.some(function (row) { return !Array.isArray(row); })) throw new Error('Informe as linhas do backup de integrantes CSP.');
  if (teamRows !== undefined && (!Array.isArray(teamRows) || teamRows.some(function(row) { return !Array.isArray(row); }))) {
    throw new Error('Informe as linhas da aba Equipes como uma matriz de valores.');
  }
  var source = getCspImportSource_();
  if (source.schema !== 'equipes') throw new Error('A recuperação de integrantes exige schema equipes em IMPORTACAO_CSP_JSON.');
  cspRequestsFromMemberBackup_(source, rows, new Date().toISOString(), teamRows);
  var hash = hash_(JSON.stringify({members: rows, teams: teamRows || null})).slice(0, 12);
  var name = 'Backup_CSP_Salvo_' + hash;
  var teamName = teamRows ? name + '_Equipes' : '';
  withLock_(function () {
    var existing = db_().getSheetByName(name);
    if (existing) {
      var saved = existing.getDataRange().getDisplayValues();
      if (saved.length !== rows.length || rows.some(function (row, i) {
        return saved[i].length !== row.length || row.some(function (value, j) { return saved[i][j] !== String(value) && saved[i][j] !== safeCell_(String(value)); });
      })) throw new Error('O backup salvo já existe com conteúdo diferente; nenhuma linha foi sobrescrita.');
    } else writeTable_(name, SEMINFO_TABLES.IntegrantesEquipes, rows.slice(1));
    protectResetBackup_(db_().getSheetByName(name));
    if (teamRows) {
      var existingTeams = db_().getSheetByName(teamName);
      if (existingTeams) {
        var savedTeams = existingTeams.getDataRange().getDisplayValues();
        if (savedTeams.length !== teamRows.length || teamRows.some(function(row, i) {
          return savedTeams[i].length !== row.length || row.some(function(value, j) {
            return savedTeams[i][j] !== String(value) && savedTeams[i][j] !== safeCell_(String(value));
          });
        })) throw new Error('O backup salvo de Equipes já existe com conteúdo diferente; nenhuma linha foi sobrescrita.');
      } else writeTable_(teamName, SEMINFO_TABLES.Equipes, teamRows.slice(1));
      protectResetBackup_(db_().getSheetByName(teamName));
    }
    setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify(Object.assign({}, source, {
      backupSheetName: name, backupTeamSheetName: teamRows ? teamName : undefined, includeLiveResponses: true
    })));
  });
  var report = prepararImportacaoCsp();
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/** Completa o Forms com linhas que sobreviveram somente na aba nativa. */
function getCspImportResponses_(source, form, itemIds) {
  var responses = getCspStoredImportResponses_(source, form, itemIds);
  if (source.schema !== 'equipes') return responses;
  var config = getConfig_(), books = [db_()];
  var destination = formDestinationId_(form);
  if (destination && destination !== books[0].getId()) books.push(SpreadsheetApp.openById(destination));
  if (config.CSP_RESPONSE_SHEET_ID && config.CSP_RESPONSE_SPREADSHEET_ID && !books.some(function (book) { return book.getId() === config.CSP_RESPONSE_SPREADSHEET_ID; })) {
    books.push(SpreadsheetApp.openById(String(config.CSP_RESPONSE_SPREADSHEET_ID)));
  }
  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function identity(date, name) { return Math.floor(date.getTime() / 1000) + ':' + normalized(name); }
  var known = {};
  responses.forEach(function (response) {
    var name = '';
    response.getItemResponses().forEach(function (answer) {
      if (String(answer.getItem().getId()) === String(itemIds.TEAM_NAME)) name = answer.getResponse();
    });
    known[identity(response.getTimestamp(), name)] = true;
  });
  books.forEach(function (book) { book.getSheets().forEach(function (sheet) {
    if (!responseSheetMatchesForm_(sheet, form)) return;
    var rows = sheet.getDataRange().getValues();
    if (!rows.length) return;
    var headers = rows[0].map(normalized), columns = {};
    var patterns = {TEAM_NAME: /^nome da equipe$/, TEAM_TYPE: /^sua equipe e$/, TEAM_SIZE: /^quantos integrantes/,
      MEMBER1: /^(coach )?nome do integrante 1/, MEMBER2: /^(se houver )?nome do integrante 2/, MEMBER3: /^(se houver )?nome do integrante 3/};
    Object.keys(patterns).forEach(function (key) {
      var matches = headers.map(function (header, index) { return patterns[key].test(header) ? index : -1; }).filter(function (index) { return index >= 0; });
      if (matches.length === 1) columns[key] = matches[0];
    });
    if (columns.TEAM_NAME === undefined) return;
    rows.slice(1).forEach(function (row, index) {
      if (!row.some(function (value) { return value !== '' && value !== null; })) return;
      var name = String(row[columns.TEAM_NAME] || '').trim();
      var timestamp = row[0];
      if (Object.prototype.toString.call(timestamp) !== '[object Date]') {
        var dateText = String(timestamp || '').trim();
        timestamp = /^\d{2}\/\d{2}\/\d{4} /.test(dateText) ? Utilities.parseDate(dateText, config.FUSO, 'dd/MM/yyyy HH:mm:ss') : new Date(dateText);
      }
      if (!isFinite(timestamp.getTime())) throw new Error('Data invalida na aba ' + sheet.getName() + ', linha ' + (index + 2) + '.');
      var fingerprint = identity(timestamp, name);
      if (known[fingerprint]) return;
      known[fingerprint] = true;
      var responseId = 'SHEET_' + hash_(source.formId + ':' + fingerprint).slice(0, 32);
      responses.push({getId: function () { return responseId; }, getTimestamp: function () { return timestamp; },
        getItemResponses: function () {
          return Object.keys(columns).map(function (key) {
            return {getItem: function () { return form.getItemById(Number(itemIds[key])); },
              getResponse: function () { return String(row[columns[key]] || ''); }};
          });
        }});
    });
  }); });
  return responses;
}

function getCspStoredImportResponses_(source, form, itemIds) {
  if (!source.backupSheetName) return form.getResponses();
  var sheet = db_().getSheetByName(source.backupSheetName);
  if (!sheet) throw new Error('Aba de backup CSP não encontrada: ' + source.backupSheetName + '.');
  var rows = sheet.getDataRange().getValues();
  var headers = ['FORM_ID', 'RESPOSTA_ID', 'DATA', 'EMAIL', 'PERGUNTA_ID', 'PERGUNTA', 'RESPOSTA_JSON'];
  if (!rows.length || JSON.stringify(rows[0].map(String)) !== JSON.stringify(headers)) {
    throw new Error('Aba de backup CSP com cabeçalho incompatível. Esperado: ' + headers.join(', ') + '.');
  }
  var responseById = {}, mappedItems = {};
  Object.keys(itemIds).forEach(function (key) { mappedItems[String(itemIds[key])] = true; });
  rows.slice(1).forEach(function (row, index) {
    if (!row.some(function (value) { return value !== '' && value !== null; })) return;
    var formId = String(row[0] || ''), responseId = String(row[1] || ''), itemId = String(row[4] || '');
    if (formId !== source.formId) throw new Error('Aba de backup CSP contém um FORM_ID diferente na linha ' + (index + 2) + '.');
    if (!responseId) throw new Error('Resposta sem ID na aba de backup CSP, linha ' + (index + 2) + '.');
    var timestamp = new Date(row[2]);
    if (!isFinite(timestamp.getTime())) throw new Error('Data inválida na aba de backup CSP, linha ' + (index + 2) + '.');
    var response = responseById[responseId];
    if (!response) {
      response = responseById[responseId] = {id: responseId, timestamp: timestamp, answers: {}};
    } else if (response.timestamp.getTime() !== timestamp.getTime()) {
      throw new Error('Resposta com datas divergentes na aba de backup CSP: ' + responseId + '.');
    }
    if (!mappedItems[itemId]) return;
    if (Object.prototype.hasOwnProperty.call(response.answers, itemId)) {
      throw new Error('Resposta duplicada para a pergunta ' + itemId + ' na aba de backup CSP.');
    }
    try { response.answers[itemId] = JSON.parse(String(row[6])); }
    catch (_) { throw new Error('RESPOSTA_JSON inválido na linha ' + (index + 2) + ' da aba de backup CSP.'); }
  });
  return Object.keys(responseById).map(function (responseId) {
    var record = responseById[responseId];
    return {
      getId: function () { return record.id; },
      getTimestamp: function () { return record.timestamp; },
      getItemResponses: function () {
        return Object.keys(record.answers).map(function (itemId) {
          var item = form.getItemById(Number(itemId));
          if (!item) throw new Error('Pergunta ' + itemId + ' ausente no Form CSP associado ao backup.');
          return {getItem: function () { return item; }, getResponse: function () { return record.answers[itemId]; }};
        });
      }
    };
  });
}

function cspTeamUnitOperation_(state, source) {
  if (source.schema !== 'equipes' || state.activities[source.activityId].capacityUnit === 'equipes') return null;
  if (SemDomain.occupancy(state, source.activityId)) throw new Error('A atividade já possui inscrições individuais. Confira a migração antes de mudar para equipes.');
  return {key: 'ADMIN:CSP:UNIDADE:' + Utilities.getUuid(), kind: 'CATALOG', at: new Date().toISOString(),
    activity: Object.assign({}, state.activities[source.activityId], {capacityUnit: 'equipes'}), reason: 'Capacidade da CSP contada por equipe, conforme organização.'};
}

function assertCspImportDestination_(state, source) {
  if (!state.activities[source.activityId]) throw new Error('Cadastre a atividade ' + source.activityId + ' antes de preparar a importação.');
  if (state.activities[source.activityId].status === 'pendente') throw new Error('Complete os dados e a capacidade da atividade ' + source.activityId + ' antes de preparar a importação.');
  var linked = getFormSources_().filter(function (entry) { return entry.id === source.formId; })[0];
  if (linked && (linked.kind !== 'INSCRICAO' || linked.activityId && linked.activityId !== source.activityId)) {
    throw new Error('O Form já está associado a outra atividade ou ao cancelamento. Preserve a associação existente.');
  }
}

function listarPerguntasImportacaoCsp() {
  requireInstaller_();
  var source = getCspImportSource_(), form = openFormWithDriveRetry_(source.formId);
  var report = {formId: source.formId, activityId: source.activityId, title: form.getTitle(),
    items: form.getItems().map(function (item) { return {id: item.getId(), title: item.getTitle(), type: String(item.getType())}; })};
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function resolveCspImportItems_(source, form) {
  var result = {}, used = {};
  ['NAME', 'CPF', 'EMAIL'].forEach(function (key) {
    var explicit = source.items[key], item;
    if (explicit !== undefined) {
      if (!Number.isInteger(Number(explicit)) || Number(explicit) < 1) throw new Error('ID inválido para ' + key + ' em IMPORTACAO_CSP_JSON.');
      item = form.getItemById(Number(explicit));
    } else {
      var patterns = {
        NAME: /^(nome|nome completo|nome (completo )?d[oa] (participante|aluno|estudante))$/,
        CPF: /^(cpf|seu cpf|cpf xxx xxx xxx xx)$/,
        EMAIL: /^(e mail|email|seu e mail|seu email|e mail institucional|email institucional|endereco de e mail|endereco de email)$/
      };
      var matches = form.getItems().filter(function (candidate) {
        var title = String(candidate.getTitle()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ').trim();
        return patterns[key].test(title);
      });
      if (matches.length !== 1) throw new Error('Não foi possível identificar uma única pergunta ' + key + '. Execute listarPerguntasImportacaoCsp e informe os IDs em IMPORTACAO_CSP_JSON.items.');
      item = matches[0];
    }
    if (!item || ['TEXT', 'PARAGRAPH_TEXT'].indexOf(String(item.getType())) < 0 || used[item.getId()]) {
      throw new Error('Pergunta ' + key + ' ausente, repetida ou incompatível. A importação exige perguntas individuais de nome, CPF e e-mail.');
    }
    used[item.getId()] = true;
    result[key] = item.getId();
  });
  return result;
}

function parseCspTeamMember_(raw, number) {
  raw = String(raw || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/&#x20;|&nbsp;/gi, ' ').trim();
  if (!raw || /^(nao|não|nenhum|não há|nao ha|n\/a|-)$/i.test(raw)) {
    if (number === 1) throw new Error('Integrante 1 (coach) não informado.');
    return null;
  }
  var labeled = /cpf\s*[:=-]?\s*(\d{3}\.\d{3}\.\d{3}\s*[-.]\s*\d{2}|\d{9,14})\b/i.exec(raw);
  var candidates = [];
  if (labeled) candidates = [{value: labeled[1], index: labeled.index + labeled[0].indexOf(labeled[1])}];
  else {
    var regex = /(?<!\d)\d{3}\.\d{3}\.\d{3}\s*[-.]\s*\d{2}\b/g, match;
    while ((match = regex.exec(raw))) candidates.push({value: match[0], index: match.index});
    if (!candidates.length) {
      regex = /(?<!\d)\d{11}(?!\d)/g;
      while ((match = regex.exec(raw))) candidates.push({value: match[0], index: match.index});
    }
  }
  var valid = candidates.filter(function (candidate) {
    try { candidate.cpf = SemDomain.normalizeCpf(candidate.value); return true; } catch (_) { return false; }
  });
  if (valid.length !== 1) throw new Error('Integrante ' + number + ': CPF inválido, ausente ou ambíguo. Confira o texto original; o CPF precisa ter 11 dígitos válidos.');
  var candidate = valid[0];
  var named = /(?:^|[\n;,])\s*nome(?: completo)?\s*[:=]\s*([^\n;,]+)/i.exec(raw);
  var prefix = raw.slice(0, candidate.index).replace(/\bcpf\s*[:=-]?\s*$/i, '').replace(/[\s:;,\-]+$/, '').trim();
  var name = named ? named[1].split(/\s+-\s+/)[0].trim() : prefix.replace(/^(?:\(coach\)|coach\s*[:=-])\s*/i, '').replace(/^nome(?: completo)?\s*[:=-]\s*/i, '').split(/[\n;,]/)[0].trim();
  if (!name || name.length > 200 || /\b\d{9,}\b/.test(name)) throw new Error('Integrante ' + number + ': não foi possível separar o nome do CPF. Confira o texto original.');
  var course = /turma\s*[:=]\s*([^\n;,]+)/i.exec(raw), phone = /(?:telefone|tel|celular)\s*[:=]\s*([^\n;,]+)/i.exec(raw);
  return {name: name, cpf: candidate.cpf, turma: course ? course[1].trim() : '', telefone: phone ? phone[1].trim() : '', raw: raw.slice(0, 6000)};
}

function readCspTeamRequests_(source, until) {
  var backup = readCspMemberBackup_(source, until);
  if (backup) {
    if (source.includeLiveResponses === true) {
      var liveSource = Object.assign({}, source), known = {};
      delete liveSource.backupSheetName;
      backup.requests.forEach(function (request) { known[request.key] = true; });
      var live = readCspTeamRequests_(liveSource, until);
      // A cópia recuperada mantém seus dados; novas respostas entram depois dela.
      backup.requests = backup.requests.concat(live.requests.filter(function (request) { return !known[request.key]; }));
      backup.items = live.items;
      backup.signature = hash_(JSON.stringify(backup.requests));
    }
    return backup;
  }
  var form = openFormWithDriveRetry_(source.formId), items = {}, used = {};
  ['TEAM_NAME', 'TEAM_TYPE', 'TEAM_SIZE', 'MEMBER1', 'MEMBER2', 'MEMBER3'].forEach(function (key) {
    var itemId = Number(source.items[key]), item = Number.isInteger(itemId) && itemId > 0 ? form.getItemById(itemId) : null;
    var types = key === 'TEAM_SIZE' || key === 'TEAM_TYPE' ? ['MULTIPLE_CHOICE', 'LIST', 'TEXT'] : ['TEXT', 'PARAGRAPH_TEXT'];
    if (!item || types.indexOf(String(item.getType())) < 0 || used[itemId]) throw new Error('Pergunta de equipes ' + key + ' ausente ou incompatível. Confira os IDs em IMPORTACAO_CSP_JSON.');
    used[itemId] = true; items[key] = itemId;
  });
  var limit = new Date(until).getTime();
  if (!isFinite(limit)) throw new Error('Data da prévia inválida.');
  var requests = getCspImportResponses_(source, form, items).filter(function (response) { return response.getTimestamp() && response.getTimestamp().getTime() <= limit; }).map(function (response) {
    var responseId = response.getId();
    if (!responseId) throw new Error('Resposta histórica sem identificador.');
    var answers = {};
    response.getItemResponses().forEach(function (answer) { answers[String(answer.getItem().getId())] = String(answer.getResponse() || '').trim(); });
    function value(key) { return answers[String(items[key])] || ''; }
    var key = source.formId + ':' + responseId, rawMembers = [value('MEMBER1'), value('MEMBER2'), value('MEMBER3')];
    var members = [], errors = [];
    var override = source.overrides && Object.prototype.hasOwnProperty.call(source.overrides, responseId) ? source.overrides[responseId] : null;
    if (override && Array.isArray(override.members)) {
      override.members.forEach(function (member, index) {
        try { members.push({name: String(member.name || '').trim(), cpf: SemDomain.normalizeCpf(String(member.cpf || '')),
          turma: String(member.turma || ''), telefone: String(member.telefone || ''), raw: rawMembers[index] || ''}); }
        catch (_) { errors.push('Integrante ' + (index + 1) + ': CPF inválido na correção administrativa.'); }
      });
    } else rawMembers.forEach(function (raw, index) {
      try { var member = parseCspTeamMember_(raw, index + 1); if (member) members.push(member); }
      catch (error) { errors.push(String(error.message || error)); }
    });
    var declared = /\b([123])\b/.exec(value('TEAM_SIZE'));
    var declaredSize = declared ? Number(declared[1]) : ({um: 1, dois: 2, 'três': 3, tres: 3})[value('TEAM_SIZE').toLowerCase()] || null;
    if (value('TEAM_SIZE') && !declaredSize) errors.push('Quantidade de integrantes não reconhecida.');
    var teamName = override && override.teamName || value('TEAM_NAME');
    return {key: key, kind: 'INSCRICAO_EQUIPE', cpf: members[0] && members[0].cpf || '', name: teamName.slice(0, 200), email: '',
      activityId: source.activityId, teamName: teamName.slice(0, 200), teamType: value('TEAM_TYPE').slice(0, 200),
      members: members, declaredSize: declaredSize, rawMembers: rawMembers.map(function (raw) { return raw.slice(0, 6000); }),
      invalidAnswer: errors.length > 0 || teamName.length > 200, importErrors: errors,
      protocol: protocol_(key), submittedAt: response.getTimestamp().toISOString(), formId: source.formId, responseId: responseId,
      identitySource: 'REVISAO_ADMINISTRATIVA_EQUIPE_SEM_EMAIL'};
  });
  requests.sort(function (a, b) { return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime() || a.key.localeCompare(b.key); });
  return {requests: requests, items: items, signature: hash_(JSON.stringify(requests))};
}

function readCspImportRequests_(source, until) {
  if (source.schema === 'equipes') return readCspTeamRequests_(source, until);
  var form = openFormWithDriveRetry_(source.formId), items = resolveCspImportItems_(source, form);
  var limit = new Date(until).getTime();
  if (!isFinite(limit)) throw new Error('Data da prévia inválida.');
  var requests = getCspImportResponses_(source, form, items).filter(function (response) {
    return response.getTimestamp() && response.getTimestamp().getTime() <= limit;
  }).map(function (response) {
    if (!response.getId()) throw new Error('Resposta histórica sem identificador.');
    var answers = {};
    response.getItemResponses().forEach(function (answer) { answers[String(answer.getItem().getId())] = String(answer.getResponse() || '').trim(); });
    var name = answers[String(items.NAME)] || '', cpf = answers[String(items.CPF)] || '', email = answers[String(items.EMAIL)] || '';
    var key = source.formId + ':' + response.getId();
    return {key: key, kind: 'INSCRICAO', cpf: cpf.slice(0, 64), name: name.slice(0, 200), email: email.length > 254 ? '' : email, activityId: source.activityId,
      authorizeSwap: false, confirmCancel: false,
      invalidAnswer: name.length > 200 || cpf.length > 64 || email.length > 254,
      protocol: protocol_(key), submittedAt: response.getTimestamp().toISOString(),
      formId: source.formId, responseId: response.getId(), identitySource: 'REVISAO_ADMINISTRATIVA_EMAIL_INFORMADO'};
  });
  requests.sort(function (a, b) { return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime() || a.key.localeCompare(b.key); });
  return {requests: requests, items: items, signature: hash_(JSON.stringify(requests))};
}

function cspImportOutcome_(state, request) {
  // Permite a migração com a recepção geral fechada, sem reabrir nenhum Form.
  var decisionState = Object.assign({}, state, {accepting: true});
  var outcome = enrichOutcome_(state, request, request.kind === 'INSCRICAO_EQUIPE' ? SemDomain.decideTeam(decisionState, request) : SemDomain.decide(decisionState, request));
  if (request.kind === 'INSCRICAO_EQUIPE' && outcome.code === 'invalid' && !/CPF repetido/.test(outcome.message)) {
    var activity = state.activities[request.activityId];
    if (activity && activity.capacityUnit === 'equipes' && activity.status === 'aberta' &&
        SemDomain.occupancy(state, request.activityId) < activity.capacity) {
      var members = request.recoveredAt ? request.members.map(function (member) {
        var saved = Object.assign({}, member);
        try { saved.cpf = SemDomain.normalizeCpf(saved.cpf); } catch (_) { saved.cpf = ''; }
        return saved;
      }) : request.rawMembers.map(function (raw, index) {
        if (!raw.trim()) return null;
        try { return parseCspTeamMember_(raw, index + 1); }
        catch (_) { return {name: raw.split(/[\n,;\d]/)[0].replace(/\s*[-:]\s*$/, '').trim(), cpf: '', raw: raw, role: index === 0 ? 'coach' : 'integrante'}; }
      }).filter(function (member) { return !!member; });
      var dataIssue = outcome.message;
      var incompleteRequest = Object.assign({}, request, {invalidAnswer: false, members: members,
        teamName: request.teamName || 'Equipe sem nome (' + request.responseId + ')'});
      outcome = SemDomain.decideTeam(decisionState, incompleteRequest, {administrativeIncomplete: true});
      if (outcome.code === 'confirmed') {
        var team = outcome.changes[0].registration;
        team.declaredSize = request.declaredSize;
        team.dataIssues = (request.importErrors || []).concat([dataIssue]);
        team.rawMembers = request.rawMembers;
        outcome.message = 'Equipe confirmada administrativamente; completar dados depois. ' + dataIssue;
      }
    }
  }
  if (outcome.participant) outcome.participant.identitySource = request.identitySource;
  return outcome;
}

function cspImportOperation_(request, outcome) {
  return {key: request.key, kind: 'REQUEST', at: new Date().toISOString(), request: request, outcome: outcome,
    importedBy: props_().getProperty('SEMINFO_INSTALLER'),
    reason: request.recoveredAt && !request.originalSubmittedAt ? 'Recuperação administrativa da cópia de IntegrantesEquipes. Data original, tipo e situação anterior ausentes; equipe reavaliada pelas regras atuais.' :
      request.recoveredAt ? 'Recuperação administrativa das cópias históricas Equipes e IntegrantesEquipes. Data, tipo e situação original preservados; equipe reavaliada pelas regras atuais.' :
      request.kind === 'INSCRICAO_EQUIPE' ? 'Importação administrativa de equipe; integrantes conferidos pela organização. Form original sem campo de e-mail.' :
      'Importação de respostas anteriores ao sistema; dados conferidos pela organização. E-mail originalmente informado pelo participante.'};
}

/** Lê e simula. Não cria inscrições, vínculos de CPF ou e-mails. */
function prepararImportacaoCsp() {
  requireInstaller_();
  var source = getCspImportSource_(), until = new Date().toISOString();
  var data = readCspImportRequests_(source, until);
  return withLock_(function () {
    var journal = readJournal_(), state = journal.state, counts = {}, rows = [], already = 0;
    assertCspImportDestination_(state, source);
    var unit = cspTeamUnitOperation_(state, source);
    if (unit) state = SemDomain.applyOperation(state, unit);
    data.requests.forEach(function (request) {
      var previous = journal.byKey[request.key], code, message;
      if (previous) { already++; code = 'ja_processada'; message = previous.outcome && previous.outcome.message || ''; }
      else {
        var outcome = cspImportOutcome_(state, request);
        code = outcome.code; message = outcome.message;
        state = SemDomain.applyOperation(state, cspImportOperation_(request, outcome));
        counts[code] = (counts[code] || 0) + 1;
      }
      if (source.schema === 'equipes') rows.push([request.protocol, request.responseId,
        request.originalSubmittedAt || (request.recoveredAt ? '' : request.submittedAt), request.teamName, request.teamType,
        request.members.length, JSON.stringify(request.members), request.rawMembers.join('\n\n'), code, message, request.recoveredAt || '', request.identitySource]);
      else rows.push([request.protocol, request.submittedAt, request.name, request.cpf, request.email, code, message]);
    });
    var name = 'Previa_CSP_' + Utilities.getUuid().slice(0, 8);
    var headers = source.schema === 'equipes' ? ['PROTOCOLO', 'RESPOSTA_ID', 'RECEBIDA_EM', 'EQUIPE', 'TIPO_EQUIPE', 'QTD_IDENTIFICADA', 'INTEGRANTES_JSON', 'TEXTOS_ORIGINAIS', 'RESULTADO_PREVISTO', 'DETALHE', 'RECUPERADA_EM', 'ORIGEM'] :
      ['PROTOCOLO', 'RECEBIDA_EM', 'NOME', 'CPF', 'EMAIL_INFORMADO', 'RESULTADO_PREVISTO', 'DETALHE'];
    writeTable_(name, headers, rows);
    var sheet = db_().getSheetByName(name), installer = props_().getProperty('SEMINFO_INSTALLER');
    var protection = sheet.protect().setDescription('SEMINFO — prévia administrativa privada');
    protection.addEditor(installer);
    protection.removeEditors(protection.getEditors().filter(function (user) { return user.getEmail().toLowerCase() !== installer; }));
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
    sheet.autoResizeColumns(1, headers.length);
    props_().setProperty('SEMINFO_IMPORTACAO_CSP', JSON.stringify({source: source, sourceSignature: hash_(JSON.stringify(source)),
      until: until, dataSignature: data.signature, head: journal.head, started: false,
      generation: props_().getProperty('SEMINFO_GENERATION') || ''}));
    return {formId: source.formId, activityId: source.activityId, total: data.requests.length, jaProcessadas: already,
      resultadosPrevistos: counts, ocupacaoPrevista: SemDomain.occupancy(state, source.activityId), unidadeCapacidade: source.schema === 'equipes' ? 'equipes' : 'pessoas',
      formularioIntegrado: getFormSources_().some(function (entry) { return entry.kind === 'INSCRICAO' && entry.id === source.formId; }),
      backupSheetName: source.backupSheetName || '',
      avisoRecuperacao: data.missingOriginalMetadata ? 'A cópia não contém data original, tipo ou situação anterior das equipes. Confira a prévia; a recuperação registra a data atual e respeita vagas e conflitos.' : '',
      previaUrl: db_().getUrl() + '#gid=' + sheet.getSheetId()};
  });
}

/** Salva todas as equipes da fonte, inclusive as que ainda precisam de dados. */
function salvarTodasEquipesRecuperadasCsp_(requests, journal) {
  var headers = ['CHAVE', 'EQUIPE', 'TIPO_EQUIPE', 'QTD_DECLARADA', 'QTD_IDENTIFICADA', 'INTEGRANTES_JSON',
    'TEXTOS_ORIGINAIS', 'SITUACAO', 'DETALHE', 'FORM_ID', 'RESPOSTA_ID'];
  var name = 'Recuperacao_CSP', byKey = {}, order = [];
  tableRows_(name).forEach(function (row) {
    byKey[row.CHAVE] = headers.map(function (header) { return row[header]; });
    order.push(row.CHAVE);
  });
  requests.forEach(function (request) {
    if (request.kind !== 'INSCRICAO_EQUIPE') return;
    var previous = journal.byKey[request.key];
    var outcome = previous ? previous.outcome : cspImportOutcome_(journal.state, request);
    if (!Object.prototype.hasOwnProperty.call(byKey, request.key)) order.push(request.key);
    byKey[request.key] = [request.key, request.teamName, request.teamType || '', request.declaredSize || '',
      request.members.length, JSON.stringify(request.members), request.rawMembers.join('\n\n'),
      outcome.code === 'invalid' ? 'pendente_conferencia' : previous ? outcome.code : 'aguardando_importacao',
      outcome.message, request.formId, request.responseId];
  });
  writeTable_(name, headers, order.map(function (key) { return byKey[key]; }));
  return db_().getUrl() + '#gid=' + db_().getSheetByName(name).getSheetId();
}

/** A conta instaladora importa a prévia conferida em lotes recuperáveis. */
function importarInscricoesAnterioresCsp() {
  requireInstaller_(); validateMailConfig_();
  var raw = props_().getProperty('SEMINFO_IMPORTACAO_CSP');
  if (!raw) throw new Error('Execute prepararImportacaoCsp e confira a prévia antes de importar.');
  var snapshot = JSON.parse(raw), source = getCspImportSource_();
  function assertGeneration() {
    if ((snapshot.generation || '') !== (props_().getProperty('SEMINFO_GENERATION') || '')) throw new Error('O sistema foi zerado. Prepare uma nova prévia de importação.');
  }
  if (snapshot.sourceSignature !== hash_(JSON.stringify(source))) throw new Error('A configuração mudou. Prepare uma nova prévia.');
  var data = readCspImportRequests_(source, snapshot.until);
  if (data.signature !== snapshot.dataSignature) throw new Error('As respostas antigas foram alteradas ou excluídas. Prepare uma nova prévia.');
  withLock_(function () {
    assertGeneration();
    var journal = readJournal_();
    assertCspImportDestination_(journal.state, source);
    if (!snapshot.started && journal.head !== snapshot.head) throw new Error('As inscrições ou o catálogo mudaram desde a prévia. Prepare uma nova prévia.');
    var unit = cspTeamUnitOperation_(journal.state, source);
    if (unit) commitOperationLocked_(journal, unit);
    if (source.schema === 'equipes') salvarTodasEquipesRecuperadasCsp_(data.requests, readJournal_());
    snapshot.started = true;
    props_().setProperty('SEMINFO_IMPORTACAO_CSP', JSON.stringify(snapshot));
  });
  var maximum = getConfig_().MAX_SOLICITACOES_POR_EXECUCAO, deadline = Date.now() + 180000;
  var processed = 0, counts = {}, already = 0;
  for (var i = 0; i < data.requests.length && Date.now() < deadline; i++) {
    var request = data.requests[i];
    var result = withLock_(function () {
      assertGeneration();
      var journal = readJournal_();
      if (journal.byKey[request.key]) return null;
      var outcome = cspImportOutcome_(journal.state, request);
      if (request.kind === 'INSCRICAO_EQUIPE' && outcome.code === 'invalid') return 'pendente_conferencia';
      commitOperationLocked_(journal, cspImportOperation_(request, outcome));
      return outcome.code;
    });
    if (result === null) { already++; continue; }
    if (result === 'pendente_conferencia') continue;
    processed++; counts[result] = (counts[result] || 0) + 1;
    if (processed >= maximum) break;
  }
  var issues = [];
  var report = withLock_(function () {
    assertGeneration();
    var journal = readJournal_();
    rebuildViewsLocked_(journal);
    var recoveryUrl = source.schema === 'equipes' ? salvarTodasEquipesRecuperadasCsp_(data.requests, journal) : '';
    var pendingReview = 0, pendingTeams = [];
    var remaining = data.requests.filter(function (request) {
      if (journal.byKey[request.key]) return false;
      if (request.kind === 'INSCRICAO_EQUIPE') {
        var outcome = cspImportOutcome_(journal.state, request);
        if (outcome.code === 'invalid') {
          pendingReview++;
          pendingTeams.push({equipe: request.teamName, respostaId: request.responseId, motivo: outcome.message});
          return false;
        }
      }
      return true;
    }).length;
    return {processadasNesteLote: processed, jaProcessadas: already, resultados: counts, restantes: remaining,
      ocupacao: SemDomain.occupancy(journal.state, source.activityId), unidadeCapacidade: source.schema === 'equipes' ? 'equipes' : 'pessoas',
      totalEquipesRecuperadas: source.schema === 'equipes' ? data.requests.length : 0, recuperacaoUrl: recoveryUrl,
      pendentesConferencia: pendingReview, equipesPendentes: pendingTeams, atividade: source.activityId,
      equipesNaoConfirmadas: data.requests.filter(function (request) { return request.kind === 'INSCRICAO_EQUIPE'; }).map(function (request) {
        var previous = journal.byKey[request.key];
        var team = journal.state.registrations[request.key + ':equipe'];
        if (team && team.status === 'confirmada') return null;
        var outcome = previous ? previous.outcome : cspImportOutcome_(journal.state, request);
        return {equipe: request.teamName, respostaId: request.responseId, resultado: team ? team.status : outcome.code,
          motivo: team ? team.cancellationReason || '' : outcome.message};
      }).filter(function (entry) { return !!entry; }),
      formularioIntegrado: getFormSources_().some(function (entry) { return entry.kind === 'INSCRICAO' && entry.id === source.formId; }), pendencias: issues};
  });
  try { refreshFormsSafely_(); }
  catch (error) { recordError_('importacao-csp-formularios', '', error); issues.push(safeError_(error)); }
  if (source.schema === 'equipes') {
    try {
      withExternalFormOperation_(function() {
        var state = readState_(), activity = state.activities[source.activityId];
        setFormReceiving_(openFormWithDriveRetry_(source.formId),
          state.accepting && activity.status === 'aberta' && SemDomain.occupancy(state, source.activityId) < activity.capacity);
      });
    } catch (error) { recordError_('importacao-csp-lotacao', '', error); issues.push(safeError_(error)); }
  }
  report.pendencias = issues;
  // A fila normal fará os envios; importação não chama MailApp diretamente.
  return report;
}

function menuPerguntasImportacaoCsp() { SpreadsheetApp.getUi().alert(JSON.stringify(listarPerguntasImportacaoCsp(), null, 2)); }
function menuPreviaImportacaoCsp() { SpreadsheetApp.getUi().alert(JSON.stringify(prepararImportacaoCsp(), null, 2)); }
function menuImportacaoCsp() { SpreadsheetApp.getUi().alert(JSON.stringify(importarInscricoesAnterioresCsp(), null, 2)); }

function cancelarEquipeCsp(teamId, reason) {
  requireInstaller_();
  reason = String(reason || '').trim();
  if (reason.length < 5 || reason.length > 500) throw new Error('Justificativa deve ter entre 5 e 500 caracteres.');
  var result = withLock_(function () {
    var journal = readJournal_(), team = journal.state.registrations[teamId];
    if (!team || team.entityType !== 'EQUIPE') throw new Error('Equipe não encontrada. Use o ID da aba Equipes.');
    if (team.status !== 'confirmada') return {resultado: 'ja_cancelada'};
    var key = 'ADMIN:CANCEL_TEAM:' + Utilities.getUuid(), at = new Date().toISOString();
    commitOperationLocked_(journal, {key: key, kind: 'REQUEST', at: at, reason: reason,
      request: {key: key, kind: 'CANCELAMENTO_EQUIPE', cpf: team.cpf, name: team.teamName, teamName: team.teamName, email: '',
        activityId: team.activityId, submittedAt: at, protocol: protocol_(key)},
      outcome: {code: 'canceled', message: 'Equipe cancelada. Uma vaga de equipe foi liberada.', changes: [
        {type: 'CANCEL', registrationId: team.id, status: 'cancelada', reason: reason}
      ]}});
    journal = readJournal_(); rebuildViewsLocked_(journal);
    return {resultado: 'canceled', activityId: team.activityId};
  });
  if (result.resultado !== 'canceled') return result;
  var issues = [];
  try { refreshFormsSafely_(); } catch (error) { issues.push(safeError_(error)); recordError_('cancelamento-equipe', '', error); }
  try {
    withExternalFormOperation_(function() {
      var source = getCspImportSource_(), state = readState_(), activity = state.activities[result.activityId];
      if (source.schema === 'equipes' && source.activityId === result.activityId) {
        setFormReceiving_(openFormWithDriveRetry_(source.formId),
          state.accepting && activity.status === 'aberta' && SemDomain.occupancy(state, result.activityId) < activity.capacity);
      }
    });
  } catch (error) { issues.push(safeError_(error)); recordError_('cancelamento-equipe-formulario', '', error); }
  var latest = readState_();
  return {resultado: result.resultado, ocupacao: SemDomain.occupancy(latest, result.activityId), unidadeCapacidade: 'equipes', pendencias: issues};
}

function menuCancelarEquipe() {
  var text = promptText_('Cancelar equipe com justificativa', 'Cole JSON: {"teamId":"ID da aba Equipes","reason":"justificativa"}');
  if (text !== null) { var params = JSON.parse(text); SpreadsheetApp.getUi().alert(JSON.stringify(cancelarEquipeCsp(params.teamId, params.reason), null, 2)); }
}
