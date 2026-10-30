/** Livro oficial: uma célula JSON selada para toda a decisão, inclusive todas as trocas. */
function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function readJournal_() {
  var sheet = ensureTable_('Operacoes', SEMINFO_TABLES.Operacoes);
  var cells = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  var previous = 'GENESIS', operations = [], byKey = {};
  cells.forEach(function(row, index) {
    var envelope, operation;
    try {
      if (!row[0]) throw new Error('Registro vazio.');
      envelope = JSON.parse(row[0]);
      if (envelope.v !== 1 || envelope.previous !== previous || typeof envelope.payload !== 'string' || envelope.hash !== hash_(envelope.previous + '\n' + envelope.payload)) throw new Error('Selo inválido.');
      operation = JSON.parse(envelope.payload);
      if (!operation.key || !operation.kind || !operation.at) throw new Error('Operação sem identidade.');
      previous = envelope.hash;
      if (byKey[operation.key]) {
        if (JSON.stringify(byKey[operation.key]) !== JSON.stringify(operation)) throw new Error('Chave repetida com decisão divergente.');
      } else { byKey[operation.key] = operation; operations.push(operation); }
    } catch (_) {
      throw new Error('Livro oficial inválido na linha ' + (index + 2) + '. Processamento bloqueado; restaure o registro a partir de backup/histórico de versões.');
    }
  });
  var state = SemDomain.replayOperations(operations);
  SemDomain.validateState(state);
  return {operations: operations, byKey: byKey, state: state, head: previous};
}

function readState_() { return readJournal_().state; }

/** Chamado SOMENTE dentro de withLock_. Releia o livro antes de qualquer tentativa. */
function commitOperationLocked_(journal, operation) {
  if (journal.byKey[operation.key]) return journal.byKey[operation.key];
  SemDomain.validateState(SemDomain.applyOperation(journal.state, operation));
  var payload = JSON.stringify(operation);
  var envelope = {v: 1, previous: journal.head, payload: payload, hash: hash_(journal.head + '\n' + payload)};
  var text = JSON.stringify(envelope);
  if (text.length > 45000) throw new Error('Operação excede o limite seguro de uma célula. Inscrições anteriores preservadas; solicite atendimento.');
  var sheet = ensureTable_('Operacoes', SEMINFO_TABLES.Operacoes);
  if (sheet.getMaxRows() < sheet.getLastRow() + 1) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  var range = sheet.getRange(sheet.getLastRow() + 1, 1);
  range.setNumberFormat('@');
  range.setValue(text);
  SpreadsheetApp.flush();
  // Não repita o append às cegas se a resposta da gravação for incerta.
  var persisted = readJournal_().byKey[operation.key];
  if (!persisted || JSON.stringify(persisted) !== payload) throw new Error('Gravação sem confirmação de leitura; recuperação necessária.');
  return persisted;
}

/** Situação das inscrições exibida nas consultas; não altera o cadastro oficial. */
function activityRegistrationStatus_(state, activity, occupied) {
  if (activity.status !== 'aberta') return activity.status;
  if (!state.accepting) return 'encerrada';
  return occupied >= Number(activity.capacity) ? 'lotada' : 'aberta';
}

function rebuildViewsLocked_(journal) {
  var state = journal.state;
  writeTable_('Atividades', SEMINFO_TABLES.Atividades, Object.values(state.activities).map(function(a) {
    var occupied = SemDomain.occupancy(state, a.id);
    return [a.id, a.title, a.type, a.description, a.instructor, a.location, a.start, a.end, a.capacity === null ? '' : a.capacity,
      activityRegistrationStatus_(state, a, occupied), occupied];
  }));
  writeTable_('Participantes', SEMINFO_TABLES.Participantes, Object.values(state.participants).map(function(p) { return [p.cpf, p.name, p.email]; }));
  writeTable_('Solicitacoes', SEMINFO_TABLES.Solicitacoes, journal.operations.filter(function(op) { return op.kind === 'REQUEST'; }).map(function(op) {
    var r = op.request;
    return [op.key, r.protocol, r.formId || 'ADMIN', r.responseId || '', r.submittedAt, op.at, r.kind, r.cpf, r.email, r.activityId, op.outcome.code];
  }));
  writeTable_('Inscricoes', SEMINFO_TABLES.Inscricoes, Object.values(state.registrations).map(function(r) {
    return [r.id, r.cpf, r.activityId, r.status, r.createdAt, r.canceledAt || r.createdAt, r.cancellationReason || ''];
  }));
  var teams = Object.values(state.registrations).filter(function (registration) { return registration.entityType === 'EQUIPE'; });
  if (teams.length) {
    writeTable_('Equipes', SEMINFO_TABLES.Equipes, teams.map(function (team) {
      return [team.id, team.activityId, team.teamName, team.teamType || '', team.cpf, team.members.length, team.status, team.createdAt, team.cancellationReason || ''];
    }));
    var members = [];
    teams.forEach(function (team) { team.members.forEach(function (member) {
      members.push([team.id, team.teamName, member.cpf, member.name, member.role, member.turma || '', member.telefone || '', member.raw || '']);
    }); });
    writeTable_('IntegrantesEquipes', SEMINFO_TABLES.IntegrantesEquipes, members);
    ['Equipes', 'IntegrantesEquipes'].forEach(function (name) {
      var sheet = db_().getSheetByName(name), description = 'SEMINFO — edição exclusiva pela conta instaladora';
      if (!sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).some(function (protection) { return protection.getDescription() === description; })) {
        var protection = sheet.protect().setDescription(description), installer = props_().getProperty('SEMINFO_INSTALLER');
        protection.setWarningOnly(false).addEditor(installer);
        protection.removeEditors(protection.getEditors().filter(function (user) { return user.getEmail().toLowerCase() !== installer; }));
        if (protection.canDomainEdit()) protection.setDomainEdit(false);
      }
    });
  }
  writeTable_('Historico', SEMINFO_TABLES.Historico, journal.operations.map(function(op) {
    return [op.key, op.at, op.kind, op.kind === 'REQUEST' ? op.request.protocol + ': ' + op.outcome.code : (op.reason || (op.activity && op.activity.id) || String(op.accepting))];
  }));
  syncNotificationQueueLocked_(journal.operations);
  // Só marca depois de concluir todas as visões e a fila. Falhas exigem nova reconstrução.
  SpreadsheetApp.flush();
  props_().setProperty('SEMINFO_VIEWS_HEAD', journal.head);
}

function enrichOutcome_(state, request, outcome) {
  if (outcome.code === 'identity_mismatch' || outcome.code === 'invalid') return outcome;
  if (state.activities[request.activityId]) outcome.activity = state.activities[request.activityId];
  outcome.changes.forEach(function(change) {
    if (change.type === 'CANCEL') {
      var registration = state.registrations[change.registrationId];
      change.activity = registration.activity || state.activities[registration.activityId];
    }
  });
  return outcome;
}

function processFormResponse_(kind, form, response, deferViews, deadline) {
  if (props_().getProperty('SEMINFO_EVENTO_ENCERRADO_EM')) return {code: 'closed', message: 'Evento encerrado; resposta preservada no Forms.', changes: []};
  var request;
  try {
    request = parseFormRequest_(kind, form, response); // Valida VERIFIED pela API antes de qualquer vínculo.
    var outcome = withLock_(function() {
      if (props_().getProperty('SEMINFO_EVENTO_ENCERRADO_EM')) return {code: 'closed', message: 'Evento encerrado; resposta preservada no Forms.', changes: []};
      var journal = readJournal_();
      var resetAt = props_().getProperty('SEMINFO_RESET_AT');
      if (resetAt && Date.parse(request.submittedAt) <= Date.parse(resetAt)) throw new Error('Resposta anterior à limpeza; envie novamente após a abertura.');
      // A verificação externa pode ter revogado o corte enquanto a resposta era lida.
      if (!isEligibleFormResponse_(form, response)) throw new Error('Resposta em quarentena: a abertura verificada deste formulário foi revogada ou alterada.');
      var operation = journal.byKey[request.key];
      if (!operation) {
        var outcome = enrichOutcome_(journal.state, request, SemDomain.decide(journal.state, request));
        operation = commitOperationLocked_(journal, {key: request.key, kind: 'REQUEST', at: new Date().toISOString(), request: request, outcome: outcome});
      }
      return operation.outcome;
    }, false, false, true);
    // A sincronização reconstrói as visões uma única vez, com o estado mais recente.
    if (deferViews !== true) refreshFormsSafely_(deadline);
    return outcome;
  } catch (error) {
    var key = request ? request.key : (form && response ? form.getId() + ':' + response.getId() : '');
    recordError_('processamento', key, error);
    // Após falhas recorrentes, avisa pelo endereço VERIFIED já obtido. A resposta
    // permanece pendente: este aviso não é uma decisão nem ocupa/libera vaga.
    if (request && request.email) {
      try {
        withLock_(function() {
          var failures = tableRows_('Erros').filter(function(row) { return row.CHAVE === key; });
          var completed = false;
          try { completed = Boolean(readJournal_().byKey[key]); } catch (_) { /* Estado oficial indeterminado exige atendimento. */ }
          if (failures.length >= 3 && !completed) syncNotificationQueueLocked_([{key: 'FALHA:' + key, kind: 'REQUEST', at: new Date().toISOString(), request: request, outcome: {code: 'failure', changes: []}}]);
        }, false, false, true);
      } catch (_) { /* O Forms continua sendo a caixa de entrada durável. */ }
    }
    throw error;
  }
}

function postProcessing_(deadline) {
  try { return processarNotificacoes(deadline); }
  catch (error) { recordError_('notificacoes', '', error); return {erro: safeError_(error)}; }
}

/** Varredura circular de todas as origens; cursores não dão respostas como processadas. */
function processarSolicitacoesPendentes(deadline, deferRefresh) {
  var started = Date.now(), finalDeadline = Math.min(started + 270000, Number(deadline) || Infinity);
  requireInstaller_(false, true);
  if (props_().getProperty('SEMINFO_EVENTO_ENCERRADO_EM')) return {processadas: 0, eventoEncerrado: true};
  var config = getConfig_(), pending = [], quarantined = 0;
  var executionDeadline = deferRefresh === true ? finalDeadline : Math.min(started + 150000, finalDeadline - 60000);
  var scanDeadline = Math.min(started + 60000, executionDeadline - 30000);
  var processed = Date.now() < scanDeadline - 15000 ? readJournal_().byKey : {};
  var sources = getFormSources_(config), cursor = Number(props_().getProperty('SEMINFO_SCAN_FORM_INDEX') || 0), scanned = 0, scanErrors = 0, partialScan = false;
  if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;
  for (var offset = 0; offset < sources.length && Date.now() < scanDeadline - 15000; offset++) {
    var index = (cursor + offset) % sources.length, source = sources[index];
    try {
      var form = openFormWithDriveRetry_(source.id);
      assertVerifiedEmail_(form);
      var responses = form.getResponses();
      var responseCursorKey = 'SEMINFO_SCAN_RESPONSE_INDEX_' + form.getId();
      var responseCursor = Number(props_().getProperty(responseCursorKey) || 0);
      if (!Number.isInteger(responseCursor) || responseCursor < 0) responseCursor = 0;
      responseCursor = responses.length ? responseCursor % responses.length : 0;
      var nextResponseIndex = responseCursor, inspected = 0;
      for (var responseOffset = 0; responseOffset < responses.length && Date.now() < scanDeadline - 15000; responseOffset++) {
        var ri = (responseCursor + responseOffset) % responses.length, response = responses[ri];
        inspected++;
        nextResponseIndex = (ri + 1) % responses.length;
        if (processed[form.getId() + ':' + response.getId()]) continue;
        if (!isEligibleFormResponse_(form, response)) { quarantined++; continue; }
        pending.push({kind: source.kind, form: form, response: response});
        if (pending.length >= config.MAX_SOLICITACOES_POR_EXECUCAO) break;
      }
      if (inspected < responses.length) partialScan = true;
      props_().setProperty(responseCursorKey, String(nextResponseIndex));
    } catch (error) { scanErrors++; recordError_('varredura-form', source.id, error); }
    scanned++;
    props_().setProperty('SEMINFO_SCAN_FORM_INDEX', String((index + 1) % sources.length));
    if (pending.length >= config.MAX_SOLICITACOES_POR_EXECUCAO) break;
  }
  pending.sort(function(a, b) { return a.response.getTimestamp().getTime() - b.response.getTimestamp().getTime(); });
  var done = 0, failed = 0;
  for (var i = 0; i < pending.length && done + failed < config.MAX_SOLICITACOES_POR_EXECUCAO && Date.now() < executionDeadline - 30000; i++) {
    try { processFormResponse_(pending[i].kind, pending[i].form, pending[i].response, true); done++; }
    catch (_) { failed++; }
  }
  var refresh = deferRefresh === true ? {adiada: true, motivo: 'Sincronização em etapa separada.'} : refreshFormsSafely_(finalDeadline);
  return {processadas: done, falhas: failed, pendentesNoLote: pending.length - done, loteCheio: pending.length >= config.MAX_SOLICITACOES_POR_EXECUCAO, respostasEmQuarentena: quarantined, formulariosVarridos: scanned, errosDeVarredura: scanErrors, varreduraParcial: scanned < sources.length || partialScan, atualizacaoFormularios: refresh};
}

function refreshFormsSafely_(deadline, skipUnchangedViews) {
  var executionDeadline = Number(deadline) || Infinity;
  function postponed(phase) { return {adiada: true, fase: phase, motivo: 'Prazo reservado para a próxima execução.'}; }
  if (Date.now() >= executionDeadline - 30000) return postponed('visoes');
  var refreshLock = LockService.getScriptLock();
  var timeout = Math.min(getConfig_().TEMPO_LOCK_MS, Math.max(1, executionDeadline - Date.now() - 30000));
  if (executionDeadline === Infinity) refreshLock.waitLock(timeout);
  else if (!refreshLock.tryLock(timeout)) return {adiada: true, motivo: 'Livro oficial ocupado por outra execução.'};
  var token = pendingOperationToken_() + '|VIEW';
  var journal, deferred = false;
  try {
    assertNoReset_();
    assertNoPendingOperation_(true);
    if (Date.now() >= executionDeadline - 30000) return postponed('visoes');
    journal = readJournal_();
    if (Date.now() >= executionDeadline - 30000) return postponed('visoes');
    if (skipUnchangedViews !== true || props_().getProperty('SEMINFO_VIEWS_HEAD') !== journal.head) rebuildViewsLocked_(journal);
    if (Date.now() >= executionDeadline - 30000) return postponed('formularios');
    if (props_().getProperty('SEMINFO_FORM_REFRESH_PENDING')) deferred = true;
    else props_().setProperty('SEMINFO_FORM_REFRESH_PENDING', token);
  } finally { try { SpreadsheetApp.flush(); } finally { refreshLock.releaseLock(); } }

  // Outra execução já atualiza as opções. As visões e a fila acima estão atuais;
  // a manutenção periódica reaplica as opções com as decisões mais recentes.
  if (deferred) return {adiada: true, motivo: 'Atualização das opções já em andamento.'};
  var refreshResult, refreshError;
  try { refreshResult = refreshFormsLocked_(journal.state, deadline); }
  catch (error) { refreshError = error; }
  finally {
    clearPendingOperation_('SEMINFO_FORM_REFRESH_PENDING', token);
  }
  if (refreshError) throw refreshError;
  return refreshResult;
}

function withExternalFormOperation_(fn) {
  var operationLock = LockService.getScriptLock();
  operationLock.waitLock(getConfig_().TEMPO_LOCK_MS);
  var token = pendingOperationToken_();
  try {
    assertNoReset_();
    assertNoPendingOperation_();
    props_().setProperty('SEMINFO_FORM_REFRESH_PENDING', token);
  } finally { try { SpreadsheetApp.flush(); } finally { operationLock.releaseLock(); } }

  try { return fn(); }
  finally {
    clearPendingOperation_('SEMINFO_FORM_REFRESH_PENDING', token);
  }
}

function manutencaoPeriodica() {
  var started = Date.now(), deadline = started + 270000;
  requireInstaller_(false, true);
  if (props_().getProperty('SEMINFO_EVENTO_ENCERRADO_EM')) return {eventoEncerrado: true};
  // O lock protege apenas o lease; envios e chamadas ao Forms continuam fora dele.
  var lock = LockService.getScriptLock(), token = pendingOperationToken_();
  if (!lock.tryLock(1000)) return {adiada: true, motivo: 'Outra operação está usando o livro oficial.'};
  try {
    assertNoReset_();
    assertNoPendingOperation_(true);
    var active = props_().getProperty('SEMINFO_MAINTENANCE_PENDING');
    if (active && Date.now() - Number(active.split('|')[0]) < 540000) return {adiada: true, motivo: 'Manutenção anterior ainda em andamento.'};
    props_().setProperty('SEMINFO_MAINTENANCE_PENDING', token);
  } finally { lock.releaseLock(); }
  var result = {};
  function stage(name, fn) {
    console.log('SEMINFO manutenção: início de ' + name + ' em ' + (Date.now() - started) + ' ms.');
    try { result[name] = fn(); }
    catch (error) { recordError_(name, '', error); result[name] = {erro: safeError_(error)}; }
    console.log('SEMINFO manutenção: ' + name + ' em ' + (Date.now() - started) + ' ms. ' + JSON.stringify(result[name]));
  }
  try {
    stage('recuperacao', function() { return processarSolicitacoesPendentes(Math.min(started + 120000, deadline), true); });
    stage('sincronizacao', function() { return refreshFormsSafely_(Math.min(Date.now() + 90000, deadline - 45000), true); });
    stage('notificacoes', function() { return postProcessing_(deadline - 15000); });
    if (Date.now() < deadline - 30000) stage('nomear-abas-respostas', function() { return sincronizarNomesAbasDeRespostas_(deadline); });
    result.duracaoMs = Date.now() - started;
    return result;
  } finally {
    // Se houver contenção ao terminar, o lease expira sozinho, inclusive após timeout.
    if (lock.tryLock(1000)) {
      try { clearPendingOperation_('SEMINFO_MAINTENANCE_PENDING', token); }
      finally { lock.releaseLock(); }
    }
  }
}

function reconstruirVisoes() {
  requireInstaller_();
  var journal = withLock_(function() { var currentJournal = readJournal_(); rebuildViewsLocked_(currentJournal); return currentJournal; });
  refreshFormsSafely_();
  return journal.operations.length;
}
