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
  const stats = { formsCreated: 0, destinations: 0, triggersCreated: 0, responsesRead: 0, queueSyncs: 0, locks: 0, lockHeld: false, formUpdates: 0, formOpensWhileLocked: 0, tryLockSucceeds: true, installLockTimeout: 0 };
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
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: id => {
      assert.ok(['SHEET', '1tFSDmBp9wsCskM0dIF_ax9-CM6upvodHAYL0xi2QhrA'].includes(id));
      return spreadsheet;
    },
      flush: () => {}, getUi: () => ({ alert: () => {} }), ProtectionType: { SHEET: 'SHEET' } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'ca@example.org' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    LockService: { getScriptLock: () => ({
      tryLock: timeout => { stats.installLockTimeout = timeout; if (!stats.tryLockSucceeds) return false; stats.locks++; stats.lockHeld = true; return true; },
      waitLock: () => { stats.locks++; stats.lockHeld = true; },
      releaseLock: () => { stats.lockHeld = false; }
    }) },
    MailApp: { getRemainingDailyQuota: () => 100 },
    Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()].map(value => value > 127 ? value - 256 : value),
      getUuid: () => 'UUID-' + (++sequence), formatDate: value => value.toISOString(), sleep: () => {} },
    FormApp: { create: (name, published) => { stats.formsCreated++; const form = new Form(name, published); forms.set(form.id, form); return form; },
      openByUrl: url => { const form = [...forms.values()].find(form => form.getPublishedUrl() === url); assert(form); return form; },
      openById: id => { if (stats.lockHeld) stats.formOpensWhileLocked++; assert(forms.has(id), 'configured form must exist'); return forms.get(id); }, DestinationType: { SPREADSHEET: 'SPREADSHEET' } },
    DriveApp: { getFileById: id => {
      assert.ok(forms.has(id));
      return {setName: name => { forms.get(id).documentTitle = name; }};
    }, getFilesByName: name => {
      const matches = [...forms.values()].filter(form => form.documentTitle === name); let index = 0;
      return { hasNext: () => index < matches.length, next: () => { const form = matches[index++]; return {
        getId: () => form.id, isTrashed: () => false, getMimeType: () => 'application/vnd.google-apps.form'
      }; } };
    } },
    UrlFetchApp: { fetch: (url, options = {}) => {
      const id = decodeURIComponent(url.split('/').pop().split('?')[0].replace(/:batchUpdate$/, '')), form = forms.get(id);
      if (options.method === 'post') {
        assert(url.endsWith(':batchUpdate'));
        assert.equal(options.contentType, 'application/json');
        assert.equal(options.headers.Authorization, 'Bearer MOCK_TOKEN');
        const body = JSON.parse(options.payload);
        const code = form.updateHttpCode || 200;
        stats.formUpdates++;
        for (const {updateSettings} of body.requests) {
          assert.equal(updateSettings.updateMask, 'emailCollectionType');
          assert.deepEqual(Object.keys(updateSettings.settings), ['emailCollectionType']);
          if (code === 200 && !form.ignoreVerifiedUpdate) {
            form.mode = updateSettings.settings.emailCollectionType;
            form.collect = form.mode !== 'DO_NOT_COLLECT';
          }
        }
        return {getResponseCode: () => code, getContentText: () => JSON.stringify({replies: [{}]})};
      }
      return { getResponseCode: () => form.httpCode || 200,
        getContentText: () => JSON.stringify({ formId: id, settings: { emailCollectionType: form.mode } }) };
    } },
    ScriptApp: { getScriptId: () => 'PROJECT', getOAuthToken: () => 'MOCK_TOKEN',
      EventType: { ON_FORM_SUBMIT: 'ON_FORM_SUBMIT', CLOCK: 'CLOCK' }, getProjectTriggers: () => [...triggers],
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: handler => {
        let id = '', event = '';
        const builder = { forForm: form => { id = typeof form === 'string' ? form : form.id; assert(forms.has(id)); return builder; }, onFormSubmit: () => { event = 'ON_FORM_SUBMIT'; return builder; },
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
    ID_PLANILHA: '', ID_FORM_INSCRICAO: '', ID_FORM_CANCELAMENTO: '', FORMULARIOS_INSCRICAO_JSON: '[]',
    FORMULARIOS_PUBLICOS_SEMINFO_JSON: '[]', IMPORTACAO_CSP_JSON: '' });
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

function simulatedClock(context) {
  let now = Date.now();
  context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return { now: () => now, advance: milliseconds => { now += milliseconds; } };
}

test('Perguntas com ID instalado não consultam a planilha de configuração novamente', () => {
  const e = environment(), installed = e.installed(), form = e.forms.get(installed.registrationId);
  e.context.getConfig_ = () => { throw new Error('Consulta desnecessária à planilha'); };
  for (const key of ['NAME', 'CPF', 'ACTIVITY', 'SWAP']) {
    assert(e.context.getStoredFormItem_(form, 'INSCRICAO', key));
  }
});

test('Sincronização com prazo alterna lotes de Forms e pula somente visões já concluídas', () => {
  const e = environment(), entries = Array.from({ length: 5 }, () => e.manualRegistration('A'));
  e.configureExisting(entries, false); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.abrirInscricoes();
  const journalBefore = JSON.stringify(e.context.readJournal_().operations), queueSyncs = e.stats.queueSyncs;
  for (const {form} of entries) form.accepting = false;
  e.properties.set('SEMINFO_FORM_REFRESH_INDEX', '0');
  const first = e.context.refreshFormsSafely_(Date.now() + 90000, true);
  assert.equal(first.atualizados, 3); assert.equal(first.parcial, true);
  assert.deepEqual(entries.map(({form}) => form.accepting), [true, true, true, false, false]);
  const second = e.context.refreshFormsSafely_(Date.now() + 90000, true);
  assert.equal(second.atualizados, 3); assert(entries.every(({form}) => form.accepting));
  assert.equal(e.stats.queueSyncs, queueSyncs, 'livro inalterado dispensa reconstrução periódica');
  assert.equal(JSON.stringify(e.context.readJournal_().operations), journalBefore);
  e.context.refreshFormsSafely_();
  assert.equal(e.stats.queueSyncs, queueSyncs + 1, 'atualização manual ainda reconstrói as visões');
  assert.equal(e.properties.has('SEMINFO_FORM_REFRESH_PENDING'), false);
});

test('Prazo esgotado na conferência dos Forms não abre nenhuma origem e libera o marcador', () => {
  const e = environment(), entries = Array.from({ length: 4 }, () => e.manualRegistration('A'));
  e.configureExisting(entries, false); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.abrirInscricoes();
  for (const {form} of entries) form.accepting = false;
  const clock = simulatedClock(e.context), verify = e.context.assertVerifiedEmail_;
  e.context.assertVerifiedEmail_ = (...args) => { const result = verify(...args); clock.advance(31000); return result; };
  const result = e.context.refreshFormsSafely_(clock.now() + 90000, true);
  assert.equal(result.adiada, true); assert.equal(result.fase, 'verificacao');
  assert(entries.every(({form}) => !form.accepting));
  assert.equal(e.properties.has('SEMINFO_FORM_REFRESH_PENDING'), false);
  assert.equal(e.stats.lockHeld, false);
  e.context.assertVerifiedEmail_ = verify;
  assert.equal(e.context.refreshFormsSafely_(clock.now() + 90000, true).atualizados, 3);
});

test('Falha do serviço na aplicação de opções preserva o cursor para tentar novamente', () => {
  const e = environment(), entry = e.manualRegistration('A');
  e.configureExisting([entry], false); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.abrirInscricoes();
  entry.form.accepting = false;
  const receive = entry.form.setAcceptingResponses;
  entry.form.setAcceptingResponses = () => { throw new Error('Server error'); };
  assert.throws(() => e.context.refreshFormsSafely_(Date.now() + 90000, true), /Server error/);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_INDEX'), '0');
  assert.equal(e.properties.has('SEMINFO_FORM_REFRESH_PENDING'), false);
  entry.form.setAcceptingResponses = receive;
  assert.equal(e.context.refreshFormsSafely_(Date.now() + 90000, true).atualizados, 1);
  assert.equal(entry.form.accepting, true);
});

test('Varredura lenta retoma origens e respostas sem perder nem duplicar decisões', () => {
  const e = environment(), entries = Array.from({ length: 3 }, () => e.manualRegistration('A'));
  e.configureExisting(entries, false); e.installed();
  e.context.salvarAtividade(e.activity('A')); e.context.abrirInscricoes();
  entries.forEach(entry => e.responseFrom(entry));
  const clock = simulatedClock(e.context);
  for (const {form} of entries) form.getResponses = () => { clock.advance(25000); return form.responses; };
  for (let round = 0; round < 3; round++) {
    const result = e.context.processarSolicitacoesPendentes(clock.now() + 120000, true);
    assert.equal(result.processadas, 1); assert.equal(result.varreduraParcial, true);
  }
  const requests = e.context.readJournal_().operations.filter(op => op.kind === 'REQUEST');
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map(op => op.request.formId)).size, 3);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(e.context.processarSolicitacoesPendentes(clock.now() + 120000, true).processadas, 0);
});

test('Manutenção reserva prazos por etapa, deixa nomes para depois dos e-mails e evita sobreposição', () => {
  const e = environment(); e.begin();
  const clock = simulatedClock(e.context), started = clock.now(), stages = [];
  e.context.processarSolicitacoesPendentes = (deadline, defer) => {
    stages.push('recuperacao'); assert.equal(deadline, started + 120000); assert.equal(defer, true);
    assert.equal(e.context.manutencaoPeriodica().adiada, true, 'segunda manutenção não trabalha junto');
    clock.advance(120000); return {processadas: 1};
  };
  e.context.refreshFormsSafely_ = (deadline, skip) => {
    stages.push('formularios'); assert.equal(deadline, started + 210000); assert.equal(skip, true);
    clock.advance(90000); return {parcial: true};
  };
  e.context.postProcessing_ = deadline => {
    stages.push('emails'); assert.equal(deadline, started + 255000); clock.advance(45000); return {enviadas: 1};
  };
  e.context.sincronizarNomesAbasDeRespostas_ = () => { throw new Error('Etapa sem tempo não deve iniciar'); };
  const result = e.context.manutencaoPeriodica();
  assert.deepEqual(stages, ['recuperacao', 'formularios', 'emails']);
  assert.equal(result.duracaoMs, 255000);
  assert.equal(e.properties.has('SEMINFO_MAINTENANCE_PENDING'), false);
  assert.equal(e.stats.lockHeld, false);
});

test('Manutenção retoma lease expirado e libera o marcador mesmo após falha na recuperação', () => {
  const e = environment(); e.begin();
  const clock = simulatedClock(e.context);
  e.properties.set('SEMINFO_MAINTENANCE_PENDING', (clock.now() - 540001) + '|interrompida');
  e.context.processarSolicitacoesPendentes = () => { throw new Error('Serviço temporariamente indisponível'); };
  let sends = 0;
  e.context.refreshFormsSafely_ = () => ({atualizados: 1});
  e.context.postProcessing_ = () => { sends++; return {enviadas: 1}; };
  e.context.sincronizarNomesAbasDeRespostas_ = () => [];
  const result = e.context.manutencaoPeriodica();
  assert.match(result.recuperacao.erro, /temporariamente/);
  assert.equal(sends, 1); assert.equal(e.context.tableRows_('Erros').length, 1);
  assert.equal(e.properties.has('SEMINFO_MAINTENANCE_PENDING'), false);
});

test('Renomeação periódica atende uma origem por vez e continua após uma origem falhar', () => {
  const e = environment(), a = e.manualRegistration('A'), b = e.manualRegistration('B');
  e.configureExisting([a, b], false); e.installed();
  const calls = [];
  e.context.nomearAbasDeRespostas_ = ids => {
    calls.push(Array.from(ids)); if (calls.length === 1) throw new Error('Server error'); return [];
  };
  assert.throws(() => e.context.sincronizarNomesAbasDeRespostas_(Date.now() + 60000), /Server error/);
  e.context.sincronizarNomesAbasDeRespostas_(Date.now() + 60000);
  assert.deepEqual(calls, [[a.form.id], [b.form.id]]);
  assert.equal(e.context.sincronizarNomesAbasDeRespostas_(Date.now() + 1000).adiada, true);
  assert.equal(calls.length, 2);
});

test('Instalação real com mocks cria Forms, abas e gatilhos uma vez e mantém ambos inicialmente fechados', () => {
  const e = environment(), first = e.installed(), counts = [e.sheets.size, e.stats.formsCreated, e.stats.destinations, e.stats.triggersCreated];
  assert.equal(e.context.readState_().accepting, false);
  assert.equal(e.stats.formOpensWhileLocked, 0);
  assert.equal(e.stats.installLockTimeout, 120000);
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

test('Falha ao adquirir o lock interrompe a instalação antes de alterar configurações ou Forms', () => {
  const e = environment();
  e.stats.tryLockSucceeds = false;
  assert.throws(() => e.context.instalarSistema(), /Outra execução da SEMINFO mantém o bloqueio/);
  assert.equal(e.stats.formsCreated, 0);
  assert.equal(e.properties.has('SEMINFO_INSTALL_PENDING'), false);
  assert.equal(e.properties.has('SEMINFO_INSTALLER'), false);
});

test('Operações comuns são bloqueadas durante uma atualização externa de Forms', () => {
  const e = environment();
  e.properties.set('SEMINFO_FORM_REFRESH_PENDING', Date.now() + '|refresh-test');
  assert.throws(() => e.context.withLock_(() => true), /atualização dos Forms/);
});

test('Atualização visual permite registrar e recuperar inscrições sem sobrescrever o marcador em andamento', () => {
  const e = environment(); e.begin();
  const first = e.response('INSCRICAO');
  const token = Date.now() + '|outra-execucao|VIEW';
  e.properties.set('SEMINFO_FORM_REFRESH_PENDING', token);
  assert.equal(e.context.processFormResponse_('INSCRICAO', first.form, first.response).code, 'confirmed');
  assert.equal(e.context.tableRows_('Inscricoes').filter(row => row.SITUACAO === 'confirmada').length, 1);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), token);
  // Configurações externas dos Forms continuam exclusivas.
  assert.throws(() => e.context.withExternalFormOperation_(() => true), /atualização dos Forms/);
  e.response('INSCRICAO', {email: 'outra@example.org', answers: {CPF: '11144477735'}});
  const recovered = e.context.processarSolicitacoesPendentes();
  assert.equal(recovered.processadas, 1);
  assert.equal(recovered.falhas, 0);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), token);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1, 'a última vaga continua protegida');
  assert.equal(e.context.tableRows_('Erros').length, 0);
  assert.equal(e.stats.lockHeld, false);
});

test('Envios simultâneos à atualização visual não duplicam refresh nem ultrapassam a última vaga', () => {
  const e = environment(); e.begin();
  const first = e.response('INSCRICAO');
  const second = e.response('INSCRICAO', {email: 'outra@example.org', answers: {CPF: '11144477735'}});
  const original = e.context.refreshFormsLocked_;
  let calls = 0;
  e.context.refreshFormsLocked_ = state => {
    calls++;
    assert.equal(e.stats.lockHeld, false);
    assert.match(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), /\|VIEW$/);
    assert.equal(e.context.processFormResponse_('INSCRICAO', first.form, first.response).code, 'confirmed');
    assert.equal(e.context.processFormResponse_('INSCRICAO', second.form, second.response).code, 'full');
    return original(state);
  };
  e.context.atualizarOpcoesFormularios();
  assert.equal(calls, 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(e.properties.has('SEMINFO_FORM_REFRESH_PENDING'), false);
  assert.equal(e.context.tableRows_('Solicitacoes').length, 2);
  e.context.refreshFormsLocked_ = original;
  e.context.processarSolicitacoesPendentes();
  assert.equal(first.form.accepting, false, 'a manutenção reaplica as opções com a ocupação atual');
  assert.equal(e.context.tableRows_('Solicitacoes').length, 2);
});

test('Cancelamento pelo menu libera a vaga e envia confirmação durante atualização VIEW sem alterar seu marcador', () => {
  const e = environment(), sent = [], alerts = [];
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), e.context);
  e.context.MailApp.sendEmail = message => sent.push(message);
  e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  e.context.processarNotificacoes(); // Esvazia a confirmação e o aviso de lotação anteriores.
  sent.splice(0);
  const token = Date.now() + '|rotina|VIEW'; e.properties.set('SEMINFO_FORM_REFRESH_PENDING', token);
  e.context.promptText_ = () => JSON.stringify({cpf: '52998224725', activityId: 'A', reason: 'Membro do Centro Acadêmico.'});
  e.context.SpreadsheetApp.getUi = () => ({alert: text => alerts.push(JSON.parse(text))});
  e.context.menuCancelar();
  assert.equal(alerts[0].code, 'canceled'); assert.equal(alerts[0].atualizacaoFormularios.adiada, true);
  assert.equal(e.context.consultarOcupacao()[0].ocupacao, 0);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), token);
  const journal = e.context.readJournal_(), operation = journal.operations.find(operation => operation.key.startsWith('ADMIN:CANCEL:'));
  assert.equal(journal.state.registrations[input.form.id + ':' + input.response.getId() + ':inscricao'].status, 'cancelada');
  assert.equal(operation.reason, 'Membro do Centro Acadêmico.');
  assert.equal(sent.length, 1); assert.match(sent[0].subject, /Cancelamento concluído/);
  assert.equal(e.context.tableRows_('FilaEmails').find(row => row.OPERACAO === operation.key).SITUACAO, 'enviada');
  assert.equal(e.stats.lockHeld, false);
});

test('Correção e reabertura de atividade coexistem com VIEW e publicam opções atuais depois da rotina', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  e.context.salvarAtividade(e.activity('A', {capacity: 30, status: 'encerrada'}));
  const token = Date.now() + '|rotina|VIEW'; e.properties.set('SEMINFO_FORM_REFRESH_PENDING', token);
  const result = e.context.salvarAtividade(e.activity('A', {capacity: 25, status: 'aberta'}));
  assert.equal(result.capacity, 25); assert.equal(result.status, 'aberta');
  assert.equal(e.context.consultarOcupacao()[0].ocupacao, 1);
  assert.equal(e.context.consultarOcupacao()[0].capacidade, 25);
  assert.equal(e.context.atualizarOpcoesFormularios().adiada, true);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), token);
  assert.equal(input.form.accepting, false, 'o Form aguarda a publicação das novas opções');
  e.properties.delete('SEMINFO_FORM_REFRESH_PENDING');
  e.context.atualizarOpcoesFormularios();
  assert.equal(input.form.accepting, true);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
});

test('Falha nas opções depois do cancelamento retorna sucesso com atualização adiada e preserva notificação', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  e.context.refreshFormsSafely_ = () => { throw new Error('Falha temporária nos Forms'); };
  let notified = 0;
  e.context.postProcessing_ = () => { notified++; };
  const result = e.context.cancelarInscricaoAdministrativa('52998224725', 'A', 'Membro do Centro Acadêmico.');
  assert.equal(result.code, 'canceled'); assert.equal(result.atualizacaoFormularios.adiada, true);
  assert.match(result.atualizacaoFormularios.motivo, /Falha temporária/);
  assert.equal(notified, 1); assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 0);
  assert.equal(e.context.tableRows_('Erros').at(-1).CONTEXTO, 'cancelamento-opcoes');
  assert.equal(e.stats.lockHeld, false);
});

test('Cancelamento e catálogo ainda respeitam atualização administrativa, instalação, limpeza e conta instaladora', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const head = e.context.readJournal_().head;
  for (const [key, value] of [
    ['SEMINFO_FORM_REFRESH_PENDING', Date.now() + '|administracao'],
    ['SEMINFO_INSTALL_PENDING', Date.now() + '|instalacao'],
    ['SEMINFO_RESET_PENDING', '{"phase":"backup"}']
  ]) {
    e.properties.set(key, value);
    assert.throws(() => e.context.cancelarInscricaoAdministrativa('52998224725', 'A', 'Membro do Centro Acadêmico.'), /andamento|interrompida/);
    assert.throws(() => e.context.salvarAtividade(e.activity('A', {capacity: 25})), /andamento|interrompida/);
    assert.equal(e.context.readJournal_().head, head);
    assert.equal(e.properties.get(key), value);
    e.properties.delete(key);
  }
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'outra@example.org'});
  assert.throws(() => e.context.cancelarInscricaoAdministrativa('52998224725', 'A', 'Membro do Centro Acadêmico.'), /conta que instalou/);
  assert.throws(() => e.context.salvarAtividade(e.activity('A', {capacity: 25})), /conta que instalou/);
  assert.equal(e.context.readJournal_().head, head);
});

test('Cancelamento revalida sob lock se uma instalação começar após a primeira autorização', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const head = e.context.readJournal_().head, getLock = e.context.LockService.getScriptLock;
  const token = Date.now() + '|nova-instalacao';
  e.context.LockService.getScriptLock = () => {
    const lock = getLock(), wait = lock.waitLock;
    lock.waitLock = () => { wait(); e.properties.set('SEMINFO_INSTALL_PENDING', token); };
    return lock;
  };
  assert.throws(() => e.context.cancelarInscricaoAdministrativa('52998224725', 'A', 'Membro do Centro Acadêmico.'), /instalação/);
  assert.equal(e.context.readJournal_().head, head); assert.equal(e.stats.lockHeld, false);
  assert.equal(e.properties.get('SEMINFO_INSTALL_PENDING'), token);
});

test('Mudanças administrativas de Forms e instalação continuam bloqueando decisões e varredura', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'), before = e.context.readJournal_().operations.length;
  e.context.withExternalFormOperation_(() => {
    assert.doesNotMatch(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), /\|VIEW$/);
    assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /atualização dos Forms/);
    assert.throws(() => e.context.processarSolicitacoesPendentes(), /atualização dos Forms/);
    assert.throws(() => e.context.refreshFormsSafely_(), /atualização dos Forms/);
  });
  e.properties.set('SEMINFO_INSTALL_PENDING', Date.now() + '|install');
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /instalação/);
  assert.throws(() => e.context.processarSolicitacoesPendentes(), /instalação/);
  assert.equal(e.context.readJournal_().operations.length, before);
  assert.equal(e.stats.lockHeld, false);
});

test('Marcador interrompido expira sem remover bloqueio ativo de outra execução', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO');
  const active = Date.now() + '|versao-antiga';
  e.properties.set('SEMINFO_FORM_REFRESH_PENDING', active);
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /atualização dos Forms/);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), active);
  e.properties.set('SEMINFO_FORM_REFRESH_PENDING', (Date.now() - 481000) + '|interrompida');
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  assert.equal(e.properties.has('SEMINFO_FORM_REFRESH_PENDING'), false);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
});

test('Revogação do corte após leitura impede confirmação durante atualização visual', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'), parse = e.context.parseFormRequest_;
  e.properties.set('SEMINFO_FORM_REFRESH_PENDING', Date.now() + '|refresh|VIEW');
  e.context.parseFormRequest_ = (...args) => {
    const request = parse(...args);
    e.properties.delete('SEMINFO_VERIFIED_SINCE_' + input.form.id);
    return request;
  };
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', input.form, input.response), /quarentena/);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 0);
  assert.equal(e.context.tableRows_('Solicitacoes').length, 0);
});

test('Confirmações são enviadas durante atualização visual e bloqueadas em configuração administrativa', () => {
  const e = environment();
  const sent = [];
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), e.context);
  e.context.MailApp.sendEmail = message => sent.push(message);
  e.begin();
  const input = e.response('INSCRICAO');
  const token = Date.now() + '|refresh|VIEW';
  e.properties.set('SEMINFO_FORM_REFRESH_PENDING', token);
  e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  assert.equal(e.context.processarNotificacoes().enviadas, 2, 'confirmação e aviso de última vaga ao CA');
  assert.equal(sent.filter(message => message.to === 'participante@example.org').length, 1);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), token);
  e.properties.delete('SEMINFO_FORM_REFRESH_PENDING');
  e.context.withExternalFormOperation_(() => {
    assert.throws(() => e.context.processarNotificacoes(), /atualização dos Forms/);
  });
});

test('Liberação do marcador só remove a operação que possui o mesmo token', () => {
  const e = environment();
  e.properties.set('SEMINFO_FORM_REFRESH_PENDING', 'token-atual');
  e.context.clearPendingOperation_('SEMINFO_FORM_REFRESH_PENDING', 'token-antigo');
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), 'token-atual');
  e.context.clearPendingOperation_('SEMINFO_FORM_REFRESH_PENDING', 'token-atual');
  assert.equal(e.properties.has('SEMINFO_FORM_REFRESH_PENDING'), false);
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

test('Renomear abas repete falha transitória do serviço Forms sem manter bloqueio global', () => {
  const e = environment(), entry = e.manualRegistration('A', {title: 'Atividade A'});
  entry.definition.title = 'Atividade A';
  e.configureExisting([entry], false);
  e.installed();
  const responseSheet = e.context.db_().insertSheet('Resposta ao formulário 8');
  responseSheet.formUrl = entry.form.getPublishedUrl();
  const openById = e.context.FormApp.openById;
  let attempts = 0;
  e.context.FormApp.openById = id => {
    assert.equal(e.stats.lockHeld, false, 'naming response tabs must not hold the script lock');
    attempts++;
    if (id === entry.form.id && attempts === 1) {
      throw new Error('Unexpected error while getting the method or property openById on object FormApp.');
    }
    return openById(id);
  };

  const result = e.context.sincronizarNomesAbasDeRespostas_();

  assert.equal(attempts, 2);
  assert.equal(result[0].aba, 'Respostas — Atividade A');
  assert.equal(responseSheet.getName(), 'Respostas — Atividade A');
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

test('onOpen cria o menu na planilha e oferece a configuração do e-mail verificado', () => {
  const e = environment(), items = [];
  let added = false;
  const menu = {addItem: (label, handler) => { items.push({label, handler}); return menu; },
    addSeparator: () => menu, addToUi: () => { added = true; }};
  e.context.SpreadsheetApp.getUi = () => ({createMenu: title => { assert.equal(title, 'SEMINFO'); return menu; }});
  e.context.onOpen();
  assert.equal(added, true);
  assert.ok(items.some(item => item.handler === 'configurarEmailVerificadoFormularios'));
  assert.ok(items.every(item => typeof e.context[item.handler] === 'function'));
  assert.equal(e.stats.formsCreated, 0);
  assert.equal(e.sheets.size, 0);
});

test('onOpen orienta sem interface, mas propaga erros diferentes e falhas ao criar menu', () => {
  const e = environment(), logs = [];
  e.context.console = {log: message => logs.push(message)};
  e.context.SpreadsheetApp.getUi = () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); };
  assert.doesNotThrow(() => e.context.onOpen());
  assert.match(logs[0], /Abra ou recarregue a planilha/);
  const failure = new Error('Acesso negado');
  e.context.SpreadsheetApp.getUi = () => { throw failure; };
  assert.throws(() => e.context.onOpen(), error => error === failure);
  e.context.SpreadsheetApp.getUi = () => ({createMenu() { throw failure; }});
  assert.throws(() => e.context.onOpen(), error => error === failure);
});

test('Configuração VERIFIED corrige vários Forms sem perder inscrições ou promover respostas históricas', () => {
  const e = environment(), entries = Array.from({length: 5}, () => e.manualRegistration('A'));
  e.configureExisting(entries, false); e.installed();
  e.context.salvarAtividade(e.activity()); e.context.abrirInscricoes();
  const confirmed = e.responseFrom(entries[0]);
  e.context.processFormResponse_('INSCRICAO', confirmed.form, confirmed.response);
  const historic = e.responseFrom(entries[1], {timestamp: new Date('2020-01-01T00:00:00Z')});
  const cutoff = e.properties.get('SEMINFO_VERIFIED_SINCE_' + entries[0].form.id);
  const operations = JSON.stringify(e.context.readJournal_().operations);
  const snapshot = () => entries.map(({form}) => ({id: form.id, title: form.title, destination: form.destination,
    items: form.items.map(item => item.id), responses: form.responses.map(response => response.getId())}));
  const before = snapshot(), created = e.stats.formsCreated, destinations = e.stats.destinations;
  for (const {form} of entries.slice(1)) form.mode = 'RESPONDER_INPUT';
  const result = e.context.configurarEmailVerificadoFormularios();
  assert.equal(result.total, 5); assert.equal(result.alterados, 4);
  assert.equal(e.stats.formUpdates, 4);
  assert.deepEqual(snapshot(), before);
  assert.equal(JSON.stringify(e.context.readJournal_().operations), operations);
  assert.equal(e.stats.formsCreated, created); assert.equal(e.stats.destinations, destinations);
  assert.equal(e.properties.get('SEMINFO_VERIFIED_SINCE_' + entries[0].form.id), cutoff);
  assert.equal(e.properties.has('SEMINFO_FORMS_ACTIVATED'), false);
  for (const {form} of entries) { assert.equal(form.mode, 'VERIFIED'); assert.equal(form.accepting, false); }
  for (const {form} of entries.slice(1)) assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + form.id), false);
  assert.equal(e.context.configurarEmailVerificadoFormularios().alterados, 0);
  assert.equal(e.stats.formUpdates, 4, 'repetição não altera novamente a coleta');
  assert.equal(e.context.conferirSistema().forms.length, 5);
  e.context.abrirInscricoes();
  assert.equal(e.properties.get('SEMINFO_VERIFIED_SINCE_' + entries[0].form.id), cutoff);
  for (const {form} of entries.slice(1)) assert.ok(e.properties.has('SEMINFO_VERIFIED_SINCE_' + form.id));
  assert.throws(() => e.context.processFormResponse_('INSCRICAO', historic.form, historic.response), /quarentena/);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'appsscript.json'), 'utf8'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/forms.body'));
});

test('Configuração VERIFIED trata coleta desativada e inclui o Form de cancelamento', () => {
  const e = environment('DO_NOT_COLLECT'); e.installed();
  const result = e.context.configurarEmailVerificadoFormularios();
  assert.equal(result.total, 2); assert.equal(result.alterados, 2);
  for (const form of e.forms.values()) {
    assert.equal(form.collect, true); assert.equal(form.mode, 'VERIFIED'); assert.equal(form.accepting, false);
    assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + form.id), false);
  }
});

test('Falha na leitura ou atualização VERIFIED mantém Forms fechados e permite retomar sem duplicar recursos', () => {
  for (const stage of ['get', 'post']) {
    const e = environment(); e.begin();
    const form = e.forms.values().next().value;
    form.mode = 'RESPONDER_INPUT';
    if (stage === 'get') form.httpCode = 403;
    else form.updateHttpCode = 403;
    assert.throws(() => e.context.configurarEmailVerificadoFormularios(), error => /HTTP 403/.test(error.message) && !/MOCK_TOKEN/.test(error.message));
    assert.equal(e.properties.has('SEMINFO_FORMS_ACTIVATED'), false);
    for (const entry of e.forms.values()) assert.equal(entry.accepting, false);
    if (stage === 'post') assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + form.id), false);
    delete form.httpCode; delete form.updateHttpCode;
    assert.equal(e.context.configurarEmailVerificadoFormularios().alterados, 1);
    assert.equal(e.forms.size, 2);
    assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + form.id), false);
  }
});

test('Resposta HTTP 200 sem coleta VERIFIED não é tratada como configuração confirmada', () => {
  const e = environment(); e.begin();
  const form = e.forms.values().next().value;
  form.mode = 'RESPONDER_INPUT'; form.ignoreVerifiedUpdate = true;
  assert.throws(() => e.context.configurarEmailVerificadoFormularios(), /Configure o e-mail verificado/);
  assert.equal(e.properties.has('SEMINFO_FORMS_ACTIVATED'), false);
  assert.equal(e.properties.has('SEMINFO_VERIFIED_SINCE_' + form.id), false);
  for (const entry of e.forms.values()) assert.equal(entry.accepting, false);
});

test('Outra conta não pode configurar VERIFIED nem fechar Forms em produção', () => {
  const e = environment(); e.begin();
  const locks = e.stats.locks;
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'outra@example.org'});
  assert.throws(() => e.context.configurarEmailVerificadoFormularios(), /conta que instalou/);
  assert.equal(e.stats.locks, locks); assert.equal(e.stats.formUpdates, 0);
  assert.equal(e.properties.get('SEMINFO_FORMS_ACTIVATED'), 'true');
  for (const form of e.forms.values()) assert.equal(form.accepting, true);
});

test('Atividade lotada sai da inscrição, permanece no cancelamento e retorna após liberação da vaga', () => {
  const e = environment(); e.begin();
  assert.equal(e.context.tableRows_('Atividades')[0].SITUACAO, 'aberta');
  const input = e.response('INSCRICAO');
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  const cancelForm = e.forms.get(e.context.getConfig_().ID_FORM_CANCELAMENTO);
  assert.equal(input.form.accepting, false);
  assert.equal(e.context.tableRows_('Atividades')[0].SITUACAO, 'lotada');
  assert.equal(e.context.consultarOcupacao()[0].situacao, 'lotada');
  assert.equal(e.context.consultarOcupacao()[0].situacaoCadastro, 'aberta');
  assert.equal(e.context.getStoredFormItem_(cancelForm, 'CANCELAMENTO', 'ACTIVITY').choices.some(choice => choice.startsWith('[A] ')), true);
  const stale = e.response('INSCRICAO', { email: 'outra@example.org', answers: { CPF: '11144477735' } });
  assert.equal(e.context.processFormResponse_('INSCRICAO', stale.form, stale.response).code, 'full');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  const cancel = e.response('CANCELAMENTO');
  assert.equal(e.context.processFormResponse_('CANCELAMENTO', cancel.form, cancel.response).code, 'canceled');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 0);
  assert.equal(input.form.accepting, true);
  assert.equal(e.context.tableRows_('Atividades')[0].SITUACAO, 'aberta');
  assert.equal(e.context.consultarOcupacao()[0].situacao, 'aberta');
  assert.equal(e.context.getStoredFormItem_(input.form, 'INSCRICAO', 'ACTIVITY').choices[0].includes('Vagas: 1'), true);
  e.context.encerrarInscricoes();
  assert.equal(input.form.accepting, false); assert.equal(cancelForm.accepting, true);
  assert.equal(e.context.tableRows_('Atividades')[0].SITUACAO, 'encerrada');
  assert.equal(e.context.consultarOcupacao()[0].situacao, 'encerrada');
});

test('Situação de consulta acompanha fechamento global e preserva encerramentos, cancelamentos e pendências do cadastro', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  e.context.salvarAtividade(e.activity('B', {capacity: 25}));
  e.context.salvarAtividade(e.activity('C', {status: 'encerrada'}));
  e.context.salvarAtividade(e.activity('D', {status: 'cancelada'}));
  e.context.salvarAtividade(e.activity('E', {status: 'pendente', capacity: null, start: '', end: ''}));
  function statuses() { return Object.fromEntries(e.context.tableRows_('Atividades').map(row => [row.ID, row.SITUACAO])); }
  const open = {A: 'lotada', B: 'aberta', C: 'encerrada', D: 'cancelada', E: 'pendente'};
  assert.deepEqual(statuses(), open);
  e.context.encerrarInscricoes();
  assert.deepEqual(statuses(), {...open, A: 'encerrada', B: 'encerrada'});
  assert.deepEqual(Object.fromEntries(Array.from(e.context.consultarOcupacao(), row => [row.id, row.situacao])), statuses());
  e.context.abrirInscricoes();
  assert.deepEqual(statuses(), open);
  const head = e.context.readJournal_().head;
  e.context.withLock_(() => e.context.rebuildViewsLocked_(e.context.readJournal_()));
  assert.deepEqual(statuses(), open);
  assert.equal(e.context.readJournal_().head, head, 'recalcular situação não grava mudança no catálogo');
  assert.equal(e.context.readState_().activities.A.status, 'aberta');
  e.context.salvarAtividade(e.activity('A', {status: 'encerrada'}));
  assert.equal(statuses().A, 'encerrada', 'fechamento administrativo prevalece sobre a lotação');
  const cancel = e.response('CANCELAMENTO'); e.context.processFormResponse_('CANCELAMENTO', cancel.form, cancel.response);
  assert.equal(statuses().A, 'encerrada', 'vaga liberada não desfaz fechamento administrativo');
  assert.equal(e.context.consultarOcupacao().find(row => row.id === 'A').ocupacao, 0);
});

test('Encerramento de 27 à tarde abrange palestras e oficinas, preserva dados e sincroniza Forms uma vez', () => {
  const e = environment(), ollama = e.manualRegistration('OFICINA_OLLAMA'), night = e.manualRegistration('OFICINA_JOGOS_NOITE');
  e.configureExisting([ollama, night], false); e.installed(); e.context.carregarProgramacaoSeminfo2026();
  e.context.salvarAtividade({...e.context.readState_().activities.OFICINA_OLLAMA, capacity: 18});
  e.context.salvarAtividade({...e.context.readState_().activities.OFICINA_IA_ALEM_CHAT, status: 'encerrada'});
  for (const activity of [
    e.activity('PALESTRA_12', {type: 'palestra', start: '2026-10-27T15:00:00Z', end: '2026-10-27T16:00:00Z'}),
    e.activity('PALESTRA_18', {type: 'palestra', start: '2026-10-27T21:00:00Z', end: '2026-10-27T22:00:00Z'}),
    e.activity('MANHA', {start: '2026-10-27T11:00:00-03:00', end: '2026-10-27T12:00:00-03:00'}),
    e.activity('DIA_26', {start: '2026-10-26T13:00:00-03:00', end: '2026-10-26T17:00:00-03:00'}),
    e.activity('OUTRO_TIPO', {type: 'programacao', start: '2026-10-27T13:00:00-03:00', end: '2026-10-27T17:00:00-03:00'}),
    e.activity('CANCELADA', {status: 'cancelada', start: '2026-10-27T13:00:00-03:00', end: '2026-10-27T17:00:00-03:00'})
  ]) e.context.salvarAtividade(activity);
  e.context.abrirInscricoes();
  const input = e.responseFrom(ollama);
  e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const before = e.context.readJournal_(), queueSyncs = e.stats.queueSyncs;
  const targetIds = ['OFICINA_GAMEMAKER', 'OFICINA_YASMIN_GABRIEL', 'OFICINA_BLENDER', 'OFICINA_OLLAMA', 'OFICINA_C', 'PALESTRA_12'];
  const result = e.context.encerrarAtividades27Tarde(), after = e.context.readJournal_();
  assert.deepEqual(Array.from(result.encerradas).sort(), targetIds.sort());
  assert.equal(result.jaBloqueadas.find(row => row.id === 'PALESTRA_BIO').situacao, 'pendente');
  for (const [id, activity] of Object.entries(before.state.activities)) {
    const expected = targetIds.includes(id) ? {...activity, status: 'encerrada'} : activity;
    assert.equal(JSON.stringify(after.state.activities[id]), JSON.stringify(expected), id);
  }
  assert.equal(JSON.stringify(after.state.registrations), JSON.stringify(before.state.registrations));
  assert.equal(JSON.stringify(after.state.participants), JSON.stringify(before.state.participants));
  assert.equal(after.state.accepting, before.state.accepting);
  assert.equal(after.operations.length, before.operations.length + targetIds.length);
  assert.equal(ollama.form.accepting, false); assert.equal(night.form.accepting, true);
  assert.equal(result.atualizacaoFormularios.atualizados, 2);
  assert.equal(e.stats.queueSyncs, queueSyncs + 1);
  assert.equal(e.stats.formOpensWhileLocked, 0);
  assert.equal(e.context.encerrarAtividades27Tarde().encerradas.length, 0);
  assert.equal(e.context.readJournal_().head, after.head, 'repetição não duplica alterações');
  assert.equal(e.stats.queueSyncs, queueSyncs + 1);
});

test('Encerramento de 27 à tarde conserva decisões se os Forms falharem e permite retomar a sincronização', () => {
  const e = environment(); e.installed();
  e.context.salvarAtividade(e.activity('A', {start: '2026-10-27T13:00:00-03:00', end: '2026-10-27T17:00:00-03:00'}));
  e.context.abrirInscricoes();
  const refresh = e.context.refreshFormsSafely_;
  e.context.refreshFormsSafely_ = () => { throw new Error('Forms temporariamente indisponível'); };
  const result = e.context.encerrarAtividades27Tarde();
  assert.equal(e.context.readState_().activities.A.status, 'encerrada');
  assert.equal(result.atualizacaoFormularios.adiada, true);
  assert.match(result.atualizacaoFormularios.motivo, /temporariamente indisponível/);
  const head = e.context.readJournal_().head;
  e.context.refreshFormsSafely_ = refresh;
  assert.equal(e.context.encerrarAtividades27Tarde().atualizacaoFormularios.adiada, false);
  assert.equal(e.forms.get(e.context.getConfig_().ID_FORM_INSCRICAO).accepting, false);
  assert.equal(e.context.readJournal_().head, head);
});

test('Encerramento de 27 à tarde exige a conta instaladora antes de alterar o catálogo', () => {
  const e = environment(); e.installed();
  const head = e.context.readJournal_().head;
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'outra@example.org'});
  assert.throws(() => e.context.encerrarAtividades27Tarde(), /conta que instalou/);
  assert.equal(e.context.readJournal_().head, head);
});

test('Listas de 27 à tarde incluem somente confirmados, preservam o livro e usam uma única leitura do estado', () => {
  const e = environment(); e.installed(); e.context.carregarProgramacaoSeminfo2026(); e.context.abrirInscricoes();
  e.context.Utilities.getUuid = () => crypto.randomUUID();
  for (const overrides of [
    {email: 'ana@example.org', answers: {NAME: 'Ana Exemplo', CPF: '01234567890', ACTIVITY: '[OFICINA_OLLAMA] Ollama'}},
    {email: 'outra@example.org', answers: {NAME: 'Pessoa Cancelada', CPF: '11144477735', ACTIVITY: '[OFICINA_OLLAMA] Ollama'}},
    {email: 'ana@example.org', answers: {NAME: 'Ana Exemplo', CPF: '01234567890', ACTIVITY: '[OFICINA_JOGOS_NOITE] Jogos'}}
  ]) {
    const input = e.response('INSCRICAO', overrides);
    assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  }
  e.context.cancelarInscricaoAdministrativa('11144477735', 'OFICINA_OLLAMA', 'Cancelamento a pedido da pessoa.');
  e.context.encerrarAtividades27Tarde();
  const oldUrl = e.context.exportarConfirmados('OFICINA_OLLAMA');
  const oldSheet = [...e.sheets.values()].find(sheet => oldUrl.endsWith('#gid=' + sheet.getSheetId()));
  const oldCells = JSON.stringify(oldSheet.cells), before = e.context.readJournal_();
  const readState = e.context.readState_;
  let reads = 0;
  e.context.readState_ = () => { reads++; return readState(); };
  const report = e.context.exportarListas27Tarde();
  assert.equal(reads, 1);
  assert.equal(report.totalAtividades, 7); assert.equal(report.listasGeradas, 7);
  assert.equal(report.totalInscritos, 1); assert.equal(report.falhas.length, 0); assert.equal(report.parcial, false);
  assert.deepEqual(Array.from(report.listas, list => list.activityId).sort(), [
    'OFICINA_BLENDER', 'OFICINA_C', 'OFICINA_GAMEMAKER', 'OFICINA_IA_ALEM_CHAT',
    'OFICINA_OLLAMA', 'OFICINA_YASMIN_GABRIEL', 'PALESTRA_BIO'
  ]);
  for (const list of report.listas) {
    const sheet = e.sheets.get(list.aba);
    assert.equal(list.url, 'https://example.org/sheet#gid=' + sheet.getSheetId());
    assert.deepEqual(sheet.cells[0], ['NOME', 'EMAIL', 'CPF', 'INSCRICAO']);
    assert.deepEqual(sheet.protections[0].editors, ['ca@example.org']);
    assert.equal(sheet.protections[0].domain, false);
    assert.equal(sheet.getLastRow(), list.inscritos + 1);
  }
  const ollama = e.sheets.get(report.listas.find(list => list.activityId === 'OFICINA_OLLAMA').aba);
  assert.deepEqual(ollama.cells[1].slice(0, 3), ['Ana Exemplo', 'ana@example.org', '01234567890']);
  assert.equal(JSON.stringify(e.context.readJournal_()), JSON.stringify(before));
  assert.equal(JSON.stringify(oldSheet.cells), oldCells);
  assert.equal(e.context.exportarListas27Tarde().listasGeradas, 7);
  assert.equal([...e.sheets.keys()].filter(name => name.startsWith('Lista_')).length, 15);
  assert.equal(JSON.stringify(oldSheet.cells), oldCells, 'repetição cria novas fotografias');
});

test('Listas de 27 à tarde registram falha de uma exportação e continuam nas atividades seguintes', () => {
  const e = environment(); e.installed(); e.context.carregarProgramacaoSeminfo2026();
  const exportList = e.context.exportarConfirmadosDoEstado_;
  e.context.exportarConfirmadosDoEstado_ = (state, id) => {
    if (id === 'OFICINA_BLENDER') throw new Error('Falha temporária na exportação');
    return exportList(state, id);
  };
  const report = e.context.exportarListas27Tarde();
  assert.equal(report.totalAtividades, 7); assert.equal(report.listasGeradas, 6); assert.equal(report.parcial, true);
  assert.equal(report.falhas.length, 1); assert.equal(report.falhas[0].activityId, 'OFICINA_BLENDER');
  assert.match(report.falhas[0].motivo, /Falha temporária/);
  assert.ok(report.listas.some(list => list.activityId === 'OFICINA_OLLAMA'));
  assert.ok(report.listas.some(list => list.activityId === 'PALESTRA_BIO'));
  assert.equal(e.context.tableRows_('Erros').at(-1).CONTEXTO, 'exportar-listas-27-tarde');
});

test('Listas de 27 à tarde exigem a conta instaladora antes de exportar dados', () => {
  const e = environment(); e.installed(); e.context.carregarProgramacaoSeminfo2026();
  const before = [...e.sheets.keys()];
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'outra@example.org'});
  assert.throws(() => e.context.exportarListas27Tarde(), /conta que instalou/);
  assert.deepEqual([...e.sheets.keys()], before);
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

test('Consulta isolada de cota funciona com Forms inacessíveis, gatilhos ausentes e instalação interrompida', () => {
  const e = environment(); e.begin();
  e.triggers.splice(0);
  e.properties.set('SEMINFO_INSTALL_PENDING', Date.now() + '|interrompida');
  e.properties.set('SEMINFO_RESET_PENDING', '{"phase":"backup"}');
  const snapshots = JSON.stringify({properties: [...e.properties], sheets: [...e.sheets].map(([name, sheet]) => [name, sheet.cells])});
  e.context.FormApp.openById = () => { throw new Error('Forms indisponível'); };
  e.context.getConfig_ = () => { throw new Error('Configuração indisponível'); };
  e.context.ScriptApp.getProjectTriggers = () => { throw new Error('Gatilhos indisponíveis'); };
  e.context.console = {log: () => {}};
  e.context.MailApp.getRemainingDailyQuota = () => 0;
  const exhausted = e.context.consultarCotaEmails();
  assert.equal(exhausted.destinatariosRestantes, 0);
  assert.equal(exhausted.cotaEsgotada, true);
  e.context.MailApp.getRemainingDailyQuota = () => 37;
  const available = e.context.consultarCotaEmails();
  assert.equal(available.destinatariosRestantes, 37);
  assert.equal(available.cotaEsgotada, false);
  assert.ok(Number.isFinite(Date.parse(available.consultadaEm)));
  assert.equal(JSON.stringify({properties: [...e.properties], sheets: [...e.sheets].map(([name, sheet]) => [name, sheet.cells])}), snapshots);
});

test('Consulta isolada de cota e reparo continuam exclusivos da conta instaladora', () => {
  const e = environment();
  assert.throws(() => e.context.consultarCotaEmails(), /conta que instalou/);
  assert.throws(() => e.context.repararGatilhos(), /conta que instalou/);
  e.installed();
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'outra@example.org'});
  e.context.MailApp.getRemainingDailyQuota = () => { assert.fail('não deve consultar a cota de outra conta'); };
  assert.throws(() => e.context.consultarCotaEmails(), /conta que instalou/);
  assert.throws(() => e.context.repararGatilhos(), /conta que instalou/);
});

test('Reparo recupera gatilhos de muitos Forms sem abri-los, preserva dados e gatilhos externos', () => {
  const e = environment(), entries = Array.from({length: 13}, () => e.manualRegistration('A'));
  e.configureExisting(entries); e.installed();
  e.context.salvarAtividade(e.activity()); e.context.abrirInscricoes();
  const input = e.responseFrom(entries[0]); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const external = {getHandlerFunction: () => 'outraAutomacao', getEventType: () => 'CLOCK', getTriggerSourceId: () => ''};
  e.triggers.push(external);
  e.triggers.splice(e.triggers.findIndex(trigger => trigger.getHandlerFunction() === 'manutencaoPeriodica'), 1);
  e.triggers.push({getHandlerFunction: () => 'aoEnviarInscricao', getEventType: () => 'ON_FORM_SUBMIT', getTriggerSourceId: () => 'OUTRO_FORM'});
  const original = e.triggers.find(trigger => trigger.getHandlerFunction() === 'aoEnviarInscricao');
  e.triggers.push({...original});
  const snapshot = JSON.stringify({properties: [...e.properties], sheets: [...e.sheets].map(([name, sheet]) => [name, sheet.cells]),
    forms: [...e.forms.values()], queueSyncs: e.stats.queueSyncs});
  e.context.FormApp.openById = () => { assert.fail('reparo não deve abrir Forms'); };
  e.context.setupForms_ = e.context.rebuildViewsLocked_ = e.context.refreshFormsLocked_ = () => { assert.fail('reparo não deve reinstalar'); };
  e.context.console = {log: () => {}};
  const result = e.context.repararGatilhos();
  assert.equal(result.criados, 1); assert.equal(result.removidos, 2); assert.equal(result.total, 15);
  assert.equal(e.triggers.length, 16); assert.ok(e.triggers.includes(external));
  assert.equal(e.stats.lockHeld, false);
  assert.equal(JSON.stringify({properties: [...e.properties], sheets: [...e.sheets].map(([name, sheet]) => [name, sheet.cells]),
    forms: [...e.forms.values()], queueSyncs: e.stats.queueSyncs}), snapshot);
  const again = e.context.repararGatilhos();
  assert.equal(again.criados, 0); assert.equal(again.removidos, 0); assert.equal(again.mantidos, 15);
});

test('Reparo respeita instalação, limpeza e atualização administrativa ativas, mas permite projeção VIEW', () => {
  const e = environment(); e.installed(); e.context.console = {log: () => {}};
  for (const [key, value] of [
    ['SEMINFO_INSTALL_PENDING', Date.now() + '|install'],
    ['SEMINFO_FORM_REFRESH_PENDING', Date.now() + '|admin'],
    ['SEMINFO_RESET_PENDING', '{"phase":"backup"}']
  ]) {
    e.properties.set(key, value);
    assert.throws(() => e.context.repararGatilhos(), /andamento|interrompida/);
    assert.equal(e.triggers.length, 3);
    e.properties.delete(key);
  }
  const token = Date.now() + '|routine|VIEW'; e.properties.set('SEMINFO_FORM_REFRESH_PENDING', token);
  e.triggers.splice(0);
  assert.equal(e.context.repararGatilhos().criados, 3);
  assert.equal(e.properties.get('SEMINFO_FORM_REFRESH_PENDING'), token);
});

test('Reparo recusa Form com instalação incompleta antes de alterar gatilhos', () => {
  const e = environment(), entry = e.manualRegistration('A');
  e.configureExisting([entry]); e.installed();
  const next = e.manualRegistration('B');
  e.context.setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify([entry.definition, next.definition]));
  const before = [...e.triggers], created = e.stats.triggersCreated;
  assert.throws(() => e.context.repararGatilhos(), /instalação.*incompleta/);
  assert.deepEqual(e.triggers, before); assert.equal(e.stats.triggersCreated, created);
  assert.equal(e.stats.lockHeld, false);
});

test('Falha durante criação de gatilhos libera lock e nova tentativa completa apenas os ausentes', () => {
  const e = environment(); e.installed(); e.triggers.splice(0); e.context.console = {log: () => {}};
  const create = e.context.ScriptApp.newTrigger; let calls = 0;
  e.context.ScriptApp.newTrigger = handler => {
    if (++calls === 2) throw new Error('Falha simulada no serviço de gatilhos');
    return create(handler);
  };
  assert.throws(() => e.context.repararGatilhos(), /Falha simulada/);
  assert.equal(e.stats.lockHeld, false); assert.equal(e.triggers.length, 1);
  e.context.ScriptApp.newTrigger = create;
  const result = e.context.repararGatilhos();
  assert.equal(result.criados, 2); assert.equal(result.mantidos, 1);
  assert.equal(e.triggers.length, 3);
});

function reassessmentEnvironment(confirmed = 21, refused = 6, realNotifications = false) {
  const e = environment(); e.context.console = {log: () => {}, error: () => {}};
  if (realNotifications) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), e.context);
  e.installed(); e.context.salvarAtividade(e.activity('A', {capacity: 30})); e.context.abrirInscricoes();
  function cpfFor(index) {
    const digits = String(100000000 + index).split('').map(Number);
    for (let length = 9; length < 11; length++) {
      const remainder = digits.reduce((sum, digit, i) => sum + digit * (length + 1 - i), 0) % 11;
      digits.push(remainder < 2 ? 0 : 11 - remainder);
    }
    return digits.join('');
  }
  let sequence = 0;
  function submit(index, changes = {}) {
    const input = e.response('INSCRICAO', {timestamp: new Date(Date.now() + 10000 + (++sequence) * 1000),
      email: changes.email || 'pessoa' + index + '@example.org',
      answers: {CPF: cpfFor(index), NAME: 'Pessoa ' + index, ...changes.answers}});
    return {...input, result: e.context.processFormResponse_('INSCRICAO', input.form, input.response, true)};
  }
  for (let index = 1; index <= confirmed; index++) assert.equal(submit(index).result.code, 'confirmed');
  e.context.salvarAtividade(e.activity('A', {capacity: 30, status: 'encerrada'}));
  const rejected = [];
  for (let index = confirmed + 1; index <= confirmed + refused; index++) {
    const input = submit(index); assert.equal(input.result.code, 'closed'); rejected.push(input);
  }
  return {...e, submit, cpfFor, rejected};
}

test('Prévia reavalia recusas em ordem de envio e prevê somente quatro vagas até 25, sem gravar decisões', () => {
  const e = reassessmentEnvironment(), before = e.context.readJournal_(), syncs = e.stats.queueSyncs;
  const preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  assert.equal(preview.ocupacaoAtual, 21); assert.equal(preview.novasConfirmacoes, 4);
  assert.equal(preview.ocupacaoPrevista, 25); assert.equal(preview.vagasRestantes, 0);
  assert.equal(preview.resultados.ja_confirmada, 21); assert.equal(preview.resultados.full, 2);
  assert.deepEqual(Array.from(preview.solicitacoes.filter(row => row.resultadoPrevisto === 'confirmed'), row => row.nome),
    ['Pessoa 22', 'Pessoa 23', 'Pessoa 24', 'Pessoa 25']);
  assert.equal(e.context.readJournal_().head, before.head); assert.equal(e.stats.queueSyncs, syncs);
  assert.equal(e.context.readState_().activities.A.capacity, 30);
  assert.equal(e.context.programacaoSeminfo2026_().find(activity => activity.id === 'OFICINA_IA_ALEM_CHAT').capacity, 25);
});

test('Confirmação limita a 25, mantém Form fechado, audita origem e cria só os quatro novos avisos', () => {
  const e = reassessmentEnvironment(21, 6, true), sent = [];
  e.context.MailApp.sendEmail = message => sent.push(message);
  e.context.FormApp.openById = () => { assert.fail('reavaliação não deve reconfigurar Forms'); };
  const preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  const result = e.context.confirmarReavaliacaoInscricoes('A', 25, preview.token, 'Correção de capacidade e reavaliação autorizada.');
  assert.equal(result.ocupacao, 25); assert.equal(result.novasConfirmacoes, 4); assert.equal(result.situacao, 'encerrada');
  const journal = e.context.readJournal_(), revised = journal.operations.filter(operation => operation.reassessmentOf);
  assert.equal(revised.length, 4); assert.equal(journal.state.accepting, true);
  for (const operation of revised) {
    assert.equal(journal.byKey[operation.reassessmentOf].outcome.code, 'closed');
    assert.equal(operation.request.authorizeSwap, false); assert.equal(operation.reassessedBy, 'ca@example.org');
    assert.equal(operation.outcome.changes.length, 1); assert.equal(operation.outcome.changes[0].type, 'CONFIRM');
    assert.equal(operation.outcome.changes[0].registration.activity.capacity, 25);
  }
  const queue = e.context.tableRows_('FilaEmails');
  assert.equal(queue.filter(row => revised.some(operation => row.ID === 'MAIL:' + operation.key)).length, 4);
  assert.equal(queue.filter(row => row.ID.startsWith('MAIL:CAPACIDADE:')).length, 1);
  assert.equal(e.forms.get(e.context.getConfig_().ID_FORM_INSCRICAO).accepting, false);
  assert.equal(sent.length, 0);
  const again = e.context.prepararReavaliacaoInscricoes('A', 25), head = journal.head;
  assert.equal(again.novasConfirmacoes, 0);
  e.context.confirmarReavaliacaoInscricoes('A', 25, again.token, 'Repetição da conferência administrativa.');
  assert.equal(e.context.readJournal_().head, head);
  assert.equal(e.context.tableRows_('FilaEmails').length, queue.length);
});

test('Reavaliação preserva cancelamentos, trocas, escolhas posteriores e recusas de identidade', () => {
  const e = reassessmentEnvironment(2, 0);
  e.context.cancelarInscricaoAdministrativa(e.cpfFor(1), 'A', 'Membro da organização.');
  e.submit(1); // Nova recusa por fechamento não anula o cancelamento.
  e.context.salvarAtividade(e.activity('B', {capacity: 10}));
  assert.equal(e.submit(2, {answers: {ACTIVITY: '[B] Atividade B', SWAP: e.context.SEMINFO_FORM_TEXT_.SWAP_YES}}).result.code, 'swapped');
  e.submit(3);
  assert.equal(e.submit(3, {answers: {ACTIVITY: '[B] Atividade B'}}).result.code, 'confirmed');
  assert.equal(e.submit(4, {answers: {ACTIVITY: '[B] Atividade B'}}).result.code, 'confirmed');
  assert.equal(e.submit(4, {email: 'outra-pessoa@example.org'}).result.code, 'identity_mismatch');
  e.submit(5);
  const preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  assert.equal(preview.novasConfirmacoes, 1);
  assert.equal(preview.resultados.cancelada_ou_trocada, 2);
  assert.equal(preview.resultados.conflict, 1); assert.equal(preview.resultados.outra_recusa, 1);
  e.context.confirmarReavaliacaoInscricoes('A', 25, preview.token, 'Conferência das solicitações recusadas.');
  const state = e.context.readState_();
  assert.equal(e.context.SemDomain.occupancy(state, 'A'), 1);
  assert.equal(e.context.SemDomain.occupancy(state, 'B'), 3);
  assert.equal(e.context.SemDomain.confirmedFor(state, e.cpfFor(1)).length, 0);
});

test('Reavaliação recusa prévia desatualizada, capacidade abaixo da ocupação, outra conta e atividade aberta', () => {
  const e = reassessmentEnvironment(2, 1), head = e.context.readJournal_().head;
  assert.throws(() => e.context.prepararReavaliacaoInscricoes('A', 1), /Capacidade/);
  assert.equal(e.context.readJournal_().head, head);
  let preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  assert.throws(() => e.context.confirmarReavaliacaoInscricoes('A', 25, 'outro-token', 'Conferência administrativa.'), /mudaram/);
  e.context.setConfig_('EMAIL_CA', 'novo@example.org'); // Mudança de endereço de atendimento não decide vagas.
  e.context.salvarAtividade(e.activity('B'));
  assert.throws(() => e.context.confirmarReavaliacaoInscricoes('A', 25, preview.token, 'Conferência administrativa.'), /mudaram/);
  preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  e.properties.set('SEMINFO_VERIFIED_SINCE_' + e.context.getConfig_().ID_FORM_INSCRICAO, new Date(Date.now() + 86400000).toISOString());
  assert.throws(() => e.context.confirmarReavaliacaoInscricoes('A', 25, preview.token, 'Conferência administrativa.'), /mudaram/);
  assert.equal(e.context.prepararReavaliacaoInscricoes('A', 25).novasConfirmacoes, 0);
  assert.equal(e.context.readState_().activities.A.capacity, 30);
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'outra@example.org'});
  assert.throws(() => e.context.prepararReavaliacaoInscricoes('A', 25), /conta que instalou/);
  assert.throws(() => e.context.confirmarReavaliacaoInscricoes('A', 25, preview.token, 'Conferência administrativa.'), /conta que instalou/);
  e.context.Session.getEffectiveUser = () => ({getEmail: () => 'ca@example.org'});
  e.context.salvarAtividade(e.activity('A', {capacity: 30}));
  assert.throws(() => e.context.prepararReavaliacaoInscricoes('A', 25), /encerrada/);
});

test('Reavaliação usa só a última solicitação por CPF e mantém respostas anteriores ao corte fora da decisão', () => {
  const e = reassessmentEnvironment(0, 1);
  e.submit(1); e.submit(2);
  let preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  assert.equal(preview.novasConfirmacoes, 2); assert.equal(preview.solicitacoes.length, 2);
  const id = e.context.getConfig_().ID_FORM_INSCRICAO;
  e.properties.delete('SEMINFO_VERIFIED_SINCE_' + id);
  preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  assert.equal(preview.novasConfirmacoes, 0); assert.equal(preview.resultados.origem_nao_elegivel, 2);
});

test('Interrupção após gravar uma reavaliação retoma em nova prévia sem duplicar inscrição', () => {
  const e = reassessmentEnvironment(21, 4), commit = e.context.commitOperationLocked_;
  const preview = e.context.prepararReavaliacaoInscricoes('A', 25);
  e.context.commitOperationLocked_ = (journal, operation) => {
    const saved = commit(journal, operation);
    if (operation.reassessmentOf) throw new Error('Interrupção após gravação');
    return saved;
  };
  assert.throws(() => e.context.confirmarReavaliacaoInscricoes('A', 25, preview.token, 'Conferência administrativa.'), /Interrupção/);
  assert.equal(e.stats.lockHeld, false);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 22);
  e.context.commitOperationLocked_ = commit;
  const resumed = e.context.prepararReavaliacaoInscricoes('A', 25);
  assert.equal(resumed.novasConfirmacoes, 3);
  e.context.confirmarReavaliacaoInscricoes('A', 25, resumed.token, 'Retomada da conferência administrativa.');
  const journal = e.context.readJournal_();
  assert.equal(e.context.SemDomain.occupancy(journal.state, 'A'), 25);
  assert.equal(journal.operations.filter(operation => operation.reassessmentOf).length, 4);
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

test('Inventário de Forms lista a fonte histórica da CSP sem instalá-la como inscrição individual', () => {
  const e = teamCspEnvironment();
  const activeSources = e.context.getFormSources_();
  const listed = e.context.listarPerguntasDosFormularios();
  const csp = listed.find(source => source.id === e.form.id);
  assert.ok(csp);
  assert.equal(csp.kind, 'IMPORTACAO_CSP');
  assert.equal(csp.activityId, 'CSP_2026');
  assert.equal(csp.title, 'Inscrição CSP por equipe');
  assert.equal(activeSources.some(source => source.id === e.form.id), false);
  assert.equal(e.properties.has('SEMINFO_FORM_ACTIVITY_' + e.form.id), false);
});

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

function savedCspMemberRows(e, responseId = 'SAVED_R1') {
  const id = e.form.id + ':' + responseId + ':equipe';
  return [Array.from(e.context.SEMINFO_TABLES.IntegrantesEquipes),
    [id, 'Equipe salva', '52998224725', 'Coach Exemplo', 'coach', '', '', 'Coach Exemplo - 52998224725'],
    [id, 'Equipe salva', '01234567890', 'Pessoa Exemplo', 'integrante', 'Turma A', '35999999999', 'Pessoa Exemplo\n01234567890']];
}

test('Recupera IntegrantesEquipes sem respostas nem perguntas originais, preservando IDs, CPF e origem', () => {
  const e = teamCspEnvironment(5), rows = savedCspMemberRows(e), name = 'Backup_Integrantes_CSP';
  e.context.writeTable_(name, rows[0], [rows[2], rows[1]]);
  e.form.items = []; e.form.responses = [];
  e.source.backupSheetName = name;
  e.context.setConfig_('IMPORTACAO_CSP_JSON', JSON.stringify(e.source));
  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.total, 1); assert.equal(preview.resultadosPrevistos.confirmed, 1);
  assert.match(preview.avisoRecuperacao, /não contém data original/);
  assert.equal(e.context.tableRows_('Equipes').length, 0, 'prévia não restaura antes da conferência');
  const previewSheet = [...e.sheets.values()].find(sheet => sheet.name.startsWith('Previa_CSP_'));
  assert.equal(previewSheet.cells[1][2], '', 'não inventa a data original');
  assert.ok(previewSheet.cells[1][10], 'registra a data da recuperação separadamente');
  assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 1);
  const team = e.context.readState_().registrations[rows[1][0]];
  assert.equal(team.members[0].role, 'coach'); assert.equal(team.members[1].cpf, '01234567890');
  assert.equal(team.members[1].raw, rows[2][7]); assert.equal(team.members[1].turma, 'Turma A');
  const op = e.context.readJournal_().byKey[e.form.id + ':SAVED_R1'];
  assert.equal(op.request.originalSubmittedAt, null); assert.equal(op.request.originalStatus, null);
  assert.equal(op.request.identitySource, 'RECUPERACAO_ADMINISTRATIVA_BACKUP_INTEGRANTES');
  assert.equal(e.context.importarInscricoesAnterioresCsp().processadasNesteLote, 0);
});

test('Recupera CSP das duas abas históricas e preserva tipo e data original da equipe', () => {
  const e = teamCspEnvironment(5), members = savedCspMemberRows(e), createdAt = '2026-10-05T17:32:52.510Z';
  const teams = [Array.from(e.context.SEMINFO_TABLES.Equipes),
    [members[1][0], 'CSP_2026', 'Equipe salva', 'Técnico em informática', '52998224725', '2', 'confirmada', createdAt, '']];
  const preview = e.context.prepararRecuperacaoEquipesCsp(members, teams);
  assert.equal(preview.total, 1);
  assert.equal(preview.avisoRecuperacao, '');
  const savedSource = JSON.parse(e.context.getConfig_().IMPORTACAO_CSP_JSON);
  assert.ok(savedSource.backupSheetName);
  assert.ok(savedSource.backupTeamSheetName);
  const previewSheet = [...e.sheets.values()].find(sheet => sheet.name.startsWith('Previa_CSP_'));
  assert.equal(previewSheet.cells[1][2], createdAt);
  assert.equal(previewSheet.cells[1][4], 'Técnico em informática');
  assert.ok(previewSheet.cells[1][10], 'registra quando os dados foram recuperados');

  e.context.importarInscricoesAnterioresCsp();
  const team = e.context.readState_().registrations[members[1][0]];
  assert.equal(team.createdAt, createdAt);
  assert.equal(team.teamType, 'Técnico em informática');
  const operation = e.context.readJournal_().byKey[e.form.id + ':SAVED_R1'];
  assert.equal(operation.request.originalSubmittedAt, createdAt);
  assert.equal(operation.request.originalStatus, 'confirmada');
  assert.equal(operation.request.identitySource, 'RECUPERACAO_ADMINISTRATIVA_BACKUP_COMPLETO');
});

test('Backup salvo é protegido e novas respostas acrescentam equipes sem sobrescrever recuperadas', () => {
  const e = teamCspEnvironment(5), rows = savedCspMemberRows(e);
  const preview = e.context.prepararRecuperacaoEquipesCsp(rows);
  assert.equal(preview.total, 1);
  const sheet = e.sheets.get(preview.backupSheetName), original = JSON.stringify(sheet.cells);
  assert.ok(sheet.hidden && sheet.protections.length);
  e.context.importarInscricoesAnterioresCsp();
  e.teamResponse('Equipe nova', ['Nova Pessoa - 11144477735']);
  const next = e.context.prepararImportacaoCsp();
  assert.equal(next.total, 2); assert.equal(next.jaProcessadas, 1);
  const result = e.context.importarInscricoesAnterioresCsp();
  assert.equal(result.processadasNesteLote, 1); assert.equal(result.ocupacao, 2);
  e.context.reconstruirVisoes();
  assert.equal(e.context.tableRows_('Equipes').length, 2);
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 3);
  assert.ok(e.context.readState_().registrations[rows[1][0]]);
  assert.equal(JSON.stringify(sheet.cells), original);
  e.context.prepararRecuperacaoEquipesCsp(rows);
  assert.equal(e.context.importarInscricoesAnterioresCsp().processadasNesteLote, 0);
  assert.equal([...e.sheets.keys()].filter(name => name.startsWith('Backup_CSP_Salvo_')).length, 1);
});

test('ID que voltou a existir no Form não duplica nem substitui os dados da equipe recuperada', () => {
  const e = teamCspEnvironment(5), live = e.teamResponse('Nome novo no Form', ['Coach Exemplo - 52998224725']);
  const rows = savedCspMemberRows(e, live.getId());
  assert.equal(e.context.prepararRecuperacaoEquipesCsp(rows).total, 1);
  assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 1);
  assert.equal(e.context.tableRows_('Equipes')[0].EQUIPE, 'Equipe salva');
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 2);
});

test('Reimportar backup após cancelamento não ressuscita a equipe nem ocupa outra vaga', () => {
  const e = teamCspEnvironment(5), rows = savedCspMemberRows(e);
  e.context.prepararRecuperacaoEquipesCsp(rows); e.context.importarInscricoesAnterioresCsp();
  e.context.cancelarEquipeCsp(rows[1][0], 'Cancelamento solicitado pela equipe.');
  e.context.prepararImportacaoCsp();
  assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 0);
  assert.equal(e.context.readState_().registrations[rows[1][0]].status, 'cancelada');
});

test('Backup de integrantes exige IDs da origem, nome consistente, coach único e CPFs válidos', () => {
  const e = teamCspEnvironment(5), rows = savedCspMemberRows(e), until = new Date().toISOString();
  const malformed = structuredClone(rows); malformed[1][0] = 'OUTRO_FORM:R1:equipe';
  assert.throws(() => e.context.cspRequestsFromMemberBackup_(e.source, malformed, until), /EQUIPE_ID incompatível/);
  const divergent = structuredClone(rows); divergent[2][1] = 'Outra equipe';
  assert.throws(() => e.context.cspRequestsFromMemberBackup_(e.source, divergent, until), /Nomes de equipe divergentes/);
  const invalid = structuredClone(rows); invalid[1][4] = 'integrante'; invalid[2][2] = '1234567890';
  const data = e.context.cspRequestsFromMemberBackup_(e.source, invalid, until);
  assert.equal(data.requests[0].invalidAnswer, true);
  assert.match(data.requests[0].importErrors.join(' '), /coach/);
  assert.match(data.requests[0].importErrors.join(' '), /CPF inválido/);
  e.context.prepararRecuperacaoEquipesCsp(invalid);
  const result = e.context.importarInscricoesAnterioresCsp();
  assert.equal(result.ocupacao, 1); assert.equal(result.pendentesConferencia, 0);
  assert.ok(e.context.readJournal_().byKey[e.form.id + ':SAVED_R1']);
});

test('Conteúdo alterado em backup existente não é sobrescrito e mudança após prévia bloqueia importação', () => {
  const e = teamCspEnvironment(5), rows = savedCspMemberRows(e);
  const report = e.context.prepararRecuperacaoEquipesCsp(rows), sheet = e.sheets.get(report.backupSheetName);
  sheet.getRange(2, 4).setValue('Nome modificado');
  assert.throws(() => e.context.prepararRecuperacaoEquipesCsp(rows), /nenhuma linha foi sobrescrita/);
  assert.throws(() => e.context.importarInscricoesAnterioresCsp(), /alteradas ou excluídas/);
  assert.equal(e.context.tableRows_('Equipes').length, 0);
  assert.equal(sheet.cells[1][3], 'Nome modificado');
});

test('CPF incompleto permite confirmar equipe preservando a resposta original', () => {
  const e = teamCspEnvironment(2);
  const invalid = e.teamResponse('Equipe com pendência', ['Pessoa Fictícia - 134756596699']);
  e.teamResponse('Equipe válida', ['Pessoa Exemplo - 11144477735']);
  e.context.prepararImportacaoCsp();
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 2); assert.equal(report.pendentesConferencia, 0); assert.equal(report.restantes, 0);
  assert.ok(e.context.readJournal_().byKey[e.form.id + ':' + invalid.getId()]);
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

test('Equipe incompleta com CPF já inscrito não interrompe a importação das novas equipes', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Já importada', ['Coach - 52998224725']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  const duplicate = e.teamResponse('Repetida com pendência', ['Outro coach - 11144477735', 'Integrante - 52998224725', 'Pessoa sem CPF']);
  e.teamResponse('Nova equipe', ['Coach novo - 01234567890', 'Pessoa sem CPF']);

  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.jaProcessadas, 1);
  assert.equal(preview.resultadosPrevistos.duplicate, 1);
  assert.equal(preview.resultadosPrevistos.confirmed, 1);
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.resultados.duplicate, 1);
  assert.equal(report.resultados.confirmed, 1);
  assert.equal(report.ocupacao, 2);
  assert.equal(report.restantes, 0);
  assert.deepEqual(e.context.tableRows_('Equipes').map(row => row.EQUIPE), ['Já importada', 'Nova equipe']);
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 3);
  assert.equal(e.context.tableRows_('Recuperacao_CSP').find(row => row.EQUIPE === 'Repetida com pendência').SITUACAO, 'duplicate');
  assert.equal(e.context.readJournal_().byKey[e.form.id + ':' + duplicate.getId()].outcome.code, 'duplicate');
  const operationCount = e.context.readJournal_().operations.length;
  assert.equal(e.context.importarInscricoesAnterioresCsp().processadasNesteLote, 0);
  assert.equal(e.context.readJournal_().operations.length, operationCount);
  assert.equal(e.context.tableRows_('Equipes').length, 2);
});

test('CPF repetido na equipe com outro integrante incompleto fica pendente e permite importar a próxima', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Repetida internamente', ['Coach - 52998224725', 'Integrante - 52998224725', 'Pessoa sem CPF']);
  e.teamResponse('Nova equipe', ['Outro coach - 11144477735']);
  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.resultadosPrevistos.invalid, 1);
  assert.equal(preview.resultadosPrevistos.confirmed, 1);
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.pendentesConferencia, 1);
  assert.match(report.equipesPendentes[0].motivo, /CPF repetido dentro da equipe/);
  assert.equal(report.restantes, 0);
  assert.equal(report.ocupacao, 1);
  assert.equal(e.context.tableRows_('Equipes')[0].EQUIPE, 'Nova equipe');
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 1);
});

test('Nome repetido de equipe incompleta é recusado mesmo quando nenhum CPF é conhecido', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Alpha', ['Primeira pessoa sem CPF']);
  e.teamResponse(' alpha ', ['Segunda pessoa sem CPF']);
  e.teamResponse('Beta', ['Terceira pessoa sem CPF']);
  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.resultadosPrevistos.confirmed, 2);
  assert.equal(preview.resultadosPrevistos.duplicate, 1);
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 2);
  assert.equal(report.resultados.duplicate, 1);
  assert.equal(e.context.tableRows_('Equipes').length, 2);
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 2);
});

test('Equipe incompleta respeita conflito de CPF conhecido e mantém as inscrições anteriores', () => {
  const e = teamCspEnvironment();
  e.context.salvarAtividade(e.activity('B')); e.context.abrirInscricoes();
  const registered = e.response('INSCRICAO', {answers: {CPF: '11144477735', ACTIVITY: '[B] Outra atividade'}});
  e.context.processFormResponse_('INSCRICAO', registered.form, registered.response);
  e.teamResponse('Incompleta em conflito', ['Coach - 11144477735', 'Pessoa sem CPF']);
  e.teamResponse('Nova equipe', ['Outro coach - 52998224725']);
  const preview = e.context.prepararImportacaoCsp();
  assert.equal(preview.resultadosPrevistos.conflict, 1);
  assert.equal(preview.resultadosPrevistos.confirmed, 1);
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.resultados.conflict, 1);
  assert.equal(report.ocupacao, 1);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'B'), 1);
  assert.equal(e.context.tableRows_('Equipes')[0].EQUIPE, 'Nova equipe');
});

test('Backup de equipe incompleta com CPF já importado não bloqueia novas respostas do Form', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Já importada', ['Coach - 52998224725']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  const rows = savedCspMemberRows(e);
  rows[2][2] = '1234567890';
  e.teamResponse('Nova equipe', ['Coach novo - 01234567890']);
  const preview = e.context.prepararRecuperacaoEquipesCsp(rows);
  assert.equal(preview.resultadosPrevistos.duplicate, 1);
  assert.equal(preview.resultadosPrevistos.confirmed, 1);
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.resultados.duplicate, 1);
  assert.equal(report.ocupacao, 2);
  assert.equal(e.context.tableRows_('Equipes').length, 2);
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 2);
});

test('Equipes com quantidade divergente e textos ambiguos sao confirmadas administrativamente', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Incompleta', ['Pessoa Exemplo - 52998224725'], 3);
  e.teamResponse('Ambígua', ['Pessoa - 52998224725 - 11144477735']);
  e.context.prepararImportacaoCsp();
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.ocupacao, 2); assert.equal(report.pendentesConferencia, 0);
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

test('Situação da CSP usa vagas de equipes e volta a aberta após cancelamento de uma equipe', () => {
  const e = teamCspEnvironment(2);
  e.context.abrirInscricoes();
  const first = e.teamResponse('Alpha', ['Coach Alpha - 52998224725', 'Integrante Alpha - 11144477735', 'Integrante Beta - 01234567890']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  function row() { return e.context.tableRows_('Atividades').find(activity => activity.ID === 'CSP_2026'); }
  assert.equal(e.context.tableRows_('IntegrantesEquipes').length, 3);
  assert.equal(row().OCUPACAO, 1); assert.equal(row().SITUACAO, 'aberta');
  e.teamResponse('Beta', ['Coach Beta - 12345678909']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  assert.equal(row().OCUPACAO, 2); assert.equal(row().SITUACAO, 'lotada');
  assert.equal(e.context.consultarOcupacao().find(activity => activity.id === 'CSP_2026').situacao, 'lotada');
  assert.equal(e.context.readState_().activities.CSP_2026.status, 'aberta');
  e.context.cancelarEquipeCsp(e.form.id + ':' + first.getId() + ':equipe', 'Cancelamento administrativo de teste');
  assert.equal(row().OCUPACAO, 1); assert.equal(row().SITUACAO, 'aberta');
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
  assert.equal(state.activities.PALESTRA_BIO.start, '2026-10-27T16:30:00.000Z');
  assert.match(state.activities.PALESTRA_BIO.description, /2026-10-27/);
  assert.equal(state.activities.CSP_2026.capacityUnit, 'equipes');
  assert.equal(state.activities.CSP_2026.capacity, 60);
  assert.equal(state.activities.CSP_2026.status, 'aberta');
  assert.equal(state.activities.CSP_2026.type, 'competicao');
  assert.equal(state.activities.ENCERRAMENTO_2026.type, 'programacao');
  assert.equal(state.activities.OFICINA_YASMIN_GABRIEL.status, 'aberta');
  assert.equal(state.activities.OFICINA_YASMIN_GABRIEL.title, 'Pipeline de Dados em Tempo Real: Do Zero ao Dashboard');
  assert.equal(state.activities.OFICINA_YASMIN_GABRIEL.instructor, 'Tiago Fernandes Moraes');
  assert.equal(state.activities.OFICINA_BLENDER.capacity, 20);
  assert.equal(state.activities.OFICINA_BLENDER.instructor, 'Caio Henrique Magalhães');
  assert.equal(state.activities.OFICINA_OLLAMA.instructor, 'Gabriel Madeira');
  assert.equal(state.activities.OFICINA_C.capacity, 40);
  assert.equal(state.activities.OFICINA_C.end, '2026-10-27T20:00:00.000Z');
  assert.equal(state.activities.CSP_2026.end, '2026-10-29T18:30:00.000Z');
  assert.equal(state.activities.ENCERRAMENTO_2026.start, '2026-10-29T18:30:00.000Z');
  assert.equal(state.activities.PALESTRA_RENATO.instructor, 'Prof. Dr. Douglas Donizeti de Castilho Braz');
  assert.equal(state.activities.NOITE_26.instructor, 'Ana Carolina Brazão');
  assert.equal(state.activities.NOITE_26.start, '2026-10-26T22:00:00.000Z');
  assert.equal(state.activities.NOITE_26.end, '');
  assert.equal(state.activities.HOMENAGEM_CRIS, undefined);
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

test('Programação final migra CSP já importada, atualiza snapshots e conserva dados de equipes', () => {
  const e = teamCspEnvironment(60);
  e.form.description = 'Texto da competição.\nHorário: 13h às 16h';
  e.context.salvarAtividade(e.activity('CSP_2026', {capacity: 60, capacityUnit: 'equipes',
    start: '2026-10-29T13:00:00-03:00', end: '2026-10-29T16:00:00-03:00'}));
  const response = e.teamResponse('Equipe preservada', ['Coach - 52998224725', 'Integrante sem CPF']);
  e.context.prepararImportacaoCsp(); e.context.importarInscricoesAnterioresCsp();
  const key = e.form.id + ':' + response.getId(), original = JSON.stringify(e.context.readJournal_().byKey[key]);
  const members = JSON.stringify(e.context.tableRows_('IntegrantesEquipes'));
  const result = e.context.sincronizarCatalogoProgramacaoFinalSeminfo2026_();
  assert.ok(result.atualizadas.includes('CSP_2026'));
  const journal = e.context.readJournal_(), team = journal.state.registrations[key + ':equipe'];
  assert.equal(team.activity.end, '2026-10-29T18:30:00.000Z');
  assert.equal(journal.state.activities.CSP_2026.end, team.activity.end);
  assert.equal(e.context.SemDomain.occupancy(journal.state, 'CSP_2026'), 1);
  assert.equal(JSON.stringify(journal.byKey[key]), original);
  assert.equal(JSON.stringify(e.context.tableRows_('IntegrantesEquipes')), members);
  e.context.atualizarDescricoesProgramacaoSeminfo2026_();
  assert.match(e.form.description, /Texto da competição/);
  assert.match(e.form.description, /Vagas: 60 equipes/);
  assert.doesNotMatch(e.form.description, /13h às 16h/);
  const count = journal.operations.length;
  e.context.sincronizarCatalogoProgramacaoFinalSeminfo2026_();
  assert.equal(e.context.readJournal_().operations.length, count);
});

test('Programação final recusa Blender com mais de 20 inscritos antes de gravar qualquer mudança', () => {
  const e = environment(); e.installed();
  const entries = e.context.programacaoSeminfo2026_();
  const blender = e.context.atividadeDaProgramacao_(entries.find(entry => entry.id === 'OFICINA_BLENDER'));
  e.context.salvarAtividade({...blender, capacity: 30});
  e.context.abrirInscricoes();
  function cpfFor(number) {
    const digits = String(200000000 + number).split('').map(Number);
    for (let length = 9; length <= 10; length++) {
      const remainder = digits.reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0) * 10 % 11;
      digits.push(remainder === 10 ? 0 : remainder);
    }
    return digits.join('');
  }
  for (let i = 0; i < 21; i++) {
    const input = e.response('INSCRICAO', {email: 'pessoa' + i + '@example.org', answers: {CPF: cpfFor(i), ACTIVITY: '[OFICINA_BLENDER] Blender'}});
    assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  }
  const before = JSON.stringify(e.context.readState_()), count = e.context.readJournal_().operations.length;
  assert.throws(() => e.context.sincronizarCatalogoProgramacaoFinalSeminfo2026_(), /Capacidade.*OFICINA_BLENDER/);
  assert.equal(JSON.stringify(e.context.readState_()), before);
  assert.equal(e.context.readJournal_().operations.length, count);
});

test('Programação final retira homenagem, atualiza placeholders e mantém fechamentos administrativos', () => {
  const e = environment(); e.installed();
  e.context.salvarAtividade(e.activity('HOMENAGEM_CRIS', {status: 'pendente', capacity: null, start: '', end: ''}));
  e.context.salvarAtividade(e.activity('OFICINA_YASMIN_GABRIEL', {status: 'pendente'}));
  e.context.salvarAtividade(e.activity('NOITE_26', {status: 'pendente', capacity: null,
    start: '2026-10-26T19:00:00-03:00', end: '2026-10-26T23:00:00-03:00'}));
  const game = e.context.atividadeDaProgramacao_(e.context.programacaoSeminfo2026_().find(entry => entry.id === 'OFICINA_GAMEMAKER'));
  e.context.salvarAtividade({...game, status: 'encerrada'});
  const result = e.context.sincronizarCatalogoProgramacaoFinalSeminfo2026_();
  const state = e.context.readState_();
  assert.ok(result.retiradasDaProgramacao.includes('HOMENAGEM_CRIS'));
  assert.equal(state.activities.OFICINA_YASMIN_GABRIEL.status, 'aberta');
  assert.equal(state.activities.NOITE_26.end, '');
  assert.equal(state.activities.OFICINA_GAMEMAKER.status, 'encerrada');
  assert.match(state.activities.HOMENAGEM_CRIS.description, /Retirada da programação final/);
  e.context.carregarProgramacaoSeminfo2026();
  assert.ok(e.context.tableRows_('Programacao').every(row => row.ID !== 'HOMENAGEM_CRIS'));
});

test('Atualização incorpora os dois Forms públicos, preserva perguntas/respostas e corrige descrições antigas', () => {
  const e = environment(); e.begin();
  const pipeline = e.manualRegistration('OFICINA_YASMIN_GABRIEL', {title: 'Pipeline de Dados em Tempo Real: Do Zero ao Dashboard'});
  const lecture = e.manualRegistration('NOITE_26', {title: 'Troubleshooting e Dados no Mundo Real'});
  pipeline.form.getPublishedUrl = () => 'https://docs.google.com/forms/d/e/PUBLIC_PIPELINE/viewform';
  lecture.form.getPublishedUrl = () => 'https://docs.google.com/forms/d/e/PUBLIC_NOITE/viewform';
  pipeline.form.description = 'Descrição prática da oficina.\n👥 Vagas: 99 participantes\n📍 Local: Sala antiga\nInformações de acessibilidade.';
  lecture.form.description = 'Descrição da palestra.\n🕓 Horário: 19h30\nAvisos de participação.';
  pipeline.form.responses.push({id: 'resposta-historica'});
  const questions = pipeline.form.items.map(item => item.id), created = e.stats.formsCreated;
  const publicForms = [pipeline, lecture].map(entry => ({activityId: entry.definition.activityId,
    title: entry.form.title, url: entry.form.getPublishedUrl(), items: entry.definition.items}));
  e.context.setConfig_('FORMULARIOS_PUBLICOS_SEMINFO_JSON', JSON.stringify(publicForms));
  const first = e.context.atualizarProgramacaoSeminfo2026();
  assert.equal(first.programacao.totalCadastradas, 18);
  assert.equal(pipeline.form.title, 'OFICINA - Pipeline de Dados em Tempo Real: Do Zero ao Dashboard');
  assert.equal(pipeline.form.documentTitle, pipeline.form.title);
  assert.equal(lecture.form.title, 'PALESTRA - Troubleshooting e dados no mundo real');
  assert.equal(lecture.form.documentTitle, lecture.form.title);
  assert.equal(e.stats.formsCreated, created);
  assert.deepEqual(pipeline.form.items.map(item => item.id), questions);
  assert.equal(pipeline.form.responses.length, 1);
  assert.equal(e.context.getRegistrationFormDefinitions_().filter(source => [pipeline.form.id, lecture.form.id].includes(source.id)).length, 2);
  assert.match(pipeline.form.description, /Descrição prática da oficina/);
  assert.match(pipeline.form.description, /Informações de acessibilidade/);
  assert.match(pipeline.form.description, /Vagas: 30/);
  assert.match(pipeline.form.description, /Local: Sala 16/);
  assert.doesNotMatch(pipeline.form.description, /99 participantes|Sala antiga/);
  assert.doesNotMatch(lecture.form.description, /19h30/);
  assert.match(lecture.form.description, /Ana Carolina Brazão/);
  const before = e.context.readJournal_().operations.length, description = pipeline.form.description;
  const second = e.context.atualizarProgramacaoSeminfo2026();
  assert.equal(e.context.readJournal_().operations.length, before);
  assert.equal(pipeline.form.description, description);
  assert.equal(second.descricoesAtualizadas.length, 0);
});

test('Busca de Form público no Drive confere a URL e não vincula um homônimo', () => {
  const e = environment(); e.installed();
  const wrong = e.manualRegistration('OUTRA', {title: 'Mesmo título'});
  const right = e.manualRegistration('NOITE_26', {title: 'Mesmo título'});
  wrong.form.getPublishedUrl = () => 'https://docs.google.com/forms/d/e/PUBLIC_ERRADO/viewform';
  right.form.getPublishedUrl = () => 'https://docs.google.com/forms/d/e/PUBLIC_CERTO/viewform';
  e.context.FormApp.openByUrl = () => { throw new Error('URL pública não aceita para edição.'); };
  const definition = {title: 'Mesmo título', activityId: 'NOITE_26', url: right.form.getPublishedUrl()};
  const found = e.context.resolverFormularioPublicoSeminfo_(definition, []);
  assert.equal(found.getId(), right.form.id);
  assert.notEqual(found.getId(), wrong.form.id);
  assert.throws(() => e.context.resolverFormularioPublicoSeminfo_({...definition, url: 'https://docs.google.com/forms/d/e/NAO_EXISTE/viewform'}, []), /ID de edição/);
});

test('Novo Form sem e-mail verificado recebe os dados finais e permanece fechado com pendência explícita', () => {
  const e = environment('RESPONDER_INPUT'); e.installed();
  const pipeline = e.manualRegistration('OFICINA_YASMIN_GABRIEL', {title: 'Pipeline de Dados em Tempo Real: Do Zero ao Dashboard'});
  pipeline.form.getPublishedUrl = () => 'https://docs.google.com/forms/d/e/PUBLIC_PIPELINE/viewform';
  pipeline.form.description = 'Descrição original.\nLocal: Sala antiga';
  e.context.setConfig_('FORMULARIOS_PUBLICOS_SEMINFO_JSON', JSON.stringify([{
    activityId: pipeline.definition.activityId, title: pipeline.form.title,
    url: pipeline.form.getPublishedUrl(), items: pipeline.definition.items
  }]));
  const result = e.context.atualizarProgramacaoSeminfo2026();
  assert.equal(result.programacao.totalCadastradas, 18);
  assert.ok(result.pendencias.length);
  assert.equal(pipeline.form.accepting, false);
  assert.match(pipeline.form.description, /Local: Sala 16/);
  assert.equal(e.context.readState_().activities.OFICINA_YASMIN_GABRIEL.instructor, 'Tiago Fernandes Moraes');
  assert.equal(e.properties.has('SEMINFO_FORM_REFRESH_PENDING'), false);
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

test('Preparação dos Forms repete falha temporária de timeout do Drive', () => {
  const e = environment(), first = e.manualRegistration('A'), second = e.manualRegistration('B');
  e.configureExisting([first]); e.installed();
  e.context.SEMINFO_CONFIG = Object.freeze({...e.context.SEMINFO_CONFIG, FORMULARIOS_INSCRICAO_JSON: JSON.stringify([
    first.definition, second.definition
  ])});
  const openById = e.context.FormApp.openById, attempts = new Map();
  e.context.FormApp.openById = id => {
    const count = attempts.get(id) || 0;
    attempts.set(id, count + 1);
    if (id === second.form.id && count === 0) throw new Error('O tempo limite do serviço Drive foi atingido ao acessar o documento.');
    return openById(id);
  };

  const result = e.context.prepararFormulariosSeminfo2026();

  assert.equal(result.length, 2);
  assert.equal(attempts.get(second.form.id), 2);
});

test('Validação lenta dos Forms ocorre fora do bloqueio global', () => {
  const e = environment(), first = e.manualRegistration('A'), second = e.manualRegistration('B');
  e.configureExisting([first]); e.installed();
  e.context.SEMINFO_CONFIG = Object.freeze({...e.context.SEMINFO_CONFIG, FORMULARIOS_INSCRICAO_JSON: JSON.stringify([
    first.definition, second.definition
  ])});
  const openById = e.context.FormApp.openById;
  e.context.FormApp.openById = id => {
    assert.equal(e.stats.lockHeld, false, 'Drive validation must not hold the script lock');
    return openById(id);
  };

  assert.equal(e.context.prepararFormulariosSeminfo2026().length, 2);
});

test('Timeout persistente do Drive não grava configuração parcial da lista de Forms', () => {
  const e = environment(), first = e.manualRegistration('A'), second = e.manualRegistration('B');
  e.configureExisting([first]); e.installed();
  e.context.SEMINFO_CONFIG = Object.freeze({...e.context.SEMINFO_CONFIG, FORMULARIOS_INSCRICAO_JSON: JSON.stringify([
    first.definition, second.definition
  ])});
  const before = e.context.getRegistrationFormDefinitions_().map(entry => entry.id);
  const openById = e.context.FormApp.openById;
  e.context.FormApp.openById = id => {
    if (id === second.form.id) throw new Error('O tempo limite do serviço Drive foi atingido ao acessar o documento.');
    return openById(id);
  };

  assert.throws(() => e.context.prepararFormulariosSeminfo2026(), /tempo limite do serviço Drive/);
  assert.deepEqual(e.context.getRegistrationFormDefinitions_().map(entry => entry.id), before);
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

test('Nomeia a aba nativa do Form histórico da CSP pelo título da atividade e preserva respostas', () => {
  const e = historicalCspEnvironment();
  e.context.salvarAtividade(e.activity('CSP_2026', {title: 'Competição Seminfo de Programação — CSP', capacityUnit: 'equipes'}));
  e.legacy.form.destination = 'SHEET';
  const raw = e.context.db_().insertSheet('Respostas ao formulário 8');
  raw.sheetId = 858916137;
  raw.formUrl = e.legacy.form.getPublishedUrl();
  raw.appendRow(['Equipe']).appendRow(['Equipe Exemplo']);

  const result = e.context.nomearAbasDeRespostas_();

  assert.equal(raw.name, 'Respostas — Competição Seminfo de Programação — CSP');
  assert.equal(raw.cells[1][0], 'Equipe Exemplo');
  assert.ok(result.some(entry => entry.formId === e.legacy.form.id && entry.aba === raw.name));
  assert.equal(e.context.getConfig_().CSP_RESPONSE_SPREADSHEET_ID, 'SHEET');
  assert.equal(e.context.getConfig_().CSP_RESPONSE_SHEET_ID, String(raw.getSheetId()));
});

test('Migra o destino de respostas CSP para a planilha principal e preserva a guia antiga', () => {
  const e = historicalCspEnvironment();
  e.context.salvarAtividade(e.activity('CSP_2026', {title: 'Competição Seminfo de Programação — CSP', capacityUnit: 'equipes'}));
  e.legacy.form.destination = '1tFSDmBp9wsCskM0dIF_ax9-CM6upvodHAYL0xi2QhrA';
  const archived = e.context.db_().insertSheet('Respostas CSP antiga');
  archived.sheetId = 858916137;
  archived.formUrl = e.legacy.form.getPublishedUrl();
  archived.appendRow(['Equipe']).appendRow(['Equipe arquivada']);
  e.legacy.form.setDestination = function (_, spreadsheetId) {
    this.destination = spreadsheetId;
    const responseSheet = e.context.db_().insertSheet('Respostas ao formulário CSP');
    responseSheet.formUrl = this.getPublishedUrl();
    responseSheet.appendRow(['Equipe']).appendRow(['Equipe nova']);
    return this;
  };

  const result = e.context.nomearAbasDeRespostas_();
  const current = e.context.db_().getSheets().filter(sheet =>
    sheet.getSheetId() !== archived.getSheetId() && sheet.formUrl === e.legacy.form.getPublishedUrl())[0];

  assert.equal(e.legacy.form.destination, 'SHEET');
  assert.equal(archived.name, 'Respostas CSP antiga');
  assert.equal(archived.cells[1][0], 'Equipe arquivada');
  assert.equal(current.name, 'Respostas — Competição Seminfo de Programação — CSP');
  assert.equal(current.cells[1][0], 'Equipe nova');
  assert.equal(e.context.getConfig_().CSP_RESPONSE_SPREADSHEET_ID, 'SHEET');
  assert.equal(e.context.getConfig_().CSP_RESPONSE_SHEET_ID, String(current.getSheetId()));
  assert.ok(result.some(entry => entry.formId === e.legacy.form.id && entry.aba === current.name));
});

test('Não altera o destino CSP quando a guia antiga configurada não está vinculada ao Form esperado', () => {
  const e = historicalCspEnvironment();
  e.legacy.form.destination = '1tFSDmBp9wsCskM0dIF_ax9-CM6upvodHAYL0xi2QhrA';
  const raw = e.context.db_().insertSheet('Respostas ao formulário 8');
  raw.sheetId = 858916137;
  raw.formUrl = 'https://docs.google.com/forms/d/outro-form/edit';

  assert.throws(() => e.context.nomearAbasDeRespostas_(), /não contém uma guia vinculada ao Form/);
  assert.equal(e.legacy.form.destination, '1tFSDmBp9wsCskM0dIF_ax9-CM6upvodHAYL0xi2QhrA');
  assert.equal(raw.name, 'Respostas ao formulário 8');
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
  e.context.salvarAtividade(e.activity('PALESTRA_DANIELE', {title: 'Nome antigo', capacity: 45}));
  const before = e.context.readState_().activities.PALESTRA_DANIELE;
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const opening = e.manualRegistration('ABERTURA_2026'); opening.definition.title = 'Abertura — XXI Seminfo';
  e.context.SEMINFO_CONFIG = Object.freeze({...e.context.SEMINFO_CONFIG, FORMULARIOS_INSCRICAO_JSON: JSON.stringify([opening.definition])});
  const created = e.stats.formsCreated;
  const result = e.context.atualizarProgramacaoSeminfo2026();
  assert.equal(result.programacao.totalCadastradas, 18);
  const title = 'Computação Quântica: Entendendo o contexto para inovar no futuro';
  const updated = e.context.readState_().activities.PALESTRA_DANIELE;
  assert.equal(updated.title, title);
  assert.equal(updated.instructor, 'Daniele Nazaré Tavares');
  assert.equal(updated.start, '2026-10-28T22:30:00.000Z');
  assert.equal(updated.end, '', 'um término de outro dia não é reutilizado');
  assert.equal(updated.capacity, before.capacity, 'capacidade preenchida administrativamente é conservada quando não há substituta');
  assert.equal(updated.status, 'pendente');
  const row = e.context.db_().getSheetByName('Programacao').getDataRange().getValues().find(row => row[0] === 'PALESTRA_DANIELE');
  assert.equal(row[4], title);
  assert.equal(opening.form.title, 'Abertura — XXI Seminfo');
  assert.equal(opening.form.accepting, false);
  assert.equal(e.context.getRegistrationFormDefinitions_().some(source => source.id === opening.form.id && source.activityId === 'ABERTURA_2026'), true);
  assert.equal(e.stats.formsCreated, created);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(input.form.responses.length, 1);
  assert.equal(e.properties.has('SEMINFO_RESET_AT'), false);
});

test('Atualiza títulos dos Forms e atividades preservando respostas, inscrições e configuração operacional', () => {
  const e = environment(); e.begin();
  const input = e.response('INSCRICAO'); e.context.processFormResponse_('INSCRICAO', input.form, input.response);
  const game = e.manualRegistration('OFICINA_GAMEMAKER');
  const raw = e.context.db_().insertSheet('Respostas antigas GameMaker');
  raw.formUrl = game.form.getPublishedUrl();
  raw.getRange(1, 1, 2, 1).setValues([['Nome'], ['Resposta preservada']]);
  e.context.setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify([
    ...e.context.getRegistrationFormDefinitions_(), game.definition]));
  e.context.instalarSistema();
  e.context.salvarAtividade(e.activity('OFICINA_GAMEMAKER', {title: 'Nome antigo', capacity: 45}));
  const before = e.context.readState_().activities.OFICINA_GAMEMAKER;
  const created = e.stats.formsCreated;
  const questionIds = game.form.items.map(item => item.id);
  const result = e.context.atualizarFormularios();
  const activityTitle = 'Desenvolvimento de Jogos 2D com GameMaker — Tarde';
  const expected = 'OFICINA - ' + activityTitle;
  assert.equal(game.form.title, expected);
  assert.equal(game.form.documentTitle, expected);
  assert.equal(raw.cells[1][0], 'Resposta preservada');
  assert.ok(result.abasDeRespostas.some(entry => entry.formId === game.form.id && entry.aba === 'Respostas — ' + expected));
  assert.equal(e.context.getRegistrationFormDefinitions_().find(entry => entry.id === game.form.id).title, expected);
  assert.deepEqual({...e.context.readState_().activities.OFICINA_GAMEMAKER}, {...before, title: activityTitle});
  assert.deepEqual(game.form.items.map(item => item.id), questionIds);
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'A'), 1);
  assert.equal(input.form.responses.length, 1);
  assert.equal(e.stats.formsCreated, created);
  assert.equal(result.formularios.length, 1);
  const operations = e.context.readJournal_().operations.length;
  e.context.atualizarFormularios();
  assert.equal(e.context.readJournal_().operations.length, operations);
});

test('Form existente de linguagem C é incorporado, nomeado e recebe inscrições sem duplicar perguntas', () => {
  const e = environment(); e.begin();
  const c = e.manualRegistration('OFICINA_C', {title: 'Formulário antigo de C'});
  c.name.setTitle('Nome Completo'); c.cpf.setTitle('CPF (xxx.xxx.xxx-xx)');
  const ids = c.form.items.map(item => item.id), created = e.stats.formsCreated;
  e.context.SEMINFO_CONFIG = Object.freeze({...e.context.SEMINFO_CONFIG,
    FORMULARIOS_INSCRICAO_JSON: JSON.stringify([{id: c.form.id, activityId: 'OFICINA_C',
      title: 'OFICINA - Introdução à linguagem C', items: {}}])});
  e.context.atualizarProgramacaoSeminfo2026();
  assert.equal(c.form.title, 'OFICINA - Introdução à linguagem C');
  assert.equal(c.form.documentTitle, c.form.title);
  assert.deepEqual(c.form.items.map(item => item.id), ids);
  assert.equal(e.stats.formsCreated, created);
  assert.equal(e.context.readState_().activities.OFICINA_C.capacity, 40);
  const definition = e.context.getRegistrationFormDefinitions_().find(source => source.id === c.form.id);
  assert.equal(definition.activityId, 'OFICINA_C');
  e.context.configurarEmailVerificadoFormularios(); e.context.abrirInscricoes();
  const input = e.responseFrom(c);
  assert.equal(e.context.processFormResponse_('INSCRICAO', input.form, input.response).code, 'confirmed');
  assert.equal(e.context.SemDomain.occupancy(e.context.readState_(), 'OFICINA_C'), 1);
  const count = e.context.readJournal_().operations.length;
  e.context.atualizarProgramacaoSeminfo2026();
  assert.equal(c.form.title, 'OFICINA - Introdução à linguagem C');
  assert.equal(c.form.documentTitle, c.form.title);
  assert.equal(c.form.responses.length, 1);
  assert.equal(e.context.readJournal_().operations.length, count);
});

test('Renomear Forms atualiza título e arquivo sem alterar o cadastro, o Form ou a guia da CSP', () => {
  const e = teamCspEnvironment(60);
  const csp = {...e.context.readState_().activities.CSP_2026, title: 'Nome próprio da CSP'};
  e.context.salvarAtividade(csp);
  const game = e.manualRegistration('OFICINA_GAMEMAKER');
  e.context.setConfig_('FORMULARIOS_INSCRICAO_JSON', JSON.stringify([
    ...e.context.getRegistrationFormDefinitions_(), game.definition]));
  e.context.instalarSistema();
  const savedCsp = JSON.stringify(e.context.readState_().activities.CSP_2026);
  const savedForm = JSON.stringify({title: e.form.title, name: e.form.documentTitle,
    destination: e.form.destination, description: e.form.description, accepting: e.form.accepting});
  const cspSheet = e.context.db_().insertSheet('Guia própria da CSP');
  cspSheet.formUrl = e.form.getPublishedUrl();
  const result = e.context.atualizarFormularios();
  assert.equal(game.form.title, 'OFICINA - Desenvolvimento de Jogos 2D com GameMaker — Tarde');
  assert.equal(game.form.documentTitle, game.form.title);
  assert.equal(JSON.stringify(e.context.readState_().activities.CSP_2026), savedCsp);
  assert.equal(JSON.stringify({title: e.form.title, name: e.form.documentTitle,
    destination: e.form.destination, description: e.form.description, accepting: e.form.accepting}), savedForm);
  assert.equal(cspSheet.name, 'Guia própria da CSP');
  assert.ok(result.formularios.every(form => form.id !== e.form.id));
});


test('Leitor CSP aceita CPF com ponto final, colado ao nome e quebras HTML', () => {
  const e = environment();
  for (const raw of ['Pessoa Exemplo 529.982.247.25', 'Pessoa Exemplo529.982.247-25', 'Pessoa Exemplo52998224725', 'Pessoa Exemplo<br>CPF: 529.982.247-25&#x20;']) {
    const member = e.context.parseCspTeamMember_(raw, 1);
    assert.equal(member.name, 'Pessoa Exemplo');
    assert.equal(member.cpf, '52998224725');
  }
  assert.throws(() => e.context.parseCspTeamMember_('Pessoa Exemplo 529.982.247.26', 1), /CPF inv.lido/);
  assert.throws(() => e.context.parseCspTeamMember_('Pessoa Exemplo', 1), /CPF inv.lido/);
  assert.throws(() => e.context.parseCspTeamMember_('Pessoa Exemplo 152998224725', 1), /CPF inv.lido/);
});


test('Recuperacao CSP salva todas as equipes incompletas e preserva textos sem duplicar', () => {
  const e = teamCspEnvironment();
  e.teamResponse('Sem CPF', ['Pessoa sem documento', 'Outra pessoa'], 3);
  e.teamResponse('Faltam integrantes', ['Coach 52998224725'], 3);
  e.teamResponse('Completa', ['Coach 11144477735']);
  e.context.prepararImportacaoCsp();
  const report = e.context.importarInscricoesAnterioresCsp();
  assert.equal(report.totalEquipesRecuperadas, 3);
  assert.equal(report.pendentesConferencia, 0);
  const rows = e.context.tableRows_('Recuperacao_CSP');
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.EQUIPE === 'Sem CPF').TEXTOS_ORIGINAIS, 'Pessoa sem documento\n\nOutra pessoa\n\n');
  assert.equal(rows.find(r => r.EQUIPE === 'Sem CPF').SITUACAO, 'confirmed');
  assert.equal(rows.find(r => r.EQUIPE === 'Completa').SITUACAO, 'confirmed');
  e.context.importarInscricoesAnterioresCsp();
  assert.equal(e.context.tableRows_('Recuperacao_CSP').length, 3);
});


test('Importacao CSP inclui linhas existentes apenas no Sheets e nao duplica respostas do Forms', () => {
 const e = teamCspEnvironment(60);
 const existing = e.teamResponse('Equipe no Forms', ['Coach 52998224725']);
 const sheet = e.context.db_().insertSheet('Respostas CSP');
 sheet.formUrl = e.form.getPublishedUrl();
 sheet.appendRow(['Carimbo de data/hora', 'Sua equipe e', 'Nome da equipe', 'Quantos integrantes', '(Coach) Nome do integrante 1, CPF, turma e telefone', '(se houver) Nome do integrante 2, CPF e turma']);
 sheet.appendRow([existing.getTimestamp(), 'Tecnico', 'Equipe no Forms', '1', 'Coach 52998224725', '']);
 sheet.appendRow([new Date('2026-10-06T15:00:00Z'), 'Tecnico', 'Equipe so no Sheets', '3', 'Pessoa sem CPF', 'Outra pessoa']);
 const preview = e.context.prepararImportacaoCsp();
 assert.equal(preview.total, 2);
 const report = e.context.importarInscricoesAnterioresCsp();
 assert.equal(report.ocupacao, 2);
 assert.equal(report.pendentesConferencia, 0);
 e.context.prepararImportacaoCsp();
 assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 2);
 assert.equal(e.context.tableRows_('Equipes').length, 2);
});


test('Relatorio CSP mostra motivos de equipes nao confirmadas mesmo em uma segunda execucao', () => {
 const e = teamCspEnvironment(1);
 e.teamResponse('Primeira', ['Coach 52998224725']);
 e.teamResponse('Sem vaga', ['Coach 11144477735']);
 e.context.prepararImportacaoCsp();
 const first = e.context.importarInscricoesAnterioresCsp();
 assert.equal(first.equipesNaoConfirmadas.length, 1);
 assert.equal(first.equipesNaoConfirmadas[0].equipe, 'Sem vaga');
 assert.equal(first.equipesNaoConfirmadas[0].resultado, 'full');
 assert.equal(e.context.importarInscricoesAnterioresCsp().equipesNaoConfirmadas[0].resultado, 'full');
});


function meetsEnvironment() {
  const e = environment();
  e.installed();
  const events = new Map(), inserted = [], patched = [], logs = [];
  const copy = value => JSON.parse(JSON.stringify(value));
  const apiError = code => Object.assign(new Error(code === 404 ? 'Not Found' : 'Calendar API indisponível'), {code});
  e.context.console = {log: text => logs.push(text)};
  e.context.Calendar = {Events: {
    get(calendar, id) {
      assert.equal(calendar, 'primary');
      if (!events.has(id)) throw apiError(404);
      return copy(events.get(id));
    },
    insert(resource, calendar, args) {
      assert.equal(calendar, 'primary');
      assert.equal(args.conferenceDataVersion, 1);
      assert.equal(args.sendUpdates, 'none');
      assert.equal(resource.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
      assert.match(resource.id, /^[a-v0-9]{5,1024}$/);
      assert.ok(!events.has(resource.id));
      assert.equal(resource.attendees, undefined);
      const event = {...copy(resource), status: 'confirmed',
        htmlLink: 'https://calendar.google.com/event?eid=' + resource.id,
        hangoutLink: 'https://meet.google.com/' + resource.id};
      inserted.push(copy(resource));
      events.set(event.id, event);
      return copy(event);
    },
    patch(resource, calendar, id, args) {
      assert.equal(calendar, 'primary');
      assert.equal(args.conferenceDataVersion, 1);
      assert.deepEqual(Object.keys(resource), resource.conferenceData ? ['conferenceData'] : ['start', 'end']);
      patched.push(copy(resource));
      const event = events.get(id);
      Object.assign(event, copy(resource));
      if (resource.conferenceData) event.hangoutLink = 'https://meet.google.com/' + id;
      return copy(event);
    }
  }};
  return {...e, events, inserted, patched, logs, apiError};
}

test('Meets reserva das 19h às 22h nas três datas, grava links e reaproveita os eventos', () => {
  const e = meetsEnvironment();
  const report = e.context.criarMeetsSeminfo2026();
  assert.deepEqual(Array.from(report, row => row.ATIVIDADE_ID), ['NOITE_26', 'PALESTRA_DANIELE', 'PALESTRA_JOHNATAN']);
  assert.deepEqual(e.inserted.map(event => event.start.dateTime), [
    '2026-10-26T19:00:00-03:00', '2026-10-28T19:00:00-03:00', '2026-10-29T19:00:00-03:00']);
  assert.deepEqual(e.inserted.map(event => event.end.dateTime), [
    '2026-10-27T01:00:00.000Z', '2026-10-29T01:00:00.000Z', '2026-10-30T01:00:00.000Z']);
  for (const event of e.inserted) {
    assert.equal(Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime), 10800000);
    assert.equal(event.start.timeZone, 'America/Sao_Paulo');
    assert.equal(event.end.timeZone, 'America/Sao_Paulo');
  }
  assert.equal(new Set(e.inserted.map(event => event.conferenceData.createRequest.requestId)).size, 3);
  assert.equal(e.context.tableRows_('Meets').length, 3);
  assert.ok(report.every(row => row.SITUACAO === 'PRONTO' && row.MEET));
  const again = e.context.criarMeetsSeminfo2026();
  assert.equal(e.inserted.length, 3);
  assert.equal(e.patched.length, 0);
  assert.equal(again[0].TERMINO, report[0].TERMINO);
  assert.equal(again[0].MEET, report[0].MEET);
  assert.equal(e.stats.lockHeld, false);
});

test('Meets antecipa eventos existentes das 19h30 para as 19h mantendo links e outros dados', () => {
  const e = meetsEnvironment(), original = e.context.criarMeetsSeminfo2026();
  for (const resource of e.inserted.slice(1)) {
    const event = e.events.get(resource.id);
    event.start.dateTime = event.start.dateTime.replace('19:00', '19:30');
    event.end.dateTime = event.end.dateTime.replace('01:00', '01:30');
    event.description = 'Descrição editada pela organização';
  }
  const updated = e.context.criarMeetsSeminfo2026();
  assert.equal(e.inserted.length, 3);
  assert.equal(e.patched.length, 2);
  for (let index = 0; index < updated.length; index++) {
    assert.equal(updated[index].MEET, original[index].MEET);
    assert.equal(updated[index].INICIO, original[index].INICIO);
    assert.equal(updated[index].TERMINO, original[index].TERMINO);
  }
  for (const resource of e.inserted.slice(1)) {
    const event = e.events.get(resource.id);
    assert.equal(event.description, 'Descrição editada pela organização');
    assert.equal(event.conferenceData.createRequest.requestId, resource.conferenceData.createRequest.requestId);
  }
  e.context.criarMeetsSeminfo2026();
  assert.equal(e.patched.length, 2);
  assert.equal(e.context.tableRows_('Meets')[1].INICIO, original[1].INICIO);
});

test('Meets consulta geração assíncrona e sinaliza pendência sem emitir novos pedidos', () => {
  const e = meetsEnvironment();
  e.context.criarMeetsSeminfo2026();
  const event = e.events.get(e.inserted[0].id);
  delete event.hangoutLink;
  event.conferenceData.createRequest.status = {statusCode: 'pending'};
  const pending = e.context.criarMeetsSeminfo2026();
  assert.match(pending[0].SITUACAO, /^PENDENTE:/);
  assert.equal(pending[0].MEET, '');
  assert.equal(e.patched.length, 0);
  let sleeps = 0;
  e.context.Utilities.sleep = () => {
    if (++sleeps === 2) event.conferenceData.entryPoints = [{entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij'}];
  };
  const ready = e.context.criarMeetsSeminfo2026();
  assert.equal(ready[0].MEET, 'https://meet.google.com/abc-defg-hij');
  assert.equal(ready[0].SITUACAO, 'PRONTO');
  assert.equal(e.inserted.length, 3);
});

test('Meets retoma resposta perdida após criação sem duplicar eventos', () => {
  const e = meetsEnvironment(), insert = e.context.Calendar.Events.insert;
  let interrupted = false;
  e.context.Calendar.Events.insert = (...args) => {
    const event = insert(...args);
    if (!interrupted) { interrupted = true; throw e.apiError(503); }
    return event;
  };
  assert.throws(() => e.context.criarMeetsSeminfo2026(), /Consulte a aba Meets/);
  assert.equal(e.events.size, 3);
  assert.equal(e.context.tableRows_('Meets').filter(row => row.SITUACAO === 'PRONTO').length, 2);
  assert.ok(e.context.criarMeetsSeminfo2026().every(row => row.SITUACAO === 'PRONTO'));
  assert.equal(e.inserted.length, 3);
});

test('Meets refaz somente a conferência que falhou usando novo requestId', () => {
  const e = meetsEnvironment();
  e.context.criarMeetsSeminfo2026();
  const event = e.events.get(e.inserted[0].id), oldRequest = event.conferenceData.createRequest.requestId;
  delete event.hangoutLink;
  event.conferenceData.createRequest.status = {statusCode: 'failure'};
  const patch = e.context.Calendar.Events.patch;
  e.context.Calendar.Events.patch = () => JSON.parse(JSON.stringify(event));
  assert.throws(() => e.context.criarMeetsSeminfo2026(), /Há falhas/);
  assert.match(e.context.tableRows_('Meets')[0].SITUACAO, /^ERRO:/);
  e.context.Calendar.Events.patch = patch;
  assert.ok(e.context.criarMeetsSeminfo2026().every(row => row.SITUACAO === 'PRONTO'));
  assert.equal(e.patched.length, 1);
  assert.notEqual(event.conferenceData.createRequest.requestId, oldRequest);
  assert.equal(e.inserted.length, 3);
});

test('Meets não interpreta falha de permissão como evento ausente e libera o bloqueio', () => {
  const e = meetsEnvironment();
  e.context.Calendar.Events.get = () => { throw e.apiError(403); };
  assert.throws(() => e.context.criarMeetsSeminfo2026(), /Há falhas/);
  assert.equal(e.inserted.length, 0);
  assert.ok(e.context.tableRows_('Meets').every(row => row.SITUACAO.startsWith('ERRO:')));
  assert.equal(e.stats.lockHeld, false);
});

test('Meets recusa outra conta, serviço desativado e evento excluído sem recriar', () => {
  const e = meetsEnvironment();
  e.properties.set('SEMINFO_INSTALLER', 'outra@example.org');
  assert.throws(() => e.context.criarMeetsSeminfo2026(), /conta que instalou/);
  e.properties.set('SEMINFO_INSTALLER', 'ca@example.org');
  const calendar = e.context.Calendar;
  delete e.context.Calendar;
  assert.throws(() => e.context.criarMeetsSeminfo2026(), /Habilite o serviço Google Calendar/);
  e.context.Calendar = calendar;
  e.context.criarMeetsSeminfo2026();
  e.events.get(e.inserted[0].id).status = 'cancelled';
  assert.throws(() => e.context.criarMeetsSeminfo2026(), /Há falhas/);
  assert.match(e.context.tableRows_('Meets')[0].SITUACAO, /excluído/);
  assert.equal(e.inserted.length, 3);
});

test('Meets recupera conflito de ID após criação concorrente sem novo evento', () => {
  const e = meetsEnvironment(), insert = e.context.Calendar.Events.insert;
  e.context.Calendar.Events.insert = (...args) => {
    insert(...args);
    throw Object.assign(new Error('The requested identifier already exists'), {code: 409});
  };
  assert.ok(e.context.criarMeetsSeminfo2026().every(row => row.SITUACAO === 'PRONTO'));
  assert.equal(e.inserted.length, 3);
});

test('Recuperacao da lista antiga completa as 13 equipes com as cinco ausentes sem duplicar', () => {
 const e = teamCspEnvironment(60);
 vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'RecuperacaoListaAntigaCsp.gs'), 'utf8'), e.context);
 const existingNames = ["Veneninho", "Backend Girls", "Avengers", "Vocaro.log()", "Os paredes de marmore", "67 Boys", "Sem ideia", "Cybercoders", "Kisses kisses", "Os Guri de Calcinha", "As Meninas Superpoderosas", "ProGram3rs", "Estagi\u00e1rios do Banco Master"];
 existingNames.forEach(name => e.teamResponse(name, ['Pessoa sem CPF']));
 e.context.prepararImportacaoCsp();
 assert.equal(e.context.importarInscricoesAnterioresCsp().ocupacao, 13);
 const report = e.context.importarEquipesFaltantesListaAntigaCsp();
 assert.equal(report.importadasAgora, 5);
 assert.equal(report.ocupacao, 18);
 assert.equal(e.context.tableRows_('Equipes').length, 18);
 const coffee = Object.values(e.context.readState_().registrations).find(team => team.teamName.startsWith('coffee ='));
 assert.equal(coffee.teamName, e.context.SEMINFO_EQUIPES_FALTANTES_LISTA_ANTIGA[0].teamName);
 assert.equal(coffee.members.length, 3);
 const babas = Object.values(e.context.readState_().registrations).find(team => team.teamName.startsWith('Bab'));
 assert.equal(babas.members.length, 3);
 assert.equal(babas.members[2].cpf, '');
 const cquer = Object.values(e.context.readState_().registrations).find(team => team.teamName === 'Cquer+');
 assert.equal(cquer.members.length, 3);
 assert.equal(cquer.members[0].cpf, '16977765666');
 assert.equal(cquer.members[1].name, 'Julia Tejada');
 assert.equal(cquer.members[2].cpf, '13947279680');
 const second = e.context.importarEquipesFaltantesListaAntigaCsp();
 assert.equal(second.importadasAgora, 0);
 assert.equal(second.ocupacao, 18);
 e.context.cancelarEquipeCsp(coffee.id, 'Cancelamento solicitado pela organizacao');
 assert.equal(e.context.importarEquipesFaltantesListaAntigaCsp().ocupacao, 17);
});
