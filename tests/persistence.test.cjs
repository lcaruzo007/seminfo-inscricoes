'use strict';

// Testes locais de integração do livro oficial e do fluxo real de processamento.
// Serviços Google são fronteiras simuladas; não executa no Google Apps Script.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', 'src');
const plain = value => JSON.parse(JSON.stringify(value));
const CPF = '52998224725';
const CPF2 = '11144477735';
const AT = '2026-10-08T15:00:00.000Z';

function fixture() {
  const rows = [['REGISTRO_JSON']];
  const projections = {};
  const notifications = new Map();
  const errors = [];
  const events = [];
  const faults = { beforeWrite: 0, afterWrite: 0, projection: '', queue: 0, refresh: 0 };
  let locked = false;
  let acquisitions = 0;
  let releases = 0;
  let activeLocks = 0;
  let maxActiveLocks = 0;
  let nextResponse = 0;
  let currentRequest = '';
  let lastRefreshedState = null;
  let maxRows = 4;
  const installer = 'organizacao@example.org';
  const scriptProperties = new Map([['SEMINFO_INSTALLER', installer]]);

  function fault(name) {
    if (!faults[name]) return false;
    faults[name]--;
    return true;
  }

  const scriptLock = {
    waitLock(milliseconds) {
      assert.equal(milliseconds, 30000);
      if (locked) throw new Error('Bloqueio simulado já ocupado.');
      locked = true;
      acquisitions++;
      activeLocks++;
      maxActiveLocks = Math.max(maxActiveLocks, activeLocks);
      events.push({ type: 'acquire', request: currentRequest });
    },
    releaseLock() {
      assert.equal(locked, true, 'liberação deve corresponder a uma aquisição');
      locked = false;
      activeLocks--;
      releases++;
      events.push({ type: 'release', request: currentRequest });
    }
  };

  const journalSheet = {
    getLastRow() { return rows.length; },
    getMaxRows() { return maxRows; },
    insertRowsAfter(after, amount) {
      assert.equal(after, maxRows);
      assert.ok(amount > 0);
      maxRows += amount;
      return this;
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      assert.equal(column, 1);
      assert.equal(columnCount, 1);
      return {
        setNumberFormat(format) { assert.equal(format, '@'); return this; },
        getDisplayValues() {
          events.push({ type: 'read', request: currentRequest, locked, lastRow: rows.length });
          return Array.from({ length: rowCount }, (_, index) => [String(rows[row - 1 + index]?.[0] ?? '')]);
        },
        setValue(value) {
          assert.equal(locked, true, 'append oficial deve acontecer sob ScriptLock');
          assert.equal(row, rows.length + 1, 'append deve usar a próxima célula');
          events.push({ type: 'write-attempt', request: currentRequest });
          if (fault('beforeWrite')) throw new Error('Falha simulada antes de gravar a célula oficial.');
          rows[row - 1] = [value];
          events.push({ type: 'write', request: currentRequest });
          if (fault('afterWrite')) throw new Error('Falha simulada após gravar, antes de responder ao chamador.');
          return this;
        }
      };
    }
  };

  const context = vm.createContext({
    console,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(algorithm, value, charset) {
        assert.equal(algorithm, 'SHA_256');
        assert.equal(charset, 'UTF_8');
        return Array.from(crypto.createHash('sha256').update(value, 'utf8').digest(), byte => byte > 127 ? byte - 256 : byte);
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => scriptProperties.get(key) || '',
        setProperty: (key, value) => { scriptProperties.set(key, String(value)); return this; },
        deleteProperty: key => { scriptProperties.delete(key); return this; }
      })
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => installer }) },
    LockService: { getScriptLock: () => scriptLock },
    SpreadsheetApp: {
      flush() { events.push({ type: 'flush', locked, request: currentRequest }); }
    }
  });

  for (const filename of ['Domain.gs', 'Config.gs', 'Persistence.gs']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, filename), 'utf8'), context, { filename });
  }

  // Mantém as funções reais de hash, bloqueio, leitura, commit, reconstrução,
  // decisão, processamento e tratamento de erro. Só substitui fronteiras I/O.
  context.ensureTable_ = name => {
    if (name === 'Operacoes') return journalSheet;
    if (name === 'Erros') return {
      appendRow(row) {
        const headers = plain(context.SEMINFO_TABLES.Erros);
        errors.push(Object.fromEntries(headers.map((header, index) => [header, row[index]])));
      }
    };
    throw new Error('Aba inesperada na simulação: ' + name);
  };
  context.tableRows_ = name => name === 'Erros' ? errors : [];
  context.writeTable_ = (name, headers, values) => {
    assert.equal(locked, true, 'projeções devem ser reconstruídas sob bloqueio');
    if (faults.projection === name) {
      faults.projection = '';
      projections[name] = plain(values.slice(0, 1));
      throw new Error('Falha simulada durante a projeção ' + name + '.');
    }
    projections[name] = plain(values);
  };
  context.syncNotificationQueueLocked_ = operations => {
    assert.equal(locked, true, 'reconstrução da fila deve ser protegida');
    if (fault('queue')) throw new Error('Falha simulada antes de reconstruir a fila.');
    for (const operation of operations) {
      if (operation.kind === 'REQUEST' && !notifications.has(operation.key)) {
        notifications.set(operation.key, { id: 'MAIL:' + operation.key, status: 'pendente' });
      }
    }
  };
  context.refreshFormsLocked_ = state => {
    assert.equal(locked, false, 'chamadas ao Forms não devem manter o ScriptLock');
    assert.equal(scriptProperties.has('SEMINFO_FORM_REFRESH_PENDING'), true, 'o marcador deve serializar atualizações externas');
    if (fault('refresh')) throw new Error('Falha simulada durante a atualização de opções.');
    lastRefreshedState = plain(state);
  };
  context.parseFormRequest_ = (kind, form, response) => {
    assert.equal(kind, response.request.kind);
    assert.equal(form.getId(), 'form-native-demo');
    currentRequest = response.request.key;
    return plain(response.request);
  };

  function activity(id, capacity = 3) {
    return {
      id, title: 'Atividade ' + id, type: 'oficina', description: 'Demonstração',
      instructor: 'Ministrante Fictício', location: 'Laboratório',
      start: '2026-10-19T14:00:00-03:00', end: '2026-10-19T16:00:00-03:00',
      capacity, status: 'aberta'
    };
  }

  function append(operation) {
    return context.withLock_(() => context.commitOperationLocked_(context.readJournal_(), operation));
  }

  function seed(...activities) {
    activities.forEach(item => append({ key: 'catalog-' + item.id, kind: 'CATALOG', at: AT, activity: item }));
    append({ key: 'mode-open', kind: 'MODE', at: AT, accepting: true });
  }

  function response(activityId, overrides = {}) {
    const responseId = 'response-' + (++nextResponse);
    const request = {
      key: 'form-native-demo:' + responseId, formId: 'form-native-demo', responseId,
      protocol: 'SEM-DEMO-' + nextResponse, submittedAt: AT,
      kind: 'INSCRICAO', name: 'Participante Fictício', cpf: CPF,
      email: 'participante@example.org', activityId,
      authorizeSwap: false, confirmCancel: false, ...overrides
    };
    return { request, getId: () => responseId };
  }

  const form = { getId: () => 'form-native-demo' };
  function process(responseObject) {
    return context.processFormResponse_(responseObject.request.kind, form, responseObject);
  }

  function journal() { return context.readJournal_(); }
  function occupancy(id) { return context.SemDomain.occupancy(journal().state, id); }
  function assertUnlocked() {
    assert.equal(locked, false);
    assert.equal(activeLocks, 0);
    assert.equal(acquisitions, releases);
  }

  return {
    context, rows, projections, notifications, errors, events, faults,
    activity, append, seed, response, process, journal, occupancy, assertUnlocked,
    get maxActiveLocks() { return maxActiveLocks; },
    get lastRefreshedState() { return lastRefreshedState; }
  };
}

function swapFixture() {
  const f = fixture();
  f.seed(f.activity('A'), f.activity('B', 1));
  const first = f.response('A');
  assert.equal(f.process(first).code, 'confirmed');
  const swap = f.response('B', { authorizeSwap: true });
  return { f, first, swap };
}

function assertCompletedSwap(f, swap) {
  const journal = f.journal();
  assert.equal(journal.byKey[swap.request.key].outcome.code, 'swapped');
  assert.equal(f.occupancy('A'), 0);
  assert.equal(f.occupancy('B'), 1);
  assert.equal(Object.values(journal.state.registrations).filter(r => r.status === 'cancelada por troca').length, 1);
  assert.equal(Object.values(journal.state.registrations).filter(r => r.status === 'confirmada').length, 1);
  f.assertUnlocked();
}

test('Persistência: falha antes da célula oficial preserva inscrição anterior durante troca', () => {
  const { f, swap } = swapFixture();
  const countBefore = f.rows.length;
  f.faults.beforeWrite = 1;
  assert.throws(() => f.process(swap), /antes de gravar/);
  assert.equal(f.rows.length, countBefore);
  assert.equal(f.journal().byKey[swap.request.key], undefined);
  assert.equal(f.occupancy('A'), 1);
  assert.equal(f.occupancy('B'), 0);
  f.assertUnlocked();
  assert.equal(f.process(swap).code, 'swapped');
  assertCompletedSwap(f, swap);
});

test('Persistência: falha após mutação da célula recupera a troca pelo replay sem novo append', () => {
  const { f, swap } = swapFixture();
  const countBefore = f.rows.length;
  f.faults.afterWrite = 1;
  assert.throws(() => f.process(swap), /após gravar/);
  assert.equal(f.rows.length, countBefore + 1, 'a gravação ocorreu apesar do erro do chamador');
  assertCompletedSwap(f, swap);
  assert.equal(f.process(swap).code, 'swapped');
  assert.equal(f.rows.length, countBefore + 1, 'mesma resposta não deve inserir nova operação');
  assert.equal(f.journal().operations.filter(op => op.key === swap.request.key).length, 1);
  assertCompletedSwap(f, swap);
});

for (const stage of ['projection', 'queue', 'refresh']) {
  const description = { projection: 'projeção parcial', queue: 'fila de notificações', refresh: 'opções do Forms' }[stage];
  test('Persistência: erro na ' + description + ' após append é recuperado sem desfazer nem repetir troca', () => {
    const { f, swap } = swapFixture();
    const countBefore = f.rows.length;
    if (stage === 'projection') f.faults.projection = 'Inscricoes';
    else f.faults[stage] = 1;
    assert.throws(() => f.process(swap), /Falha simulada/);
    assert.equal(f.rows.length, countBefore + 1);
    assertCompletedSwap(f, swap);
    assert.equal(f.process(swap).code, 'swapped');
    assert.equal(f.rows.length, countBefore + 1);
    const confirmed = f.projections.Inscricoes.filter(row => row[3] === 'confirmada');
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0][2], 'B');
    assert.equal(f.projections.Inscricoes.filter(row => row[3] === 'cancelada por troca').length, 1);
    assert.equal(f.notifications.size, 2, 'cada solicitação tem um ID de notificação estável na fronteira simulada');
    assert.equal(f.notifications.has(swap.request.key), true);
    assert.equal(f.context.SemDomain.occupancy(f.lastRefreshedState, 'A'), 0);
    assert.equal(f.context.SemDomain.occupancy(f.lastRefreshedState, 'B'), 1);
    assertCompletedSwap(f, swap);
  });
}

test('Persistência: commit com chave já registrada retorna original sem duplicar célula', () => {
  const f = fixture();
  f.seed(f.activity('A'));
  const response = f.response('A');
  assert.equal(f.process(response).code, 'confirmed');
  const original = f.journal().byKey[response.request.key];
  const countBefore = f.rows.length;
  assert.deepEqual(plain(f.append(original)), plain(original));
  assert.equal(f.rows.length, countBefore);
  assert.equal(f.process(response).code, 'confirmed');
  assert.equal(f.rows.length, countBefore);
  assert.equal(f.occupancy('A'), 1);
  f.assertUnlocked();
});

for (const damage of ['payload', 'previous', 'truncated', 'blank']) {
  test('Persistência: cadeia com dano ' + damage + ' bloqueia leitura e novas decisões', () => {
    const f = fixture();
    f.seed(f.activity('A'));
    if (damage === 'blank') f.rows.push(['']);
    else if (damage === 'truncated') f.rows.push(['{"v":1,"previous":']);
    else {
      const envelope = JSON.parse(f.rows[1][0]);
      if (damage === 'payload') envelope.payload = envelope.payload.replace('Atividade A', 'Atividade alterada');
      else {
        envelope.previous = 'HEAD_INCORRETO';
        envelope.hash = f.context.hash_(envelope.previous + '\n' + envelope.payload);
      }
      f.rows[1][0] = JSON.stringify(envelope);
    }
    assert.throws(() => f.journal(), /Livro oficial inválido/);
    const countBefore = f.rows.length;
    assert.throws(() => f.process(f.response('A')), /Livro oficial inválido/);
    assert.equal(f.rows.length, countBefore, 'livro inválido não pode receber nova decisão');
    f.assertUnlocked();
  });
}

test('Persistência: chave repetida com payload divergente em cadeia selada é recusada', () => {
  const f = fixture();
  f.seed(f.activity('A'));
  const journal = f.journal();
  const divergent = plain(journal.byKey['catalog-A']);
  divergent.activity.capacity = 4;
  const payload = JSON.stringify(divergent);
  const envelope = { v: 1, previous: journal.head, payload, hash: f.context.hash_(journal.head + '\n' + payload) };
  f.rows.push([JSON.stringify(envelope)]);
  assert.throws(() => f.journal(), /Livro oficial inválido/);
});

test('Persistência: dois pedidos pela última vaga usam releitura serializada (simulação local, sem Google)', async () => {
  const f = fixture();
  f.seed(f.activity('A', 1));
  const first = f.response('A');
  const second = f.response('A', { cpf: CPF2, email: 'outra@example.org' });
  const stale = f.journal().state;
  assert.equal(f.context.SemDomain.decide(stale, first.request).code, 'confirmed');
  assert.equal(f.context.SemDomain.decide(stale, second.request).code, 'confirmed');
  f.events.length = 0;
  // Chamadas colocadas na mesma fila de microtasks. A API Apps Script é síncrona;
  // isto verifica o protocolo de bloqueio/releitura, não concorrência distribuída.
  const outcomes = await Promise.all([
    Promise.resolve().then(() => f.process(first)),
    Promise.resolve().then(() => f.process(second))
  ]);
  assert.deepEqual(outcomes.map(outcome => outcome.code), ['confirmed', 'full']);
  const reads = f.events.filter(event => event.type === 'read');
  assert.ok(reads.length >= 4);
  assert.equal(reads.every(event => event.locked), true, 'leituras de processamento acontecem dentro do bloqueio');
  const firstRead = reads.find(event => event.request === first.request.key);
  const secondRead = reads.find(event => event.request === second.request.key);
  assert.ok(secondRead.lastRow > firstRead.lastRow, 'segundo pedido releu o resultado durável do primeiro');
  assert.equal(f.maxActiveLocks, 1);
  assert.equal(f.occupancy('A'), 1);
  assert.equal(f.journal().operations.filter(op => op.kind === 'REQUEST' && op.outcome.code === 'confirmed').length, 1);
  f.assertUnlocked();
});

test('Persistência: rotina de reconstrução administrativa recupera projeções da fonte oficial', () => {
  const { f, swap } = swapFixture();
  f.faults.projection = 'Participantes';
  assert.throws(() => f.process(swap), /projeção/);
  const countBefore = f.rows.length;
  const operationCount = f.context.reconstruirVisoes();
  assert.equal(operationCount, f.journal().operations.length);
  assert.equal(f.rows.length, countBefore);
  assert.equal(f.projections.Inscricoes.filter(row => row[3] === 'confirmada')[0][2], 'B');
  assert.equal(f.notifications.has(swap.request.key), true);
  assertCompletedSwap(f, swap);
});

test('Persistência: três falhas de atualização após commit não geram aviso de falha contraditório', () => {
  const f = fixture();
  f.seed(f.activity('A'));
  const response = f.response('A');
  const countBefore = f.rows.length;
  f.faults.refresh = 3;
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => f.process(response), /atualização de opções/);
  }
  assert.equal(f.errors.filter(error => error.CHAVE === response.request.key).length, 3);
  assert.equal(f.rows.length, countBefore + 1);
  assert.equal(f.journal().byKey[response.request.key].outcome.code, 'confirmed');
  assert.equal(f.occupancy('A'), 1);
  assert.deepEqual(Array.from(f.notifications.values(), notification => notification.id), ['MAIL:' + response.request.key]);
  assert.equal(f.notifications.has('FALHA:' + response.request.key), false);
  assert.equal(f.process(response).code, 'confirmed');
  assert.equal(f.rows.length, countBefore + 1);
  assert.equal(f.notifications.size, 1);
  f.assertUnlocked();
});

test('Persistência: três falhas antes do commit mantêm pedido pendente e geram aviso de atendimento', () => {
  const f = fixture();
  f.seed(f.activity('A'));
  const response = f.response('A');
  const countBefore = f.rows.length;
  f.faults.beforeWrite = 3;
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => f.process(response), /antes de gravar/);
  }
  assert.equal(f.rows.length, countBefore);
  assert.equal(f.journal().byKey[response.request.key], undefined);
  assert.equal(f.occupancy('A'), 0);
  assert.deepEqual(Array.from(f.notifications.values(), notification => notification.id), ['MAIL:FALHA:' + response.request.key]);
  f.assertUnlocked();
});
