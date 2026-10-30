function onOpen() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (error) {
    if (!/^(?:Exception:\s*)?Cannot call SpreadsheetApp\.getUi\(\) from this context\.?$/i.test(String(error && error.message || error).trim())) throw error;
    console.log('Abra ou recarregue a planilha vinculada para exibir o menu SEMINFO. Pelo editor, execute a função administrativa desejada.');
    return;
  }
  ui.createMenu('SEMINFO')
    .addItem('Instalar / reinstalar com segurança', 'instalarSistema')
    .addItem('Configurar e-mail verificado nos Forms', 'configurarEmailVerificadoFormularios')
    .addItem('Conferir configuração e cotas', 'menuConferir')
    .addItem('Consultar somente cota de e-mail', 'menuCotaEmails')
    .addItem('Reparar somente gatilhos', 'menuRepararGatilhos')
    .addItem('Listar perguntas dos Forms existentes', 'menuPerguntasFormularios')
    .addItem('Listar perguntas do Form antigo da CSP', 'menuPerguntasImportacaoCsp')
    .addItem('Preparar prévia das inscrições antigas da CSP', 'menuPreviaImportacaoCsp')
    .addItem('Importar inscrições antigas da CSP conferidas', 'menuImportacaoCsp')
    .addSeparator()
    .addItem('Cadastrar / atualizar atividade', 'menuSalvarAtividade')
    .addItem('Apagar atividade', 'menuApagarAtividade')
    .addItem('Carregar programação XXI Seminfo', 'menuProgramacaoSeminfo2026')
    .addItem('Criar / consultar Meets (3 horas)', 'criarMeetsSeminfo2026')
    .addItem('Atualizar nomes dos formulários', 'menuAtualizarFormularios')
    .addItem('Começar do zero com os mesmos Forms', 'menuComecarDoZero')
    .addItem('Atualizar opções dos Forms', 'atualizarOpcoesFormularios')
    .addItem('Consultar ocupação', 'menuOcupacao')
    .addItem('Reavaliar inscrições recusadas / corrigir capacidade', 'menuReavaliarInscricoes')
    .addItem('Exportar lista confirmada', 'menuExportar')
    .addItem('Gerar listas de terça à tarde (27/10)', 'menuExportarListas27Tarde')
    .addItem('Gerar listas de presença por dia e sala', 'menuListasPresenca')
    .addSeparator()
    .addItem('Abrir inscrições', 'abrirInscricoes')
    .addItem('Encerrar inscrições', 'encerrarInscricoes')
    .addItem('Encerrar evento, cancelar e-mails e gerar presenças', 'menuEncerrarEvento')
    .addItem('Cancelar e-mails pendentes e suspender envios', 'menuCancelarEmailsPendentes')
    .addItem('Cancelar com justificativa', 'menuCancelar')
    .addItem('Cancelar equipe com justificativa', 'menuCancelarEquipe')
    .addItem('Alterar e-mail vinculado ao CPF', 'menuAlterarEmail')
    .addSeparator()
    .addItem('Processar solicitações pendentes', 'menuProcessarSolicitacoes')
    .addItem('Processar e-mails pendentes', 'menuProcessarEmails')
    .addItem('Reconstruir visões / recuperar', 'reconstruirVisoes')
    .addItem('Consultar erros', 'menuErros')
    .addItem('Consultar histórico', 'menuHistorico').addToUi();
}

function instalarSistema() {
  var current = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!current) throw new Error('A conta instaladora precisa fornecer sua identidade Google ao projeto.');
  var installLock = LockService.getScriptLock();
  if (!installLock.tryLock(Math.max(SEMINFO_CONFIG.TEMPO_LOCK_MS, 120000))) {
    throw new Error('Outra execução da SEMINFO mantém o bloqueio. Confira Execuções, aguarde terminar e execute instalarSistema novamente.');
  }
  var installToken = pendingOperationToken_();
  var spreadsheetId;
  try {
    assertNoReset_();
    assertNoPendingOperation_();
    var previous = props_().getProperty('SEMINFO_INSTALLER');
    if (previous && previous !== current) throw new Error('Sistema já instalado por outra conta. Utilize a conta original; não crie gatilhos paralelos.');
    spreadsheetId = props_().getProperty('SEMINFO_ID_PLANILHA') || SEMINFO_CONFIG.ID_PLANILHA;
    if (!spreadsheetId) {
      var active = SpreadsheetApp.getActiveSpreadsheet();
      if (!active) throw new Error('Crie este projeto em Extensões > Apps Script de uma planilha, ou configure ID_PLANILHA.');
      spreadsheetId = active.getId();
    }
    props_().setProperty('SEMINFO_ID_PLANILHA', spreadsheetId);
    props_().setProperty('SEMINFO_INSTALLER', current);
    props_().setProperty('SEMINFO_INSTALL_PENDING', installToken);
  } finally { try { SpreadsheetApp.flush(); } finally { installLock.releaseLock(); } }

  var report;
  try {
    Object.keys(SEMINFO_TABLES).forEach(function(name) { ensureTable_(name, SEMINFO_TABLES[name]); });
    var existing = tableRows_('Configuracoes');
    Object.keys(SEMINFO_CONFIG).forEach(function(key) {
      if (!existing.some(function(row) { return row.CHAVE === key; })) setConfig_(key, key === 'ID_PLANILHA' ? spreadsheetId : SEMINFO_CONFIG[key]);
    });
    ensureNotificationSheet_();
    db_().setSpreadsheetTimeZone('America/Sao_Paulo');
    if (Session.getScriptTimeZone() !== 'America/Sao_Paulo') throw new Error('Configure o fuso do projeto como America/Sao_Paulo no manifesto antes de continuar.');
    getTriggerPlan_(); // Confere o espaço para a recuperação antes de alterar Forms.
    var forms = setupForms_();
    try { forms.abasDeRespostas = nomearAbasDeRespostas_(); }
    catch (error) { forms.issues = (forms.issues || []).concat(['Nomes das abas de respostas: ' + safeError_(error)]); }
    var journal = withLock_(function() {
      var currentJournal = readJournal_();
      rebuildViewsLocked_(currentJournal);
      return currentJournal;
    }, false, true);
    try { refreshFormsLocked_(journal.state); }
    catch (error) { forms.issues = (forms.issues || []).concat([safeError_(error)]); }
    installTriggersLocked_();
    protectOperationalSheetsLocked_();
    report = forms;
  } finally {
    clearPendingOperation_('SEMINFO_INSTALL_PENDING', installToken);
  }
  var registrationReports = report.registrations || [{editUrl: report.registrationEditUrl, url: report.registrationUrl}];
  var text = 'Instalação preservada. Configure EMAIL_CA na aba Configuracoes e coleta Verificado em todos os Forms.\n\n' +
    'Inscrições (editar):\n' + registrationReports.map(function(f) { return (f.title ? f.title + ': ' : '') + f.editUrl; }).join('\n') +
    '\nCancelamento (editar): ' + (report.cancellationEditUrl || 'não instalado') +
    '\n\nInscrições (participantes):\n' + registrationReports.map(function(f) { return (f.title ? f.title + ': ' : '') + f.url; }).join('\n') +
    '\nCancelamento (participantes): ' + (report.cancellationUrl || 'não instalado') +
    '\n\nPendências: ' + ((report.issues || []).join('; ') || 'nenhuma identificada') + '\nDepois use Conferir e Abrir inscrições.';
  try { SpreadsheetApp.getUi().alert(text); } catch (_) { console.log(text); }
  return report;
}

function installTriggersLocked_() {
  var triggers = ScriptApp.getProjectTriggers();
  var plan = getTriggerPlan_(), specs = plan.specs, keep = [], removed = 0, created = 0;
  specs.forEach(function(spec) {
    var found = triggers.find(function(t) { return t.getHandlerFunction() === spec.handler && t.getEventType() === spec.event && (!spec.id || t.getTriggerSourceId() === spec.id); });
    if (found) keep.push(found);
  });
  triggers.forEach(function(t) {
    if (['aoEnviarInscricao', 'aoEnviarCancelamento', 'manutencaoPeriodica'].indexOf(t.getHandlerFunction()) >= 0 && keep.indexOf(t) < 0) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  specs.forEach(function(spec) {
    if (!keep.some(function(t) { return t.getHandlerFunction() === spec.handler && t.getEventType() === spec.event && (!spec.id || t.getTriggerSourceId() === spec.id); })) {
      var builder = ScriptApp.newTrigger(spec.handler);
      if (spec.id) builder.forForm(spec.id).onFormSubmit().create();
      else builder.timeBased().everyMinutes(5).create();
      created++;
    }
  });
  return {mantidos: keep.length, criados: created, removidos: removed, total: specs.length, formsViaVarredura: plan.viaVarredura};
}

/** Reserva o periódico e usa os slots restantes; os demais Forms são varridos. */
function getTriggerPlan_() {
  var sources = getFormSources_();
  var managed = ['aoEnviarInscricao', 'aoEnviarCancelamento', 'manutencaoPeriodica'];
  var unrelated = ScriptApp.getProjectTriggers().filter(function(t) { return managed.indexOf(t.getHandlerFunction()) < 0; }).length;
  if (unrelated >= 20) throw new Error('Remova pelo menos um gatilho não pertencente à SEMINFO para instalar a recuperação periódica.');
  var priority = sources.filter(function(s) { return s.kind === 'CANCELAMENTO'; }).concat(sources.filter(function(s) { return s.kind === 'INSCRICAO'; }));
  var selected = priority.slice(0, Math.max(0, 19 - unrelated));
  var specs = selected.map(function(s) { return {handler: s.kind === 'INSCRICAO' ? 'aoEnviarInscricao' : 'aoEnviarCancelamento', id: s.id, event: ScriptApp.EventType.ON_FORM_SUBMIT}; });
  specs.push({handler: 'manutencaoPeriodica', id: '', event: ScriptApp.EventType.CLOCK});
  return {specs: specs, viaVarredura: priority.slice(selected.length).map(function(s) { return s.id; })};
}

/** Recupera a automação existente sem reconfigurar Forms nem reconstruir o livro. */
function repararGatilhos() {
  requireInstaller_(false, true);
  var result = withLock_(function () {
    requireInstaller_(false, true);
    var properties = props_().getProperties(), sources = getFormSources_();
    if (!sources.some(function (source) { return source.kind === 'INSCRICAO'; })) throw new Error('Instale os formulários antes de reparar seus gatilhos.');
    sources.forEach(function (source) {
      var keys = source.kind === 'INSCRICAO' ? ['NAME', 'CPF', 'SWAP'] : ['CPF', 'CANCEL'];
      if (source.kind !== 'INSCRICAO' || !source.activityId) keys.push('ACTIVITY');
      var legacyOrigin = properties['SEMINFO_ID_FORM_' + source.kind] === source.id;
      keys.forEach(function (key) {
        if (!properties['SEMINFO_ITEM_' + source.id + '_' + key] &&
            !(legacyOrigin && properties['SEMINFO_ITEM_' + source.kind + '_' + key])) {
          throw new Error('A instalação do formulário ' + source.id + ' está incompleta (campo ' + key + '). Conclua a configuração desse Form antes de reparar os gatilhos.');
        }
      });
    });
    var report = installTriggersLocked_();
    conferirGatilhos_();
    return report;
  }, false, false, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function conferirGatilhos_() {
  var triggers = ScriptApp.getProjectTriggers(), plan = getTriggerPlan_();
  plan.specs.forEach(function (spec) {
    var matching = triggers.filter(function (t) { return t.getHandlerFunction() === spec.handler && t.getEventType() === spec.event && (!spec.id || t.getTriggerSourceId() === spec.id); });
    if (matching.length !== 1) throw new Error('Gatilho ausente, duplicado ou de origem incorreta: ' + spec.handler + ' / ' + spec.id + '. Execute repararGatilhos (SEMINFO → Reparar somente gatilhos).');
  });
  var managedCount = triggers.filter(function (t) { return ['aoEnviarInscricao', 'aoEnviarCancelamento', 'manutencaoPeriodica'].indexOf(t.getHandlerFunction()) >= 0; }).length;
  if (managedCount !== plan.specs.length) throw new Error('Gatilhos SEMINFO excedentes ou de origem incorreta. Execute repararGatilhos (SEMINFO → Reparar somente gatilhos).');
  return plan;
}

/** Consulta somente o MailApp: continua disponível mesmo com instalação interrompida. */
function consultarCotaEmails() {
  requireInstaller_(true); // Somente leitura; mantém a exigência da conta instaladora.
  var remaining = MailApp.getRemainingDailyQuota();
  var report = {destinatariosRestantes: remaining, cotaEsgotada: remaining === 0, consultadaEm: new Date().toISOString()};
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function protectOperationalSheetsLocked_() {
  var installer = props_().getProperty('SEMINFO_INSTALLER');
  Object.keys(SEMINFO_TABLES).concat(['FilaEmails']).forEach(function(name) {
    var sheet = db_().getSheetByName(name);
    var description = 'SEMINFO — edição exclusiva pela conta instaladora';
    var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).filter(function(p) { return p.getDescription() === description; });
    var protection = existing[0] || sheet.protect().setDescription(description);
    existing.slice(1).forEach(function(p) { p.remove(); });
    protection.setWarningOnly(false);
    protection.addEditor(installer);
    var others = protection.getEditors().filter(function(user) { return user.getEmail().toLowerCase() !== installer; });
    if (others.length) protection.removeEditors(others);
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  });
}

function conferirSistema() {
  requireInstaller_();
  var config = validateMailConfig_(), journal = readJournal_();
  validateFixedFormActivities_(journal.state);
  if (db_().getSpreadsheetTimeZone() !== config.FUSO || Session.getScriptTimeZone() !== config.FUSO) throw new Error('Fuso da planilha/projeto divergente.');
  var forms = verifyForms_(false);
  var plan = conferirGatilhos_();
  return {instalador: props_().getProperty('SEMINFO_INSTALLER'), emailCa: config.EMAIL_CA, copiaCa: config.ENVIAR_COPIA_CA,
    destinatariosRestantes: MailApp.getRemainingDailyQuota(), inscricoesAbertas: journal.state.accepting,
    operacoes: journal.operations.length, atividades: Object.keys(journal.state.activities).length, forms: forms, formsViaVarredura: plan.viaVarredura,
    atividadesPendentes: Object.values(journal.state.activities).filter(function (activity) { return activity.status === 'pendente'; }).map(function (activity) { return {id: activity.id, titulo: activity.title, detalhe: activity.description}; })};
}

function abrirInscricoes() {
  requireInstaller_(); validateMailConfig_(); validateFixedFormActivities_(readState_()); verifyForms_(true);
  return changeMode_(true);
}

function validateFixedFormActivities_(state) {
  getRegistrationFormDefinitions_().forEach(function(source) {
    if (source.activityId && !state.activities[source.activityId] && !(state.deletedActivities || {})[source.activityId] && !isPendingProgramActivity_(source.activityId)) throw new Error('Cadastre a atividade ' + source.activityId + ' associada ao formulário ' + source.id + ' antes de abrir ou conferir as inscrições.');
  });
}

function encerrarInscricoes() { requireInstaller_(); return changeMode_(false); }

function changeMode_(accepting) {
  withLock_(function() {
    if (accepting && props_().getProperty('SEMINFO_EVENTO_ENCERRADO_EM')) throw new Error('O evento foi encerrado. As inscrições não podem ser reabertas nesta edição.');
    var journal = readJournal_();
    if (journal.state.accepting !== accepting) {
      commitOperationLocked_(journal, {key: 'ADMIN:MODE:' + Utilities.getUuid(), kind: 'MODE', at: new Date().toISOString(), accepting: accepting});
      journal = readJournal_();
    }
    rebuildViewsLocked_(journal);
  });
  return refreshFormsSafely_();
}

/** Fecha todas as origens sem depender de perguntas, API VERIFIED ou vagas. */
function fecharFormulariosEvento_() {
  var sources = getFormSources_(), config = getConfig_();
  var historical = JSON.parse(String(config.IMPORTACAO_CSP_JSON || '{}'));
  if (historical.formId && !sources.some(function (source) { return source.id === historical.formId; })) sources.push({id: historical.formId});
  var result = {fechados: [], falhas: []};
  sources.forEach(function (source) {
    try {
      var form = openFormWithDriveRetry_(source.id);
      // O fechamento é obrigatório mesmo quando a mensagem opcional falha.
      setFormReceiving_(form, false);
      result.fechados.push(source.id);
      setFormClosedMessage_(form, 'A XXI SEMINFO foi encerrada. Inscrições e cancelamentos estão fechados.');
    } catch (error) {
      result.falhas.push({formId: source.id, motivo: safeError_(error)});
      recordError_('encerrar-evento-form', source.id, error);
    }
  });
  result.parcial = result.falhas.length > 0;
  return result;
}

/** Reexecutável após interrupção; não apaga inscrições, respostas ou histórico. */
function encerrarEventoSeminfo() {
  requireInstaller_();
  var result = withExternalFormOperation_(function () {
    var summary = withLock_(function () {
      var properties = props_(), journal = readJournal_();
      if (!properties.getProperty('SEMINFO_EVENTO_ENCERRADO_EM')) properties.setProperty('SEMINFO_EVENTO_ENCERRADO_EM', new Date().toISOString());
      var emails = cancelarEmailsPendentesLocked_();
      if (journal.state.accepting) {
        commitOperationLocked_(journal, {key: 'ADMIN:ENCERRAMENTO:' + Utilities.getUuid(), kind: 'MODE',
          at: new Date().toISOString(), accepting: false, reason: 'Encerramento definitivo da XXI SEMINFO.'});
      }
      var viewsError = '';
      try { rebuildViewsLocked_(readJournal_()); }
      catch (error) { viewsError = safeError_(error); recordError_('encerrar-evento-visoes', '', error); }
      return {encerradoEm: properties.getProperty('SEMINFO_EVENTO_ENCERRADO_EM'), inscricoesAbertas: false,
        emails: emails, erroVisoes: viewsError};
    }, false, true);
    summary.formularios = fecharFormulariosEvento_();
    return summary;
  });
  result.presencas = gerarListasPresencaPorDiaESala();
  result.parcial = !!result.erroVisoes || result.formularios.parcial || result.presencas.parcial || result.emails.emEnvio > 0;
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function gruposPresenca_(state) {
  var references = {}, groups = Object.create(null);
  programacaoSeminfo2026_().forEach(function (entry) { references[entry.id] = entry; });
  Object.values(state.activities).forEach(function (activity) {
    var reference = references[activity.id] || {};
    var date = activity.start ? Utilities.formatDate(new Date(activity.start), 'America/Sao_Paulo', 'yyyy-MM-dd') : (reference.date || 'Sem data');
    var room = String(activity.location || reference.location || 'Sala não informada').trim();
    var key = JSON.stringify([date, room]);
    if (!groups[key]) groups[key] = {data: date, sala: room, atividades: [], linhas: [], inscritos: 0};
    var group = groups[key];
    var beginning = activity.start ? Utilities.formatDate(new Date(activity.start), 'America/Sao_Paulo', 'HH:mm') : (reference.start || 'A confirmar');
    var end = activity.end ? Utilities.formatDate(new Date(activity.end), 'America/Sao_Paulo', 'HH:mm') : (reference.end || 'A confirmar');
    group.atividades.push(activity.title);
    var participants = inscritosDaAtividade_(state, activity.id);
    group.inscritos += participants.length;
    // Atividades vazias também ficam identificadas, sem atestar presença.
    (participants.length ? participants : [{nome: ''}]).forEach(function (participant) {
      group.linhas.push([date, room, beginning + ' – ' + end, activity.title, participant.nome,
        participant.equipe || '', participant.papel || '', '', '', '']);
    });
  });
  return Object.values(groups).sort(function (a, b) {
    return a.data.localeCompare(b.data) || a.sala.localeCompare(b.sala, 'pt-BR', {numeric: true});
  }).map(function (group) {
    group.linhas.sort(function (a, b) { return a[2].localeCompare(b[2]) || a[3].localeCompare(b[3], 'pt-BR') || a[4].localeCompare(b[4], 'pt-BR'); });
    return group;
  });
}

/** Novas fotografias privadas: não sobrescreve marcações de listas anteriores. */
function gerarListasPresencaPorDiaESala() {
  requireInstaller_();
  var state = withLock_(function () { return readState_(); });
  var groups = gruposPresenca_(state), lists = [], errors = [];
  var headers = ['DATA', 'SALA', 'HORARIO', 'ATIVIDADE', 'NOME', 'EQUIPE', 'PAPEL', 'PRESENCA', 'ASSINATURA', 'OBSERVACOES'];
  var suffix = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 8);
  groups.forEach(function (group, index) {
    var label = group.sala.replace(/[\[\]:*?\/\\]/g, '_').slice(0, 32);
    var name = 'Presenca_' + group.data + '_' + label + '_' + (index + 1) + '_' + suffix;
    try {
      writeTable_(name, headers, group.linhas);
      var sheet = db_().getSheetByName(name);
      // Marcações ficam editáveis pela organização com acesso à planilha privada.
      sheet.autoResizeColumns(1, headers.length);
      sheet.setColumnWidth(5, 240);
      sheet.setColumnWidth(9, 260);
      sheet.setRowHeights(2, group.linhas.length, 32);
      lists.push({data: group.data, sala: group.sala, atividades: group.atividades, inscritos: group.inscritos,
        aba: name, url: db_().getUrl() + '#gid=' + sheet.getSheetId()});
    } catch (error) {
      errors.push({data: group.data, sala: group.sala, motivo: safeError_(error)});
      recordError_('listas-presenca', name, error);
    }
  });
  var indexName = 'Presencas_Indice_' + suffix;
  try {
    writeTable_(indexName, ['DATA', 'SALA', 'ATIVIDADES', 'INSCRITOS', 'ABA', 'LINK'], lists.map(function (list) {
      return [list.data, list.sala, list.atividades.join('\n'), list.inscritos, list.aba, list.url];
    }));
  } catch (error) { errors.push({indice: true, motivo: safeError_(error)}); }
  var result = {fuso: 'America/Sao_Paulo', totalSalasDias: groups.length, listasGeradas: lists.length,
    totalInscritos: lists.reduce(function (total, list) { return total + list.inscritos; }, 0),
    indice: errors.some(function (error) { return error.indice; }) ? '' : db_().getUrl() + '#gid=' + db_().getSheetByName(indexName).getSheetId(),
    listas: lists, falhas: errors, parcial: errors.length > 0};
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function menuEncerrarEvento() { SpreadsheetApp.getUi().alert(JSON.stringify(encerrarEventoSeminfo(), null, 2)); }
function menuCancelarEmailsPendentes() { SpreadsheetApp.getUi().alert(JSON.stringify(cancelarEmailsPendentes(), null, 2)); }
function menuListasPresenca() { SpreadsheetApp.getUi().alert(JSON.stringify(gerarListasPresencaPorDiaESala(), null, 2)); }

function atualizarOpcoesFormularios() {
  requireInstaller_(false, true);
  return refreshFormsSafely_();
}

/** Todas as mudanças de cadastro passam aqui; Atividades é uma visão protegida. */
function salvarAtividade(activity) {
  requireInstaller_(false, true);
  var normalized = SemDomain.validateActivity(activity);
  var saved = withLock_(function() {
    var journal = readJournal_();
    if (!normalized.capacityUnit && journal.state.activities[normalized.id] && journal.state.activities[normalized.id].capacityUnit) normalized.capacityUnit = journal.state.activities[normalized.id].capacityUnit;
    if (journal.state.activities[normalized.id] && JSON.stringify(journal.state.activities[normalized.id]) === JSON.stringify(normalized)) return normalized;
    commitOperationLocked_(journal, {key: 'ADMIN:CATALOG:' + Utilities.getUuid(), kind: 'CATALOG', at: new Date().toISOString(), activity: normalized});
    journal = readJournal_(); rebuildViewsLocked_(journal);
    return normalized;
  }, false, false, true);
  try { refreshFormsSafely_(); } catch (error) { recordError_('opcoes', normalized.id, error); }
  return saved;
}

/** Mesmo período para o encerramento e a exportação em lote. */
function atividades27Tarde_(state) {
  var beginning = Date.parse('2026-10-27T12:00:00-03:00');
  var end = Date.parse('2026-10-27T18:00:00-03:00');
  return Object.values(state.activities).filter(function (activity) {
    var start = Date.parse(activity.start);
    return ['palestra', 'oficina'].indexOf(activity.type) >= 0 && start >= beginning && start < end;
  }).sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id); });
}

/** Encerra palestras e oficinas com início em 27/10/2026, das 12h às 18h de São Paulo. */
function encerrarAtividades27Tarde() {
  requireInstaller_(false, true);
  var result = withLock_(function () {
    var journal = readJournal_(), closed = [], unchanged = [];
    atividades27Tarde_(journal.state).forEach(function (activity) {
      if (activity.status !== 'aberta') {
        unchanged.push({id: activity.id, situacao: activity.status});
        return;
      }
      var updated = Object.assign({}, activity, {status: 'encerrada'});
      commitOperationLocked_(journal, {key: 'ADMIN:ENCERRAR_27_TARDE:' + Utilities.getUuid(), kind: 'CATALOG',
        at: new Date().toISOString(), activity: updated,
        reason: 'Encerramento das palestras e oficinas de 27/10/2026 à tarde pela organização.'});
      journal = readJournal_();
      closed.push(activity.id);
    });
    if (closed.length) rebuildViewsLocked_(journal);
    return {data: '2026-10-27', inicio: '12:00', fimExclusivo: '18:00', fuso: 'America/Sao_Paulo',
      encerradas: closed, jaBloqueadas: unchanged};
  }, false, false, true);
  try { result.atualizacaoFormularios = refreshFormsSafely_(undefined, true); }
  catch (error) {
    recordError_('encerrar-27-tarde', '', error);
    result.atualizacaoFormularios = {adiada: true, motivo: safeError_(error)};
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function cancelarInscricaoAdministrativa(cpf, activityId, reason) {
  requireInstaller_(false, true);
  cpf = SemDomain.normalizeCpf(cpf);
  reason = String(reason || '').trim();
  if (reason.length < 5 || reason.length > 500) throw new Error('Justificativa deve ter entre 5 e 500 caracteres.');
  var result = withLock_(function() {
    var journal = readJournal_(), participant = journal.state.participants[cpf];
    if (!participant) throw new Error('Participante inexistente.');
    var key = 'ADMIN:CANCEL:' + Utilities.getUuid(), now = new Date().toISOString();
    var request = {key: key, kind: 'CANCELAMENTO', cpf: cpf, name: participant.name, email: participant.email, activityId: activityId,
      confirmCancel: true, authorizeSwap: false, protocol: protocol_(key), submittedAt: now};
    var outcome = enrichOutcome_(journal.state, request, SemDomain.decide(journal.state, request));
    outcome.changes.forEach(function(c) { c.reason = reason; });
    commitOperationLocked_(journal, {key: key, kind: 'REQUEST', at: now, request: request, outcome: outcome, reason: reason});
    journal = readJournal_(); rebuildViewsLocked_(journal);
    return outcome;
  }, false, false, true);
  // O cancelamento já foi persistido. Uma falha nas opções não desfaz a vaga
  // liberada nem impede a tentativa de envio da confirmação.
  try {
    var refresh = refreshFormsSafely_();
    if (refresh && refresh.adiada) result.atualizacaoFormularios = refresh;
  } catch (error) {
    result.atualizacaoFormularios = {adiada: true, motivo: safeError_(error)};
    recordError_('cancelamento-opcoes', activityId, error);
  }
  postProcessing_();
  return result;
}

function alterarEmailParticipante(cpf, newEmail, reason) {
  requireInstaller_(); cpf = SemDomain.normalizeCpf(cpf); newEmail = SemDomain.normalizeEmail(newEmail);
  reason = String(reason || '').trim();
  if (reason.length < 5 || reason.length > 500) throw new Error('Registre uma justificativa de 5 a 500 caracteres após verificar a identidade presencialmente.');
  return withLock_(function() {
    var journal = readJournal_(), participant = journal.state.participants[cpf];
    if (!participant) throw new Error('CPF não cadastrado.');
    if (participant.email === newEmail) return participant;
    commitOperationLocked_(journal, {key: 'ADMIN:EMAIL:' + Utilities.getUuid(), kind: 'PARTICIPANT_EMAIL', at: new Date().toISOString(),
      participantEmailChange: {cpf: cpf, oldEmail: participant.email, newEmail: newEmail}, reason: reason});
    journal = readJournal_(); rebuildViewsLocked_(journal);
    return journal.state.participants[cpf];
  });
}

function consultarOcupacao() {
  requireInstaller_(false, true);
  var state = readState_();
  return Object.values(state.activities).map(function(a) {
    var occupied = SemDomain.occupancy(state, a.id);
    return {id: a.id, titulo: a.title, capacidade: a.capacity, ocupacao: occupied,
      situacao: activityRegistrationStatus_(state, a, occupied), situacaoCadastro: a.status};
  });
}

/** Simula somente recusas por fechamento/lotação, mantendo a recepção fechada. */
function planoReavaliacaoInscricoes_(journal, activityId, capacity) {
  var current = journal.state.activities[activityId];
  if (!current) throw new Error('Atividade inexistente.');
  if (current.status !== 'encerrada' || current.capacityUnit === 'equipes') throw new Error('A reavaliação exige uma atividade individual encerrada.');
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Informe uma capacidade inteira positiva.');
  var activity = SemDomain.validateActivity(Object.assign({}, current, {capacity: capacity}));
  var state = SemDomain.applyOperation(journal.state, {key: 'PREVIA:CAPACIDADE:' + activityId,
    kind: 'CATALOG', at: new Date().toISOString(), activity: activity});
  var properties = props_().getProperties(), sources = getFormSources_(), latest = {}, history = {};
  Object.values(state.registrations).forEach(function (registration) {
    if (registration.activityId === activityId && registration.cpf) history[registration.cpf] = registration;
  });
  journal.operations.forEach(function (operation) {
    var request = operation.request;
    if (operation.kind !== 'REQUEST' || !request || request.kind !== 'INSCRICAO' || request.activityId !== activityId || operation.reassessmentOf) return;
    var cpf;
    try { cpf = SemDomain.normalizeCpf(request.cpf); }
    catch (_) { cpf = 'INVALIDO:' + operation.key; }
    var previous = latest[cpf];
    if (!previous || Date.parse(request.submittedAt) > Date.parse(previous.request.submittedAt) ||
        Date.parse(request.submittedAt) === Date.parse(previous.request.submittedAt) && operation.key > previous.key) latest[cpf] = operation;
  });
  var rows = [], operations = [], counts = {};
  Object.keys(latest).map(function (cpf) { return {cpf: cpf, original: latest[cpf]}; }).sort(function (a, b) {
    return Date.parse(a.original.request.submittedAt) - Date.parse(b.original.request.submittedAt) || a.original.key.localeCompare(b.original.key);
  }).forEach(function (entry) {
    var original = entry.original, request = original.request, previous = history[entry.cpf], code, detail;
    var source = sources.find(function (source) { return source.kind === 'INSCRICAO' && source.id === request.formId && (!source.activityId || source.activityId === activityId); });
    var cutoff = properties['SEMINFO_VERIFIED_SINCE_' + request.formId];
    var key = 'ADMIN:REAVALIACAO:' + protocol_(original.key), outcome;
    if (previous) {
      code = previous.status === 'confirmada' ? 'ja_confirmada' : 'cancelada_ou_trocada';
      detail = previous.status === 'confirmada' ? 'Inscrição atual preservada.' : 'Cancelamento ou troca anterior preservado; não será reinscrita.';
    } else if (!original.outcome || ['closed', 'full'].indexOf(original.outcome.code) < 0) {
      code = 'outra_recusa'; detail = original.outcome && original.outcome.message || 'Não há recusa por fechamento ou lotação.';
    } else if (journal.byKey[key]) {
      code = 'ja_reavaliada'; detail = 'Esta resposta já foi reavaliada.';
    } else if (!source || request.key !== request.formId + ':' + request.responseId || request.identitySource ||
        !cutoff || !(Date.parse(request.submittedAt) > Date.parse(cutoff)) ||
        properties.SEMINFO_RESET_AT && Date.parse(request.submittedAt) <= Date.parse(properties.SEMINFO_RESET_AT)) {
      code = 'origem_nao_elegivel'; detail = 'Origem ou período verificado não permite reavaliação desta resposta.';
    } else {
      // A autorização antiga de troca não cancela inscrições escolhidas depois.
      var revised = Object.assign({}, request, {key: key, protocol: protocol_(key), authorizeSwap: false});
      var activities = Object.assign({}, state.activities);
      activities[activityId] = Object.assign({}, activity, {status: 'aberta'});
      var decisionState = Object.assign({}, state, {accepting: true, activities: activities});
      outcome = enrichOutcome_(state, revised, SemDomain.decide(decisionState, revised));
      code = outcome.code; detail = outcome.message;
      if (code === 'confirmed') {
        outcome.changes.forEach(function (change) { if (change.registration) change.registration.activity = activity; });
        var operation = {key: key, kind: 'REQUEST', at: new Date().toISOString(), request: revised, outcome: outcome,
          reassessmentOf: original.key, reassessedBy: properties.SEMINFO_INSTALLER,
          reason: 'Reavaliação administrativa de resposta recusada por fechamento ou lotação, sem cancelar outras inscrições.'};
        state = SemDomain.applyOperation(state, operation);
        operations.push(operation);
      }
    }
    counts[code] = (counts[code] || 0) + 1;
    rows.push({protocolo: request.protocol, nome: request.name, recebidaEm: request.submittedAt,
      resultadoAnterior: original.outcome && original.outcome.code || '', resultadoPrevisto: code, detalhe: detail});
  });
  return {activity: activity, operations: operations, report: {activityId: activityId, capacidade: capacity,
    ocupacaoAtual: SemDomain.occupancy(journal.state, activityId), novasConfirmacoes: operations.length,
    ocupacaoPrevista: SemDomain.occupancy(state, activityId), vagasRestantes: capacity - SemDomain.occupancy(state, activityId),
    resultados: counts, solicitacoes: rows}, token: hash_(JSON.stringify({head: journal.head, activity: activity,
      generation: properties.SEMINFO_GENERATION || '', resetAt: properties.SEMINFO_RESET_AT || '', sources: sources,
      cutoffs: sources.map(function (source) { return properties['SEMINFO_VERIFIED_SINCE_' + source.id] || ''; })}))};
}

function prepararReavaliacaoInscricoes(activityId, capacity) {
  requireInstaller_(false, true);
  var result = withLock_(function () {
    var plan = planoReavaliacaoInscricoes_(readJournal_(), String(activityId || '').trim(), capacity);
    return Object.assign({token: plan.token}, plan.report);
  }, false, false, true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Revalida o livro sob lock; cada confirmação conserva o vínculo com a recusa original. */
function confirmarReavaliacaoInscricoes(activityId, capacity, token, reason) {
  requireInstaller_(false, true);
  activityId = String(activityId || '').trim();
  reason = String(reason || '').trim();
  if (reason.length < 5 || reason.length > 500) throw new Error('Justificativa deve ter entre 5 e 500 caracteres.');
  var result = withLock_(function () {
    var journal = readJournal_(), plan = planoReavaliacaoInscricoes_(journal, String(activityId || '').trim(), capacity);
    if (!token || token !== plan.token) throw new Error('O cadastro ou as inscrições mudaram depois da prévia. Prepare a reavaliação novamente.');
    if (JSON.stringify(journal.state.activities[activityId]) !== JSON.stringify(plan.activity)) {
      commitOperationLocked_(journal, {key: 'ADMIN:CAPACIDADE:' + token, kind: 'CATALOG',
        at: new Date().toISOString(), activity: plan.activity, reason: reason});
      journal = readJournal_();
    }
    plan.operations.forEach(function (operation) {
      operation.reason = reason;
      commitOperationLocked_(journal, operation);
      journal = readJournal_();
    });
    rebuildViewsLocked_(journal);
    return {activityId: activityId, capacidade: capacity, novasConfirmacoes: plan.operations.length,
      ocupacao: SemDomain.occupancy(journal.state, activityId), situacao: journal.state.activities[activityId].status,
      vagasRestantes: capacity - SemDomain.occupancy(journal.state, activityId)};
  }, false, false, true);
  // O Form já está encerrado; não repete a atualização lenta de todos os Forms.
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function menuReavaliarInscricoes() {
  var text = promptText_('Reavaliar inscrições recusadas / corrigir capacidade',
    'Cole JSON: {"activityId":"OFICINA_IA_ALEM_CHAT","capacity":25,"reason":"Correção da capacidade e reavaliação das solicitações já enviadas."}. A atividade deve estar encerrada.');
  if (text === null) return;
  var input = JSON.parse(text), preview = prepararReavaliacaoInscricoes(input.activityId, input.capacity), ui = SpreadsheetApp.getUi();
  var message = 'Capacidade: ' + preview.capacidade + '\nOcupação atual: ' + preview.ocupacaoAtual +
    '\nNovas confirmações possíveis: ' + preview.novasConfirmacoes + '\nOcupação prevista: ' + preview.ocupacaoPrevista +
    '\nVagas ainda livres: ' + preview.vagasRestantes + '\n\n' + preview.solicitacoes.map(function (row) {
      return row.nome + ': ' + row.resultadoPrevisto + ' — ' + row.detalhe;
    }).join('\n') + '\n\nAplicar a capacidade e as confirmações previstas? O formulário continuará encerrado.';
  if (ui.alert('Prévia da reavaliação', message, ui.ButtonSet.YES_NO) === ui.Button.YES) {
    ui.alert(JSON.stringify(confirmarReavaliacaoInscricoes(input.activityId, input.capacity, preview.token, input.reason), null, 2));
  }
}

function consultarInscritos(activityId) {
  requireInstaller_();
  return inscritosDaAtividade_(readState_(), activityId);
}

function inscritosDaAtividade_(state, activityId) {
  if (!state.activities[activityId]) throw new Error('Atividade inexistente.');
  var rows = [];
  Object.values(state.registrations).filter(function(r) { return r.activityId === activityId && r.status === 'confirmada'; }).forEach(function(r) {
    if (r.entityType === 'EQUIPE') {
      r.members.forEach(function (member) { rows.push({nome: member.name, cpf: member.cpf, email: '', equipe: r.teamName,
        tipoEquipe: r.teamType || '', papel: member.role, turma: member.turma || '', telefone: member.telefone || '', inscricao: r.id}); });
      return;
    }
    var p = state.participants[r.cpf];
    rows.push({nome: p.name, email: p.email, cpf: p.cpf, inscricao: r.id});
  });
  return rows;
}

/** Exporta para uma nova aba privada; a planilha não é compartilhada com participantes. */
function exportarConfirmados(activityId) {
  requireInstaller_();
  return exportarConfirmadosDoEstado_(readState_(), activityId).url;
}

function exportarConfirmadosDoEstado_(state, activityId) {
  var rows = inscritosDaAtividade_(state, activityId), name = 'Lista_' + activityId + '_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 4);
  var teams = state.activities[activityId].capacityUnit === 'equipes';
  var headers = teams ? ['EQUIPE', 'TIPO_EQUIPE', 'NOME', 'PAPEL', 'CPF', 'TURMA', 'TELEFONE', 'INSCRICAO'] : ['NOME', 'EMAIL', 'CPF', 'INSCRICAO'];
  writeTable_(name, headers, rows.map(function(p) { return teams ? [p.equipe, p.tipoEquipe, p.nome, p.papel, p.cpf, p.turma, p.telefone, p.inscricao] : [p.nome, p.email, p.cpf, p.inscricao]; }));
  var sheet = db_().getSheetByName(name);
  var protection = sheet.protect().setDescription('SEMINFO — lista privada');
  protection.addEditor(props_().getProperty('SEMINFO_INSTALLER'));
  protection.removeEditors(protection.getEditors().filter(function(user) { return user.getEmail().toLowerCase() !== props_().getProperty('SEMINFO_INSTALLER'); }));
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  sheet.autoResizeColumns(1, headers.length);
  return {aba: name, inscritos: rows.length, url: db_().getUrl() + '#gid=' + sheet.getSheetId()};
}

/** Uma fotografia do livro para todas as listas, inclusive de atividades encerradas ou vazias. */
function exportarListas27Tarde() {
  requireInstaller_();
  var state = withLock_(function () { return readState_(); });
  var activities = atividades27Tarde_(state), lists = [], errors = [];
  activities.forEach(function (activity) {
    try {
      var exported = exportarConfirmadosDoEstado_(state, activity.id);
      lists.push({activityId: activity.id, titulo: activity.title, aba: exported.aba,
        inscritos: exported.inscritos, url: exported.url});
    } catch (error) {
      recordError_('exportar-listas-27-tarde', activity.id, error);
      errors.push({activityId: activity.id, motivo: safeError_(error)});
    }
  });
  var result = {data: '2026-10-27', inicio: '12:00', fimExclusivo: '18:00', fuso: 'America/Sao_Paulo',
    totalAtividades: activities.length, listasGeradas: lists.length,
    totalInscritos: lists.reduce(function (total, list) { return total + list.inscritos; }, 0),
    listas: lists, falhas: errors, parcial: errors.length > 0};
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function carregarDemonstracao() {
  requireInstaller_();
  var examples = [
    {id: 'DEMO_GO', title: 'Introdução a Go', type: 'oficina', description: 'Dados fictícios; não abrir ao público.', instructor: 'Ana Exemplo', location: 'Laboratório 1', start: '2026-11-09T14:00:00-03:00', end: '2026-11-09T16:00:00-03:00', capacity: 2, status: 'aberta'},
    {id: 'DEMO_WEB', title: 'Aplicações web', type: 'oficina', description: 'Conflito parcial com Go.', instructor: 'Bruno Exemplo', location: 'Laboratório 2', start: '2026-11-09T15:00:00-03:00', end: '2026-11-09T17:00:00-03:00', capacity: 2, status: 'aberta'},
    {id: 'DEMO_IA', title: 'Panorama de IA', type: 'palestra', description: 'Consecutiva a Go.', instructor: 'Carla Exemplo', location: 'Auditório', start: '2026-11-09T16:00:00-03:00', end: '2026-11-09T18:00:00-03:00', capacity: 3, status: 'aberta'},
    {id: 'DEMO_DIA2', title: 'Segurança digital', type: 'palestra', description: 'Mesmo horário no dia seguinte.', instructor: 'Diego Exemplo', location: 'Auditório', start: '2026-11-10T14:00:00-03:00', end: '2026-11-10T16:00:00-03:00', capacity: 1, status: 'aberta'},
    {id: 'DEMO_LONGA', title: 'Projeto integrado', type: 'oficina', description: 'Troca pode afetar Go e IA.', instructor: 'Eva Exemplo', location: 'Laboratório 3', start: '2026-11-09T14:00:00-03:00', end: '2026-11-09T18:00:00-03:00', capacity: 1, status: 'aberta'}
  ];
  examples.forEach(function(activity) {
    if (!readState_().activities[activity.id]) salvarAtividade(activity);
  });
  return examples.map(function(a) { return a.id; });
}

function promptText_(title, instruction) {
  var ui = SpreadsheetApp.getUi(), answer = ui.prompt(title, instruction, ui.ButtonSet.OK_CANCEL);
  return answer.getSelectedButton() === ui.Button.OK ? answer.getResponseText().trim() : null;
}
function menuConferir() { SpreadsheetApp.getUi().alert(JSON.stringify(conferirSistema(), null, 2)); }
function menuCotaEmails() { SpreadsheetApp.getUi().alert(JSON.stringify(consultarCotaEmails(), null, 2)); }
function menuRepararGatilhos() { SpreadsheetApp.getUi().alert(JSON.stringify(repararGatilhos(), null, 2)); }
function menuPerguntasFormularios() { requireInstaller_(); SpreadsheetApp.getUi().alert(JSON.stringify(listarPerguntasDosFormularios(), null, 2)); }
function menuOcupacao() { SpreadsheetApp.getUi().alert(JSON.stringify(consultarOcupacao(), null, 2)); }
function menuProcessarSolicitacoes() { SpreadsheetApp.getUi().alert(JSON.stringify(processarSolicitacoesPendentes(), null, 2)); postProcessing_(); }
function menuProcessarEmails() { requireInstaller_(false, true); SpreadsheetApp.getUi().alert(JSON.stringify(processarNotificacoes(), null, 2)); }
function menuErros() { requireInstaller_(); db_().setActiveSheet(db_().getSheetByName('Erros')); }
function menuHistorico() { requireInstaller_(); db_().setActiveSheet(db_().getSheetByName('Historico')); }
function menuSalvarAtividade() {
  var text = promptText_('Cadastrar / atualizar atividade', 'Cole JSON com id,title,type,description,instructor,location,start,end,capacity,status. Use ISO com fuso, ex.: 2026-11-09T14:00:00-03:00. O ID é permanente.');
  if (text !== null) SpreadsheetApp.getUi().alert(JSON.stringify(salvarAtividade(JSON.parse(text)), null, 2));
}
function menuExportar() { var id = promptText_('Exportar lista', 'ID da atividade:'); if (id !== null) SpreadsheetApp.getUi().alert(exportarConfirmados(id)); }
function menuExportarListas27Tarde() { SpreadsheetApp.getUi().alert(JSON.stringify(exportarListas27Tarde(), null, 2)); }
function menuCancelar() {
  var text = promptText_('Cancelamento administrativo', 'Cole JSON: {"cpf":"...","activityId":"...","reason":"justificativa"}');
  if (text !== null) { var p = JSON.parse(text); SpreadsheetApp.getUi().alert(JSON.stringify(cancelarInscricaoAdministrativa(p.cpf, p.activityId, p.reason))); }
}
function menuAlterarEmail() {
  var text = promptText_('Correção de e-mail', 'Após conferir a identidade pelo CA, cole JSON: {"cpf":"...","newEmail":"...","reason":"justificativa"}');
  if (text !== null) { var p = JSON.parse(text); alterarEmailParticipante(p.cpf, p.newEmail, p.reason); SpreadsheetApp.getUi().alert('E-mail atualizado e auditado.'); }
}

/** Exclui do catálogo; o Form fixo permanece instalado e fechado. */
function apagarAtividade(activityId) {
  requireInstaller_();
  var result = withLock_(function () {
    var journal = readJournal_();
    activityId = String(activityId || '').trim();
    if (!journal.state.activities[activityId]) throw new Error('Atividade inexistente.');
    commitOperationLocked_(journal, {key: 'ADMIN:DELETE:' + Utilities.getUuid(), kind: 'DELETE_ACTIVITY',
      at: new Date().toISOString(), activityId: activityId, reason: 'Atividade excluída pela organização.'});
    journal = readJournal_();
    rebuildViewsLocked_(journal);
    return {apagada: activityId};
  });
  try { refreshFormsSafely_(); } catch (error) { recordError_('excluir-atividade', activityId, error); }
  return result;
}

function menuApagarAtividade() {
  requireInstaller_();
  var id = promptText_('Apagar atividade', 'ID da atividade sem inscrições. O Form será mantido e ficará fechado.');
  if (id) SpreadsheetApp.getUi().alert(JSON.stringify(apagarAtividade(id), null, 2));
}

function openFormWithDriveRetry_(formId) {
  var lastError;
  for (var attempt = 0; attempt < 3; attempt++) {
    try { return FormApp.openById(formId); }
    catch (error) {
      lastError = error;
      var message = String(error && error.message || error);
      var transientServiceError =
        /Drive.*(?:tempo limite|timed out|timeout)|(?:tempo limite|timed out|timeout).*Drive/i.test(message) ||
        /Unexpected error while getting the method or property openById on object FormApp/i.test(message);
      if (!transientServiceError || attempt === 2) {
        throw error;
      }
      Utilities.sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

/** Atualiza também instalações existentes; mantém IDs, vínculos e mapeamentos. */
function formulariosPublicosSeminfo2026_() {
  var definitions = JSON.parse(String(getConfig_().FORMULARIOS_PUBLICOS_SEMINFO_JSON || '[]'));
  if (!Array.isArray(definitions)) throw new Error('FORMULARIOS_PUBLICOS_SEMINFO_JSON deve ser uma lista.');
  return definitions;
}

/** Confere a URL publicada; um ID de participação nunca é usado como ID de edição. */
function resolverFormularioPublicoSeminfo_(definition, configured) {
  function canonical(url) { return String(url).split('?')[0].replace(/\/$/, ''); }
  if (!/^https:\/\/docs\.google\.com\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform$/.test(canonical(definition.url))) {
    throw new Error('URL de participação inválida para ' + definition.title + '.');
  }
  var candidates = configured.filter(function (entry) { return entry.activityId === definition.activityId; });
  for (var i = 0; i < candidates.length; i++) {
    var installed = openFormWithDriveRetry_(candidates[i].id);
    if (canonical(installed.getPublishedUrl()) === canonical(definition.url)) return installed;
  }
  try {
    var direct = FormApp.openByUrl(definition.url);
    if (canonical(direct.getPublishedUrl()) === canonical(definition.url)) return direct;
  } catch (_) { /* A URL pública pode exigir a busca do arquivo de edição no Drive. */ }
  var names = [definition.driveTitle || definition.title, definition.title];
  for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
    var files = DriveApp.getFilesByName(names[nameIndex]);
    while (files.hasNext()) {
      var file = files.next();
      if (file.isTrashed() || file.getMimeType() !== 'application/vnd.google-apps.form') continue;
      var form = openFormWithDriveRetry_(file.getId());
      if (canonical(form.getPublishedUrl()) === canonical(definition.url)) return form;
    }
  }
  throw new Error('Não foi possível localizar o Form de ' + definition.title + ' pela conta instaladora. Acrescente seu ID de edição em FORMULARIOS_INSCRICAO_JSON, com activityId ' + definition.activityId + ', e repita a atualização.');
}

function prepararFormulariosSeminfo2026() {
  requireInstaller_();
  var currentConfig = String(getConfig_().FORMULARIOS_INSCRICAO_JSON || '[]');
  var current = getRegistrationFormDefinitions_();
  var expected = JSON.parse(SEMINFO_CONFIG.FORMULARIOS_INSCRICAO_JSON);
  var merged = current.filter(function (entry) { return !!entry.id; });
  formulariosPublicosSeminfo2026_().forEach(function (entry) {
    var form = resolverFormularioPublicoSeminfo_(entry, merged);
    expected.push({id: form.getId(), activityId: entry.activityId, title: entry.title, items: entry.items || {}});
  });
  expected.forEach(function (entry) {
    var existing = merged.find(function (item) { return item.id === entry.id; });
    if (existing && existing.activityId !== entry.activityId) throw new Error('O Form ' + entry.id + ' já aponta para outra atividade. Preserve seu vínculo antes de continuar.');
    if (existing) existing.title = entry.title;
    else merged.push(entry);
  });
  // Drive calls can be slow; validate before taking the global lock.
  merged.forEach(function (entry) { openFormWithDriveRetry_(entry.id).getTitle(); });
  return withLock_(function () {
    if (String(getConfig_().FORMULARIOS_INSCRICAO_JSON || '[]') !== currentConfig) {
      throw new Error('A configuração dos Forms mudou durante a validação. Execute a preparação novamente.');
    }
    setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify(merged));
    return merged;
  });
}

function programacaoSeminfo2026_() {
  function item(id, date, start, end, title, type, instructor, location, capacity, pending) {
    return {id: id, date: date, start: start, end: end, title: title, type: type,
      instructor: instructor, location: location, capacity: capacity, pending: pending || ''};
  }
  return [
    item('ABERTURA_2026', '2026-10-26', '13:00', '17:00', 'Abertura — XXI Seminfo', 'programacao', '', 'Auditório Novo', null, 'Capacidade. Bloco com credenciamento, palestra de Douglas e coffee break.'),
    item('CREDENCIAMENTO_2026', '2026-10-26', '', '', 'Credenciamento e registro de presença', '', '', 'Auditório Novo', null, 'Integra o bloco das 13h às 17h; horários individuais e Form não informados.'),
    // Os IDs históricos são mantidos para preservar inscrições e vínculos dos Forms.
    item('PALESTRA_RENATO', '2026-10-26', '', '', 'Inteligência Artificial e Inovação: muito além de um prompt e um conjunto de dados', 'palestra', 'Prof. Dr. Douglas Donizeti de Castilho Braz', 'Auditório Novo', null, 'Integra o bloco das 13h às 17h; horários individuais, capacidade e Form não informados.'),
    item('COFFEE_BREAK', '2026-10-26', '', '', 'Coffee break', '', '', 'Auditório Novo', null, 'Integra o bloco das 13h às 17h; horários individuais e Form não informados.'),
    item('NOITE_26', '2026-10-26', '19:00', '', 'Troubleshooting e dados no mundo real', 'palestra', 'Ana Carolina Brazão', 'Online — Google Meet', null, 'Término e capacidade.'),
    item('OFICINA_GAMEMAKER', '2026-10-27', '13:00', '17:00', 'Desenvolvimento de Jogos 2D com GameMaker — Tarde', 'oficina', 'Ricardo José Martins', 'Sala 14', 30),
    item('OFICINA_YASMIN_GABRIEL', '2026-10-27', '13:00', '17:00', 'Pipeline de Dados em Tempo Real: Do Zero ao Dashboard', 'oficina', 'Tiago Fernandes Moraes', 'Sala 16', 30),
    item('OFICINA_BLENDER', '2026-10-27', '13:00', '17:00', 'Introdução ao 3D com Blender', 'oficina', 'Caio Henrique Magalhães', 'Sala 15', 20),
    item('OFICINA_OLLAMA', '2026-10-27', '13:00', '17:00', 'Rodando Inteligência Artificial no seu PC com Ollama', 'oficina', 'Gabriel Madeira', 'Sala 5 — Redes', 15),
    item('OFICINA_IA_ALEM_CHAT', '2026-10-27', '13:00', '17:00', 'IA Além do Chat: Guia Prático para Geração de Imagens e Vídeos com o Gemini', 'oficina', 'Rafaela Alves Magalhães e Felipe Antony Baquião Avelar', 'Sala 13', 25),
    item('OFICINA_C', '2026-10-27', '13:00', '17:00', 'Introdução à linguagem C', 'oficina', 'Matheus Matias dos Santos, Matheus Henrique Dias e Felipe Augusto de Melo Lozano', 'Cesário Coimbra — Sala 09', 40),
    item('OFICINA_JOGOS_NOITE', '2026-10-27', '19:00', '23:00', 'Desenvolvimento de Jogos 2D com GameMaker — Noite', 'oficina', 'Ricardo José Martins', 'Sala 14', 30),
    item('PALESTRA_BIO', '2026-10-27', '13:30', '', 'Acervo Brasileiro de Referências sobre Eugenia (ABREU): o uso de ferramentas Google na construção de uma plataforma de divulgação científica', 'palestra', '', 'Auditório H', null, 'Término, capacidade e palestrante.'),
    item('OFICINA_SEGURANCA', '2026-10-28', '13:00', '17:00', 'Segurança da Informação na Prática: Aprenda, Identifique e Proteja-se', 'oficina', 'Rafaela Alves Magalhães e Nycollas Icrad Luz Machado', 'Sala 15', 30),
    item('PALESTRA_DANIELE', '2026-10-28', '19:30', '', 'Computação Quântica: Entendendo o contexto para inovar no futuro', 'palestra', 'Daniele Nazaré Tavares', 'Online — Google Meet', null, 'Término e capacidade.'),
    item('CSP_2026', '2026-10-29', '13:00', '15:30', 'Competição Seminfo de Programação — CSP', 'competicao', '', 'Prédio da Informática', 60),
    item('ENCERRAMENTO_2026', '2026-10-29', '15:30', '17:00', 'Encerramento', '', '', 'Auditório H', null, 'Sem Form de inscrição informado.'),
    item('PALESTRA_JOHNATAN', '2026-10-29', '19:30', '', 'Ainda precisamos aprender a programar? O futuro da Engenharia de Software na era da Inteligência Artificial', 'palestra', 'Prof. Dr. Johnatan Alves de Oliveira', 'Online — Google Meet', null, 'Término e capacidade.')
  ];
}

/** Reserva das 19h às 22h no calendário principal da conta instaladora e lista os links em Meets. */
function criarMeetsSeminfo2026() {
  requireInstaller_();
  if (typeof Calendar === 'undefined') throw new Error('Habilite o serviço Google Calendar API, versão v3, com identificador Calendar.');
  return withLock_(function () {
    var ids = ['NOITE_26', 'PALESTRA_DANIELE', 'PALESTRA_JOHNATAN'];
    var report = programacaoSeminfo2026_().filter(function (entry) { return ids.indexOf(entry.id) >= 0; }).map(function (entry) {
      var start = entry.date + 'T19:00:00-03:00';
      var end = new Date(Date.parse(start) + 3 * 60 * 60 * 1000).toISOString();
      var row = {ATIVIDADE_ID: entry.id, TITULO: entry.title, PALESTRANTE: entry.instructor,
        INICIO: start, TERMINO: end, MEET: '', EVENTO_AGENDA: '', SITUACAO: ''};
      try {
        var event = obterOuCriarMeetSeminfo_(entry, start, end);
        row.INICIO = event.start.dateTime;
        row.TERMINO = event.end.dateTime;
        row.MEET = linkMeetSeminfo_(event);
        row.EVENTO_AGENDA = event.htmlLink || '';
        var status = event.conferenceData && event.conferenceData.createRequest && event.conferenceData.createRequest.status;
        row.SITUACAO = row.MEET ? 'PRONTO' : status && status.statusCode === 'failure' ?
          'ERRO: Google não conseguiu gerar o Meet; confira a conta e execute novamente.' :
          'PENDENTE: execute novamente para consultar o link.';
      } catch (error) {
        row.SITUACAO = 'ERRO: ' + safeError_(error);
      }
      console.log(entry.title + '\n' + (row.MEET || row.SITUACAO));
      return row;
    });
    writeTable_('Meets', ['ATIVIDADE_ID', 'TITULO', 'PALESTRANTE', 'INICIO', 'TERMINO', 'MEET', 'EVENTO_AGENDA', 'SITUACAO'], report);
    if (report.some(function (row) { return row.SITUACAO.indexOf('ERRO:') === 0; })) {
      throw new Error('Há falhas na criação dos Meets. Consulte a aba Meets e o registro de execução. Execute novamente após corrigir; os eventos já criados serão reaproveitados.');
    }
    return report;
  });
}

function obterOuCriarMeetSeminfo_(entry, start, end) {
  // ID estável: uma resposta perdida ou a repetição da função não gera outro evento.
  var id = 'seminfo2026' + protocol_('MEET:' + entry.id).slice(4).toLowerCase();
  var marker = 'SEMINFO_2026:' + entry.id;
  var event;
  try { event = Calendar.Events.get('primary', id); }
  catch (error) { if (!erroCalendarSeminfo_(error, 404)) throw error; }
  if (!event) {
    var resource = {id: id, summary: 'XXI SEMINFO — ' + entry.title,
      description: 'Palestrante: ' + entry.instructor + '\nReserva de 3 horas, incluindo margem para atrasos.',
      start: {dateTime: start, timeZone: 'America/Sao_Paulo'},
      end: {dateTime: end, timeZone: 'America/Sao_Paulo'},
      extendedProperties: {private: {seminfoMeet: marker}},
      conferenceData: pedidoMeetSeminfo_()};
    try { event = Calendar.Events.insert(resource, 'primary', {conferenceDataVersion: 1, sendUpdates: 'none'}); }
    catch (error) {
      if (!erroCalendarSeminfo_(error, 409)) throw error;
      event = Calendar.Events.get('primary', id);
    }
  }
  if (event.status === 'cancelled') throw new Error('O evento foi excluído do calendário. Confira-o na lixeira do Google Agenda antes de continuar.');
  if (!event.extendedProperties || !event.extendedProperties.private || event.extendedProperties.private.seminfoMeet !== marker) {
    throw new Error('O ID do evento já existe e não pertence a esta palestra da SEMINFO.');
  }
  // Atualiza também as reservas antigas, preservando o mesmo evento e o link do Meet.
  if (Date.parse(event.start && event.start.dateTime) !== Date.parse(start) || Date.parse(event.end && event.end.dateTime) !== Date.parse(end)) {
    event = Calendar.Events.patch({start: {dateTime: start, timeZone: 'America/Sao_Paulo'},
      end: {dateTime: end, timeZone: 'America/Sao_Paulo'}}, 'primary', id, {conferenceDataVersion: 1, sendUpdates: 'none'});
  }
  // Só repete pedidos de conferência ausentes ou falhos.
  var data = event.conferenceData, request = data && data.createRequest;
  if (!linkMeetSeminfo_(event) && (!data || !request || request.status && request.status.statusCode === 'failure')) {
    event = Calendar.Events.patch({conferenceData: pedidoMeetSeminfo_()}, 'primary', id, {conferenceDataVersion: 1, sendUpdates: 'none'});
  }
  for (var attempt = 0; attempt < 5 && !linkMeetSeminfo_(event); attempt++) {
    var status = event.conferenceData && event.conferenceData.createRequest && event.conferenceData.createRequest.status;
    if (status && status.statusCode === 'failure') break;
    Utilities.sleep(1000);
    event = Calendar.Events.get('primary', id);
  }
  return event;
}

function pedidoMeetSeminfo_() {
  return {createRequest: {requestId: Utilities.getUuid(), conferenceSolutionKey: {type: 'hangoutsMeet'}}};
}

function linkMeetSeminfo_(event) {
  if (event.hangoutLink) return event.hangoutLink;
  var entries = event.conferenceData && event.conferenceData.entryPoints || [];
  var video = entries.find(function (entry) { return entry.entryPointType === 'video'; });
  return video && video.uri || '';
}

function erroCalendarSeminfo_(error, code) {
  var found = Number(error && (error.code || error.details && error.details.code));
  if (found) return found === code;
  var message = String(error && error.message || error);
  return code === 404 ? /\b404\b|\bNot Found\b|\bNão encontrado\b/i.test(message) :
    /\b409\b|\balready exists\b|\bConflict\b|\bjá existe\b/i.test(message);
}

function isPendingProgramActivity_(id) {
  return programacaoSeminfo2026_().some(function (entry) { return entry.id === id && (!entry.start || !entry.end || !entry.capacity); });
}

/** Um cadastro pendente preserva campos desconhecidos sem inventar valores. */
function atividadeDaProgramacao_(entry) {
  var activity = {id: entry.id, title: entry.title, type: entry.type || 'programacao',
    description: 'Programação de ' + entry.date + '.' + (entry.pending ? ' Pendências: ' + entry.pending : ''),
    instructor: entry.instructor, location: entry.location,
    start: entry.start ? entry.date + 'T' + entry.start + ':00-03:00' : '',
    end: entry.end ? entry.date + 'T' + entry.end + ':00-03:00' : '',
    capacity: entry.capacity, status: !entry.type || !entry.start || !entry.end || !entry.capacity ? 'pendente' : 'aberta'};
  if (entry.id === 'CSP_2026') activity.capacityUnit = 'equipes';
  return SemDomain.validateActivity(activity);
}

/** Aplica a versão final inteira em uma operação, incluindo os horários dos inscritos. */
function sincronizarCatalogoProgramacaoFinalSeminfo2026_() {
  requireInstaller_();
  return withLock_(function () {
    var journal = readJournal_(), changed = [], created = [], updated = [], retired = [];
    var obsoleteTimes = ['CREDENCIAMENTO_2026', 'PALESTRA_RENATO', 'COFFEE_BREAK', 'NOITE_26'];
    function sameDay(instant, date) {
      var beginning = Date.parse(date + 'T00:00:00-03:00'), value = Date.parse(instant);
      return isFinite(value) && value >= beginning && value < beginning + 86400000;
    }
    programacaoSeminfo2026_().forEach(function (entry) {
      if ((journal.state.deletedActivities || {})[entry.id]) return;
      var existing = journal.state.activities[entry.id], activity = atividadeDaProgramacao_(entry);
      if (existing) {
        if (!activity.capacity && existing.capacity) activity.capacity = existing.capacity;
        if (!activity.start && obsoleteTimes.indexOf(entry.id) < 0 && sameDay(existing.start, entry.date)) activity.start = existing.start;
        if (!activity.end && obsoleteTimes.indexOf(entry.id) < 0 && sameDay(existing.end, entry.date)) activity.end = existing.end;
        if (!activity.instructor && existing.instructor) activity.instructor = existing.instructor;
        if (activity.start && activity.end && Date.parse(activity.end) <= Date.parse(activity.start)) activity.end = '';
        activity.status = activity.start && activity.end && activity.capacity ? 'aberta' : 'pendente';
        if (existing.status === 'encerrada' || existing.status === 'cancelada') activity.status = existing.status;
        // Atividades retiradas de inscrições por decisão administrativa continuam fechadas.
        if (!activity.start || !activity.end || !activity.capacity) activity.status = 'pendente';
        activity = SemDomain.validateActivity(activity);
        if (JSON.stringify(activity) === JSON.stringify(existing)) return;
        updated.push(entry.id);
      } else created.push(entry.id);
      changed.push(activity);
    });
    var oldTribute = journal.state.activities.HOMENAGEM_CRIS;
    if (oldTribute) {
      var withdrawn = Object.assign({}, oldTribute, {
        description: 'Retirada da programação final da XXI SEMINFO. Cadastro e histórico preservados.',
        status: oldTribute.start && oldTribute.end && oldTribute.capacity ? 'cancelada' : 'pendente'
      });
      if (JSON.stringify(withdrawn) !== JSON.stringify(oldTribute)) { changed.push(withdrawn); retired.push(oldTribute.id); }
    }
    if (changed.length) {
      commitOperationLocked_(journal, {key: 'ADMIN:PROGRAMA_FINAL:' + Utilities.getUuid(), kind: 'PROGRAM_UPDATE',
        at: new Date().toISOString(), activities: changed,
        reason: 'Programação final da XXI SEMINFO, de 26 a 29/10/2026, atualizada pela organização.'});
      rebuildViewsLocked_(readJournal_());
    }
    return {criadas: created, atualizadas: updated, retiradasDaProgramacao: retired};
  });
}

/** Não inventa capacidade nem término para palestras com dados incompletos. */
function carregarProgramacaoSeminfo2026() {
  requireInstaller_();
  return withLock_(function () {
    var entries = programacaoSeminfo2026_(), journal = readJournal_(), created = [];
    entries.forEach(function (entry) {
      if (journal.state.activities[entry.id] || (journal.state.deletedActivities || {})[entry.id]) return;
      var activity = atividadeDaProgramacao_(entry);
      commitOperationLocked_(journal, {key: 'ADMIN:CATALOG:' + Utilities.getUuid(), kind: 'CATALOG', at: new Date().toISOString(), activity: activity});
      journal = readJournal_(); created.push(entry.id);
    });
    var definitions = getRegistrationFormDefinitions_();
    writeTable_('Programacao', ['ID', 'DATA', 'INICIO', 'TERMINO', 'ATIVIDADE', 'MINISTRANTE', 'LOCAL', 'VAGAS', 'FORM_EDITAR', 'PENDENCIAS'], entries.map(function (entry) {
      var source = definitions.find(function (definition) { return definition.activityId === entry.id; });
      return [entry.id, entry.date, entry.start, entry.end, entry.title, entry.instructor, entry.location,
        entry.capacity || '', source ? 'https://docs.google.com/forms/d/' + source.id + '/edit' : '', entry.pending];
    }));
    rebuildViewsLocked_(journal);
    return {criadas: created, totalCadastradas: entries.filter(function (entry) { return !!journal.state.activities[entry.id]; }).length,
      pendencias: entries.filter(function (entry) { return !!entry.pending; }).map(function (entry) { return {id: entry.id, detalhe: entry.pending}; })};
  });
}

function menuProgramacaoSeminfo2026() {
  var result = atualizarProgramacaoSeminfo2026();
  SpreadsheetApp.getUi().alert(JSON.stringify(result.programacao, null, 2));
}

/** Atualiza catálogo e Forms de uma instalação existente, preservando inscrições. */
function atualizarProgramacaoSeminfo2026() {
  var catalog = sincronizarCatalogoProgramacaoFinalSeminfo2026_();
  prepararFormulariosSeminfo2026();
  var program = carregarProgramacaoSeminfo2026();
  program.criadas = catalog.criadas;
  program.atualizadas = catalog.atualizadas;
  program.retiradasDaProgramacao = catalog.retiradasDaProgramacao;
  var installation = instalarSistema();
  var titles = atualizarFormularios(true);
  var descriptions = atualizarDescricoesProgramacaoSeminfo2026_();
  var issues = (installation.issues || []).slice();
  try { refreshFormsSafely_(); }
  catch (error) { recordError_('programacao-final-formularios', '', error); issues.push(safeError_(error)); }
  return {programacao: program, instalacao: installation, titulos: titles,
    descricoesAtualizadas: descriptions, pendencias: issues};
}

/** Conserva os textos da oficina; substitui as linhas antigas de data, local, horário e vagas. */
function atualizarDescricoesProgramacaoSeminfo2026_() {
  var state = readState_(), updated = [];
  var ids = programacaoSeminfo2026_().map(function (entry) { return entry.id; });
  getFormInventorySources_().forEach(function (source) {
    var activity = state.activities[source.activityId];
    if (!activity || ids.indexOf(source.activityId) < 0) return;
    var form = openFormWithDriveRetry_(source.id), original = form.getDescription();
    if (source.kind === 'IMPORTACAO_CSP' && form.getTitle() !== activity.title) {
      form.setTitle(activity.title);
      DriveApp.getFileById(source.id).setName(activity.title);
    }
    var preserved = String(original || '').replace(/\n*XXI SEMINFO — Programação atualizada\n[\s\S]*$/, '')
      .replace(/^[^\wÀ-ÿ\n]*(?:local|hor[áa]rio(?: de in[íi]cio)?|data|vagas|ministrantes?|palestrante)\s*:.*$/gim, '')
      .replace(/\n{3,}/g, '\n\n').trim();
    var entry = programacaoSeminfo2026_().find(function (item) { return item.id === source.activityId; });
    var start = activity.start ? Utilities.formatDate(new Date(activity.start), 'America/Sao_Paulo', 'HH:mm') : '';
    var end = activity.end ? Utilities.formatDate(new Date(activity.end), 'America/Sao_Paulo', 'HH:mm') : '';
    var lines = ['XXI SEMINFO — Programação atualizada', 'Data: ' + entry.date.split('-').reverse().join('/'),
      'Horário: ' + (start ? start + (end ? ' às ' + end : ' (término a confirmar)') : 'a confirmar'),
      'Local: ' + (activity.location || 'a confirmar')];
    if (activity.instructor) lines.push('Ministrante(s): ' + activity.instructor);
    lines.push('Vagas: ' + (activity.capacity ? activity.capacity + (activity.capacityUnit === 'equipes' ? ' equipes' : '') : 'a confirmar'));
    var description = (preserved ? preserved + '\n\n' : '') + lines.join('\n');
    if (description !== original) { form.setDescription(description); updated.push(source.id); }
  });
  return updated;
}

function tituloFormularioDaAtividade_(activity) {
  var prefix = {oficina: 'OFICINA', palestra: 'PALESTRA'}[activity.type];
  if (!prefix) return activity.title;
  return prefix + ' - ' + String(activity.title).replace(/^(?:(?:oficina|palestra)\s*[-–—:]\s*)+/i, '').trim();
}

/** Sincroniza título visível e arquivo do Form com o prefixo do tipo da atividade. */
function atualizarFormularios(deferRefresh) {
  requireInstaller_();
  return withLock_(function () {
    var definitions = getRegistrationFormDefinitions_();
    var program = programacaoSeminfo2026_();
    var titles = {}, formTitles = {};
    program.forEach(function (entry) {
      if (entry.id === 'CSP_2026' || !definitions.some(function (source) { return source.activityId === entry.id; })) return;
      titles[entry.id] = entry.title;
      formTitles[entry.id] = tituloFormularioDaAtividade_(entry);
    });
    var entries = definitions.filter(function (entry) { return entry.id && titles[entry.activityId]; })
      .map(function (entry) { return {source: entry, form: openFormWithDriveRetry_(entry.id)}; });
    var journal = readJournal_();
    Object.keys(titles).forEach(function (id) {
      var existing = journal.state.activities[id];
      if (!existing || existing.title === titles[id]) return;
      var activity = Object.assign({}, existing, {title: titles[id]});
      commitOperationLocked_(journal, {key: 'ADMIN:CATALOG:' + Utilities.getUuid(), kind: 'CATALOG',
        at: new Date().toISOString(), activity: activity});
      journal = readJournal_();
    });
    definitions.forEach(function (entry) {
      if (formTitles[entry.activityId]) entry.title = formTitles[entry.activityId];
    });
    setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify(definitions));
    entries.forEach(function (entry) {
      var title = formTitles[entry.source.activityId];
      entry.form.setTitle(title);
      DriveApp.getFileById(entry.source.id).setName(title);
    });
    var responseSheets = nomearAbasDeRespostas_(entries.map(function (entry) { return entry.source.id; }));
    rebuildViewsLocked_(journal);
    var sheet = db_().getSheetByName('Programacao');
    if (sheet && sheet.getLastRow() > 1) {
      var rows = sheet.getDataRange().getValues();
      rows.slice(1).forEach(function (row, index) {
        if (titles[row[0]]) sheet.getRange(index + 2, 5).setValue(titles[row[0]]);
      });
    }
    if (deferRefresh !== true) refreshFormsLocked_(journal.state);
    return {formularios: entries.map(function (entry) {
      return {id: entry.source.id, titulo: formTitles[entry.source.activityId]};
    }), abasDeRespostas: responseSheets};
  });
}

function menuAtualizarFormularios() {
  var result = atualizarFormularios();
  SpreadsheetApp.getUi().alert('Nomes atualizados em ' + result.formularios.length + ' formulário(s). Inscrições e respostas preservadas.');
}

/** Copia para a mesma planilha, sem mudar compartilhamento ou exigir Drive write. */
function backupResetSheet_(sheet, spreadsheet, name) {
  var copy = spreadsheet.getSheetByName(name) || sheet.copyTo(spreadsheet).setName(name);
  protectResetBackup_(copy);
}

function responseSheetMatchesForm_(sheet, form) {
  if (/^Backup_/.test(sheet.getName()) || sheet.getName() === 'Configuracoes') return false;
  var url = sheet.getFormUrl();
  if (!url) return false;
  if (url.split('?')[0] === form.getPublishedUrl().split('?')[0] || url.indexOf('/d/' + form.getId() + '/') >= 0) return true;
  try { return FormApp.openByUrl(url).getId() === form.getId(); }
  catch (_) { return false; } // Uma aba de outro Form não pertence à limpeza.
}

/** As abas nativas também passam a exibir a atividade, em vez de Formulário 3. */
function nomearAbasDeRespostas_(formIds) {
  var result = [];
  var sources = getFormSources_();
  var importConfig = String(getConfig_().IMPORTACAO_CSP_JSON || '').trim();
  var config = getConfig_();
  var cspSource = null;
  if (importConfig && importConfig !== '{}') {
    cspSource = getCspImportSource_();
    if (!formIds || formIds.indexOf(cspSource.formId) >= 0) {
      var activity = readState_().activities[cspSource.activityId];
      var scheduledActivity = programacaoSeminfo2026_().filter(function (entry) { return entry.id === cspSource.activityId; })[0];
      var cspTitle = activity && activity.title || scheduledActivity && scheduledActivity.title || '';
      var existingSource = sources.filter(function (source) { return source.id === cspSource.formId; })[0];
      if (existingSource) {
        existingSource.title = cspTitle || existingSource.title;
      } else {
        sources.push({kind: 'IMPORTACAO_CSP', id: cspSource.formId, title: cspTitle});
      }
    }
  }
  if (formIds) sources = sources.filter(function (source) { return formIds.indexOf(source.id) >= 0; });
  sources.forEach(function (source) {
    var form = openFormWithDriveRetry_(source.id);
    if (cspSource && source.id === cspSource.formId) {
      var targetSpreadsheet = db_();
      var targetSpreadsheetId = targetSpreadsheet.getId();
      var destination = formDestinationId_(form);
      var existingTargetSheets = targetSpreadsheet.getSheets();
      var existingTargetIds = existingTargetSheets.map(function (sheet) { return sheet.getSheetId(); });
      if (destination && destination !== targetSpreadsheetId) {
        var sourceSpreadsheet = SpreadsheetApp.openById(destination);
        if (!sourceSpreadsheet.getSheets().some(function (sheet) { return responseSheetMatchesForm_(sheet, form); })) {
          throw new Error('O destino atual de respostas da CSP não contém uma guia vinculada ao Form. Nenhum destino foi alterado.');
        }
      } else if (!destination && config.CSP_RESPONSE_SPREADSHEET_ID &&
          String(config.CSP_RESPONSE_SPREADSHEET_ID) !== targetSpreadsheetId && config.CSP_RESPONSE_SHEET_ID) {
        var oldSheetId = Number(config.CSP_RESPONSE_SHEET_ID);
        if (!Number.isInteger(oldSheetId) || oldSheetId < 1) throw new Error('CSP_RESPONSE_SHEET_ID inválido na aba Configuracoes.');
        var oldSpreadsheet = SpreadsheetApp.openById(String(config.CSP_RESPONSE_SPREADSHEET_ID));
        var oldSheet = oldSpreadsheet.getSheets().filter(function (sheet) { return sheet.getSheetId() === oldSheetId; })[0];
        if (!oldSheet || !responseSheetMatchesForm_(oldSheet, form)) {
          throw new Error('A guia configurada para respostas da CSP não está vinculada ao Form ' + cspSource.formId + '. Nenhum destino foi alterado.');
        }
      }
      if (destination !== targetSpreadsheetId) {
        form.setDestination(FormApp.DestinationType.SPREADSHEET, targetSpreadsheetId);
      }
      var newTargetSheets = targetSpreadsheet.getSheets().filter(function (sheet) {
        return existingTargetIds.indexOf(sheet.getSheetId()) < 0 && responseSheetMatchesForm_(sheet, form);
      });
      var matchingTargetSheets = newTargetSheets.length ? newTargetSheets :
        targetSpreadsheet.getSheets().filter(function (sheet) { return responseSheetMatchesForm_(sheet, form); });
      if (matchingTargetSheets.length !== 1) {
        throw new Error(matchingTargetSheets.length ?
          'Mais de uma guia de respostas da CSP foi encontrada na planilha principal. Nenhuma guia foi renomeada.' :
          'O Form CSP foi vinculado à planilha principal, mas sua guia de respostas não foi encontrada.');
      }
      var targetSheet = matchingTargetSheets[0];
      var targetId = targetSheet.getSheetId();
      var cspBase = ('Respostas — ' + (source.title || form.getTitle())).replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      var cspCollision = targetSpreadsheet.getSheets().some(function (sheet) { return sheet.getName() === cspBase && sheet.getSheetId() !== targetId; });
      var cspName = cspCollision ? cspBase.slice(0, 78) + ' ' + targetId : cspBase;
      if (targetSheet.getName() !== cspName) targetSheet.setName(cspName);
      setConfig_('CSP_RESPONSE_SPREADSHEET_ID', targetSpreadsheetId);
      setConfig_('CSP_RESPONSE_SHEET_ID', targetId);
      result.push({formId: source.id, aba: cspName, planilha: targetSpreadsheetId});
      return;
    }
    var destination = formDestinationId_(form);
    if (!destination) return;
    var spreadsheet = SpreadsheetApp.openById(destination);
    var title = source.kind === 'CANCELAMENTO' ? 'Cancelamentos — SEMINFO' : source.title || form.getTitle();
    var base = ('Respostas — ' + title).replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    spreadsheet.getSheets().forEach(function (sheet) {
      if (!responseSheetMatchesForm_(sheet, form)) return;
      var name = base, collision = spreadsheet.getSheetByName(name);
      if (collision && collision.getSheetId() !== sheet.getSheetId()) name = base.slice(0, 78) + ' ' + sheet.getSheetId();
      if (sheet.getName() !== name) sheet.setName(name);
      result.push({formId: source.id, aba: name, planilha: destination});
    });
  });
  return result;
}

function sincronizarNomesAbasDeRespostas_(deadline) {
  if (!deadline) return nomearAbasDeRespostas_();
  if (Date.now() >= deadline - 30000) return {adiada: true};
  var config = getConfig_(), sources = getFormSources_(config);
  var importConfig = String(config.IMPORTACAO_CSP_JSON || '').trim();
  if (importConfig && importConfig !== '{}') {
    var cspId = getCspImportSource_().formId;
    if (!sources.some(function(source) { return source.id === cspId; })) sources.push({id: cspId});
  }
  if (!sources.length || Date.now() >= deadline - 30000) return {adiada: true};
  var cursor = Number(props_().getProperty('SEMINFO_RESPONSE_SHEET_INDEX') || 0);
  if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;
  var index = cursor % sources.length;
  // Avança mesmo se uma origem falhar, para que as demais também sejam atendidas.
  props_().setProperty('SEMINFO_RESPONSE_SHEET_INDEX', String((index + 1) % sources.length));
  return nomearAbasDeRespostas_([sources[index].id]);
}

function protectResetBackup_(copy) {
  var description = 'SEMINFO — backup privado anterior à limpeza';
  var protection = copy.getProtections(SpreadsheetApp.ProtectionType.SHEET).filter(function (existing) { return existing.getDescription() === description; })[0] || copy.protect().setDescription(description);
  protection.setWarningOnly(false).addEditor(props_().getProperty('SEMINFO_INSTALLER'));
  protection.removeEditors(protection.getEditors().filter(function (user) { return user.getEmail().toLowerCase() !== props_().getProperty('SEMINFO_INSTALLER'); }));
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  copy.hideSheet();
}

/**
 * Zera dados operacionais e respostas, preservando Forms/perguntas/configuração.
 * Um marcador durável bloqueia os workers até concluir todas as etapas.
 * Reexecutar após falha retoma a mesma limpeza e os mesmos backups.
 */
function limparTudoERecomecar() {
  requireInstaller_(true);
  return withLock_(function () {
    var properties = props_(), raw = properties.getProperty('SEMINFO_RESET_PENDING');
    var plan;
    if (raw) plan = JSON.parse(raw);
    else {
      var sources = getFormSources_();
      var importConfig;
      try { importConfig = JSON.parse(String(getConfig_().IMPORTACAO_CSP_JSON || '{}')); }
      catch (_) { throw new Error('IMPORTACAO_CSP_JSON inválido; corrija a configuração antes de limpar.'); }
      if (importConfig.formId && !sources.some(function (source) { return source.id === importConfig.formId; })) sources.push({id: importConfig.formId, kind: 'IMPORTACAO_CSP'});
      var forms = sources.map(function (source) { return openFormWithDriveRetry_(source.id); });
      // Uma mensagem já reservada pode estar sendo enviada fora do ScriptLock.
      var queueSheet = db_().getSheetByName('FilaEmails');
      if (queueSheet && queueSheet.getLastRow() > 1 && typeof notificationRows_ === 'function' && notificationRows_(queueSheet).some(function (row) {
        return row.SITUACAO === 'processando' && Date.parse(row.LEASE_ATE) > Date.now();
      })) throw new Error('Há e-mail em envio. Aguarde sua conclusão/expiração da reserva e execute a limpeza novamente.');
      var prefix = 'Backup_' + Utilities.getUuid().slice(0, 8) + '_';
      var targets = [], seen = {};
      function addTarget(spreadsheet, sheet) {
        var key = spreadsheet.getId() + ':' + sheet.getSheetId();
        if (seen[key]) return;
        seen[key] = true;
        targets.push({spreadsheetId: spreadsheet.getId(), sheetName: sheet.getName(), backupName: prefix + String(targets.length + 1)});
      }
      db_().getSheets().forEach(function (sheet) {
        var name = sheet.getName();
        if ((Object.prototype.hasOwnProperty.call(SEMINFO_TABLES, name) && name !== 'Configuracoes') || name === 'FilaEmails' || name === 'Programacao' || /^(Lista_|Previa_CSP_)/.test(name)) addTarget(db_(), sheet);
      });
      // Só limpa abas nativas vinculadas aos Forms de inscrição/cancelamento.
      forms.forEach(function (form) {
        if (importConfig.formId && form.getId() === importConfig.formId) return;
        var destination = formDestinationId_(form);
        if (!destination) return;
        var spreadsheet = SpreadsheetApp.openById(destination);
        spreadsheet.getSheets().forEach(function (sheet) {
          if (responseSheetMatchesForm_(sheet, form)) addTarget(spreadsheet, sheet);
        });
      });
      plan = {prefix: prefix, formIds: sources.map(function (source) { return source.id; }),
        clearFormIds: sources.map(function (source) { return source.id; }).filter(function (id) { return id !== importConfig.formId; }),
        preservedImportFormId: importConfig.formId || '', targets: targets, phase: 'backup', backedForms: []};
      properties.setProperty('SEMINFO_RESET_PENDING', JSON.stringify(plan));
    }
    var importConfigForPlan;
    try { importConfigForPlan = JSON.parse(String(getConfig_().IMPORTACAO_CSP_JSON || '{}')); }
    catch (_) { throw new Error('IMPORTACAO_CSP_JSON inválido; corrija a configuração antes de limpar.'); }
    var preservedImportFormId = String(importConfigForPlan.formId || '');
    plan.clearFormIds = plan.clearFormIds || plan.formIds.slice();
    if (preservedImportFormId && plan.formIds.indexOf(preservedImportFormId) >= 0) {
      plan.clearFormIds = plan.clearFormIds.filter(function (id) { return id !== preservedImportFormId; });
      plan.preservedImportFormId = preservedImportFormId;
      var preservedForm = openFormWithDriveRetry_(preservedImportFormId);
      plan.targets = plan.targets.filter(function (target) {
        var sheet = SpreadsheetApp.openById(target.spreadsheetId).getSheetByName(target.sheetName);
        return !sheet || !responseSheetMatchesForm_(sheet, preservedForm);
      });
      properties.setProperty('SEMINFO_RESET_PENDING', JSON.stringify(plan));
    }
    var resetForms = plan.formIds.map(openFormWithDriveRetry_);
    var clearForms = plan.clearFormIds.map(openFormWithDriveRetry_);
    resetForms.forEach(function (form) { setFormReceiving_(form, false); });
    properties.deleteProperty('SEMINFO_FORMS_ACTIVATED');
    if (plan.phase === 'backup') {
      plan.targets.forEach(function (target) {
        var spreadsheet = SpreadsheetApp.openById(target.spreadsheetId), sheet = spreadsheet.getSheetByName(target.sheetName);
        if (!sheet) throw new Error('Aba da limpeza não encontrada: ' + target.sheetName);
        backupResetSheet_(sheet, spreadsheet, target.backupName);
      });
      // Guarda também respostas sem destino nativo, antes de deleteAllResponses.
      clearForms.forEach(function (form, index) {
        var name = plan.prefix + 'Form_' + index;
        if (plan.backedForms.indexOf(form.getId()) >= 0) return;
        var rows = [];
        form.getResponses().forEach(function (response) {
          var answers = response.getItemResponses();
          if (!answers.length) answers = [null];
          answers.forEach(function (answer) {
            var value = answer ? JSON.stringify(answer.getResponse()) : '';
            if (String(value).length > 45000) throw new Error('Resposta excede limite seguro de backup; limpeza interrompida antes da exclusão.');
            rows.push([form.getId(), response.getId(), response.getTimestamp().toISOString(), form.collectsEmail() ? response.getRespondentEmail() || '' : '',
              answer ? answer.getItem().getId() : '', answer ? answer.getItem().getTitle() : '', value]);
          });
        });
        writeTable_(name, ['FORM_ID', 'RESPOSTA_ID', 'DATA', 'EMAIL', 'PERGUNTA_ID', 'PERGUNTA', 'RESPOSTA_JSON'], rows);
        var backup = db_().getSheetByName(name);
        protectResetBackup_(backup);
        SpreadsheetApp.flush();
        plan.backedForms.push(form.getId());
        properties.setProperty('SEMINFO_RESET_PENDING', JSON.stringify(plan));
      });
      plan.phase = 'clear';
      properties.setProperty('SEMINFO_RESET_PENDING', JSON.stringify(plan));
    }
    clearForms.forEach(function (form) { form.deleteAllResponses(); });
    plan.targets.forEach(function (target) {
      var sheet = SpreadsheetApp.openById(target.spreadsheetId).getSheetByName(target.sheetName);
      if (!sheet) throw new Error('Aba da limpeza não encontrada: ' + target.sheetName);
      if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    });
    Object.keys(properties.getProperties()).forEach(function (key) {
      if (/^SEMINFO_(VERIFIED_SINCE_|SCAN_)/.test(key) || ['SEMINFO_IMPORTACAO_CSP', 'SEMINFO_EVENTO_ENCERRADO_EM', 'SEMINFO_EMAILS_CANCELADOS_EM'].indexOf(key) >= 0) properties.deleteProperty(key);
    });
    properties.setProperty('SEMINFO_RESET_AT', new Date().toISOString());
    properties.setProperty('SEMINFO_GENERATION', Utilities.getUuid());
    SpreadsheetApp.flush();
    properties.deleteProperty('SEMINFO_RESET_PENDING');
    return {zerado: true, formsMantidos: plan.formIds, respostasPreservadasCsp: plan.preservedImportFormId || '',
      backups: plan.prefix,
      inscricoesAbertas: false, aviso: 'Atividades e inscrições zeradas. Carregue a programação, confira os Forms e abra as inscrições quando estiver pronto.'};
  }, true);
}

/** Atalho do editor: migra os links, limpa e prepara a programação real. */
function comecarSeminfo2026DoZero() {
  if (!props_().getProperty('SEMINFO_RESET_PENDING')) prepararFormulariosSeminfo2026();
  var reset = limparTudoERecomecar();
  var program = carregarProgramacaoSeminfo2026();
  var installation = instalarSistema();
  return {limpeza: reset, programacao: program, instalacao: installation};
}

function menuComecarDoZero() {
  requireInstaller_(true);
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('Começar do zero com os mesmos Forms',
    'Zerar TODAS as atividades, inscrições, participantes, equipes, histórico, fila e respostas dos Forms integrados? Os IDs e perguntas dos Forms serão mantidos. Cópias privadas ficarão ocultas na planilha. A programação de 26 a 29/10/2026 será carregada e as inscrições ficarão fechadas.', ui.ButtonSet.YES_NO);
  if (answer === ui.Button.YES) ui.alert(JSON.stringify(comecarSeminfo2026DoZero().limpeza, null, 2));
}
