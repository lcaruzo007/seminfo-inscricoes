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
  source.items = source.items || {};
  if (typeof source.items !== 'object' || Array.isArray(source.items)) throw new Error('items deve conter os IDs das perguntas.');
  var allowed = source.schema === 'equipes' ? ['TEAM_TYPE', 'TEAM_NAME', 'TEAM_SIZE', 'MEMBER1', 'MEMBER2', 'MEMBER3'] : ['NAME', 'CPF', 'EMAIL'];
  if (Object.keys(source.items).some(function (key) { return allowed.indexOf(key) < 0; })) throw new Error('Mapeamento incompatível com o formato ' + source.schema + '. Use: ' + allowed.join(', ') + '.');
  if (source.schema === 'equipes' && source.formId === '1oXixuiIIJ1sGVdTgs0uEQVSEaqxEO5NqupTi-4xv2ww') {
    source.items = Object.assign({TEAM_TYPE: 742351656, TEAM_NAME: 396811097, TEAM_SIZE: 1358170985, MEMBER1: 98572697, MEMBER2: 1537440165, MEMBER3: 1869818828}, source.items);
  }
  return source;
}

function getCspImportResponses_(source, form, itemIds) {
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
  var source = getCspImportSource_(), form = FormApp.openById(source.formId);
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
  raw = String(raw || '').trim();
  if (!raw || /^(nao|não|nenhum|não há|nao ha|n\/a|-)$/i.test(raw)) {
    if (number === 1) throw new Error('Integrante 1 (coach) não informado.');
    return null;
  }
  var labeled = /cpf\s*[:=-]?\s*(\d{3}\.\d{3}\.\d{3}\s*-\s*\d{2}|\d{9,14})\b/i.exec(raw);
  var candidates = [];
  if (labeled) candidates = [{value: labeled[1], index: labeled.index + labeled[0].indexOf(labeled[1])}];
  else {
    var regex = /\b\d{3}\.\d{3}\.\d{3}\s*-\s*\d{2}\b/g, match;
    while ((match = regex.exec(raw))) candidates.push({value: match[0], index: match.index});
    if (!candidates.length) {
      regex = /\b\d{9,14}\b/g;
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
  var form = FormApp.openById(source.formId), items = {}, used = {};
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
  var form = FormApp.openById(source.formId), items = resolveCspImportItems_(source, form);
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
  if (outcome.participant) outcome.participant.identitySource = request.identitySource;
  return outcome;
}

function cspImportOperation_(request, outcome) {
  return {key: request.key, kind: 'REQUEST', at: new Date().toISOString(), request: request, outcome: outcome,
    importedBy: props_().getProperty('SEMINFO_INSTALLER'),
    reason: request.kind === 'INSCRICAO_EQUIPE' ? 'Importação administrativa de equipe; integrantes conferidos pela organização. Form original sem campo de e-mail.' :
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
      if (source.schema === 'equipes') rows.push([request.protocol, request.responseId, request.submittedAt, request.teamName, request.teamType,
        request.members.length, JSON.stringify(request.members), request.rawMembers.join('\n\n'), code, message]);
      else rows.push([request.protocol, request.submittedAt, request.name, request.cpf, request.email, code, message]);
    });
    var name = 'Previa_CSP_' + Utilities.getUuid().slice(0, 8);
    var headers = source.schema === 'equipes' ? ['PROTOCOLO', 'RESPOSTA_ID', 'RECEBIDA_EM', 'EQUIPE', 'TIPO_EQUIPE', 'QTD_IDENTIFICADA', 'INTEGRANTES_JSON', 'TEXTOS_ORIGINAIS', 'RESULTADO_PREVISTO', 'DETALHE'] :
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
      previaUrl: db_().getUrl() + '#gid=' + sheet.getSheetId()};
  });
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
  var report = withLock_(function () {
    assertGeneration();
    var journal = readJournal_();
    rebuildViewsLocked_(journal);
    var issues = [];
    try { refreshFormsLocked_(journal.state); }
    catch (error) { recordError_('importacao-csp-formularios', '', error); issues.push(safeError_(error)); }
    if (source.schema === 'equipes' && SemDomain.occupancy(journal.state, source.activityId) >= journal.state.activities[source.activityId].capacity) {
      try { setFormReceiving_(FormApp.openById(source.formId), false); }
      catch (error) { recordError_('importacao-csp-lotacao', '', error); issues.push(safeError_(error)); }
    }
    var pendingReview = 0;
    var remaining = data.requests.filter(function (request) {
      if (journal.byKey[request.key]) return false;
      if (request.kind === 'INSCRICAO_EQUIPE' && cspImportOutcome_(journal.state, request).code === 'invalid') { pendingReview++; return false; }
      return true;
    }).length;
    return {processadasNesteLote: processed, jaProcessadas: already, resultados: counts, restantes: remaining,
      ocupacao: SemDomain.occupancy(journal.state, source.activityId), unidadeCapacidade: source.schema === 'equipes' ? 'equipes' : 'pessoas',
      pendentesConferencia: pendingReview, atividade: source.activityId,
      formularioIntegrado: getFormSources_().some(function (entry) { return entry.kind === 'INSCRICAO' && entry.id === source.formId; }), pendencias: issues};
  });
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
  return withLock_(function () {
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
    var issues = [];
    try { refreshFormsLocked_(journal.state); } catch (error) { issues.push(safeError_(error)); recordError_('cancelamento-equipe', '', error); }
    var source = getCspImportSource_(), activity = journal.state.activities[team.activityId];
    if (source.schema === 'equipes' && source.activityId === team.activityId) {
      try { setFormReceiving_(FormApp.openById(source.formId), journal.state.accepting && activity.status === 'aberta' && SemDomain.occupancy(journal.state, team.activityId) < activity.capacity); }
      catch (error) { issues.push(safeError_(error)); recordError_('cancelamento-equipe-formulario', '', error); }
    }
    return {resultado: 'canceled', ocupacao: SemDomain.occupancy(journal.state, team.activityId), unidadeCapacidade: 'equipes', pendencias: issues};
  });
}

function menuCancelarEquipe() {
  var text = promptText_('Cancelar equipe com justificativa', 'Cole JSON: {"teamId":"ID da aba Equipes","reason":"justificativa"}');
  if (text !== null) { var params = JSON.parse(text); SpreadsheetApp.getUi().alert(JSON.stringify(cancelarEquipeCsp(params.teamId, params.reason), null, 2)); }
}
