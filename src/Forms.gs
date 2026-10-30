/**
 * SEMINFO — formulários nativos e leitura das solicitações.
 * Nunca cria pergunta de e-mail: a origem é getRespondentEmail(), após verificar
 * settings.emailCollectionType === VERIFIED pela API oficial Google Forms.
 */
var SEMINFO_FORM_TEXT_ = Object.freeze({
  NAME: 'Nome completo',
  CPF: 'CPF',
  ACTIVITY: 'Atividade',
  SWAP: 'Se você já estiver inscrito em outra atividade com horário conflitante, autoriza substituir a inscrição anterior, caso exista vaga na atividade escolhida?',
  SWAP_YES: 'Sim, autorizo substituir as inscrições com horário conflitante.',
  SWAP_NO: 'Não, mantenha minhas inscrições anteriores.',
  CANCEL: 'Confirmação do cancelamento',
  CANCEL_YES: 'Sim, confirmo o cancelamento da minha inscrição na atividade selecionada.',
  CANCEL_NO: 'Não, mantenha minha inscrição.',
  RECEIVED: 'Recebemos sua solicitação. O envio deste formulário não garante a vaga. O resultado será encaminhado ao seu e-mail após a verificação de disponibilidade e de conflitos de horário.',
  EMPTY: 'Nenhuma atividade disponível no momento. Aguarde novas vagas ou entre em contato com o Centro Acadêmico Alan Turing.'
});

// Apenas na execução atual; não usa CacheService nem cache persistente de segurança.
var SEMINFO_FORM_METADATA_ = {};

/** Um formulário pode representar uma atividade fixa ou apresentar a seleção. */
function getRegistrationFormDefinitions_(config) {
  var cfg = config || getConfig_();
  var raw = String(cfg.FORMULARIOS_INSCRICAO_JSON || '[]').trim() || '[]';
  var definitions;
  try { definitions = JSON.parse(raw); }
  catch (_) { throw new Error('FORMULARIOS_INSCRICAO_JSON deve conter um array JSON válido.'); }
  if (!Array.isArray(definitions)) throw new Error('FORMULARIOS_INSCRICAO_JSON deve conter um array de formulários.');
  if (!definitions.length) definitions = [{id: cfg.ID_FORM_INSCRICAO ||
    PropertiesService.getScriptProperties().getProperty('SEMINFO_ID_FORM_INSCRICAO') || '', activityId: '', items: {}}];
  var seen = {};
  var normalizedDefinitions = definitions.map(function (entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Descritor de formulário inválido.');
    var id = String(entry.id || '').trim();
    var activityId = String(entry.activityId || '').trim();
    if ((!id && definitions.length > 1) || (id && !/^[A-Za-z0-9_-]+$/.test(id))) {
      throw new Error('Informe o ID de edição de cada formulário, sem URL, em FORMULARIOS_INSCRICAO_JSON.');
    }
    if (activityId && !/^[A-Za-z0-9_-]{1,64}$/.test(activityId)) throw new Error('activityId inválido no formulário ' + id + '.');
    if (seen[id]) throw new Error('Formulário de inscrição repetido: ' + id + '.');
    seen[id] = true;
    var items = entry.items || {};
    if (typeof items !== 'object' || Array.isArray(items)) throw new Error('items deve mapear NAME, CPF, ACTIVITY e SWAP para IDs de perguntas.');
    var normalized = {}, usedItems = {};
    Object.keys(items).forEach(function (key) {
      var itemId = Number(items[key]);
      if (['NAME', 'CPF', 'ACTIVITY', 'SWAP'].indexOf(key) === -1 || !Number.isInteger(itemId) || itemId < 1 || usedItems[itemId]) {
        throw new Error('Mapeamento de pergunta inválido ou repetido no formulário ' + id + ': ' + key + '.');
      }
      usedItems[itemId] = true;
      normalized[key] = itemId;
    });
    var installedActivity = id ? PropertiesService.getScriptProperties().getProperty('SEMINFO_FORM_ACTIVITY_' + id) : null;
    if (installedActivity === null && id === PropertiesService.getScriptProperties().getProperty('SEMINFO_ID_FORM_INSCRICAO') &&
        (PropertiesService.getScriptProperties().getProperty('SEMINFO_ITEM_INSCRICAO_ACTIVITY') ||
         PropertiesService.getScriptProperties().getProperty('SEMINFO_VERIFIED_SINCE_' + id))) installedActivity = '';
    if (installedActivity !== null && installedActivity !== '' && installedActivity !== activityId ||
        installedActivity === '' && activityId) {
      throw new Error('A atividade associada ao formulário ' + id + ' já foi instalada. Não remapeie um formulário com histórico.');
    }
    var title = String(entry.title || '').trim();
    if (title.length > 300) throw new Error('Título do formulário excede 300 caracteres.');
    return {id: id, activityId: activityId, title: title, items: normalized};
  });
  var installedIds = JSON.parse(PropertiesService.getScriptProperties().getProperty('SEMINFO_REGISTRATION_IDS') || '[]');
  var legacyPrimaryId = PropertiesService.getScriptProperties().getProperty('SEMINFO_ID_FORM_INSCRICAO');
  if (!installedIds.length && legacyPrimaryId) installedIds = [legacyPrimaryId];
  installedIds.forEach(function (id) {
    if (!normalizedDefinitions.some(function (entry) { return entry.id === id; })) {
      throw new Error('O formulário de inscrição já instalado ' + id + ' foi removido da configuração. Preserve as origens com histórico e respostas pendentes.');
    }
  });
  return normalizedDefinitions;
}

/** Inventário das origens configuradas. Não cria nem modifica formulários. */
function getFormSources_(config) {
  var cfg = config || getConfig_();
  var sources = getRegistrationFormDefinitions_(cfg).filter(function (entry) { return !!entry.id; }).map(function (entry) {
    return {kind: 'INSCRICAO', id: entry.id, activityId: entry.activityId, title: entry.title, items: entry.items};
  });
  var cancellationId = String(cfg.ID_FORM_CANCELAMENTO ||
    PropertiesService.getScriptProperties().getProperty('SEMINFO_ID_FORM_CANCELAMENTO') || '').trim();
  var installedCancelId = PropertiesService.getScriptProperties().getProperty('SEMINFO_ID_FORM_CANCELAMENTO');
  if (installedCancelId && cancellationId !== installedCancelId) throw new Error('O formulário de cancelamento já instalado não pode ser substituído por outro ID.');
  if (cancellationId) {
    if (sources.some(function (entry) { return entry.id === cancellationId; })) {
      throw new Error('Inscrição e cancelamento precisam ser formulários distintos.');
    }
    sources.push({kind: 'CANCELAMENTO', id: cancellationId, activityId: '', items: {}});
  }
  return sources;
}

/** Inclui a fonte histórica CSP no inventário, sem instalá-la como inscrição individual. */
function getFormInventorySources_() {
  var sources = getFormSources_();
  var raw = String(getConfig_().IMPORTACAO_CSP_JSON || '').trim();
  if (!raw || raw === '{}') return sources;
  var csp = getCspImportSource_();
  if (sources.some(function (source) { return source.id === csp.formId; })) return sources;
  var title = csp.title || '';
  if (!title) {
    var activity = readState_().activities[csp.activityId];
    var scheduledActivity = typeof programacaoSeminfo2026_ === 'function' ?
      programacaoSeminfo2026_().filter(function (entry) { return entry.id === csp.activityId; })[0] : null;
    title = activity && activity.title || scheduledActivity && scheduledActivity.title || '';
  }
  sources.push({kind: 'IMPORTACAO_CSP', id: csp.formId, activityId: csp.activityId,
    title: title, items: csp.items});
  return sources;
}

function shouldCreateCancellationForm_() {
  var value = getConfig_().CRIAR_FORM_CANCELAMENTO;
  return value === undefined || value === true || /^(true|sim)$/i.test(String(value));
}

/** IDs e tipos de todas as perguntas; a consulta preserva os Forms existentes. */
function listarPerguntasDosFormularios() {
  if (PropertiesService.getScriptProperties().getProperty('SEMINFO_INSTALLER')) requireInstaller_();
  var result = getFormInventorySources_().map(function (source) {
    var form = openFormWithDriveRetry_(source.id);
    return {kind: source.kind, id: source.id, title: form.getTitle(), activityId: source.activityId, editUrl: form.getEditUrl(),
      items: form.getItems().map(function (item) { return {id: item.getId(), title: item.getTitle(), type: String(item.getType())}; })};
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Executar durante a instalação exclusiva, sem manter o ScriptLock nas chamadas ao Forms. Preserva respostas. */
function setupForms_() {
  var cfg = getConfig_();
  var definitions = getRegistrationFormDefinitions_();
  var primaryId = PropertiesService.getScriptProperties().getProperty('SEMINFO_ID_FORM_INSCRICAO') ||
    (definitions.some(function (source) { return source.id === cfg.ID_FORM_INSCRICAO; }) ? cfg.ID_FORM_INSCRICAO : '');
  // Todas as origens existentes passam pela conferência antes de qualquer setter.
  getFormSources_();
  var registrations = definitions.map(function (source) {
    var form = source.id ? openFormWithDriveRetry_(source.id) : null;
    if (form) preflightForm_('INSCRICAO', form, source);
    return {source: source, form: form};
  });
  var cancelId = cfg.ID_FORM_CANCELAMENTO || PropertiesService.getScriptProperties().getProperty('SEMINFO_ID_FORM_CANCELAMENTO');
  var cancellation = cancelId ? openFormWithDriveRetry_(cancelId) : null;
  if (cancellation) preflightForm_('CANCELAMENTO', cancellation, {items: {}});
  registrations.forEach(function (entry) {
    if (!entry.form) entry.form = getOrCreateForm_('INSCRICAO', '');
    entry.source.id = entry.form.getId();
    if (!primaryId) primaryId = entry.form.getId();
    if (entry.form.getId() === primaryId) {
      PropertiesService.getScriptProperties().setProperty('SEMINFO_ID_FORM_INSCRICAO', entry.form.getId());
      setConfig_('ID_FORM_INSCRICAO', entry.form.getId());
    }
    PropertiesService.getScriptProperties().setProperty('SEMINFO_FORM_ACTIVITY_' + entry.form.getId(), entry.source.activityId);
    configureForm_('INSCRICAO', entry.form, entry.source);
  });
  PropertiesService.getScriptProperties().setProperty('SEMINFO_REGISTRATION_IDS', JSON.stringify(registrations.map(function (entry) { return entry.form.getId(); })));
  if (!cancellation && shouldCreateCancellationForm_()) cancellation = getOrCreateForm_('CANCELAMENTO', '');
  if (cancellation) {
    PropertiesService.getScriptProperties().setProperty('SEMINFO_ID_FORM_CANCELAMENTO', cancellation.getId());
    setConfig_('ID_FORM_CANCELAMENTO', cancellation.getId());
    configureForm_('CANCELAMENTO', cancellation, {items: {}});
  }
  var issues = [];
  var forms = registrations.map(function (entry) { return entry.form; });
  if (cancellation) forms.push(cancellation);
  forms.forEach(function (form) {
    try { assertVerifiedEmail_(form); }
    catch (error) {
      setFormReceiving_(form, false);
      issues.push(String(error.message || error));
    }
  });
  var registration = registrations.filter(function (entry) { return entry.form.getId() === primaryId; })[0].form;
  return {
    registrations: registrations.map(function (entry) { return {id: entry.form.getId(), title: entry.form.getTitle(), activityId: entry.source.activityId,
      editUrl: entry.form.getEditUrl(), url: entry.form.getPublishedUrl()}; }),
    registrationId: registration.getId(), cancellationId: cancellation ? cancellation.getId() : '',
    registrationUrl: registration.getPublishedUrl(), cancellationUrl: cancellation ? cancellation.getPublishedUrl() : '',
    registrationEditUrl: registration.getEditUrl(), cancellationEditUrl: cancellation ? cancellation.getEditUrl() : '',
    issues: issues
  };
}

/**
 * Grava o ID assim que a criação retorna. O nome do arquivo em Drive contém um
 * marcador do projeto, recuperável se a execução parar antes de persistir o ID.
 * Form.setTitle altera o título visível; o documentTitle de Drive é separado.
 */
function getOrCreateForm_(kind, configuredId) {
  var props = PropertiesService.getScriptProperties();
  var property = 'SEMINFO_ID_FORM_' + kind;
  var storedId = props.getProperty(property);
  var id = String(configuredId || storedId || '').trim();
  if (configuredId && storedId && String(configuredId) !== storedId) {
    throw new Error('O ID do formulário ' + kind + ' difere do ID já instalado. Não substitua recursos com respostas; procure a organização.');
  }
  var form;
  if (id) {
    // IDs inacessíveis não provocam criação silenciosa de um segundo formulário.
    form = openFormWithDriveRetry_(id);
  } else {
    var documentTitle = 'SEMINFO [' + ScriptApp.getScriptId() + '] ' + kind;
    var files = DriveApp.getFilesByName(documentTitle);
    var candidates = [];
    while (files.hasNext()) {
      var file = files.next();
      if (!file.isTrashed() && file.getMimeType() === 'application/vnd.google-apps.form') {
        candidates.push(file.getId());
      }
    }
    if (candidates.length > 1) {
      throw new Error('Mais de um formulário com o marcador ' + kind + '. Informe o ID correto; nenhum recurso foi excluído.');
    }
    form = candidates.length ? openFormWithDriveRetry_(candidates[0]) : FormApp.create(documentTitle, false);
    props.setProperty('SEMINFO_CREATED_FORM_' + form.getId(), 'true');
  }
  props.setProperty(property, form.getId());
  setConfig_('ID_FORM_' + kind, form.getId());
  return form;
}

function formDestinationId_(form) {
  try { return form.getDestinationId() || ''; }
  catch (error) {
    var detail = String(error && error.message || error).trim().replace(/^Exception:\s*/i, '');
    // O Google lança esta exceção, em vez de retornar vazio, em Forms sem vínculo.
    if (/^(The form currently has no response destination|O formulário não tem nenhum destino de resposta no momento)\.?$/i.test(detail)) return '';
    throw error;
  }
}

function configureForm_(kind, form, source) {
  source = source || {items: {}};
  var created = PropertiesService.getScriptProperties().getProperty('SEMINFO_CREATED_FORM_' + form.getId()) === 'true';
  var isRegistration = kind === 'INSCRICAO';
  if (created) form.setTitle(isRegistration ? 'SEMINFO — Solicitação de inscrição' : 'SEMINFO — Solicitação de cancelamento')
    .setDescription('Semana da Informática — Centro Acadêmico Alan Turing. ' +
      'Use a mesma Conta Google em todas as solicitações referentes ao seu CPF. ' +
      'O e-mail é coletado pelo Google Forms a partir da conta conectada. ' +
      (isRegistration ? 'Envie uma solicitação por atividade. A confirmação depende de vagas e compatibilidade de horários. ' +
        'Se autorizar uma troca, TODAS as suas inscrições confirmadas com horário conflitante serão substituídas, somente se houver vaga na nova atividade.' :
        'Selecione a atividade que deseja cancelar. A lista inclui atividades lotadas, encerradas e canceladas. O cancelamento será confirmado por e-mail.'));
  if (isRegistration && source.title) form.setTitle(source.title);
  form.setLimitOneResponsePerUser(false)
    .setAllowResponseEdits(false)
    .setPublishingSummary(false)
    .setShowLinkToRespondAgain(true)
    .setShuffleQuestions(false)
    .setConfirmationMessage(isRegistration ? SEMINFO_FORM_TEXT_.RECEIVED :
      'Recebemos sua solicitação de cancelamento. O resultado será encaminhado ao e-mail da sua Conta Google após a verificação da identidade e da inscrição.');
  // Não reaplica um setter booleano a uma coleta já configurada como VERIFIED.
  if (!form.collectsEmail()) form.setCollectEmail(true);
  var destination = formDestinationId_(form);
  var spreadsheetId = db_().getId();
  // Repetir setDestination mesmo com o mesmo destino pode gerar outra aba bruta.
  if (!destination) form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  PropertiesService.getScriptProperties().setProperty('SEMINFO_FORM_DESTINATION_' + form.getId(), formDestinationId_(form));

  if (isRegistration) {
    var name = textFormItem_(ensureFormItem_(form, kind, 'NAME', 'TEXT', SEMINFO_FORM_TEXT_.NAME, source)).setRequired(true);
    if (created) name.setHelpText('Informe seu nome completo.');
  }
  var cpf = textFormItem_(ensureFormItem_(form, kind, 'CPF', 'TEXT', SEMINFO_FORM_TEXT_.CPF, source)).setRequired(true);
  if (created) cpf.setHelpText('Informe os 11 dígitos do seu CPF. Zeros iniciais são preservados. A validação completa ocorre após o envio.');
  if (!isRegistration || !source.activityId) {
    var activityItem = singleChoiceItem_(ensureFormItem_(form, kind, 'ACTIVITY', 'LIST', SEMINFO_FORM_TEXT_.ACTIVITY, source));
    activityItem.setRequired(true);
    if (String(activityItem.getType()) === 'MULTIPLE_CHOICE') activityItem.showOtherOption(false);
    if (created) activityItem.setHelpText(isRegistration ?
      'Escolha uma atividade. A disponibilidade exibida pode mudar até o processamento; o envio não reserva vaga.' :
      'Escolha a atividade da sua inscrição. A organização verificará se existe uma inscrição confirmada vinculada ao seu CPF.');
    if (!activityItem.getChoices().length) activityItem.setChoiceValues(['Nenhuma atividade cadastrada.']);
  }
  ensureFormItem_(form, kind, isRegistration ? 'SWAP' : 'CANCEL', 'MULTIPLE_CHOICE',
    isRegistration ? SEMINFO_FORM_TEXT_.SWAP : SEMINFO_FORM_TEXT_.CANCEL, source)
    .asMultipleChoiceItem().setRequired(true).showOtherOption(false)
    .setChoiceValues(isRegistration ? [SEMINFO_FORM_TEXT_.SWAP_YES, SEMINFO_FORM_TEXT_.SWAP_NO] :
      [SEMINFO_FORM_TEXT_.CANCEL_YES, SEMINFO_FORM_TEXT_.CANCEL_NO])
    .setHelpText(isRegistration ?
      'A autorização abrange TODAS as suas inscrições confirmadas com horário total ou parcialmente sobreposto. Sem vaga na atividade escolhida, todas as inscrições anteriores permanecem válidas.' :
      'Esta solicitação afeta somente a inscrição na atividade selecionada.');
}

function compatibleFormItemType_(key, type, actual) {
  return actual === type || key === 'ACTIVITY' && type === 'LIST' && actual === 'MULTIPLE_CHOICE' ||
    (key === 'NAME' || key === 'CPF') && type === 'TEXT' && actual === 'PARAGRAPH_TEXT';
}

function textFormItem_(item) {
  return String(item.getType()) === 'PARAGRAPH_TEXT' ? item.asParagraphTextItem() : item.asTextItem();
}

function singleChoiceItem_(item) {
  return String(item.getType()) === 'LIST' ? item.asListItem() : item.asMultipleChoiceItem();
}

function storedFormItemId_(form, kind, key) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty(formItemProperty_(kind, key, form));
  if (stored) return stored;
  var legacyOrigin = props.getProperty('SEMINFO_ID_FORM_' + kind) || getConfig_()['ID_FORM_' + kind];
  if (!stored && (kind !== 'INSCRICAO' && kind !== 'CANCELAMENTO' || legacyOrigin === form.getId())) {
    stored = props.getProperty(formItemProperty_(kind, key));
  }
  return stored;
}

function matchesFormItemTitle_(key, candidateTitle, title) {
  if (key !== 'NAME' && key !== 'CPF') return candidateTitle === title;
  var normalized = String(candidateTitle).trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized === title.toLowerCase() || key === 'CPF' && normalized === 'cpf (xxx.xxx.xxx-xx)';
}

/** Somente leitura: evita alterar o primeiro Form e depois falhar no segundo. */
function resolveFormItem_(form, kind, key, type, title, source) {
  source = source || {items: {}};
  var explicit = source.items && source.items[key];
  var stored = storedFormItemId_(form, kind, key);
  if (explicit && stored && Number(explicit) !== Number(stored)) {
    throw new Error('A pergunta ' + kind + '/' + key + ' do formulário ' + form.getId() + ' já foi mapeada para outro ID. Preserve o histórico.');
  }
  var item;
  if (explicit || stored) {
    item = form.getItemById(Number(explicit || stored));
    if (!item || !compatibleFormItemType_(key, type, String(item.getType()))) {
      throw new Error('Pergunta ' + kind + '/' + key + ' ausente ou com tipo incompatível no formulário ' + form.getId() + '. Confira os IDs com listarPerguntasDosFormularios.');
    }
    return item;
  }
  var matching = form.getItems().filter(function (candidate) { return matchesFormItemTitle_(key, candidate.getTitle(), title); });
  if (matching.length > 1 || matching.length === 1 && !compatibleFormItemType_(key, type, String(matching[0].getType()))) {
    throw new Error('Pergunta ambígua ou com tipo incompatível: ' + title + ' no formulário ' + form.getId() + '. Informe seu ID em items após listarPerguntasDosFormularios.');
  }
  item = matching[0];
  var created = PropertiesService.getScriptProperties().getProperty('SEMINFO_CREATED_FORM_' + form.getId()) === 'true';
  if (!item && !created && (key === 'NAME' || key === 'CPF' || key === 'ACTIVITY')) {
    throw new Error('Não localizamos a pergunta ' + key + ' no formulário existente ' + form.getId() + '. Execute listarPerguntasDosFormularios e informe seu ID em items; nenhuma pergunta será duplicada.');
  }
  return item;
}

function preflightForm_(kind, form, source) {
  var roles = kind === 'INSCRICAO' ? ['NAME', 'CPF', 'SWAP'] : ['CPF', 'CANCEL'];
  if (kind !== 'INSCRICAO' || !source.activityId) roles.push('ACTIVITY');
  var seen = {};
  roles.forEach(function (key) {
    var type = key === 'NAME' || key === 'CPF' ? 'TEXT' : key === 'ACTIVITY' ? 'LIST' : 'MULTIPLE_CHOICE';
    var item = resolveFormItem_(form, kind, key, type, SEMINFO_FORM_TEXT_[key], source);
    if (item && seen[item.getId()]) throw new Error('A mesma pergunta representa mais de um campo no formulário ' + form.getId() + '.');
    if (item) seen[item.getId()] = true;
  });
  var expected = PropertiesService.getScriptProperties().getProperty('SEMINFO_FORM_DESTINATION_' + form.getId());
  if (expected !== null && expected !== formDestinationId_(form)) throw new Error('O destino bruto do formulário ' + form.getId() + ' foi alterado após a instalação. Restaure o vínculo antes de reinstalar.');
}

/** Campos instalados precisam existir; a autorização deve manter seu sentido. */
function assertInstalledFormItems_(source, form) {
  var keys = source.kind === 'INSCRICAO' ? ['NAME', 'CPF', 'SWAP'] : ['CPF', 'CANCEL'];
  if (source.kind !== 'INSCRICAO' || !source.activityId) keys.push('ACTIVITY');
  keys.forEach(function (key) {
    var item = getStoredFormItem_(form, source.kind, key);
    var specific = key === 'NAME' || key === 'CPF' ? textFormItem_(item) : key === 'ACTIVITY' ? singleChoiceItem_(item) : item.asMultipleChoiceItem();
    if (typeof specific.isRequired === 'function' && !specific.isRequired()) throw new Error('Pergunta obrigatória ' + key + ' alterada no formulário ' + form.getId() + '. Reinstale para restaurar.');
    if (key === 'SWAP' || key === 'CANCEL') {
      var values = specific.getChoices().map(function (choice) { return typeof choice === 'string' ? choice : choice.getValue(); });
      var expected = key === 'SWAP' ? [SEMINFO_FORM_TEXT_.SWAP_YES, SEMINFO_FORM_TEXT_.SWAP_NO] : [SEMINFO_FORM_TEXT_.CANCEL_YES, SEMINFO_FORM_TEXT_.CANCEL_NO];
      if (item.getTitle() !== SEMINFO_FORM_TEXT_[key] || JSON.stringify(values) !== JSON.stringify(expected)) {
        throw new Error('A autorização ' + key + ' foi alterada no formulário ' + form.getId() + '. Reinstale para restaurar o texto e as opções completas.');
      }
    }
  });
}

/**
 * Recupera itens pelo ID, título fixo ou item vazio cuja criação foi interrompida.
 * Não apaga itens/respostas. IDs já persistidos que foram apagados exigem reparo.
 */
function ensureFormItem_(form, kind, key, type, title, source) {
  var props = PropertiesService.getScriptProperties();
  var property = formItemProperty_(kind, key, form);
  var pendingProperty = property + '_PENDING';
  var genericKind = kind !== 'INSCRICAO' && kind !== 'CANCELAMENTO';
  var item = genericKind ? null : resolveFormItem_(form, kind, key, type, title, source);
  if (genericKind) {
    var stored = props.getProperty(property);
    item = stored ? form.getItemById(Number(stored)) : form.getItems().filter(function (candidate) {
      return candidate.getTitle() === title && String(candidate.getType()) === type;
    })[0];
  }
  var newItem = !item;
  if (!item) {
    if (!item && props.getProperty(pendingProperty) === form.getId()) {
      var blanks = form.getItems().filter(function (candidate) {
        return !candidate.getTitle() && String(candidate.getType()) === type;
      });
      if (blanks.length > 1) throw new Error('Criação interrompida com perguntas vazias ambíguas em ' + kind + '/' + key + '.');
      item = blanks[0];
    }
    if (!item) {
      props.setProperty(pendingProperty, form.getId());
      if (type === 'TEXT') item = form.addTextItem();
      else if (type === 'LIST') item = form.addListItem();
      else if (type === 'MULTIPLE_CHOICE') item = form.addMultipleChoiceItem();
      else throw new Error('Tipo de pergunta não suportado: ' + type);
    }
  }
  props.setProperty(property, String(item.getId()));
  if (!genericKind && getConfig_()['ID_FORM_' + kind] === form.getId()) {
    props.setProperty(formItemProperty_(kind, key), String(item.getId()));
  }
  if (newItem || key === 'SWAP' || key === 'CANCEL' || genericKind || props.getProperty('SEMINFO_CREATED_FORM_' + form.getId()) === 'true') item.setTitle(title);
  props.deleteProperty(pendingProperty);
  // add* retorna um tipo concreto; os chamadores esperam um Item genérico.
  return form.getItemById(item.getId());
}

function formItemProperty_(kind, key, form) {
  return 'SEMINFO_ITEM_' + (form && (kind === 'INSCRICAO' || kind === 'CANCELAMENTO') ? form.getId() : kind) + '_' + key;
}

/** Metadata GET is the security check; collectsEmail() alone is insufficient. */
function getFormMetadata_(form, force) {
  var id = form.getId();
  if (!force && SEMINFO_FORM_METADATA_[id]) return SEMINFO_FORM_METADATA_[id];
  var response = UrlFetchApp.fetch('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(id) +
    '?fields=formId,settings.emailCollectionType', {
      method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  var httpCode = response.getResponseCode();
  if (httpCode !== 200) {
    // Não registra o token nem o corpo inteiro da resposta em planilhas/e-mails.
    throw new Error('Não foi possível verificar a coleta nativa do formulário ' + id +
      ' (Google Forms API HTTP ' + httpCode + '). Habilite a Google Forms API no projeto Cloud associado e confira a autorização. Nenhuma solicitação será aplicada sem essa verificação.');
  }
  var metadata = JSON.parse(response.getContentText());
  if (metadata.formId !== id) throw new Error('A API retornou um formulário incompatível com o ID esperado.');
  SEMINFO_FORM_METADATA_[id] = metadata;
  return metadata;
}

/** Configuração administrativa explícita; a abertura continua sendo uma etapa separada. */
function configurarEmailVerificadoFormularios() {
  requireInstaller_();
  var result = withExternalFormOperation_(function () {
    var entries = getFormSources_().map(function (source) { return {source: source, form: openFormWithDriveRetry_(source.id)}; });
    if (!entries.length) throw new Error('Instale os formulários antes de configurar o e-mail verificado.');
    var properties = PropertiesService.getScriptProperties();
    properties.deleteProperty('SEMINFO_FORMS_ACTIVATED');
    entries.forEach(function (entry) { setFormReceiving_(entry.form, false); });
    var reports = entries.map(function (entry) {
      var form = entry.form, id = form.getId(), metadata = getFormMetadata_(form, true);
      var changed = !metadata.settings || metadata.settings.emailCollectionType !== 'VERIFIED';
      if (changed) {
        // Respostas anteriores à correção não passam a ter identidade verificada.
        properties.deleteProperty('SEMINFO_VERIFIED_SINCE_' + id);
        delete SEMINFO_FORM_METADATA_[id];
        var response = UrlFetchApp.fetch('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(id) + ':batchUpdate', {
          method: 'post', contentType: 'application/json',
          headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
          payload: JSON.stringify({requests: [{updateSettings: {
            settings: {emailCollectionType: 'VERIFIED'}, updateMask: 'emailCollectionType'
          }}]}),
          muteHttpExceptions: true
        });
        if (response.getResponseCode() !== 200) throw new Error('Não foi possível configurar o e-mail verificado em ' + form.getEditUrl() +
          ' (Google Forms API HTTP ' + response.getResponseCode() + '). Atualize appsscript.json com o escopo forms.body, autorize novamente e confira a Google Forms API e o acesso de edição.');
      }
      assertVerifiedEmail_(form, true); // Confirma por GET, mesmo após um POST bem-sucedido.
      return {id: id, editUrl: form.getEditUrl(), emailCollectionType: 'VERIFIED', alterado: changed};
    });
    return {total: reports.length, alterados: reports.filter(function (report) { return report.alterado; }).length,
      formularios: reports, proximoPasso: 'Execute conferirSistema e depois abrirInscricoes.'};
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function assertVerifiedEmail_(form, force) {
  var metadata;
  try { metadata = getFormMetadata_(form, force); }
  catch (error) { setFormReceiving_(form, false); throw error; }
  if (!metadata.settings || metadata.settings.emailCollectionType !== 'VERIFIED') {
    deactivateUnsafeForms_(form.getId());
    throw new Error('Configure o e-mail verificado no formulário: ' + form.getEditUrl() +
      ' → Configurações → Respostas → Coletar endereços de e-mail → Verificado. ' +
      'Entrada do participante e perguntas de e-mail digitado não verificam identidade. ' +
      'Ou execute configurarEmailVerificadoFormularios pela conta instaladora.');
  }
  return metadata;
}

/** Uma modalidade insegura conhecida invalida a janela de confiança do formulário. */
function deactivateUnsafeForms_(unsafeFormId) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('SEMINFO_VERIFIED_SINCE_' + unsafeFormId);
  props.deleteProperty('SEMINFO_FORMS_ACTIVATED');
  getFormSources_().forEach(function (source) {
    setFormReceiving_(openFormWithDriveRetry_(source.id), false);
  });
}

/** activate=true somente quando a organização decide abrir as inscrições. */
function verifyForms_(activate) {
  var sources = getFormSources_();
  var reports = [];
  var issues = [];
  if (!sources.some(function (source) { return source.kind === 'INSCRICAO'; })) issues.push('Formulário INSCRICAO ainda não instalado.');
  if (shouldCreateCancellationForm_() && !sources.some(function (source) { return source.kind === 'CANCELAMENTO'; })) issues.push('Formulário CANCELAMENTO ainda não instalado.');
  sources.forEach(function (source) {
    var id = source.id, kind = source.kind;
    var form = openFormWithDriveRetry_(id);
    try {
      var metadata = assertVerifiedEmail_(form, true);
      preflightForm_(kind, form, source);
      assertInstalledFormItems_(source, form);
      var expectedDestination = PropertiesService.getScriptProperties().getProperty('SEMINFO_FORM_DESTINATION_' + id) || db_().getId();
      if (form.canEditResponse() || form.hasLimitOneResponsePerUser() || form.isPublishingSummary() ||
          formDestinationId_(form) !== expectedDestination) {
        throw new Error('Configuração do formulário ' + kind + ' alterada. Reinstale para restaurar destino, vários envios, edição desativada e resumo privado.');
      }
      reports.push({kind: kind, id: id, activityId: source.activityId, emailCollectionType: metadata.settings.emailCollectionType,
        editUrl: form.getEditUrl(), url: form.getPublishedUrl()});
    } catch (error) {
      setFormReceiving_(form, false);
      issues.push(String(error.message || error));
    }
  });
  if (issues.length) {
    sources.forEach(function (source) { setFormReceiving_(openFormWithDriveRetry_(source.id), false); });
    throw new Error(issues.join('\n'));
  }
  if (activate === true) {
    var properties = PropertiesService.getScriptProperties();
    var cutoff = new Date().toISOString();
    reports.forEach(function (report) {
      var key = 'SEMINFO_VERIFIED_SINCE_' + report.id;
      if (!properties.getProperty(key)) properties.setProperty(key, cutoff);
    });
    properties.setProperty('SEMINFO_FORMS_ACTIVATED', 'true');
  }
  return reports;
}

/** Estado lido sob lock; chamadas ao Forms executadas fora dele, sob marcador VIEW. */
function refreshFormsLocked_(state, deadline) {
  if (props_().getProperty('SEMINFO_EVENTO_ENCERRADO_EM')) return fecharFormulariosEvento_();
  var executionDeadline = Number(deadline) || Infinity;
  var sources = getFormSources_();
  if (!sources.some(function (source) { return source.kind === 'INSCRICAO'; })) return {available: 0, total: 0, issues: ['Formulários ainda não instalados.']};
  var activities = Object.keys(state.activities || {}).map(function (id) { return state.activities[id]; });
  var confirmedCount = {};
  Object.keys(state.registrations || {}).forEach(function (id) {
    var registration = state.registrations[id];
    if (registration.status === 'confirmada') {
      confirmedCount[registration.activityId] = (confirmedCount[registration.activityId] || 0) + 1;
    }
  });
  activities.sort(function (a, b) {
    return (a.start ? new Date(a.start).getTime() : Infinity) - (b.start ? new Date(b.start).getTime() : Infinity) || String(a.id).localeCompare(String(b.id));
  });
  var available = activities.filter(function (activity) {
    return activity.capacityUnit !== 'equipes' && activity.status === 'aberta' && (confirmedCount[activity.id] || 0) < Number(activity.capacity);
  });
  var entries = [], issues = [];
  // A verificação termina para todas as origens antes de abrir qualquer uma.
  // Uma origem insegura revoga a ativação global e nunca reabre a próxima.
  for (var index = 0; index < sources.length; index++) {
    if (Date.now() >= executionDeadline - 30000) {
      if (issues.length) break;
      return {available: available.length, total: activities.length, issues: [], adiados: sources.length, adiada: true, fase: 'verificacao'};
    }
    var entry = {source: sources[index], form: openFormWithDriveRetry_(sources[index].id)};
    entries.push(entry);
    try { assertVerifiedEmail_(entry.form); preflightForm_(entry.source.kind, entry.form, entry.source); assertInstalledFormItems_(entry.source, entry.form); }
    catch (error) { issues.push(String(error.message || error)); }
  }
  if (issues.length) {
    sources.forEach(function (source, index) { setFormReceiving_(entries[index] ? entries[index].form : openFormWithDriveRetry_(source.id), false); });
    throw new Error(issues.join('\n'));
  }
  var activated = PropertiesService.getScriptProperties().getProperty('SEMINFO_FORMS_ACTIVATED') === 'true';
  var availableIds = {};
  available.forEach(function (activity) { availableIds[activity.id] = true; });
  var cursor = Number(props_().getProperty('SEMINFO_FORM_REFRESH_INDEX') || 0);
  if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;
  var updated = 0, maximum = executionDeadline === Infinity ? entries.length : Math.min(3, entries.length);
  for (var offset = 0; offset < maximum && Date.now() < executionDeadline - 30000; offset++) {
    var currentIndex = (cursor + offset) % entries.length, entry = entries[currentIndex];
    // Uma falha repete esta origem; sucessos continuam pela próxima na rodada seguinte.
    props_().setProperty('SEMINFO_FORM_REFRESH_INDEX', String(currentIndex));
    var source = entry.source, form = entry.form;
    var trusted = !!PropertiesService.getScriptProperties().getProperty('SEMINFO_VERIFIED_SINCE_' + form.getId());
    if (source.kind === 'INSCRICAO') {
      if (!source.activityId) singleChoiceItem_(getStoredFormItem_(form, source.kind, 'ACTIVITY'))
        .setChoiceValues(available.length ? available.map(function (activity) {
          return formActivityLabel_(activity) + ' | Vagas: ' + (Number(activity.capacity) - (confirmedCount[activity.id] || 0));
        }) : ['Nenhuma atividade disponível no momento.']);
      setFormClosedMessage_(form, !trusted ? 'Formulário em configuração. Aguarde a abertura verificada pela organização.' : state.accepting ? SEMINFO_FORM_TEXT_.EMPTY :
        'O recebimento de solicitações de inscrição está encerrado pela organização. Consulte o Centro Acadêmico Alan Turing.');
      var hasAvailable = source.activityId ? availableIds[source.activityId] === true : available.length > 0;
      setFormReceiving_(form, activated && trusted && state.accepting === true && hasAvailable);
    } else {
      var individualActivities = activities.filter(function (activity) { return activity.capacityUnit !== 'equipes' && (activity.status !== 'pendente' || confirmedCount[activity.id] > 0); });
      singleChoiceItem_(getStoredFormItem_(form, source.kind, 'ACTIVITY'))
        .setChoiceValues(individualActivities.length ? individualActivities.map(formActivityLabel_) : ['Nenhuma atividade individual cadastrada.']);
      setFormClosedMessage_(form, 'O cancelamento ainda não está disponível. Consulte o Centro Acadêmico Alan Turing.');
      setFormReceiving_(form, activated && trusted && individualActivities.length > 0);
    }
    updated++;
    props_().setProperty('SEMINFO_FORM_REFRESH_INDEX', String((currentIndex + 1) % entries.length));
  }
  return {available: available.length, total: activities.length, issues: [], atualizados: updated,
    adiados: entries.length - updated, parcial: updated < entries.length, adiada: updated < entries.length};
}

function setFormClosedMessage_(form, message) {
  try { form.setCustomClosedFormMessage(message); }
  catch (error) {
    var detail = String(error && error.message || error).trim().replace(/^Exception:\s*/i, '');
    if (!/^(Invalid data updating form|Dados inválidos ao atualizar o formulário)\.?$/i.test(detail)) throw error;
    // A mensagem é opcional; a publicação e o recebimento continuam sendo controlados.
    console.warn('SEMINFO: mensagem de fechamento não atualizada no formulário ' + form.getId() + '.');
  }
}

function setFormReceiving_(form, accepting) {
  var step = 'consultar publicação';
  try {
    if (accepting && form.supportsAdvancedResponderPermissions() && !form.isPublished()) {
      step = 'setPublished(true)';
      form.setPublished(true);
    }
    // Publishing overwrites acceptance, so this must follow setPublished().
    step = 'isAcceptingResponses()';
    if (form.isAcceptingResponses() !== accepting) {
      step = 'setAcceptingResponses(' + accepting + ')';
      form.setAcceptingResponses(accepting);
    }
  } catch (error) {
    // Uma falha real no recebimento não pode ser tratada como mensagem opcional.
    throw new Error('Falha ao ' + (accepting ? 'abrir' : 'fechar') + ' o formulário ' + form.getId() +
      ' na etapa ' + step + ': ' + String(error && error.message || error));
  }
}

function formActivityLabel_(activity) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(activity.id))) throw new Error('ID incompatível com as opções do formulário: ' + activity.id);
  return '[' + activity.id + '] ' + activity.title + ' | ' +
    (activity.start ? Utilities.formatDate(new Date(activity.start), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') : 'Início a confirmar') + '–' +
    (activity.end ? Utilities.formatDate(new Date(activity.end), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') : 'Término a confirmar') +
    (activity.location ? ' | ' + activity.location : '');
}

function getStoredFormItem_(form, kind, key) {
  var stored = storedFormItemId_(form, kind, key);
  var item = stored ? form.getItemById(Number(stored)) : null;
  if (!item) throw new Error('Pergunta ' + kind + '/' + key + ' ausente. Execute a instalação para conferir; respostas existentes serão preservadas.');
  var type = key === 'NAME' || key === 'CPF' ? 'TEXT' : key === 'ACTIVITY' ? 'LIST' : 'MULTIPLE_CHOICE';
  if (!compatibleFormItemType_(key, type, String(item.getType()))) throw new Error('Tipo da pergunta ' + kind + '/' + key + ' alterado após a instalação.');
  return item;
}

/** Respostas anteriores à primeira abertura verificada permanecem em quarentena. */
function isEligibleFormResponse_(form, response) {
  var cutoff = PropertiesService.getScriptProperties().getProperty('SEMINFO_VERIFIED_SINCE_' + form.getId());
  return !!cutoff && !!response && !!response.getTimestamp() &&
    response.getTimestamp().getTime() > new Date(cutoff).getTime();
}

/** Full CPF validation and identity matching are performed by the domain server. */
function parseFormRequest_(kind, form, response) {
  if (kind !== 'INSCRICAO' && kind !== 'CANCELAMENTO') throw new Error('Tipo de solicitação desconhecido.');
  var source = form && getFormSources_().filter(function (entry) { return entry.kind === kind && entry.id === form.getId(); })[0];
  if (!source) throw new Error('A origem da solicitação não é o formulário instalado.');
  if (!response || !response.getId()) throw new Error('Resposta ainda não enviada ou ID de resposta ausente.');
  assertVerifiedEmail_(form);
  if (!isEligibleFormResponse_(form, response)) {
    throw new Error('Resposta em quarentena: enviada antes da abertura verificada deste formulário. Não será aplicada nem notificada; a pessoa deve enviar nova solicitação após a liberação.');
  }
  preflightForm_(kind, form, source);
  assertInstalledFormItems_(source, form);
  var email = String(response.getRespondentEmail() || '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Resposta sem e-mail nativo verificado. Nenhum campo digitado pode substituí-lo.');
  }
  var answers = {};
  response.getItemResponses().forEach(function (itemResponse) {
    answers[String(itemResponse.getItem().getId())] = String(itemResponse.getResponse() || '').trim();
  });
  function answer(key) { return answers[String(getStoredFormItem_(form, kind, key).getId())] || ''; }
  var activityChoice = source.activityId ? '' : answer('ACTIVITY');
  var activityMatch = /^\[([A-Za-z0-9_-]{1,64})\](?:\s|$)/.exec(activityChoice);
  var key = form.getId() + ':' + response.getId();
  var swapAnswer = kind === 'INSCRICAO' ? answer('SWAP') : '';
  var cancelAnswer = kind === 'CANCELAMENTO' ? answer('CANCEL') : '';
  var rawCpf = answer('CPF');
  var rawName = kind === 'INSCRICAO' ? answer('NAME') : '';
  var invalidAnswer = rawCpf.length > 64 || rawName.length > 200 || (kind === 'INSCRICAO' ?
    [SEMINFO_FORM_TEXT_.SWAP_YES, SEMINFO_FORM_TEXT_.SWAP_NO].indexOf(swapAnswer) === -1 :
    [SEMINFO_FORM_TEXT_.CANCEL_YES, SEMINFO_FORM_TEXT_.CANCEL_NO].indexOf(cancelAnswer) === -1);
  return {
    key: key, kind: kind, cpf: rawCpf.slice(0, 64),
    name: rawName.slice(0, 200), email: email,
    activityId: source.activityId || (activityMatch ? activityMatch[1] : ''),
    authorizeSwap: swapAnswer === SEMINFO_FORM_TEXT_.SWAP_YES,
    confirmCancel: cancelAnswer === SEMINFO_FORM_TEXT_.CANCEL_YES,
    invalidAnswer: invalidAnswer,
    protocol: protocol_(key), submittedAt: response.getTimestamp().toISOString(),
    formId: form.getId(), responseId: response.getId()
  };
}

/** Installable triggers are attached to Forms, not to raw response sheets. */
function aoEnviarInscricao(e) { runSeminfoFormTrigger_('INSCRICAO', e); }
function aoEnviarCancelamento(e) { runSeminfoFormTrigger_('CANCELAMENTO', e); }

function runSeminfoFormTrigger_(kind, event) {
  if (!event || !event.source || !event.response) throw new Error('Use um gatilho instalável de envio no Google Forms. Não execute esta função sem evento.');
  var deadline = Date.now() + 270000;
  try { processFormResponse_(kind, event.source, event.response, false, deadline - 45000); }
  finally {
    postProcessing_(deadline);
    // No envio, confere somente a aba do próprio Form; o periódico cobre as demais.
    try { if (Date.now() < deadline - 30000) nomearAbasDeRespostas_([event.source.getId()]); }
    catch (error) { recordError_('nomear-abas-respostas', event.source.getId(), error); }
  }
}
