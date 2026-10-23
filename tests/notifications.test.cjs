'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(overrides = {}) {
  const sheets = new Map();
  const sent = [];
  let depth = 0;
  let quota = overrides.quota === undefined ? 100 : overrides.quota;
  let fail = overrides.fail || null;
  const config = {
    EMAIL_CA: 'ca@example.org', ENVIAR_COPIA_CA: true,
    NOME_REMETENTE: 'SEMINFO — Centro Acadêmico Alan Turing', MAX_EMAILS_POR_EXECUCAO: 10,
    ...overrides.config
  };
  function sheet(name) {
    const data = [];
    return {
      name, data,
      getLastRow() { return data.length; },
      getMaxRows() { return 1000; },
      insertRowsAfter() {},
      setFrozenRows() {},
      getRange(row, col, height, width) {
        return {
          getValues() {
            return Array.from({ length: height }, (_, y) =>
              Array.from({ length: width }, (_, x) => data[row + y - 1]?.[col + x - 1] ?? ''));
          },
          setNumberFormat() { return this; },
          setValues(values) {
            assert.equal(values.length, height);
            for (let y = 0; y < height; y++) {
              assert.equal(values[y].length, width);
              data[row + y - 1] ||= [];
              for (let x = 0; x < width; x++) data[row + y - 1][col + x - 1] = values[y][x];
            }
            return this;
          }
        };
      }
    };
  }
  const context = vm.createContext({
    console, Date, Math, Number, Object, String, JSON,
    getConfig_: () => ({ ...config }),
    requireInstaller_: () => {},
    db_: () => ({
      getSheetByName: name => sheets.get(name),
      insertSheet: name => { const created = sheet(name); sheets.set(name, created); return created; }
    }),
    SpreadsheetApp: { flush() {} },
    Utilities: {
      formatDate(date, timezone) {
        assert.equal(timezone, 'America/Sao_Paulo');
        return new Intl.DateTimeFormat('pt-BR', {
          timeZone: timezone, dateStyle: 'short', timeStyle: 'short'
        }).format(date);
      }
    },
    withLock_(fn) {
      assert.equal(depth, 0, 'não há locks aninhados');
      depth++;
      try { return fn(); } finally { depth--; }
    },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail(message) {
        assert.equal(depth, 0, 'envio deve ocorrer fora do bloqueio');
        if (fail) throw fail;
        const addresses = new Set([message.to, message.cc].filter(Boolean));
        assert.ok(quota >= addresses.size, 'destinatários precisam caber na cota');
        quota -= addresses.size;
        sent.push(message);
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Notifications.gs'), 'utf8'), context);
  return {
    context, sent, config,
    setQuota(value) { quota = value; },
    setFailure(value) { fail = value; },
    sync(operations) { return context.withLock_(() => context.syncNotificationQueueLocked_(operations)); },
    rows() { return context.notificationRows_(sheets.get('FilaEmails')); },
    update(row) { context.withLock_(() => context.writeNotificationRow_(sheets.get('FilaEmails'), row)); }
  };
}

const activity = {
  id: 'O01', title: 'Oficina de testes', start: '2026-10-20T14:00:00-03:00',
  end: '2026-10-20T16:00:00-03:00', location: 'Laboratório 1'
};
function operation(key = 'FORM:RESPOSTA1', code = 'confirmed', extraOutcome = {}) {
  return {
    key, at: '2026-10-08T12:00:00Z', kind: 'REQUEST',
    request: {
      key, kind: 'REGISTER', cpf: '01234567890', name: 'Pessoa fictícia',
      email: 'pessoa@example.org', activityId: activity.id, protocol: 'SEM-TESTE'
    },
    outcome: {
      code, activity,
      changes: [{ type: 'CONFIRM', registration: { id: 'I01', activity } }],
      ...extraOutcome
    }
  };
}

test('fila é idempotente e preserva estado enviada; confirmação contém dados e nenhum CPF', () => {
  const env = setup();
  assert.equal(env.sync([operation(), operation()]), 1);
  assert.equal(env.rows().length, 1);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 1);
  assert.equal(env.rows()[0].SITUACAO, 'enviada');
  assert.equal(env.sync([operation()]), 0);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 1);
  assert.match(env.sent[0].body, /Oficina de testes/);
  assert.match(env.sent[0].body, /Laboratório 1/);
  assert.match(env.sent[0].body, /SEM-TESTE/);
  assert.ok(!env.sent[0].body.includes(operation().request.cpf));
  assert.equal(env.sent[0].replyTo, 'ca@example.org');
  assert.ok(!env.sent[0].cc, 'confirmação não envia cópia ao CA');
  assert.ok(!Object.hasOwn(env.sent[0], 'from'));
});

test('cota é de destinatários: CC exige duas unidades e falta de cota mantém fila pendente', () => {
  const env = setup({ quota: 1 });
  env.sync([operation('FORM:RESPOSTA1', 'conflict', {changes: []})]);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 0);
  const pending = env.rows()[0];
  assert.equal(pending.SITUACAO, 'pendente');
  assert.equal(pending.TENTATIVAS, 0);
  assert.match(pending.ERRO, /^SEM_COTA/);
  env.setQuota(2);
  pending.PROXIMA_TENTATIVA = '';
  env.update(pending);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 1);
  assert.equal(env.rows()[0].SITUACAO, 'enviada');
});

test('cópia desativada ou mesmo destinatário utiliza só uma unidade', () => {
  for (const config of [{ ENVIAR_COPIA_CA: false }, { EMAIL_CA: 'pessoa@example.org' }]) {
    const env = setup({ quota: 1, config });
    env.sync([operation('FORM:RESPOSTA1', 'conflict', {changes: []})]);
    env.context.processarNotificacoes();
    assert.equal(env.sent.length, 1);
    assert.ok(!env.sent[0].cc);
  }
});

test('falha de envio mantém mensagem e tentativa, agenda backoff e sanitiza dados privados', () => {
  const env = setup({ fail: new Error('Backend unavailable for pessoa@example.org CPF 01234567890') });
  env.sync([operation()]);
  const before = Date.now();
  env.context.processarNotificacoes();
  const row = env.rows()[0];
  assert.equal(row.SITUACAO, 'pendente');
  assert.equal(row.TENTATIVAS, 1);
  assert.ok(new Date(row.PROXIMA_TENTATIVA).getTime() >= before + 5 * 60 * 1000);
  assert.ok(!row.ERRO.includes('pessoa@'));
  assert.ok(!row.ERRO.includes('01234567890'));
  env.setFailure(null);
  row.PROXIMA_TENTATIVA = '';
  env.update(row);
  env.context.processarNotificacoes();
  assert.equal(env.rows()[0].SITUACAO, 'enviada');
  assert.equal(env.rows()[0].TENTATIVAS, 2);
});

test('lease ativa evita novo envio e reserva cota para outra execução; lease expirada permite retomar', () => {
  const env = setup({ quota: 2 });
  env.sync([operation('FORM:RESPOSTA1', 'conflict', {changes: []}), operation('FORM:RESPOSTA2', 'conflict', {changes: []})]);
  const claim = env.context.withLock_(() => env.context.claimNotificationLocked_());
  assert.equal(claim.ID, 'MAIL:FORM:RESPOSTA1');
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 0, 'outra execução precisa respeitar a reserva de duas unidades');
  const expired = env.rows()[0];
  expired.LEASE_ATE = '2020-01-01T00:00:00Z';
  env.update(expired);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 1);
  assert.equal(env.rows()[0].TENTATIVAS, 2);
});

test('finalização atrasada não sobrescreve claim mais recente', () => {
  const env = setup();
  env.sync([operation()]);
  const oldClaim = env.context.withLock_(() => env.context.claimNotificationLocked_());
  const expired = env.rows()[0];
  expired.LEASE_ATE = '2020-01-01T00:00:00Z';
  env.update(expired);
  const newClaim = env.context.withLock_(() => env.context.claimNotificationLocked_());
  assert.equal(env.context.withLock_(() => env.context.finishNotificationLocked_(oldClaim, '')), false);
  assert.equal(env.rows()[0].SITUACAO, 'processando');
  assert.equal(env.context.withLock_(() => env.context.finishNotificationLocked_(newClaim, '')), true);
});

test('identidade incompatível não divulga snapshots ou cadastro original', () => {
  const env = setup();
  const source = operation('FORM:OUTRO', 'identity_mismatch', {
    participant: { name: 'Nome sigiloso', email: 'original@example.org' },
    activity: { ...activity, title: 'Inscrição sigilosa' }
  });
  env.sync([source]);
  const body = env.rows()[0].CORPO;
  assert.match(body, /Nenhuma inscrição foi alterada/);
  for (const secret of ['Nome sigiloso', 'original@example.org', 'Inscrição sigilosa', source.request.cpf]) {
    assert.ok(!body.includes(secret));
  }
});

test('troca informa todas as atividades canceladas e os detalhes da nova inscrição', () => {
  const env = setup();
  env.sync([operation('FORM:TROCA', 'swapped', {
    changes: [
      { type: 'CANCEL', registrationId: 'ANT1', activity: { ...activity, title: 'Oficina anterior A' } },
      { type: 'CANCEL', registrationId: 'ANT2', activity: { ...activity, title: 'Oficina anterior B' } },
      { type: 'CONFIRM', registration: { activity } }
    ]
  })]);
  const body = env.rows()[0].CORPO;
  for (const title of ['Oficina anterior A', 'Oficina anterior B', 'Oficina de testes']) assert.ok(body.includes(title));
});

test('limite de lote respeita configuração e itens enviados não são reenviados', () => {
  const env = setup({ config: { MAX_EMAILS_POR_EXECUCAO: 2 } });
  env.sync([operation('F:R1'), operation('F:R2'), operation('F:R3')]);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 2);
  assert.equal(env.rows().filter(row => row.SITUACAO === 'pendente').length, 1);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 3);
});

test('sem endereço válido não cria notificação; todos os códigos previstos têm modelo', () => {
  const env = setup();
  const source = operation();
  source.request.email = '';
  assert.equal(env.sync([source]), 0);
  for (const code of ['confirmed', 'swapped', 'full', 'conflict', 'duplicate', 'canceled', 'no_active', 'invalid', 'identity_mismatch', 'closed', 'missing_activity', 'failure']) {
    const message = env.context.notificationTemplate_(operation('F:' + code, code), env.config);
    assert.match(message.subject, /^SEMINFO/);
    assert.match(message.body, /Protocolo da solicitação/);
  }
});

test('identificador duplicado na planilha bloqueia o envio para impedir duplicidade', () => {
  const env = setup();
  env.sync([operation()]);
  const duplicate = { ...env.rows()[0], _row: 3 };
  env.update(duplicate);
  assert.throws(() => env.context.processarNotificacoes(), /duplicado/);
  assert.equal(env.sent.length, 0);
});

test('interrupção depois do envio antes do sucesso pode produzir duplicata após lease', () => {
  const env = setup();
  env.sync([operation()]);
  const claim = env.context.withLock_(() => env.context.claimNotificationLocked_());
  env.context.MailApp.sendEmail({ to: claim.DESTINATARIO, cc: claim.CC, body: claim.CORPO, subject: claim.ASSUNTO });
  // Simula a interrupção: não chama finishNotificationLocked_.
  claim.LEASE_ATE = '2020-01-01T00:00:00Z';
  env.update(claim);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 2, 'MailApp não fornece chave idempotente ou confirmação de entrega');
  assert.equal(env.rows()[0].SITUACAO, 'enviada');
});

test('prazo global expirado encerra lote sem reservar ou enviar uma mensagem', () => {
  const env = setup();
  env.sync([operation()]);
  env.context.processarNotificacoes(Date.now() - 1);
  assert.equal(env.sent.length, 0);
  assert.equal(env.rows()[0].SITUACAO, 'pendente');
  assert.equal(env.rows()[0].TENTATIVAS, 0);
});

function capacityCatalog(id = 'O01', capacity = 2, key = 'CAT:' + id) {
  return {key, kind: 'CATALOG', at: '2026-10-09T14:00:00Z', activity: {...activity, id, capacity}};
}
function capacityConfirmation(key, activityId = 'O01') {
  return operation(key, 'confirmed', {changes: [{type: 'CONFIRM', registration: {id: key + ':inscricao', activityId, activity}}]});
}
function capacityAlerts(env) { return env.rows().filter(row => row.ID.startsWith('MAIL:CAPACIDADE:')); }

test('sucessos só vão ao participante; conflitos e demais problemas têm cópia ao CA', () => {
  const env = setup();
  const successes = ['confirmed', 'swapped', 'canceled'];
  const problems = ['conflict', 'full', 'duplicate', 'invalid', 'identity_mismatch', 'no_active', 'closed', 'missing_activity', 'failure'];
  env.sync([...successes, ...problems].map(code => operation('F:' + code, code, {changes: []})));
  for (const row of env.rows()) {
    assert.equal(row.DESTINATARIO, 'pessoa@example.org');
    assert.equal(row.CC, successes.some(code => row.ID === 'MAIL:F:' + code) ? '' : 'ca@example.org');
  }
});

test('última vaga cria um único aviso direto ao CA, prioritário mesmo com só uma unidade de cota', () => {
  const env = setup({quota: 1, config: {MAX_EMAILS_POR_EXECUCAO: 1}});
  const catalog = capacityCatalog(), first = capacityConfirmation('F:PRIMEIRA'), last = capacityConfirmation('F:ULTIMA');
  env.sync([catalog, first]);
  assert.equal(capacityAlerts(env).length, 0);
  assert.equal(env.sync([catalog, first, last]), 2, 'confirmação da última vaga mais aviso ao CA');
  const alert = capacityAlerts(env)[0];
  assert.equal(alert.DESTINATARIO, 'ca@example.org'); assert.equal(alert.CC, '');
  assert.match(alert.CORPO, /Ocupação confirmada: 2\/2/);
  assert.ok(!alert.CORPO.includes(last.request.cpf));
  assert.equal(env.sync([catalog, first, last, last]), 0);
  env.context.processarNotificacoes();
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].to, 'ca@example.org');
  assert.match(env.sent[0].subject, /Capacidade atingida/);
  assert.equal(capacityAlerts(env)[0].SITUACAO, 'enviada');
  assert.equal(env.rows().find(row => row.ID === 'MAIL:F:ULTIMA').SITUACAO, 'pendente');
  const denied = operation('F:LOTADA', 'full', {changes: []});
  env.sync([catalog, first, last, denied]);
  assert.equal(capacityAlerts(env).length, 1, 'solicitação recusada não repete alerta de capacidade');
});

test('cancelamento libera vaga e uma nova lotação gera outro aviso sem repetir o anterior', () => {
  const env = setup();
  const catalog = capacityCatalog('O01', 1), first = capacityConfirmation('F:ANTIGA');
  env.sync([catalog, first]); env.context.processarNotificacoes();
  const canceled = operation('F:CANCELADA', 'canceled', {changes: [{type: 'CANCEL', registrationId: 'F:ANTIGA:inscricao'}]});
  env.sync([catalog, first, canceled]);
  assert.equal(capacityAlerts(env).length, 1);
  const renewed = capacityConfirmation('F:NOVA');
  env.sync([catalog, first, canceled, renewed]);
  assert.equal(capacityAlerts(env).length, 2);
  assert.equal(capacityAlerts(env)[0].SITUACAO, 'enviada');
  assert.equal(capacityAlerts(env)[1].SITUACAO, 'pendente');
  assert.equal(env.sync([catalog, first, canceled, renewed]), 0);
});

test('recuperação de troca avisa somente a lotação vigente e usa o cadastro da atividade correta', () => {
  const env = setup();
  const a = capacityCatalog('A', 1), b = capacityCatalog('B', 1);
  b.activity.title = 'Oficina B';
  const first = capacityConfirmation('F:ANTERIOR', 'A');
  const swap = operation('F:TROCA', 'swapped', {changes: [
    {type: 'CANCEL', registrationId: 'F:ANTERIOR:inscricao'},
    {type: 'CONFIRM', registration: {id: 'F:TROCA:inscricao', activityId: 'B', activity: b.activity}}
  ]});
  env.sync([a, b, first, swap]);
  assert.equal(capacityAlerts(env).length, 1);
  assert.match(capacityAlerts(env)[0].CORPO, /ID da atividade: B/);
  assert.match(capacityAlerts(env)[0].ASSUNTO, /Oficina B/);
  assert.equal(env.rows().find(row => row.ID === 'MAIL:F:TROCA').CC, '');
});

test('reduzir capacidade até a ocupação gera aviso; atividade sem inscritos não gera alerta', () => {
  const env = setup();
  const catalog = capacityCatalog('O01', 3), a = capacityConfirmation('F:A'), b = capacityConfirmation('F:B');
  env.sync([catalog, a, b]);
  assert.equal(capacityAlerts(env).length, 0);
  const reduction = capacityCatalog('O01', 2, 'CAT:REDUCAO');
  env.sync([catalog, a, b, reduction]);
  assert.equal(capacityAlerts(env).length, 1);
  assert.match(capacityAlerts(env)[0].CORPO, /2\/2/);
  assert.equal(capacityAlerts(env)[0].OPERACAO, reduction.key);
});

test('programação final projeta novas capacidades no aviso ao CA sem duplicar alertas', () => {
  const env = setup();
  const initial = capacityCatalog('O01', 3), first = capacityConfirmation('F:A'), second = capacityConfirmation('F:B');
  const update = {key: 'PROGRAM:FINAL', kind: 'PROGRAM_UPDATE', at: '2026-10-23T12:00:00Z',
    activities: [{...initial.activity, capacity: 2, title: 'Título final'}]};
  const operations = [initial, first, second, update];
  env.sync(operations);
  assert.equal(capacityAlerts(env).length, 1);
  assert.match(capacityAlerts(env)[0].CORPO, /2\/2/);
  assert.match(capacityAlerts(env)[0].ASSUNTO, /Título final/);
  assert.equal(env.sync(operations), 0);
});

test('atualização remove CC dos sucessos pendentes e preserva enviados, claims ativos e problemas', () => {
  const env = setup();
  const operations = [operation('F:PENDENTE'), operation('F:ENVIADA'), operation('F:ATIVA'), operation('F:PROBLEMA', 'conflict', {changes: []})];
  env.sync(operations);
  const rows = env.rows();
  rows[0].CC = 'ca@example.org'; env.update(rows[0]);
  rows[1].CC = 'ca@example.org'; rows[1].SITUACAO = 'enviada'; env.update(rows[1]);
  rows[2].CC = 'ca@example.org'; rows[2].SITUACAO = 'processando'; rows[2].LEASE_ATE = '2099-01-01T00:00:00Z'; env.update(rows[2]);
  assert.equal(env.sync(operations), 0);
  const updated = env.rows();
  assert.equal(updated[0].CC, '');
  assert.equal(updated[1].CC, 'ca@example.org');
  assert.equal(updated[2].CC, 'ca@example.org');
  assert.equal(updated[3].CC, 'ca@example.org');
});
