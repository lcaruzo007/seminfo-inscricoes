'use strict';

// Integração local com os .gs reais. Serviços Google são simulados; não prova
// permissões Cloud, publicação real, entrega de e-mail ou LockService remoto.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function environment(defaultMode = 'VERIFIED') {
  let sequence = 0;
  let sheetSequence = 0;
  const properties = new Map(), sheets = new Map(), forms = new Map(), triggers = [];
  const stats = { formsCreated: 0, destinations: 0, triggersCreated: 0, responsesRead: 0, queueSyncs: 0, locks: 0 };
  const propertiesApi = {
    getProperties: () => Object.fromEntries(properties),
    getProperty: key => properties.has(key) ? properties.get(key) : null,
    setProperty: (key, value) => { properties.set(key, String(value)); return propertiesApi; },
    deleteProperty: key => { properties.delete(key); return propertiesApi; }
  };
  class Range {
    constructor(sheet, row, column, height = 1, width = 1) { Object.assign(this, { sheet, row, column, height, width }); }
    getValues() {
      return Array.from({ length: this.height }, (_, r) => Array.from({ length: this.width }, (_, c) =>
        this.sheet.cells[this.row + r - 1]?.[this.column + c - 1] ?? ''));
    }
    getDisplayValues() { return this.getValues().map(row => row.map(String)); }
    setValues(rows) {
      assert.equal(rows.length, this.height);
      rows.forEach((row, r) => {
        assert.equal(row.length, this.width);
        this.sheet.cells[this.row + r - 1] ||= [];
        row.forEach((value, c) => { this.sheet.cells[this.row + r - 1][this.column + c - 1] = value; });
      });
      return this;
    }
    setValue(value) { return this.setValues([[value]]); }
    clearContent() { return this.setValues(Array.from({ length: this.height }, () => Array(this.width).fill(''))); }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setBackground() { return this; }
    setFontColor() { return this; }
  }
  class Protection {
    constructor(sheet) { this.sheet = sheet; this.description = ''; this.editors = []; this.domain = true; }
    getDescription() { return this.description; }
    setDescription(value) { this.description = value; return this; }
    setWarningOnly() { return this; }
    addEditor(email) { if (!this.editors.includes(email)) this.editors.push(email); return this; }
    getEditors() { return this.editors.map(email => ({ getEmail: () => email })); }
    removeEditors(users) { const remove = users.map(user => user.getEmail()); this.editors = this.editors.filter(email => !remove.includes(email)); return this; }
    canDomainEdit() { return this.domain; }
    setDomainEdit(value) { this.domain = value; return this; }
    remove() { this.sheet.protections.splice(this.sheet.protections.indexOf(this), 1); }
  }
  class Sheet {
    constructor(name) { this.name = name; this.sheetId = ++sheetSequence; this.cells = []; this.protections = []; this.maxRows = 100; }
    getLastRow() { let count = this.cells.length; while (count && !this.cells[count - 1]?.some(value => value !== '' && value !== undefined)) count--; return count; }
    getLastColumn() { return Math.max(0, ...this.cells.map(row => row?.length || 0)); }
    getRange(...args) { return new Range(this, ...args); }
    getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
    appendRow(values) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); return this; }
    setFrozenRows() { return this; }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(_, count) { this.maxRows += count; return this; }
    getProtections() { return this.protections; }
    protect() { const protection = new Protection(this); this.protections.push(protection); return protection; }
    autoResizeColumns() { return this; }
    getSheetId() { return this.sheetId; }
    getName() { return this.name; }
    getFormUrl() { return this.formUrl || null; }
    setName(name) { sheets.delete(this.name); this.name = name; sheets.set(name, this); return this; }
    hideSheet() { this.hidden = true; return this; }
    copyTo() { const copy = new Sheet('Cópia ' + sheets.size); copy.cells = JSON.parse(JSON.stringify(this.cells)); sheets.set(copy.name, copy); return copy; }
  }
  const spreadsheet = {
    timezone: '', getId: () => 'SHEET', getUrl: () => 'https://example.org/sheet',
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => [...sheets.values()],
    insertSheet: name => { assert(!sheets.has(name)); const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; },
    setSpreadsheetTimeZone(value) { this.timezone = value; }, getSpreadsheetTimeZone() { return this.timezone; }
  };
  class Item {
    constructor(type) { this.type = type; this.id = ++sequence; this.title = ''; this.choices = []; }
    getType() { return this.type; }
    getId() { return this.id; }
    getTitle() { return this.title; }
    setTitle(value) { this.title = value; return this; }
    asTextItem() { assert.equal(this.type, 'TEXT'); return this; }
    asParagraphTextItem() { assert.equal(this.type, 'PARAGRAPH_TEXT'); return this; }
    asListItem() { assert.equal(this.type, 'LIST'); return this; }
    asMultipleChoiceItem() { assert.equal(this.type, 'MULTIPLE_CHOICE'); return this; }
    setRequired(value) { this.required = value; return this; }
    setHelpText(value) { this.help = value; return this; }
    showOtherOption(value) { this.other = value; return this; }
    setChoiceValues(values) { assert(values.length > 0); this.choices = [...values]; return this; }
    getChoices() { return this.choices; }
  }
  class Form {
    constructor(documentTitle, published) {
      this.id = 'FORM_' + (++sequence); this.documentTitle = documentTitle; this.title = documentTitle;
      this.published = published; this.accepting = published; this.items = []; this.responses = [];
      this.mode = defaultMode; this.collect = false; this.destination = ''; this.edit = false; this.one = false; this.summary = false;
    }
    getId() { return this.id; }
    getTitle() { return this.title; }
    getDescription() { return this.description || ''; }
    getItems() { return this.items; }
    getItemById(id) { return this.items.find(item => item.id === id) || null; }
    add(type) { const item = new Item(type); this.items.push(item); return item; }
    addTextItem() { return this.add('TEXT'); }
    addParagraphTextItem() { return this.add('PARAGRAPH_TEXT'); }
    addListItem() { return this.add('LIST'); }
    addMultipleChoiceItem() { return this.add('MULTIPLE_CHOICE'); }
    getEditUrl() { return 'https://example.org/forms/' + this.id + '/edit'; }
    getPublishedUrl() { return 'https://example.org/forms/' + this.id; }
    collectsEmail() { return this.collect; }
    setCollectEmail(value) { this.collect = value; return this; }
    getDestinationId() { if (this.destinationError) throw this.destinationError; return this.destination; }
    setDestination(type, id) { this.destination = id; stats.destinations++; return this; }
    setTitle(value) { this.title = value; return this; }
    setDescription(value) { this.description = value; return this; }
    setLimitOneResponsePerUser(value) { this.one = value; return this; }
    setAllowResponseEdits(value) { this.edit = value; return this; }
    setPublishingSummary(value) { this.summary = value; return this; }
    setShowLinkToRespondAgain(value) { this.again = value; return this; }
    setShuffleQuestions() { return this; }
    setConfirmationMessage(value) { this.confirmation = value; return this; }
    setCustomClosedFormMessage(value) { this.closedMessage = value; return this; }
    canEditResponse() { return this.edit; }
    hasLimitOneResponsePerUser() { return this.one; }
    isPublishingSummary() { return this.summary; }
    supportsAdvancedResponderPermissions() { return true; }
    isPublished() { return this.published; }
    setPublished(value) { this.published = value; this.accepting = value; return this; }
    isAcceptingResponses() { return this.accepting; }
    setAcceptingResponses(value) { assert(!value || this.published, 'publish before accepting'); this.accepting = value; return this; }
    getResponses() { return this.responses; }
    deleteAllResponses() { this.responses = []; return this; }
  }
  const context = vm.createContext({
    console, PropertiesService: { getScriptProperties: () => propertiesApi },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: id => { assert.equal(id, 'SHEET'); return spreadsheet; },
      flush: () => {}, getUi: () => ({ alert: () => {} }), ProtectionType: { SHEET: 'SHEET' } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'ca@example.org' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    LockService: { getScriptLock: () => ({ waitLock: () => { stats.locks++; }, releaseLock: () => {} }) },
    MailApp: { getRemainingDailyQuota: () => 100 },
    Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()].map(value => value > 127 ? value - 256 : value),
      getUuid: () => 'UUID-' + (++sequence), formatDate: value => value.toISOString() },
    FormApp: { create: (name, published) => { stats.formsCreated++; const form = new Form(name, published); forms.set(form.id, form); return form; },
      openByUrl: url => { const form = [...forms.values()].find(form => form.getPublishedUrl() === url); assert(form); return form; },
      openById: id => { assert(forms.has(id), 'configured form must exist'); return forms.get(id); }, DestinationType: { SPREADSHEET: 'SPREADSHEET' } },
    DriveApp: { getFilesByName: name => {
      const matches = [...forms.values()].filter(form => form.documentTitle === name); let index = 0;
      return { hasNext: () => index < matches.length, next: () => { const form = matches[index++]; return {
        getId: () => form.id, isTrashed: () => false, getMimeType: () => 'application/vnd.google-apps.form'
      }; } };
    } },
    UrlFetchApp: { fetch: url => {
      const id = decodeURIComponent(url.split('/').pop().split('?')[0]), form = forms.get(id);
      return { getResponseCode: () => form.httpCode || 200,
        getContentText: () => JSON.stringify({ formId: id, settings: { emailCollectionType: form.mode } }) };
    } },
    ScriptApp: { getScriptId: () => 'PROJECT', getOAuthToken: () => 'MOCK_TOKEN',
      EventType: { ON_FORM_SUBMIT: 'ON_FORM_SUBMIT', CLOCK: 'CLOCK' }, getProjectTriggers: () => [...triggers],
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: handler => {
        let id = '', event = '';
        const builder = { forForm: form => { id = form.id; return builder; }, onFormSubmit: () => { event = 'ON_FORM_SUBMIT'; return builder; },
          timeBased: () => { event = 'CLOCK'; return builder; }, everyMinutes: () => builder,
          create: () => { stats.triggersCreated++; const trigger = {
            getHandlerFunction: () => handler, getEventType: () => event, getTriggerSourceId: () => id
          }; triggers.push(trigger); return trigger; } };
        return builder;
      }
    }
  });
  for (const filename of ['Domain.gs', 'Config.gs', 'Persistence.gs', 'Admin.gs', 'Forms.gs', 'Importacao.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', filename), 'utf8'), context, { filename });
  }
  // Os IDs reais configurados pelo CA não pertencem aos serviços simulados.
  context.SEMINFO_CONFIG = Object.freeze({ ...context.SEMINFO_CONFIG,
    ID_PLANILHA: '', ID_FORM_INSCRICAO: '', ID_FORM_CANCELAMENTO: '', FORMULARIOS_INSCRICAO_JSON: '[]', IMPORTACAO_CSP_JSON: '' });
  // A fila é testada separadamente. Estas fronteiras não enviam e-mails reais.
  context.ensureNotificationSheet_ = () => context.ensureTable_('FilaEmails', ['ID']);
  context.syncNotificationQueueLocked_ = () => { stats.queueSyncs++; };
  context.processarNotificacoes = () => ({ enviadas: 0 });
  function response(kind, overrides = {}) {
    const config = context.getConfig_(), form = overrides.form || forms.get(config['ID_FORM_' + kind]);
    const input = { CPF: '52998224725', NAME: 'Pessoa Fictícia', ACTIVITY: '[A] Título antigo | Horário antigo',
      SWAP: context.SEMINFO_FORM_TEXT_.SWAP_NO, CANCEL: context.SEMINFO_FORM_TEXT_.CANCEL_YES, ...overrides.answers };
    const id = 'RESPONSE_' + (++sequence);
    const result = {
      getId: () => id, getTimestamp: () => overrides.timestamp || new Date(Date.now() + 1000),
      getRespondentEmail: () => { stats.responsesRead++; return overrides.email || 'participante@example.org'; },
      getItemResponses: () => Object.entries(input).filter(([key]) => overrides.definition ?
        Object.prototype.hasOwnProperty.call(overrides.definition.items, key) :
        properties.has('SEMINFO_ITEM_' + kind + '_' + key)).map(([key, value]) => ({
          getItem: () => overrides.definition ? form.getItemById(overrides.definition.items[key]) :
            context.getStoredFormItem_(form, kind, key), getResponse: () => value
        }))
    };
    form.responses.push(result);
    return { form, response: result };
  }
  function installed() { const result = context.instalarSistema(); context.setConfig_('EMAIL_CA', 'ca@example.org'); return result; }
  function activity(id = 'A', changes = {}) {
    return { id, title: 'Atividade ' + id, type: 'oficina', description: 'Demonstração', instructor: 'Pessoa Exemplo', location: 'Sala 1',
      start: '2026-11-09T14:00:00-03:00', end: '2026-11-09T16:00:00-03:00', capacity: 1, status: 'aberta', ...changes };
  }
  function begin() { installed(); context.salvarAtividade(activity()); context.abrirInscricoes(); }
  function manualRegistration(activityId, options = {}) {
    const form = context.FormApp.create(options.title || 'Formulário existente: ' + activityId, true);
    form.collect = true; form.destination = options.destination || 'SHEET';
    form.description = 'Descrição original para participantes';
    const name = form.addTextItem().setTitle('Seu nome').setRequired(true).setHelpText('Texto já existente');
    const cpf = form.addTextItem().setTitle('Documento CPF').setRequired(true);
    const swap = form.addMultipleChoiceItem().setTitle(context.SEMINFO_FORM_TEXT_.SWAP).setRequired(true)
      .setChoiceValues([context.SEMINFO_FORM_TEXT_.SWAP_YES, context.SEMINFO_FORM_TEXT_.SWAP_NO]);
    const extra = form.addTextItem().setTitle('Curso e turma');
    const definition = { id: form.id, activityId, items: { NAME: name.id, CPF: cpf.id, SWAP: swap.id } };
    let activityItem;
    if (!activityId) {
      activityItem = (options.activityType === 'MULTIPLE_CHOICE' ? form.addMultipleChoiceItem() : form.addListItem())
        .setTitle('Qual atividade você deseja?').setRequired(true).setChoiceValues(['[A] Atividade antiga']);
      definition.items.ACTIVITY = activityItem.id;
      delete definition.activityId;
    }
    return { form, definition, name, cpf, swap, extra, activityItem };
  }
  function configureExisting(entries, createCancellation = true) {
    context.SEMINFO_CONFIG = Object.freeze({ ...context.SEMINFO_CONFIG,
      FORMULARIOS_INSCRICAO_JSON: JSON.stringify(entries.map(entry => entry.definition || entry)),
      CRIAR_FORM_CANCELAMENTO: createCancellation });
  }
  function responseFrom(entry, overrides = {}) {
    return response('INSCRICAO', { ...overrides, form: entry.form, definition: entry.definition });
  }
  return { context, forms, properties, sheets, triggers, stats, response, responseFrom,
    installed, activity, begin, manualRegistration, configureExisting };
}

test('Instalação real com mocks cria Forms, abas e gatilhos uma vez e mantém ambos inicialmente fechados', () => {
  const e = environment(), first = e.installed(), counts = [e.sheets.size, e.stats.formsCreated, e.stats.destinations, e.stats.triggersCreated];
  assert.equal(e.context.readState_().accepting, false);
  assert.equal(e.forms.get(first.registrationId).accepting, false);
  assert.equal(e.forms.get(first.cancellationId).accepting, false);
  assert.equal(e.forms.get(first.registrationId).items.length, 4);
  assert.equal(e.forms.get(first.cancellationId).items.length, 3);
  assert.equal(e.forms.get(first.registrationId).items.some(item => /e-mail/i.test(item.title)), false);
  const second = e.context.instalarSistema();
  assert.deepEqual([e.sheets.size, e.stats.formsCreated, e.stats.destinations, e.stats.triggersCreated], counts);
  assert.equal(second.registrationId, first.registrationId);
  assert.equal(second.cancellationId, first.cancellationId);
  assert.equal(e.triggers.length, 3);
  for (const sheet of e.sheets.values()) assert.equal(sheet.protections.length, 1);
});

test('Reinstalação preserva livro, configurações, inscrições confirmadas e estado de abertura', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const journal = e.sheets.get('Operacoes').getDataRange().getDisplayValues();
  const cutoff = e.properties.get('SEMINFO_VERIFIED_SINCE_' + input.form.id);
  e.context.instalarSistema();
  assert.deepEqual(e.sheets.get('Operacoes').getDataRange().getDisplayValues(), journal);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(e.context.getConfig_().EMAIL_CA, 'ca@example.org');
  assert.equal(e.context.readState_().accepting, true);
  assert.equal(e.forms.size, 2); assert.equal(e.triggers.length, 3);
  assert.equal(e.properties.get('SEMINFO_VERIFIED_SINCE_' + input.form.id), cutoff);
});

test('Nomeia a aba de respostas criada após a instalação quando a primeira inscrição chega', () => {
  const e = environment(), entry = e.manualRegistration('A', {title: 'Formulário padrão'});
  entry.definition.title = 'Atividade A — Manhã';
  e.configureExisting([entry], false);
  e.installed();
  e.context.salvarAtividade(e.activity('A'));
  e.context.abrirInscricoes();
  const input = e.responseFrom(entry);
  const responseSheet = e.context.db_().insertSheet('Resposta ao formulário 8');
  responseSheet.formUrl = entry.form.getPublishedUrl();

  e.context.aoEnviarInscricao({source: entry.form, response: input.response});

  assert.equal(responseSheet.getName(), 'Respostas — Atividade A — Manhã');
});

test('Entrada do participante falha fechada; primeira abertura VERIFIED define a janela confiável', () => {
  const e = environment('RESPONDER_INPUT'), report = e.installed();
  assert(report.issues.length > 0); e.context.salvarAtividade(e.activity());
  assert.throws(() => e.context.abrirInscricoes(), /Verificado/);
  assert.equal(e.context.readState_().accepting, false);
  for (const form of e.forms.values()) { assert.equal(form.accepting, false); form.mode = 'VERIFIED'; }
  e.context.abrirInscricoes();
  for (const form of e.forms.values()) {
    assert.equal(form.accepting, true); assert.equal(form.published, true);
    assert(e.properties.has('SEMINFO_VERIFIED_SINCE_' + form.id));
  }
});

test('Atividade lotada sai da inscrição, permanece no cancelamento e retorna após liberação da vaga', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO');
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  const cancelForm = e.forms.get(e.context.getConfig_().ID_FORM_CANCELAMENTO);
  assert.equal(input.form.accepting, false);
  assert.equal(e.context.getStoredFormItem_(cancelForm, 'CANCELAMENTO', 'ACTIVITY').choices.some(choice => choice.startsWith('[A] ')), true);
  const stale = e.response('INSCRICAO', { email: 'outra@example.org', answers: { CPF: '11144477735' } });
  assert.equal(e.context.processFormResponse_('INSCRICAO', stale.form, stale.response).code, 'full');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  const cancel = e.response('CANCELAMENTO');
  assert.equal(e.context.processFormResponse_('CANCELAMENTO', cancel.form, cancel.response).code, 'canceled');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 0);
  assert.equal(input.form.accepting, true);
  assert.equal(e.context.getStoredFormItem_(input.form, 'INSCRICAO', 'ACTIVITY').choices[0].includes('Vagas: 1'), true);
  e.context.encerrarInscricoes();
  assert.equal(input.form.accepting, false); assert.equal(cancelForm.accepting, true);
});

test('Rótulo antigo resolve ID permanente, e identidade vem exclusivamente do e-mail nativo', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO', { answers: { CPF: '012.345.678-90' }, email: ' Pessoa@Example.org ' });
  const parsed = e.context.parseFormRequest_('INSCRICAO', input.form, input.response);
  assert.equal(parsed.activityId, 'A'); assert.equal(parsed.email, 'pessoa@example.org'); assert.equal(parsed.cpf, '012.345.678-90');
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  e.context.salvarAtividade(e.activity('A', { title: 'Título corrigido' }));
  const attacker = e.response('CANCELAMENTO', { answers: { CPF: '01234567890' }, email: 'outro@example.org' });
  const denied = e.context.processFormResponse_('CANCELAMENTO', attacker.form, attacker.response);
  assert.equal(denied.code, 'identity_mismatch'); assert.equal(denied.changes.length, 0);
  assert.equal(JSON.stringify(denied).includes('pessoa@example.org'), false);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
});

test('Resposta anterior à ativação entra em quarentena antes de consultar ou notificar o e-mail', () => {
  const e = environment(); e.begin();
  const legacy = e.response('INSCRICAO', { timestamp: new Date('2020-01-01T00:00:00Z') });
  const before = e.context.readJournal_().operations.length, reads = e.stats.responsesRead, syncs = e.stats.queueSyncs;
  assert.equal(e.context.isEligibleFormResponse_(legacy.form, legacy.response), false);
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', legacy.form, legacy.response), /quarentena/);
  assert.equal(e.stats.responsesRead, reads); assert.equal(e.stats.queueSyncs, syncs);
  assert.equal(e.context.readJournal_().operations.length, before);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 0);
});

test('Recuperação ignora quarentena, retoma resposta pendente e repetir a mesma resposta não duplica inscrição', () => {
  const e = environment(); e.begin();
  e.response('INSCRICAO', { timestamp: new Date('2020-01-01T00:00:00Z') });
  const valid = e.response('INSCRICAO');
  const scan = e.context.processarSolicitacoesPendentes();
  assert.equal(scan.respostasEmQuarentena, 1); assert.equal(scan.processadas, 1);
  assert.equal(e.stats.responsesRead, 1, 'somente o e-mail da resposta elegível é consultado');
  const count = e.context.readJournal_().operations.length;
  assert.equal(e.context.processFormResponse_('INSCRICAO', valid.form, valid.response).code, 'confirmed');
  assert.equal(e.context.readJournal_().operations.length, count);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(e.context.processarSolicitacoesPendentes().processadas, 0);
});

test('Modalidade insegura detectada fecha ambos, revoga a janela; API indisponível bloqueia processamento', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'), before = e.context.readJournal_().operations.length;
  input.form.mode = 'RESPONDER_INPUT'; e.context.SEMINFO_FORM_METADATA_ = {};
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /Verificado/);
  assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + input.form.id), false);
  assert.equal(e.properties.has('SEMINFO_FORMS_ACTIVATED'), false);
  for (const form of e.forms.values()) assert.equal(form.accepting, false);
  assert.equal(e.context.readJournal_().operations.length, before);
  input.form.mode = 'VERIFIED'; e.context.abrirInscricoes();
  input.form.httpCode = 403; e.context.SEMINFO_FORM_METADATA_ = {};
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /HTTP 403/);
  assert.equal(input.form.accepting, false);
  assert.equal(e.context.readJournal_().operations.length, before);
});

test('Autorizações desconhecidas e entradas grandes são inválidas; texto armazenável tem limites', () => {
  const e = environment(); e.begin();
  const badChoice = e.response('INSCRICAO', { answers: { SWAP: 'Sim' } });
  assert.equal(e.context.parseFormRequest_('INSCRICAO', badChoice.form, badChoice.response).invalidAnswer, true);
  assert.equal(e.context.processFormResponse_('INSCRICAO', badChoice.form, badChoice.response).code, 'invalid');
  const large = e.response('INSCRICAO', { answers: { NAME: 'A'.repeat(10000), CPF: '0'.repeat(10000) } });
  const parsed = e.context.parseFormRequest_('INSCRICAO', large.form, large.response);
  assert.equal(parsed.invalidAnswer, true); assert.equal(parsed.name.length, 200); assert.equal(parsed.cpf.length, 64);
  assert.equal(e.context.processFormResponse_('INSCRICAO', large.form, large.response).code, 'invalid');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 0);
});

test('Recupera criação interrompida por marcador e pergunta vazia sem duplicar ou apagar recursos', () => {
  const e = environment(), report = e.installed(), count = e.stats.formsCreated;
  e.properties.delete('SEMINFO_ID_FORM_INSCRICAO'); e.context.setConfig_('ID_FORM_INSCRICAO', '');
  const recovered = e.context.getOrCreateForm_('INSCRICAO', '');
  assert.equal(recovered.id, report.registrationId); assert.equal(e.stats.formsCreated, count);
  const form = e.context.FormApp.create('Teste de interrupção', false), blank = form.addTextItem();
  e.properties.set('SEMINFO_ITEM_RECOVERY_CPF_PENDING', form.id);
  const item = e.context.ensureFormItem_(form, 'RECOVERY', 'CPF', 'TEXT', 'CPF');
  assert.equal(item.id, blank.id); assert.equal(form.items.length, 1);
  assert.equal(e.properties.has('SEMINFO_ITEM_RECOVERY_CPF_PENDING'), false);
});

test('Gatilhos duplicados ou de origem errada são reparados, e executar instalador novamente preserva três', () => {
  const e = environment(); e.installed();
  e.triggers.push({ getHandlerFunction: () => 'aoEnviarInscricao', getEventType: () => 'ON_FORM_SUBMIT', getTriggerSourceId: () => 'OUTRO_FORM' });
  e.context.installTriggersLocked_();
  assert.equal(e.triggers.length, 3);
  const created = e.stats.triggersCreated;
  e.context.installTriggersLocked_();
  assert.equal(e.triggers.length, 3); assert.equal(e.stats.triggersCreated, created);
});

test('Conferência rejeita um único gatilho com formulário ou evento errado até a instalação repará-lo', () => {
  const e = environment(); e.installed();
  assert.equal(e.context.conferirSistema().forms.length, 2);
  for (const invalid of [
    { event: 'ON_FORM_SUBMIT', source: 'OUTRO_FORM' },
    { event: 'CLOCK', source: e.context.getConfig_().ID_FORM_INSCRICAO }
  ]) {
    const index = e.triggers.findIndex(trigger => trigger.getHandlerFunction() === 'aoEnviarInscricao');
    e.triggers[index] = { getHandlerFunction: () => 'aoEnviarInscricao',
      getEventType: () => invalid.event, getTriggerSourceId: () => invalid.source };
    assert.equal(e.triggers.filter(trigger => trigger.getHandlerFunction() === 'aoEnviarInscricao').length, 1);
    assert.throws(() => e.context.conferirSistema(), /origem incorreta/);
    e.context.instalarSistema();
    assert.equal(e.triggers.length, 3);
    assert.equal(e.context.conferirSistema().forms.length, 2);
  }
});

test('Gatilho compartilha prazo global com as notificações, inclusive quando o processamento falha', () => {
  const e = environment(); e.begin(); const input = e.response('INSCRICAO');
  const deadlines = [];
  e.context.postProcessing_ = deadline => { deadlines.push(deadline); };
  e.context.processFormResponse_ = () => {};
  const before = Date.now();
  e.context.aoEnviarInscricao({ source: input.form, response: input.response });
  assert(deadlines[0] >= before + 270000 && deadlines[0] <= Date.now() + 270000);
  e.context.processFormResponse_ = () => { throw new Error('Falha simulada'); };
  assert.throws(() => e.context.aoEnviarInscricao({ source: input.form, response: input.response }), /Falha simulada/);
  assert.equal(deadlines.length, 2); assert.equal(typeof deadlines[1], 'number');
});

test('Vários Forms existentes mantêm títulos, perguntas, respostas e destinos; só o cancelamento é criado', () => {
  const e = environment(), a = e.manualRegistration('A', { destination: 'PLANILHA_BRUTA_A' }), b = e.manualRegistration('B');
  const historic = { getId: () => 'HISTORIC', getTimestamp: () => new Date('2020-01-01T00:00:00Z') };
  a.form.responses.push(historic);
  const snapshot = entry => ({ id: entry.form.id, title: entry.form.title, description: entry.form.description,
    destination: entry.form.destination, items: entry.form.items.map(item => ({ id: item.id, title: item.title, type: item.type })),
    nameHelp: entry.name.help, extraTitle: entry.extra.title });
  const before = [snapshot(a), snapshot(b)], created = e.stats.formsCreated, destinations = e.stats.destinations;
  e.configureExisting([a, b]); e.installed();
  assert.deepEqual([snapshot(a), snapshot(b)], before);
  assert.equal(a.form.responses[0], historic);
  assert.equal(e.stats.formsCreated, created + 1, 'apenas o formulário único de cancelamento é novo');
  assert.equal(e.stats.destinations, destinations + 1, 'destinos brutos adotados não são reaplicados');
  assert.equal(e.context.getFormSources_().filter(source => source.kind === 'INSCRICAO').length, 2);
  assert.equal(e.triggers.filter(trigger => trigger.getHandlerFunction() === 'aoEnviarInscricao').length, 2);
  assert.equal(e.triggers.length, 4);
});

test('Reinstalar vários Forms não cria inscrições ou perguntas novas nem mistura IDs locais das perguntas', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  b.name.id = a.cpf.id; b.cpf.id = a.name.id;
  b.definition.items.NAME = b.name.id; b.definition.items.CPF = b.cpf.id;
  e.configureExisting([a, b]); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B', {
    start: '2026-11-09T16:00:00-03:00', end: '2026-11-09T18:00:00-03:00' }));
  e.context.abrirInscricoes();
  const first = e.responseFrom(a), second = e.responseFrom(b, { answers: { NAME: 'Nome do segundo formulário' } });
  assert.equal(e.context.parseFormRequest_('INSCRICAO', first.form, first.response).name, 'Pessoa Fictícia');
  assert.equal(e.context.parseFormRequest_('INSCRICAO', second.form, second.response).name, 'Nome do segundo formulário');
  assert.equal(e.context.parseFormRequest_('INSCRICAO', second.form, second.response).cpf, '52998224725');
  const counts = [e.stats.formsCreated, a.form.items.length, b.form.items.length, e.stats.destinations, e.stats.triggersCreated];
  e.context.instalarSistema();
  assert.deepEqual([e.stats.formsCreated, a.form.items.length, b.form.items.length, e.stats.destinations, e.stats.triggersCreated], counts);
  assert.equal(e.context.conferirSistema().forms.length, 3);
  assert.equal(e.context.readJournal_().operations.filter(operation => operation.kind === 'REQUEST').length, 0);
});

test('Forms de atividades fixas consecutivas usam o mesmo CPF e fecham apenas a origem que ficou lotada', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b]); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B', {
    start: '2026-11-09T16:00:00-03:00', end: '2026-11-09T18:00:00-03:00' }));
  e.context.abrirInscricoes();
  const first = e.responseFrom(a), second = e.responseFrom(b);
  assert.equal(e.context.processFormResponse_('INSCRICAO', first.form, first.response).code, 'confirmed');
  assert.equal(a.form.accepting, false); assert.equal(b.form.accepting, true);
  assert.equal(e.context.processFormResponse_('INSCRICAO', second.form, second.response).code, 'confirmed');
  const state = e.context.readState_();
  assert.equal(Object.keys(state.participants).length, 1);
  assert.equal(e.context.SemDomain.confirmedFor(state, '52998224725').length, 2);
  assert.equal(a.form.accepting, false); assert.equal(b.form.accepting, false);
});

test('Conflito entre Forms fixos exige autorização e a troca libera a atividade anterior', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b]); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B', {
    start: '2026-11-09T15:00:00-03:00', end: '2026-11-09T17:00:00-03:00' }));
  e.context.abrirInscricoes();
  const first = e.responseFrom(a), denied = e.responseFrom(b);
  assert.equal(e.context.processFormResponse_('INSCRICAO', first.form, first.response).code, 'confirmed');
  assert.equal(e.context.processFormResponse_('INSCRICAO', denied.form, denied.response).code, 'conflict');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 0);
  const allowed = e.responseFrom(b, { answers: { SWAP: e.context.SEMINFO_FORM_TEXT_.SWAP_YES } });
  assert.equal(e.context.processFormResponse_('INSCRICAO', allowed.form, allowed.response).code, 'swapped');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 0);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 1);
  assert.equal(a.form.accepting, true); assert.equal(b.form.accepting, false);
});

test('Duas origens da mesma atividade disputam a mesma última vaga sem ultrapassar a capacidade', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('A');
  e.configureExisting([a, b]); e.installed(); e.context.salvarAtividade(e.activity()); e.context.abrirInscricoes();
  const first = e.responseFrom(a), second = e.responseFrom(b, { email: 'outra@example.org', answers: { CPF: '11144477735' } });
  assert.equal(e.context.processFormResponse_('INSCRICAO', first.form, first.response).code, 'confirmed');
  assert.equal(a.form.accepting, false); assert.equal(b.form.accepting, false);
  assert.equal(e.context.processFormResponse_('INSCRICAO', second.form, second.response).code, 'full');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  const keys = e.context.readJournal_().operations.filter(operation => operation.kind === 'REQUEST').map(operation => operation.key);
  assert.equal(new Set(keys).size, 2, 'a chave de idempotência inclui a origem');
});

test('Cancelamento único cancela inscrições vindas de qualquer Form e é preservado na reinstalação', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b]); const install = e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  const input = e.responseFrom(b);
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  const cancellation = e.response('CANCELAMENTO', { answers: { ACTIVITY: '[B] Título antigo' } });
  assert.equal(e.context.processFormResponse_('CANCELAMENTO', cancellation.form, cancellation.response).code, 'canceled');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 0);
  assert.equal(b.form.accepting, true);
  const created = e.stats.formsCreated; e.context.instalarSistema();
  assert.equal(e.context.getConfig_().ID_FORM_CANCELAMENTO, install.cancellationId);
  assert.equal(e.stats.formsCreated, created);
  assert.equal(e.context.getFormSources_().filter(source => source.kind === 'CANCELAMENTO').length, 1);
});

test('Sem criar cancelamento, vários Forms continuam operacionais com recuperação e cancelamento administrativo', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b], false); const created = e.stats.formsCreated; e.installed();
  assert.equal(e.stats.formsCreated, created); assert.equal(e.forms.size, 2); assert.equal(e.triggers.length, 3);
  assert.equal(e.context.getFormSources_().some(source => source.kind === 'CANCELAMENTO'), false);
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  e.responseFrom(b); assert.equal(e.context.processarSolicitacoesPendentes().processadas, 1);
  assert.equal(e.context.cancelarInscricaoAdministrativa('52998224725', 'B', 'Pedido presencial confirmado').code, 'canceled');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 0);
  e.context.instalarSistema(); assert.equal(e.stats.formsCreated, created);
  assert.equal(e.context.conferirSistema().forms.length, 2);
});

test('Recuperação varre todos os Forms, ordena por envio global, ignora quarentena e não repete respostas', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b]); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  e.responseFrom(a, { timestamp: new Date('2020-01-01T00:00:00Z') });
  const earlier = e.responseFrom(b, { timestamp: new Date(Date.now() + 1000) });
  const later = e.responseFrom(a, { timestamp: new Date(Date.now() + 2000) });
  const scan = e.context.processarSolicitacoesPendentes();
  assert.equal(scan.respostasEmQuarentena, 1); assert.equal(scan.processadas, 2);
  assert.equal(e.stats.responsesRead, 2);
  const requests = e.context.readJournal_().operations.filter(operation => operation.kind === 'REQUEST');
  assert.equal(requests[0].key, earlier.form.id + ':' + earlier.response.getId()); assert.equal(requests[0].outcome.code, 'confirmed');
  assert.equal(requests[1].key, later.form.id + ':' + later.response.getId()); assert.equal(requests[1].outcome.code, 'conflict');
  assert.equal(e.context.processarSolicitacoesPendentes().processadas, 0);
  assert.equal(e.context.readJournal_().operations.filter(operation => operation.kind === 'REQUEST').length, 2);
});

test('Form seletor existente suporta múltipla escolha sem renomear a pergunta e compartilha catálogo com fixos', () => {
  const e = environment(), selector = e.manualRegistration(undefined, { activityType: 'MULTIPLE_CHOICE' }), fixed = e.manualRegistration('B');
  const questionTitle = selector.activityItem.title;
  e.configureExisting([selector, fixed]); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B', {
    start: '2026-11-09T16:00:00-03:00', end: '2026-11-09T18:00:00-03:00' })); e.context.abrirInscricoes();
  assert.equal(selector.activityItem.title, questionTitle);
  assert.equal(selector.activityItem.type, 'MULTIPLE_CHOICE');
  assert.equal(selector.activityItem.choices.some(choice => choice.startsWith('[A] ')), true);
  const input = e.responseFrom(selector);
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  assert.equal(selector.activityItem.choices.some(choice => choice.startsWith('[A] ')), false);
  assert.equal(selector.activityItem.choices.some(choice => choice.startsWith('[B] ')), true);
  assert.equal(fixed.form.accepting, true);
});

test('Mudança insegura de coleta em uma origem revoga a janela dessa origem e fecha todos os Forms', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b]); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  const input = e.responseFrom(b), before = e.context.readJournal_().operations.length;
  b.form.mode = 'RESPONDER_INPUT'; e.context.SEMINFO_FORM_METADATA_ = {};
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /Verificado/);
  for (const form of e.forms.values()) assert.equal(form.accepting, false);
  assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + b.form.id), false);
  assert.equal(e.context.readJournal_().operations.length, before);
});

test('Origem não configurada e mapeamento duplicado são rejeitados antes de aplicar solicitações', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B'), outsider = e.manualRegistration('A');
  e.configureExisting([a, b]); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  const input = e.responseFrom(outsider);
  assert.throws(() => e.context.parseFormRequest_('INSCRICAO', input.form, input.response), /origem|instalad|configurad/i);
  const invalid = environment(), duplicate = invalid.manualRegistration('A');
  duplicate.definition.items.CPF = duplicate.definition.items.NAME;
  invalid.configureExisting([duplicate]); const title = duplicate.form.title, itemCount = duplicate.form.items.length;
  assert.throws(() => invalid.installed(), /mape|pergunta|item|duplicad|repetid/i);
  assert.equal(duplicate.form.title, title); assert.equal(duplicate.form.items.length, itemCount);
});

test('Lotes de recuperação alternam origens movimentadas sem deixar o último Form esperando indefinidamente', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('A');
  e.configureExisting([a, b], false);
  e.context.SEMINFO_CONFIG = Object.freeze({ ...e.context.SEMINFO_CONFIG, MAX_SOLICITACOES_POR_EXECUCAO: 2 });
  e.installed(); e.context.salvarAtividade(e.activity('A', { capacity: 10 })); e.context.abrirInscricoes();
  for (let i = 0; i < 5; i++) e.responseFrom(a);
  for (let i = 0; i < 5; i++) e.responseFrom(b);
  const first = e.context.processarSolicitacoesPendentes(), second = e.context.processarSolicitacoesPendentes();
  assert.equal(first.processadas, 2); assert.equal(second.processadas, 2);
  assert.equal(first.varreduraParcial, true); assert.equal(second.varreduraParcial, true);
  const requests = e.context.readJournal_().operations.filter(operation => operation.kind === 'REQUEST');
  assert.equal(requests.filter(operation => operation.request.formId === a.form.id).length, 2);
  assert.equal(requests.filter(operation => operation.request.formId === b.form.id).length, 2);
});

test('Mais Forms que slots de gatilho usam recuperação periódica sem omitir nenhuma origem', () => {
  const e = environment(), entries = Array.from({ length: 21 }, (_, i) => e.manualRegistration('A', { title: 'Origem ' + i }));
  e.configureExisting(entries); e.installed();
  assert.equal(e.triggers.length, 20);
  assert.equal(e.triggers.filter(trigger => trigger.getHandlerFunction() === 'manutencaoPeriodica').length, 1);
  assert.equal(e.triggers.filter(trigger => trigger.getHandlerFunction() === 'aoEnviarCancelamento').length, 1);
  e.context.salvarAtividade(e.activity('A', { capacity: 30 }));
  const report = e.context.conferirSistema();
  assert.equal(report.formsViaVarredura.length, 3);
  const sources = e.context.getFormSources_().map(source => source.id);
  const direct = e.triggers.filter(trigger => trigger.getEventType() === 'ON_FORM_SUBMIT').map(trigger => trigger.getTriggerSourceId());
  assert.equal(new Set([...direct, ...report.formsViaVarredura]).size, sources.length);
  for (const id of sources) assert([...direct, ...report.formsViaVarredura].includes(id));
  const polled = entries.find(entry => report.formsViaVarredura.includes(entry.form.id));
  e.context.abrirInscricoes(); e.responseFrom(polled);
  assert.equal(e.context.processarSolicitacoesPendentes().processadas, 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  const created = e.stats.triggersCreated; e.context.instalarSistema();
  assert.equal(e.triggers.length, 20); assert.equal(e.stats.triggersCreated, created);
});

test('Validar todos os mapeamentos antes de instalar evita alterações parciais no primeiro Form', () => {
  const e = environment(), valid = e.manualRegistration('A'), invalid = e.manualRegistration('B');
  valid.name.required = false; valid.swap.choices = ['Minha opção original'];
  invalid.definition.items.CPF = 999999;
  const created = e.stats.formsCreated, destination = valid.form.destination, count = valid.form.items.length;
  e.configureExisting([valid, invalid]);
  assert.throws(() => e.installed(), /mape|pergunta|item|inexist|ausente/i);
  assert.equal(valid.name.required, false); assert.deepEqual(valid.swap.choices, ['Minha opção original']);
  assert.equal(valid.form.destination, destination); assert.equal(valid.form.items.length, count);
  assert.equal(e.stats.formsCreated, created);
});

test('Atividade fixa da configuração prevalece sobre uma pergunta antiga de atividade no Form', () => {
  const e = environment(), a = e.manualRegistration('A');
  const leftover = a.form.addListItem().setTitle('Atividade antiga').setChoiceValues(['[B] Opção antiga']);
  a.definition.items.ACTIVITY = leftover.id;
  e.configureExisting([a]); e.installed(); e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B'));
  e.context.abrirInscricoes();
  const input = e.responseFrom(a, { answers: { ACTIVITY: '[B] Opção antiga' } });
  assert.equal(e.context.parseFormRequest_('INSCRICAO', input.form, input.response).activityId, 'A');
  assert.deepEqual(leftover.choices, ['[B] Opção antiga']);
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 0);
});

test('Campos de texto longo existentes são aceitos sem recriar as perguntas de nome e CPF', () => {
  const e = environment(), a = e.manualRegistration('A');
  a.name.type = 'PARAGRAPH_TEXT'; a.cpf.type = 'PARAGRAPH_TEXT';
  const count = a.form.items.length;
  e.configureExisting([a]); e.installed(); e.context.salvarAtividade(e.activity('A')); e.context.abrirInscricoes();
  const input = e.responseFrom(a);
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  assert.equal(a.form.items.length, count); assert.equal(a.name.type, 'PARAGRAPH_TEXT'); assert.equal(a.cpf.type, 'PARAGRAPH_TEXT');
});

test('Histórico impede remover origens, mudar sua atividade fixa ou remapear uma pergunta já instalada', () => {
  for (const mutation of ['remove', 'activity', 'item', 'selector']) {
    const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration(mutation === 'selector' ? undefined : 'B');
    e.configureExisting([a, b]); e.installed();
    const changed = JSON.parse(JSON.stringify([a.definition, b.definition]));
    if (mutation === 'remove') changed.pop();
    if (mutation === 'activity') changed[1].activityId = 'C';
    if (mutation === 'selector') changed[1].activityId = 'C';
    if (mutation === 'item') changed[1].items.NAME = b.extra.id;
    e.context.setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify(changed));
    const created = e.stats.formsCreated, firstCount = a.form.items.length, secondCount = b.form.items.length;
    assert.throws(() => e.context.instalarSistema(), /histórico|hist.rico|instalad|mape|removid/i);
    assert.equal(e.stats.formsCreated, created); assert.equal(a.form.items.length, firstCount); assert.equal(b.form.items.length, secondCount);
  }
});

test('Falha HTTP de uma origem fecha todos durante a atualização e não reabre uma origem posterior', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b]); e.installed(); e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B'));
  e.context.abrirInscricoes(); a.form.httpCode = 403; e.context.SEMINFO_FORM_METADATA_ = {};
  assert.throws(() => e.context.atualizarOpcoesFormularios(), /HTTP 403/);
  for (const form of e.forms.values()) assert.equal(form.accepting, false);
  assert.equal(e.properties.get('SEMINFO_FORMS_ACTIVATED'), 'true', 'a indisponibilidade temporária não cria uma nova janela de identidade');
});

test('Mapeamento legado do Form principal migra para IDs por origem sem duplicar perguntas', () => {
  const e = environment(), initial = e.installed(), primary = e.forms.get(initial.registrationId), count = primary.items.length;
  for (const key of [...e.properties.keys()]) if (key.startsWith('SEMINFO_ITEM_' + primary.id + '_')) e.properties.delete(key);
  const legacyName = e.properties.get('SEMINFO_ITEM_INSCRICAO_NAME');
  assert(legacyName); e.context.instalarSistema();
  assert.equal(primary.items.length, count);
  assert.equal(e.properties.get('SEMINFO_ITEM_' + primary.id + '_NAME'), legacyName);
  assert.equal(e.context.getStoredFormItem_(primary, 'INSCRICAO', 'NAME').id, Number(legacyName));
});

test('Recuperação com prazo curto reserva o tempo restante e retoma na chamada seguinte', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b]); e.installed(); e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B'));
  e.context.abrirInscricoes(); e.responseFrom(b);
  const short = e.context.processarSolicitacoesPendentes(Date.now() + 1000);
  assert.equal(short.processadas, 0); assert.equal(short.formulariosVarridos, 0); assert.equal(short.varreduraParcial, true);
  assert.equal(e.stats.responsesRead, 0); assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 0);
  assert.equal(e.context.processarSolicitacoesPendentes().processadas, 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 1);
});

test('Adicionar uma origem a sistema aberto preserva a janela antiga e exige abrir para ativar a nova', () => {
  const e = environment(), a = e.manualRegistration('A');
  e.configureExisting([a]); e.installed(); e.context.salvarAtividade(e.activity('A')); e.context.salvarAtividade(e.activity('B'));
  e.context.abrirInscricoes(); const oldCutoff = e.properties.get('SEMINFO_VERIFIED_SINCE_' + a.form.id);
  const b = e.manualRegistration('B');
  const historical = e.responseFrom(b, { timestamp: new Date(Date.now() - 1000) });
  e.context.setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify([a.definition, b.definition])); e.context.instalarSistema();
  assert.equal(e.properties.get('SEMINFO_VERIFIED_SINCE_' + a.form.id), oldCutoff);
  assert.equal(a.form.accepting, true); assert.equal(b.form.accepting, false);
  assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + b.form.id), false);
  e.context.abrirInscricoes();
  assert.equal(e.properties.get('SEMINFO_VERIFIED_SINCE_' + a.form.id), oldCutoff);
  assert(e.properties.has('SEMINFO_VERIFIED_SINCE_' + b.form.id)); assert.equal(b.form.accepting, true);
  assert.equal(e.context.isEligibleFormResponse_(b.form, historical.response), false);
  const fresh = e.responseFrom(b);
  assert.equal(e.context.processFormResponse_('INSCRICAO', fresh.form, fresh.response).code, 'confirmed');
});

test('Resposta permanentemente inválida não impede recuperar as seguintes do mesmo Form', () => {
  const e = environment(), a = e.manualRegistration('A');
  e.configureExisting([a], false);
  e.context.SEMINFO_CONFIG = Object.freeze({ ...e.context.SEMINFO_CONFIG, MAX_SOLICITACOES_POR_EXECUCAO: 1 });
  e.installed(); e.context.salvarAtividade(e.activity('A', { capacity: 2 })); e.context.abrirInscricoes();
  const broken = e.responseFrom(a), valid = e.responseFrom(a, { email: 'outra@example.org', answers: { CPF: '11144477735' } });
  const originalEmail = broken.response.getRespondentEmail;
  broken.response.getRespondentEmail = () => '';
  const first = e.context.processarSolicitacoesPendentes();
  assert.equal(first.processadas, 0); assert.equal(first.falhas, 1);
  assert.equal(e.context.readJournal_().operations.filter(operation => operation.kind === 'REQUEST').length, 0);
  const second = e.context.processarSolicitacoesPendentes();
  assert.equal(second.processadas, 1); assert.equal(second.falhas, 0);
  assert.equal(e.context.readJournal_().byKey[valid.form.id + ':' + valid.response.getId()].outcome.code, 'confirmed');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  broken.response.getRespondentEmail = originalEmail;
  const recovered = e.context.processarSolicitacoesPendentes();
  assert.equal(recovered.processadas, 1); assert.equal(recovered.falhas, 0);
  assert.equal(e.context.readJournal_().byKey[broken.form.id + ':' + broken.response.getId()].outcome.code, 'confirmed');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 2);
  assert.equal(e.context.processarSolicitacoesPendentes().processadas, 0);
});

test('Inventário antes da instalação lê IDs e tipos dos Forms sem criar planilha, gatilhos ou modificar perguntas', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([{ id: a.form.id, activityId: 'A' }, { id: b.form.id, activityId: 'B' }], false);
  const logged = []; e.context.console = { log: value => logged.push(value) };
  const before = JSON.stringify([...e.forms.values()]), counts = [e.stats.formsCreated, e.stats.destinations, e.stats.triggersCreated, e.stats.locks];
  const inventory = e.context.listarPerguntasDosFormularios();
  assert.equal(inventory.length, 2); assert.equal(inventory[0].id, a.form.id); assert.equal(inventory[1].id, b.form.id);
  assert.equal(inventory[0].items.find(item => item.id === a.name.id).title, 'Seu nome');
  assert.equal(inventory[1].items.find(item => item.id === b.cpf.id).type, 'TEXT');
  assert.equal(inventory[1].items.length, b.form.items.length); assert.equal(logged.length, 1);
  assert.equal(JSON.stringify([...e.forms.values()]), before);
  assert.deepEqual([e.stats.formsCreated, e.stats.destinations, e.stats.triggersCreated, e.stats.locks], counts);
  assert.equal(e.sheets.size, 0); assert.equal(e.properties.size, 0); assert.equal(e.triggers.length, 0);
});

for (const message of ['Invalid data updating form.', 'Dados inválidos ao atualizar o formulário.',
  'Exception: Dados inválidos ao atualizar o formulário.']) {
  test('Reabrir Forms publicados continua quando somente a mensagem opcional falha: ' + message, () => {
    const e = environment(); e.begin(); e.context.encerrarInscricoes();
    const warnings = [];
    e.context.console = { ...console, warn: value => warnings.push(value) };
    for (const form of e.forms.values()) {
      form.setCustomClosedFormMessage = () => { throw new Error(message); };
    }
    e.context.abrirInscricoes();
    assert.equal(e.context.readState_().accepting, true);
    for (const form of e.forms.values()) assert.equal(form.accepting, true);
    assert.equal(warnings.length, e.forms.size);
    e.context.encerrarInscricoes();
    assert.equal(e.forms.get(e.context.getConfig_().ID_FORM_INSCRICAO).accepting, false);
    e.context.abrirInscricoes();
    for (const form of e.forms.values()) assert.equal(form.accepting, true);
  });
}

test('Falhas desconhecidas na mensagem e falhas reais na abertura não são ignoradas', () => {
  const e = environment(); e.begin(); e.context.encerrarInscricoes();
  const form = e.forms.get(e.context.getConfig_().ID_FORM_INSCRICAO);
  const originalMessage = form.setCustomClosedFormMessage;
  const denied = new Error('Permissão negada.');
  form.setCustomClosedFormMessage = () => { throw denied; };
  assert.throws(() => e.context.abrirInscricoes(), error => error === denied);
  assert.equal(form.accepting, false);
  form.setCustomClosedFormMessage = originalMessage;
  form.setAcceptingResponses = () => { throw new Error('Dados inválidos ao atualizar o formulário.'); };
  assert.throws(() => e.context.abrirInscricoes(), error =>
    error.message.includes('setAcceptingResponses(true)') && error.message.includes(form.id) &&
    error.message.includes('Dados inválidos ao atualizar o formulário.'));
  assert.equal(form.accepting, false);
});

test('Falha na publicação identifica a etapa e o Form sem ignorar o erro', () => {
  const e = environment(); e.installed(); e.context.salvarAtividade(e.activity());
  const form = e.forms.get(e.context.getConfig_().ID_FORM_INSCRICAO);
  form.setPublished = () => { throw new Error('Dados inválidos ao atualizar o formulário.'); };
  assert.throws(() => e.context.abrirInscricoes(), error =>
    error.message.includes('setPublished(true)') && error.message.includes(form.id) &&
    error.message.includes('Dados inválidos ao atualizar o formulário.'));
  assert.equal(form.accepting, false);
});

test('Livro e fila reais mantêm confirmação sem CC, conflito com CC e aviso único de capacidade ao CA', () => {
  const e = environment(), sent = [];
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), e.context, {filename: 'Notifications.gs'});
  e.context.MailApp.sendEmail = message => sent.push(message);
  e.begin();
  const input = e.response('INSCRICAO');
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  let rows = e.context.tableRows_('FilaEmails');
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.ID.startsWith('MAIL:CAPACIDADE:')).DESTINATARIO, 'ca@example.org');
  assert.equal(rows.find(row => !row.ID.startsWith('MAIL:CAPACIDADE:')).CC, '');
  e.context.processarNotificacoes();
  assert.match(sent[0].subject, /Capacidade atingida/);
  assert.equal(sent[0].to, 'ca@example.org');
  assert.equal(sent[1].to, 'participante@example.org');
  assert.ok(!sent[1].cc);
  e.context.salvarAtividade(e.activity('B'));
  const conflicting = e.response('INSCRICAO', {answers: {ACTIVITY: '[B] Outra atividade'}});
  assert.equal(e.context.processFormResponse_('INSCRICAO', conflicting.form, conflicting.response).code, 'conflict');
  e.context.processarNotificacoes();
  assert.match(sent[2].subject, /Conflito de horário/);
  assert.equal(sent[2].cc, 'ca@example.org');
  e.context.reconstruirVisoes(); e.context.processarNotificacoes();
  assert.equal(sent.length, 3);
  rows = e.context.tableRows_('FilaEmails');
  assert.equal(rows.filter(row => row.ID.startsWith('MAIL:CAPACIDADE:')).length, 1);
});

function historicalCspEnvironment(capacity = 2, realNotifications = false) {
  const e = environment();
  if (realNotifications) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), e.context, {filename: 'Notifications.gs'});
  e.installed();
  e.context.salvarAtividade(e.activity('CSP_2026', {capacity}));
  const legacy = e.manualRegistration('CSP_2026');
  const email = legacy.form.addTextItem().setTitle('E-mail');
  legacy.definition.items.EMAIL = email.id;
  legacy.form.mode = 'RESPONDER_INPUT';
  const source = {formId: legacy.form.id, activityId: 'CSP_2026', items: {NAME: legacy.name.id, CPF: legacy.cpf.id, EMAIL: email.id}};
  e.context.setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify(source));
  function oldResponse(cpf, address, minute = 0, overrides = {}) {
    return e.responseFrom(legacy, {timestamp: new Date(Date.UTC(2026, 9, 5, 12, minute)),
      answers: {CPF: cpf, EMAIL: address, ...overrides}});
  }
  return {...e, legacy, source, oldResponse};
}

test('Prévia histórica é administrativa e não grava inscrições ou usa o e-mail nativo', () => {
  const e = historicalCspEnvironment();
  e.oldResponse('01234567890', 'antigo@example.org');
  const before = e.context.readJournal_().operations.length;
  assert.throws(() => e.context.importarInscricoesAnterioresCsp(), /prévia/);
  const report = e.context.prepararImportacaoCsp();
  assert.equal(report.resultadosPrevistos.confirmed, 1);
  assert.equal(report.ocupacaoPrevista, 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'CSP_2026'), 0);
  assert.equal(e.context.readJournal_().operations.length, before);
  assert.equal(e.stats.responsesRead, 0);
  const preview = [...e.sheets.entries()].find(([name]) => name.startsWith('Previa_CSP_'))[1];
  assert.equal(preview.cells[1][3], '01234567890');
  assert.equal(preview.cells[1][4], 'antigo@example.org');
  assert.equal(preview.protections.length, 1);
  e.properties.set('SEMINFO_INSTALLER', 'outra@example.org');
  assert.throws(() => e.context.prepararImportacaoCsp(), /conta/);
  assert.throws(() => e.context.importarInscricoesAnterioresCsp(), /conta/);
});

test('Importação histórica retoma lotes, mantém origem auditada e aplica duplicidade, lotação e CPF inválido', () => {
  const e = historicalCspEnvironment(1);
  e.context.setConfig_('MAX_SOLICITACOES_POR_EXECUCAO', 1);
  const first = e.oldResponse('52998224725', 'primeiro@example.org', 0);
  e.oldResponse('52998224725', 'primeiro@example.org', 1);
  e.oldResponse('11144477735', 'segundo@example.org', 2);
  e.oldResponse('00000000000', 'invalido@example.org', 3);
  const preview = e.context.prepararImportacaoCsp();
  assert.deepEqual({...preview.resultadosPrevistos}, {confirmed: 1, duplicate: 1, full: 1, invalid: 1});
  for (let remaining = 3; remaining >= 0; remaining--) {
    const report = e.context.importarInscricoesAnterioresCsp();
    assert.equal(report.processadasNesteLote, 1); assert.equal(report.restantes, remaining);
  }
  assert.equal(e.context.importarInscricoesAnterioresCsp().processadasNesteLote, 0);
  const journal = e.context.readJournal_();
  const imported = journal.byKey[first.form.id + ':' + first.response.getId()];
  assert.equal(imported.importedBy, 'ca@example.org');
  assert.match(imported.reason, /dados conferidos/);
  assert.equal(imported.request.identitySource, 'REVISAO_ADMINISTRATIVA_EMAIL_INFORMADO');
  assert.equal(journal.state.participants['52998224725'].email, 'primeiro@example.org');
  assert.equal(journal.state.accepting, false);
  assert.equal(e.context.SemDomain.occupancy(journal.state, 'CSP_2026'), 1);
  assert.equal(e.stats.responsesRead, 0);
  assert.equal(e.context.prepararImportacaoCsp().jaProcessadas, 4);
  assert.equal(journal.operations.filter(operation => operation.kind === 'REQUEST').length, 4);
});

test('Importação antiga não autoriza trocas nem substitui o e-mail já vinculado ao CPF', () => {
  const e = historicalCspEnvironment();
  e.context.salvarAtividade(e.activity('B'));
  e.context.abrirInscricoes();
  const registered = e.response('INSCRICAO', {email: 'primeiro@example.org', answers: {ACTIVITY: '[B] Outra atividade'}});
  e.context.processFormResponse_('INSCRICAO', registered.form, registered.response);
  e.context.encerrarInscricoes();
  e.oldResponse('52998224725', 'primeiro@example.org', 0, {SWAP: e.context.SEMINFO_FORM_TEXT_.SWAP_YES});
  e.oldResponse('52998224725', 'diferente@example.org', 1);
  const preview = e.context.prepararImportacaoCsp();
  assert.deepEqual({...preview.resultadosPrevistos}, {conflict: 1, identity_mismatch: 1});
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.deepEqual({...report.resultados}, {conflict: 1, identity_mismatch: 1});
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'CSP_2026'), 0);
});

test('Respostas editadas e estado alterado invalidam a prévia antes de gravar a importação', () => {
  const e = historicalCspEnvironment();
  const input = e.oldResponse('52998224725', 'primeiro@example.org');
  e.context.prepararImportacaoCsp();
  e.context.salvarAtividade(e.activity('CSP_2026', {capacity: 3}));
  assert.throws(() => e.context.importarInscricoesAnterioresCsp(), /mudaram desde a prévia/);
  e.context.prepararImportacaoCsp();
  const original = input.response.getItemResponses;
  input.response.getItemResponses = () => original().map(answer => ({getItem: answer.getItem,
    getResponse: () => answer.getItem().id === e.source.items.EMAIL ? 'editado@example.org' : answer.getResponse()}));
  assert.throws(() => e.context.importarInscricoesAnterioresCsp(), /alteradas ou excluídas/);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'CSP_2026'), 0);
});

test('Importação usa apenas as respostas da prévia; novos envios e regras dos gatilhos são preservados', () => {
  const e = historicalCspEnvironment();
  e.oldResponse('52998224725', 'antigo@example.org');
  e.context.prepararImportacaoCsp();
  e.responseFrom(e.legacy, {timestamp: new Date(Date.now() + 60000), answers: {CPF: '11144477735', EMAIL: 'novo@example.org'}});
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.processadasNesteLote, 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'CSP_2026'), 1);
  assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + e.legacy.form.id), false);
  assert.equal(e.legacy.form.responses.length, 2);
});

test('Perguntas antigas são detectadas por título e ambiguidades exigem mapeamento explícito', () => {
  const e = historicalCspEnvironment();
  e.legacy.name.setTitle('Nome completo'); e.legacy.cpf.setTitle('CPF');
  e.context.setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify({...e.source, items: {}}));
  e.oldResponse('52998224725', 'antigo@example.org');
  assert.equal(e.context.prepararImportacaoCsp().total, 1);
  e.legacy.form.addTextItem().setTitle('Email');
  assert.throws(() => e.context.prepararImportacaoCsp(), /única pergunta EMAIL/);
  e.context.setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify(e.source));
  assert.equal(e.context.prepararImportacaoCsp().total, 1);
});

test('Importação conferida atualiza a fila real sem enviar diretamente; confirmação sem CC e capacidade para CA', () => {
  const e = historicalCspEnvironment(1, true), sent = [];
  e.context.MailApp.sendEmail = message => sent.push(message);
  e.oldResponse('01234567890', 'conferido@example.org');
  e.context.prepararImportacaoCsp();
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 1);
  assert.equal(report.formularioIntegrado, false);
  assert.equal(sent.length, 0);
  const rows = e.context.tableRows_('FilaEmails');
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => !row.ID.startsWith('MAIL:CAPACIDADE:')).DESTINATARIO, 'conferido@example.org');
  assert.equal(rows.find(row => !row.ID.startsWith('MAIL:CAPACIDADE:')).CC, '');
  assert.equal(rows.find(row => row.ID.startsWith('MAIL:CAPACIDADE:')).DESTINATARIO, 'ca@example.org');
  e.context.processarNotificacoes();
  assert.equal(sent.length, 2);
  assert.equal(e.stats.responsesRead, 0);
});

function teamCspEnvironment(capacity = 30, realNotifications = false) {
  const e = environment();
  if (realNotifications) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), e.context);
  e.installed(); e.context.salvarAtividade(e.activity('CSP_2026', {capacity}));
  const form = e.context.FormApp.create('Inscrição CSP por equipe', true);
  const items = {
    TEAM_NAME: form.addTextItem(), TEAM_TYPE: form.addMultipleChoiceItem(), TEAM_SIZE: form.addMultipleChoiceItem(),
    MEMBER1: form.addParagraphTextItem(), MEMBER2: form.addParagraphTextItem(), MEMBER3: form.addParagraphTextItem()
  };
  const source = {formId: form.id, activityId: 'CSP_2026', schema: 'equipes', items: Object.fromEntries(Object.entries(items).map(([key, item]) => [key, item.id]))};
  e.context.setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify(source));
  let sequence = 0;
  function response(teamName, members, declaredSize = members.length) {
    const answers = {TEAM_NAME: teamName, TEAM_TYPE: 'Competitiva', TEAM_SIZE: String(declaredSize), MEMBER1: members[0] || '', MEMBER2: members[1] || '', MEMBER3: members[2] || ''};
    const result = {getId: () => 'TEAM_R' + sequence, getTimestamp: () => new Date('2026-10-05T12:00:00Z'),
      getRespondentEmail: () => { throw new Error('O Form não tem e-mail nativo.'); },
      getItemResponses: () => Object.entries(answers).map(([key, value]) => ({getItem: () => items[key], getResponse: () => value}))};
    const responseId = 'TEAM_R' + (++sequence); result.getId = () => responseId;
    form.responses.push(result); return result;
  }
  return {...e, form, source, teamResponse: response};
}

test('Equipe com três integrantes ocupa uma vaga e exporta todos os CPFs completos sem criar e-mails', () => {
  const e = teamCspEnvironment(2, true);
  const response = e.teamResponse('Equipe Alpha', ['Coach Exemplo - 52998224725', 'Pessoa Exemplo - 11144477735', 'Terceira Pessoa - 01234567890']);
  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.resultadosPrevistos.confirmed, 1); assert.equal(preview.ocupacaoPrevista, 1);
  assert.equal(preview.unidadeCapacidade, 'equipes');
  assert.equal(e.context.readState_().activities.CSP_2026.capacityUnit, undefined, 'prévia não muda o catálogo');
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 1); assert.equal(report.pendentesConferencia, 0);
  const state = e.context.readState_();
  assert.equal(state.activities.CSP_2026.capacityUnit, 'equipes');
  assert.equal(Object.keys(state.participants).length, 0, 'não inventa e-mail para integrantes');
  const team = state.registrations[e.form.id + ':' + response.getId() + ':equipe'];
  assert.equal(team.members.length, 3); assert.equal(team.members[0].role, 'coach');
  assert.equal(e.context.tableRows_('Equipes').length, 1);
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 3);
  assert.equal(e.context.tableRows_('FilaEmails').length, 0, 'sucesso sem e-mail não gera mensagem ao CA');
  e.context.exportarConfirmados('CSP_2026');
  const exported = [...e.sheets.entries()].find(([name]) => name.startsWith('Lista_CSP_2026_'))[1];
  assert.equal(exported.getLastRow(), 4);
  assert.equal(exported.cells[3][4], '01234567890');
  assert.equal(e.context.importarInscricoesAnterioresCsp().processadasNesteLote, 0);
  e.context.salvarAtividade({...e.activity('CSP_2026', {capacity: 3}), description: 'Descrição atualizada'});
  assert.equal(e.context.readState_().activities.CSP_2026.capacityUnit, 'equipes');
});

test('Importação da CSP pode recuperar respostas de uma aba de backup após a limpeza do Form', () => {
  const e = teamCspEnvironment(2);
  const response = e.teamResponse('Equipe recuperada', ['Coach Exemplo - 52998224725', 'Pessoa Exemplo - 11144477735']);
  const backupName = 'Backup_CSP_Respostas';
  const backup = e.context.db_().insertSheet(backupName);
  backup.appendRow(['FORM_ID', 'RESPOSTA_ID', 'DATA', 'EMAIL', 'PERGUNTA_ID', 'PERGUNTA', 'RESPOSTA_JSON']);
  response.getItemResponses().forEach(answer => backup.appendRow([
    e.form.id, response.getId(), response.getTimestamp().toISOString(), '',
    answer.getItem().getId(), answer.getItem().getTitle(), JSON.stringify(answer.getResponse())
  ]));
  e.form.responses = [];
  e.source.backupSheetName = backupName;
  e.context.setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify(e.source));

  assert.equal(e.context.prepararImportacaoCsp().resultadosPrevistos.confirmed, 1);
  assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 1);
  assert.equal(e.context.readState_().registrations[e.form.id + ':' + response.getId() + ':equipe'].members.length, 2);
});

test('CPF de 12 dígitos fica pendente para conferência e pode ser corrigido sem perder a resposta original', () => {
  const e = teamCspEnvironment(2);
  const invalid = e.teamResponse('Equipe com pendência', ['Pessoa Fictícia - 134756596699']);
  e.teamResponse('Equipe válida', ['Pessoa Exemplo - 11144477735']);
  e.context.prepararImportacaoCsp();
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 1); assert.equal(report.pendentesConferencia, 1); assert.equal(report.restantes, 0);
  assert.ok(!e.context.readJournal_().byKey[e.form.id + ':' + invalid.getId()]);
  e.source.overrides = {[invalid.getId()]: {members: [{name: 'Pessoa Fictícia', cpf: '52998224725'}]}};
  e.context.setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify(e.source));
  e.context.prepararImportacaoCsp();
  assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 2);
  const corrected = e.context.readState_().registrations[e.form.id + ':' + invalid.getId() + ':equipe'];
  assert.match(corrected.members[0].raw, /134756596699/);
});

test('Integrante repetido, nome de equipe repetido e CPF duplicado na equipe não ocupam outra vaga', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Alpha', ['Coach Alpha - 52998224725', 'Integrante Alpha - 11144477735']);
  e.teamResponse('Beta', ['Coach Beta - 01234567890', 'Integrante Repetido - 11144477735']);
  e.teamResponse('alpha', ['Outra Pessoa - 01234567890']);
  e.teamResponse('CPF duplicado', ['Coach Duplicado - 01234567890', 'Integrante Duplicado - 01234567890']);
  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.resultadosPrevistos.confirmed, 1); assert.equal(preview.resultadosPrevistos.duplicate, 2); assert.equal(preview.resultadosPrevistos.invalid, 1);
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 1); assert.equal(report.pendentesConferencia, 1);
});

test('Número declarado divergente e textos ambíguos não são confirmados automaticamente', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Incompleta', ['Pessoa Exemplo - 52998224725'], 3);
  e.teamResponse('Ambígua', ['Pessoa - 52998224725 - 11144477735']);
  e.context.prepararImportacaoCsp();
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 0); assert.equal(report.pendentesConferencia, 2);
});

test('Conflito de um integrante impede a equipe inteira e o CA recebe o problema sem e-mail fictício', () => {
  const e = teamCspEnvironment(30, true);
  e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  const registered = e.response('INSCRICAO', {answers: {CPF: '11144477735', ACTIVITY: '[B] Outra atividade'}});
  e.context.processFormResponse_('INSCRICAO', registered.form, registered.response);
  e.teamResponse('Equipe em conflito', ['Coach - 52998224725', 'Integrante - 11144477735']);
  e.context.prepararImportacaoCsp();
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.resultados.conflict, 1); assert.equal(report.ocupacao, 0);
  const row = e.context.tableRows_('FilaEmails').find(row => /Equipe em conflito/.test(row.CORPO));
  assert.equal(row.DESTINATARIO, 'ca@example.org'); assert.equal(row.CC, '');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 1);
});

test('Uma equipe confirmada bloqueia conflito individual sem permitir troca que cancele seus integrantes', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Alpha', ['Coach Alpha - 52998224725', 'Integrante Alpha - 11144477735']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  const input = e.response('INSCRICAO', {answers: {CPF: '11144477735', ACTIVITY: '[B] Outra atividade', SWAP: e.context.SEMINFO_FORM_TEXT_.SWAP_YES}});
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'conflict');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'CSP_2026'), 1);
});

test('Cancelamento administrativo libera uma vaga de equipe, preserva integrantes e exclui da exportação confirmada', () => {
  const e = teamCspEnvironment(1);
  const response = e.teamResponse('Alpha', ['Coach Alpha - 52998224725', 'Integrante Alpha - 11144477735']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  assert.equal(e.form.accepting, false);
  e.context.abrirInscricoes();
  const teamId = e.form.id + ':' + response.getId() + ':equipe';
  assert.equal(e.context.cancelarEquipeCsp(teamId, 'Cancelamento administrativo de teste').ocupacao, 0);
  assert.equal(e.form.accepting, true);
  assert.equal(e.context.tableRows_('Equipes')[0].SITUACAO, 'cancelada');
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 2);
  assert.equal(e.context.consultarInscritos('CSP_2026').length, 0);
  assert.equal(e.context.cancelarEquipeCsp(teamId, 'Cancelamento repetido').resultado, 'ja_cancelada');
});

test('O limite de 30 equipes permite 90 integrantes e fecha o Form sem contar pessoas como vagas', () => {
  const e = teamCspEnvironment(30, true);
  function syntheticCpf(number) {
    let digits = String(100000000 + number).split('').map(Number);
    for (let length = 9; length <= 10; length++) {
      const remainder = digits.reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0) * 10 % 11;
      digits.push(remainder === 10 ? 0 : remainder);
    }
    return digits.join('');
  }
  for (let i = 0; i < 31; i++) e.teamResponse('Equipe ' + i, [0, 1, 2].map(member => 'Pessoa ' + i + ' ' + member + ' - ' + syntheticCpf(i * 3 + member)));
  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.resultadosPrevistos.confirmed, 30); assert.equal(preview.resultadosPrevistos.full, 1);
  let report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 30); assert.equal(report.restantes, 1);
  report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 30); assert.equal(report.resultados.full, 1); assert.equal(report.restantes, 0);
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 90);
  assert.equal(e.form.accepting, false);
  const alerts = e.context.tableRows_('FilaEmails').filter(row => row.ID.startsWith('MAIL:CAPACIDADE:'));
  assert.equal(alerts.length, 1); assert.match(alerts[0].CORPO, /30\/30 equipes/);
});

test('Título explícito nomeia Form existente e preserva descrição, perguntas e respostas', () => {
  const e = environment(), entry = e.manualRegistration('A');
  entry.definition.title = 'Oficina de Jogos — Ricardo Martins — Tarde';
  entry.form.responses.push({id: 'histórica'});
  e.configureExisting([entry]); e.installed();
  assert.equal(entry.form.title, entry.definition.title);
  assert.equal(entry.form.description, 'Descrição original para participantes');
  assert.equal(entry.form.responses.length, 1);
  assert.equal(entry.form.getItemById(entry.name.id).title, 'Seu nome');
});

test('Programação carrega horários/capacidades conhecidos, separa turnos e mantém palestras pendentes', () => {
  const e = environment(); e.installed();
  const result = e.context.carregarProgramacaoSeminfo2026(), state = e.context.readState_();
  assert.equal(result.criadas.length, 18);
  assert.equal(result.totalCadastradas, 18);
  assert.equal(Object.keys(state.activities).length, 18);
  assert.equal(state.activities.OFICINA_OLLAMA.capacity, 15);
  assert.equal(state.activities.OFICINA_JOGOS_NOITE.start, '2026-10-27T22:00:00.000Z');
  assert.equal(state.activities.OFICINA_GAMEMAKER.start, '2026-10-27T16:00:00.000Z');
  assert.equal(state.activities.PALESTRA_DANIELE.status, 'pendente');
  assert.equal(state.activities.PALESTRA_DANIELE.start, '2026-10-28T22:30:00.000Z');
  assert.equal(state.activities.PALESTRA_DANIELE.end, '');
  assert.equal(state.activities.PALESTRA_DANIELE.capacity, null);
  assert.equal(state.activities.PALESTRA_BIO.start, '');
  assert.match(state.activities.PALESTRA_BIO.description, /2026-10-27/);
  assert.equal(state.activities.CSP_2026.capacityUnit, 'equipes');
  assert.equal(state.activities.CSP_2026.type, 'competicao');
  assert.equal(state.activities.ENCERRAMENTO_2026.type, 'programacao');
  assert.equal(state.activities.OFICINA_YASMIN_GABRIEL.status, 'pendente');
  assert.equal(state.activities.ABERTURA_2026.status, 'pendente');
  assert.equal(e.context.tableRows_('Atividades').length, 18);
  assert.equal(e.context.tableRows_('Programacao').length, 18);
  const count = e.context.readJournal_().operations.length;
  e.context.carregarProgramacaoSeminfo2026();
  assert.equal(e.context.readJournal_().operations.length, count, 'repetir não duplica nem sobrescreve');
});

test('Atividade excluída sai das opções e da reconstrução; Form fixo continua instalado e fechado', () => {
  const e = environment(), entry = e.manualRegistration('A'); e.configureExisting([entry]);
  e.installed(); e.context.salvarAtividade(e.activity()); e.context.abrirInscricoes();
  assert.equal(entry.form.accepting, true);
  e.context.apagarAtividade('A');
  assert.equal(e.context.readState_().activities.A, undefined);
  assert.equal(e.context.tableRows_('Atividades').length, 0);
  assert.equal(entry.form.accepting, false);
  e.context.reconstruirVisoes(); e.context.abrirInscricoes();
  assert.equal(entry.form.accepting, false);
  assert.equal(e.context.getRegistrationFormDefinitions_()[0].id, entry.form.id);
  e.context.salvarAtividade(e.activity());
  assert.equal(entry.form.accepting, true, 'recadastrar restaura atividade');
});

test('Exclusão com inscrição é recusada sem perder ocupação nem histórico', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO');
  e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const before = e.context.readJournal_().operations.length;
  assert.throws(() => e.context.apagarAtividade('A'), /possui inscrições/);
  assert.equal(e.context.readJournal_().operations.length, before);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
});

function resetEnvironment() {
  const e = environment();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), e.context);
  e.begin();
  const formId = e.context.getConfig_().ID_FORM_INSCRICAO;
  e.properties.set('SEMINFO_VERIFIED_SINCE_' + formId, new Date(Date.now() - 5000).toISOString());
  const input = e.response('INSCRICAO', {timestamp: new Date(Date.now() - 2000)});
  e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const raw = e.context.db_().insertSheet('Respostas ao formulário 3'); raw.formUrl = input.form.getPublishedUrl();
  raw.appendRow(['DATA', 'CPF']).appendRow(['data', '52998224725']);
  e.context.db_().insertSheet('Anotações').appendRow(['MANTER']).appendRow(['conteúdo independente']);
  e.properties.set('SEMINFO_IMPORTACAO_CSP', '{"prévia":"anterior"}');
  return {e, input, raw};
}

test('Limpeza zera livro, cadastros, fila e respostas; mantém Forms/perguntas/configuração e backups', () => {
  const {e, input, raw} = resetEnvironment();
  const ids = [...e.forms.keys()], items = input.form.items.map(item => item.id), created = e.stats.formsCreated;
  const result = e.context.limparTudoERecomecar();
  assert.equal(result.zerado, true);
  assert.equal(e.context.readJournal_().operations.length, 0);
  assert.equal(Object.keys(e.context.readState_().activities).length, 0);
  for (const name of ['Participantes', 'Inscricoes', 'Solicitacoes', 'Historico', 'FilaEmails', 'Equipes', 'IntegrantesEquipes']) assert.equal(e.context.tableRows_(name).length, 0, name);
  assert.equal(raw.getLastRow(), 1);
  assert.equal(e.sheets.get('Anotações').getLastRow(), 2);
  assert.deepEqual([...e.forms.keys()], ids);
  assert.deepEqual(input.form.items.map(item => item.id), items);
  assert.equal(e.stats.formsCreated, created);
  assert.equal(e.context.getConfig_().EMAIL_CA, 'ca@example.org');
  assert.equal(e.properties.has('SEMINFO_IMPORTACAO_CSP'), false);
  assert.equal(e.properties.has('SEMINFO_FORMS_ACTIVATED'), false);
  assert.equal(e.properties.has('SEMINFO_RESET_PENDING'), false);
  assert.ok(e.properties.get('SEMINFO_RESET_AT'));
  assert.ok([...e.sheets.values()].some(sheet => sheet.name.startsWith(result.backups) && sheet.cells.some(row => String(row[0]).includes('GENESIS'))));
  assert.ok([...e.sheets.values()].filter(sheet => sheet.name.startsWith(result.backups)).every(sheet => sheet.hidden && sheet.protections.length));
  for (const form of e.forms.values()) { assert.equal(form.responses.length, 0); assert.equal(form.accepting, false); }
  e.context.reconstruirVisoes();
  assert.equal(e.context.tableRows_('FilaEmails').length, 0, 'recuperação não recria e-mails antigos');
  e.context.salvarAtividade(e.activity()); e.context.abrirInscricoes();
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /quarentena/);
  assert.equal(e.context.tableRows_('Inscricoes').length, 0);
});

test('Limpeza interrompida bloqueia operação, retoma backups originais e conclui com mesmos Forms', () => {
  const {e, input} = resetEnvironment();
  const original = input.form.deleteAllResponses.bind(input.form);
  input.form.deleteAllResponses = () => { original(); throw new Error('falha após limpar Form'); };
  assert.throws(() => e.context.limparTudoERecomecar(), /falha após limpar/);
  const plan = JSON.parse(e.properties.get('SEMINFO_RESET_PENDING'));
  const backups = [...e.sheets.keys()].filter(name => name.startsWith(plan.prefix));
  assert.equal(plan.phase, 'clear');
  assert.throws(() => e.context.salvarAtividade(e.activity('B')), /Limpeza em andamento/);
  assert.throws(() => e.context.abrirInscricoes(), /Limpeza em andamento/);
  assert.throws(() => e.installed(), /Limpeza em andamento/);
  assert.equal(e.properties.has('SEMINFO_FORMS_ACTIVATED'), false);
  input.form.deleteAllResponses = original;
  const result = e.context.limparTudoERecomecar();
  assert.equal(result.backups, plan.prefix);
  assert.deepEqual([...e.sheets.keys()].filter(name => name.startsWith(plan.prefix)), backups);
  assert.equal(e.context.readJournal_().operations.length, 0);
});

test('Falha ao copiar backup interrompe antes de apagar respostas ou livro oficial', () => {
  const {e, input} = resetEnvironment();
  const sheet = e.sheets.get('Operacoes'), original = sheet.copyTo.bind(sheet), count = sheet.getLastRow();
  sheet.copyTo = () => { throw new Error('falha no backup'); };
  assert.throws(() => e.context.limparTudoERecomecar(), /falha no backup/);
  assert.equal(input.form.responses.length, 1); assert.equal(sheet.getLastRow(), count);
  sheet.copyTo = original;
  e.context.limparTudoERecomecar();
  assert.equal(input.form.responses.length, 0); assert.equal(sheet.getLastRow(), 1);
});

test('Limpeza aguarda e-mail em envio e recusa outra conta sem efeitos', () => {
  const {e, input} = resetEnvironment();
  assert.ok(e.context.claimNotificationLocked_());
  assert.throws(() => e.context.limparTudoERecomecar(), /e-mail em envio/);
  assert.equal(e.properties.has('SEMINFO_RESET_PENDING'), false);
  assert.equal(input.form.responses.length, 1);
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'outra@example.org'});
  assert.throws(() => e.context.limparTudoERecomecar(), /conta que instalou/);
});

test('Limpeza preserva respostas do Form antigo da CSP e permite importá-las depois do reinício', () => {
  const e = teamCspEnvironment(2, true);
  e.teamResponse('Equipe teste', ['Coach Exemplo - 52998224725', 'Integrante Exemplo - 11144477735']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  assert.equal(e.context.tableRows_('Equipes').length, 1);
  const result = e.context.limparTudoERecomecar();
  assert.ok(result.formsMantidos.includes(e.form.id));
  assert.equal(result.respostasPreservadasCsp, e.form.id);
  assert.equal(e.form.responses.length, 1); assert.equal(e.form.accepting, false);
  assert.equal(e.context.tableRows_('Equipes').length, 0);
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 0);
  assert.equal(e.context.tableRows_('FilaEmails').length, 0);
  e.context.salvarAtividade(e.activity('CSP_2026', {capacity: 2}));
  assert.equal(e.context.prepararImportacaoCsp().total, 1);
  assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 1);
});

test('Migração da lista nomeia Forms e adiciona novos preservando perguntas e vínculos já instalados', () => {
  const e = environment(), first = e.manualRegistration('A'), second = e.manualRegistration('B');
  e.configureExisting([first]); e.installed();
  const created = e.stats.formsCreated;
  e.context.SEMINFO_CONFIG = Object.freeze({...e.context.SEMINFO_CONFIG, FORMULARIOS_INSCRICAO_JSON: JSON.stringify([
    {id: first.form.id, activityId: 'A', title: 'Primeira oficina', items: {}},
    {...second.definition, title: 'Segunda oficina'}
  ])});
  e.context.prepararFormulariosSeminfo2026();
  const definitions = e.context.getRegistrationFormDefinitions_();
  assert.equal(definitions.length, 2);
  assert.equal(definitions[0].items.NAME, first.name.id);
  assert.equal(definitions[0].title, 'Primeira oficina');
  e.context.instalarSistema();
  assert.equal(first.form.title, 'Primeira oficina'); assert.equal(second.form.title, 'Segunda oficina');
  assert.equal(e.stats.formsCreated, created, 'usa os mesmos Forms');
  assert.equal(second.form.accepting, false);
});

test('Importação já iniciada é invalidada quando muda a geração após reinício', () => {
  const e = historicalCspEnvironment(3);
  e.oldResponse('52998224725', 'primeiro@example.org');
  e.oldResponse('11144477735', 'segundo@example.org', 1);
  e.context.setConfig_('MAX_SOLICITACOES_POR_EXECUCAO', 1);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  assert.equal(JSON.parse(e.properties.get('SEMINFO_IMPORTACAO_CSP')).started, true);
  e.properties.set('SEMINFO_GENERATION', 'nova-geração');
  assert.throws(() => e.context.importarInscricoesAnterioresCsp(), /sistema foi zerado/);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'CSP_2026'), 1);
});

test('Instalação nomeia abas nativas por atividade, preserva dados e não renomeia abas independentes', () => {
  const e = environment(), report = e.installed(), form = e.forms.get(report.registrationId);
  e.context.setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify([{id: form.id, title: 'Oficina de Jogos — Tarde'}]));
  const raw = e.context.db_().insertSheet('Respostas ao formulário 3'); raw.formUrl = form.getPublishedUrl();
  raw.appendRow(['Nome']).appendRow(['Pessoa inscrita']);
  const unrelated = e.context.db_().insertSheet('Anotações'); unrelated.appendRow(['Manter']);
  const install = e.context.instalarSistema();
  assert.equal(form.title, 'Oficina de Jogos — Tarde');
  assert.equal(raw.name, 'Respostas — Oficina de Jogos — Tarde');
  assert.equal(raw.cells[1][0], 'Pessoa inscrita'); assert.equal(unrelated.name, 'Anotações');
  assert.equal(install.abasDeRespostas.length, 1);
  e.context.instalarSistema();
  assert.equal(raw.name, 'Respostas — Oficina de Jogos — Tarde');
});

test('Form sem destino é reconhecido em português e inglês; erros diferentes continuam sendo propagados', () => {
  const e = environment();
  for (const message of [
    'O formulário não tem nenhum destino de resposta no momento.',
    'O formulário não tem nenhum destino de resposta no momento',
    'Exception: O formulário não tem nenhum destino de resposta no momento.',
    'The form currently has no response destination.',
    'The form currently has no response destination'
  ]) {
    assert.equal(e.context.formDestinationId_({getDestinationId() { throw new Error(message); }}), '');
  }
  for (const message of ['Falha ao recuperar os dados do formulário. Aguarde e tente novamente.', 'Acesso negado.', 'O formulário não tem nenhum destino de resposta no momento. Outro erro.']) {
    const error = new Error(message);
    assert.throws(() => e.context.formDestinationId_({getDestinationId() { throw error; }}), actual => actual === error);
  }
});

test('Limpeza completa aceita Form sem planilha de respostas e preserva perguntas e backup das respostas', () => {
  const {e, input} = resetEnvironment();
  input.form.destination = '';
  input.form.destinationError = new Error('O formulário não tem nenhum destino de resposta no momento.');
  const questions = input.form.items.map(item => item.id);
  const result = e.context.limparTudoERecomecar();
  assert.equal(result.zerado, true);
  assert.equal(input.form.responses.length, 0);
  assert.equal(input.form.accepting, false);
  assert.deepEqual(input.form.items.map(item => item.id), questions);
  assert.equal(e.context.readJournal_().operations.length, 0);
  assert.equal(e.properties.has('SEMINFO_RESET_PENDING'), false);
  const backup = [...e.sheets.values()].find(sheet => sheet.name.startsWith(result.backups + 'Form_') && sheet.cells[1]?.[0] === input.form.id);
  assert.ok(backup && backup.getLastRow() > 1 && backup.hidden, 'respostas sem destino também têm backup antes da exclusão');
});

test('Instalação vincula destino ausente quando a exceção do Google vem em português', () => {
  const e = environment(), entry = e.manualRegistration('A');
  entry.form.destination = '';
  entry.form.destinationError = new Error('O formulário não tem nenhum destino de resposta no momento.');
  const originalSetDestination = entry.form.setDestination.bind(entry.form);
  entry.form.setDestination = (type, id) => { entry.form.destinationError = null; return originalSetDestination(type, id); };
  e.configureExisting([entry]); e.installed();
  assert.equal(entry.form.destination, 'SHEET');
  assert.equal(e.context.getRegistrationFormDefinitions_()[0].id, entry.form.id);
});

test('Acrescenta atividades faltantes em instalação existente sem sobrescrever oficinas nem perder inscrições', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const existing = e.activity('OFICINA_GAMEMAKER', {title: 'Título ajustado pela organização', capacity: 45});
  e.context.salvarAtividade(existing);
  const before = e.context.readState_().activities.OFICINA_GAMEMAKER;
  const result = e.context.carregarProgramacaoSeminfo2026();
  assert.equal(result.criadas.length, 17);
  assert.equal(result.totalCadastradas, 18);
  assert.equal(JSON.stringify(e.context.readState_().activities.OFICINA_GAMEMAKER), JSON.stringify(before));
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(input.form.responses.length, 1);
  assert.ok(e.context.readState_().activities.PALESTRA_BIO);
  const operations = e.context.readJournal_().operations.length;
  assert.equal(e.context.carregarProgramacaoSeminfo2026().criadas.length, 0);
  assert.equal(e.context.readJournal_().operations.length, operations);
});

test('Form de palestra pendente permanece fechado e fora do cancelamento até completar cadastro', () => {
  const e = environment(), lecture = e.manualRegistration('PALESTRA_BIO');
  e.configureExisting([lecture]); e.installed(); e.context.carregarProgramacaoSeminfo2026();
  e.context.abrirInscricoes();
  assert.equal(lecture.form.accepting, false);
  const cancel = e.forms.get(e.context.getConfig_().ID_FORM_CANCELAMENTO);
  const choices = e.context.getStoredFormItem_(cancel, 'CANCELAMENTO', 'ACTIVITY').choices;
  assert.ok(choices.every(choice => !choice.includes('[PALESTRA_BIO]')));
  assert.ok(e.context.conferirSistema().atividadesPendentes.some(item => item.id === 'PALESTRA_BIO'));
  assert.doesNotThrow(() => e.context.formActivityLabel_(e.context.readState_().activities.PALESTRA_BIO));
  const completed = {...e.context.readState_().activities.PALESTRA_BIO,
    start: '2026-10-27T13:00:00-03:00', end: '2026-10-27T14:00:00-03:00', capacity: 100, status: 'aberta'};
  e.context.salvarAtividade(completed);
  assert.equal(lecture.form.accepting, true);
});

test('Prévia CSP pendente exige completar dados antes de consumir respostas históricas', () => {
  const e = teamCspEnvironment(2, true);
  e.teamResponse('Equipe teste', ['Coach Exemplo - 52998224725']);
  e.context.salvarAtividade({...e.context.readState_().activities.CSP_2026, capacity: null, status: 'pendente'});
  const before = e.context.readJournal_().operations.length;
  assert.throws(() => e.context.prepararImportacaoCsp(), /Complete os dados/);
  assert.equal(e.context.readJournal_().operations.length, before);
  assert.equal(e.context.tableRows_('Solicitacoes').length, 0);
});

test('Atualização da programação inclui Form da abertura e conserva inscrições existentes', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const opening = e.manualRegistration('ABERTURA_2026'); opening.definition.title = 'Abertura — XXI Seminfo';
  e.context.SEMINFO_CONFIG = Object.freeze({...e.context.SEMINFO_CONFIG, FORMULARIOS_INSCRICAO_JSON: JSON.stringify([opening.definition])});
  const created = e.stats.formsCreated;
  const result = e.context.atualizarProgramacaoSeminfo2026();
  assert.equal(result.programacao.totalCadastradas, 18);
  assert.equal(opening.form.title, 'Abertura — XXI Seminfo');
  assert.equal(opening.form.accepting, false);
  assert.equal(e.context.getRegistrationFormDefinitions_().some(source => source.id === opening.form.id && source.activityId === 'ABERTURA_2026'), true);
  assert.equal(e.stats.formsCreated, created);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(input.form.responses.length, 1);
  assert.equal(e.properties.has('SEMINFO_RESET_AT'), false);
});
