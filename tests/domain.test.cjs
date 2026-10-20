'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Domain.gs'), 'utf8'), context, { filename: 'Domain.gs' });
const D = context.SemDomain;
const plain = value => JSON.parse(JSON.stringify(value));
const CPF = '52998224725';
const CPF2 = '11144477735';
const ZERO_CPF = '01234567890';
const AT = '2026-10-08T12:00:00-03:00';
let counter = 0;

function activity(id, overrides = {}) {
  return {
    id, title: 'Atividade ' + id, type: 'oficina', description: 'Demonstração',
    instructor: 'Pessoa Fictícia', location: 'Laboratório',
    start: '2026-10-19T14:00:00-03:00', end: '2026-10-19T16:00:00-03:00',
    capacity: 10, status: 'aberta', ...overrides
  };
}

function catalog(...activities) {
  const initial = D.applyOperation(D.createState(), { key: 'test-open-' + (++counter), kind: 'MODE', at: AT, accepting: true });
  return activities.reduce((state, item) => D.applyOperation(state, {
    key: 'catalog-' + (++counter), kind: 'CATALOG', at: AT, activity: item
  }), initial);
}

function request(activityId, overrides = {}) {
  return {
    key: 'form-demo:response-' + (++counter), kind: 'INSCRICAO',
    cpf: CPF, name: 'Participante Fictício', email: 'participante@example.org',
    activityId, authorizeSwap: false, confirmCancel: false,
    protocol: 'SEM-DEMO-' + counter, submittedAt: AT, ...overrides
  };
}

function submit(state, input) {
  const before = JSON.stringify(state);
  const outcome = D.decide(state, input);
  assert.equal(JSON.stringify(state), before, 'decide não deve alterar o estado recebido');
  const operation = { key: input.key, kind: 'REQUEST', at: input.submittedAt, request: input, outcome };
  const next = D.applyOperation(state, operation);
  assert.equal(JSON.stringify(state), before, 'applyOperation não deve alterar o estado recebido');
  return { state: next, outcome, operation };
}

test('1. Confirma inscrição com vaga e registra CPF como texto', () => {
  const { state, outcome } = submit(catalog(activity('A')), request('A'));
  assert.equal(outcome.code, 'confirmed');
  assert.equal(D.occupancy(state, 'A'), 1);
  assert.equal(state.participants[CPF].cpf, CPF);
  assert.equal(typeof state.participants[CPF].cpf, 'string');
  assert.equal(Object.values(state.registrations)[0].activity.start, '2026-10-19T17:00:00.000Z');
  assert.equal(D.validateState(state), true);
});

test('2. Rejeita atividade lotada contando somente confirmações', () => {
  let state = submit(catalog(activity('A', { capacity: 1 })), request('A')).state;
  const next = submit(state, request('A', { cpf: CPF2, email: 'outra@example.org' }));
  assert.equal(next.outcome.code, 'full');
  assert.equal(D.occupancy(next.state, 'A'), 1);
  assert.equal(next.state.participants[CPF2].email, 'outra@example.org', 'primeiro envio válido vincula a identidade mesmo sem vaga');
});

test('3. Valida CPF, preserva zero inicial e rejeita caracteres diferentes da máscara', () => {
  assert.equal(D.normalizeCpf(' 529.982.247-25\t'), CPF);
  assert.equal(D.normalizeCpf('012.345.678-90'), ZERO_CPF);
  for (const bad of ['52998224724', '00000000000', '11111111111', '5299822472', 'a52998224725', '529/982/24725', '+52998224725', 52998224725]) {
    assert.throws(() => D.normalizeCpf(bad), /CPF/);
  }
  const state = catalog(activity('A'));
  assert.equal(D.decide(state, request('A', { cpf: '00000000000' })).code, 'invalid');
  const valid = submit(state, request('A', { cpf: ZERO_CPF }));
  assert.equal(valid.outcome.code, 'confirmed');
  assert.equal(valid.state.participants[ZERO_CPF].cpf, ZERO_CPF);
});

test('4. Inscrição duplicada não ocupa outra vaga', () => {
  const state = submit(catalog(activity('A')), request('A')).state;
  const next = submit(state, request('A'));
  assert.equal(next.outcome.code, 'duplicate');
  assert.equal(next.outcome.changes.length, 0);
  assert.equal(D.occupancy(next.state, 'A'), 1);
});

test('5. Detecta conflitos totais e parciais em ambas as direções', () => {
  const state = submit(catalog(activity('A'), activity('B'), activity('C', {
    start: '2026-10-19T15:00:00-03:00', end: '2026-10-19T17:00:00-03:00'
  }), activity('D', {
    start: '2026-10-19T13:00:00-03:00', end: '2026-10-19T15:00:00-03:00'
  })), request('A')).state;
  for (const id of ['B', 'C', 'D']) {
    assert.equal(D.decide(state, request(id)).code, 'conflict');
  }
  assert.equal(D.occupancy(state, 'A'), 1);
});

test('6. Permite atividades consecutivas e horários iguais em dias diferentes', () => {
  let state = catalog(activity('A'), activity('B', {
    start: '2026-10-19T16:00:00-03:00', end: '2026-10-19T18:00:00-03:00'
  }), activity('C', {
    start: '2026-10-20T14:00:00-03:00', end: '2026-10-20T16:00:00-03:00'
  }));
  for (const id of ['A', 'B', 'C']) {
    const step = submit(state, request(id));
    assert.equal(step.outcome.code, 'confirmed');
    state = step.state;
  }
  assert.equal(D.confirmedFor(state, CPF).length, 3);
});

test('7. Troca exige autorização explícita e preserva histórico', () => {
  const state = submit(catalog(activity('A'), activity('B')), request('A')).state;
  const denied = submit(state, request('B', { authorizeSwap: false }));
  assert.equal(denied.outcome.code, 'conflict');
  assert.equal(D.occupancy(denied.state, 'A'), 1);
  assert.equal(D.occupancy(denied.state, 'B'), 0);
  const allowed = submit(denied.state, request('B', { authorizeSwap: true }));
  assert.equal(allowed.outcome.code, 'swapped');
  assert.equal(D.occupancy(allowed.state, 'A'), 0);
  assert.equal(D.occupancy(allowed.state, 'B'), 1);
  assert.ok(Object.values(allowed.state.registrations).some(r => r.status === 'cancelada por troca'));
});

test('8. Uma troca substitui todas as inscrições conflitantes', () => {
  let state = catalog(activity('A', { end: '2026-10-19T15:00:00-03:00' }), activity('B', {
    start: '2026-10-19T15:00:00-03:00', end: '2026-10-19T16:00:00-03:00'
  }), activity('C'));
  state = submit(state, request('A')).state;
  state = submit(state, request('B')).state;
  const swap = submit(state, request('C', { authorizeSwap: true }));
  assert.equal(swap.outcome.code, 'swapped');
  assert.equal(swap.outcome.changes.filter(c => c.type === 'CANCEL').length, 2);
  assert.equal(swap.outcome.canceledActivities.length, 2);
  assert.deepEqual(plain(D.confirmedFor(swap.state, CPF).map(r => r.activityId)), ['C']);
  assert.equal(Object.values(swap.state.registrations).filter(r => r.status === 'cancelada por troca').length, 2);
});

test('9. Atividade lotada mantém todas as inscrições anteriores mesmo com autorização', () => {
  let state = catalog(activity('A'), activity('B', { capacity: 1 }));
  state = submit(state, request('A')).state;
  state = submit(state, request('B', { cpf: CPF2, email: 'outra@example.org' })).state;
  const full = submit(state, request('B', { authorizeSwap: true }));
  assert.equal(full.outcome.code, 'full');
  assert.equal(full.outcome.changes.length, 0);
  assert.deepEqual(plain(D.confirmedFor(full.state, CPF).map(r => r.activityId)), ['A']);
});

test('10. Simula a ordem serializada do bloqueio na disputa pela última vaga', () => {
  const state = catalog(activity('A', { capacity: 1 }));
  const winner = submit(state, request('A'));
  const loser = submit(winner.state, request('A', { cpf: CPF2, email: 'outra@example.org' }));
  assert.equal(winner.outcome.code, 'confirmed');
  assert.equal(loser.outcome.code, 'full');
  assert.equal(D.occupancy(loser.state, 'A'), 1);
  // Esta simulação valida a regra após releitura; concorrência real do
  // LockService exige duas respostas na instalação Google (teste proposto).
});

test('11. Cancelamento libera vaga uma vez e aceita atividade lotada', () => {
  const initial = submit(catalog(activity('A', { capacity: 1 })), request('A')).state;
  const canceled = submit(initial, request('A', { kind: 'CANCELAMENTO', confirmCancel: true }));
  assert.equal(canceled.outcome.code, 'canceled');
  assert.equal(D.occupancy(canceled.state, 'A'), 0);
  assert.equal(Object.values(canceled.state.registrations)[0].status, 'cancelada');
  const repeated = submit(canceled.state, request('A', { kind: 'CANCELAMENTO', confirmCancel: true }));
  assert.equal(repeated.outcome.code, 'no_active');
  assert.equal(D.occupancy(repeated.state, 'A'), 0);
  const next = submit(repeated.state, request('A', { cpf: CPF2, email: 'outra@example.org' }));
  assert.equal(next.outcome.code, 'confirmed');
});

test('12. Reprocessar a mesma chave de formulário/resposta é idempotente', () => {
  const input = request('A');
  const applied = submit(catalog(activity('A')), input);
  const repeated = D.applyOperation(applied.state, applied.operation);
  assert.deepEqual(plain(repeated), plain(applied.state));
  const outcome = D.decide(repeated, input);
  assert.equal(outcome.code, 'confirmed');
  assert.equal(outcome.replayed, true);
  assert.equal(D.occupancy(repeated, 'A'), 1);
});

test('13. Troca é uma única operação: interrupção antes do registro preserva a anterior; replay restaura inteira', () => {
  const catalogA = { key: 'recovery-catalog-A', kind: 'CATALOG', at: AT, activity: activity('A') };
  const catalogB = { key: 'recovery-catalog-B', kind: 'CATALOG', at: AT, activity: activity('B') };
  let state = D.applyOperation(D.createState(), catalogA);
  state = D.applyOperation(state, catalogB);
  const openOperation = { key: 'recovery-open', kind: 'MODE', at: AT, accepting: true };
  state = D.applyOperation(state, openOperation);
  const confirmed = submit(state, request('A'));
  state = confirmed.state;
  const swapRequest = request('B', { authorizeSwap: true });
  const swapOperation = { key: swapRequest.key, kind: 'REQUEST', at: AT, request: swapRequest, outcome: D.decide(state, swapRequest) };
  assert.equal(D.occupancy(state, 'A'), 1, 'decidir sem registrar não cancela a anterior');
  const replayed = [catalogA, catalogB, openOperation, confirmed.operation, swapOperation].reduce((s, op) => D.applyOperation(s, op), D.createState());
  assert.equal(D.occupancy(replayed, 'A'), 0);
  assert.equal(D.occupancy(replayed, 'B'), 1);
  assert.equal(Object.values(replayed.registrations).filter(r => r.status === 'cancelada por troca').length, 1);
  const broken = plain(swapOperation);
  broken.outcome.changes.at(-1).registration.activityId = 'NAO_EXISTE';
  assert.throws(() => D.applyOperation(state, broken));
  assert.equal(D.occupancy(state, 'A'), 1, 'falha no reducer não altera o estado de entrada');
});

test('14. Estado confirmado permanece válido sem processamento de notificação', () => {
  const applied = submit(catalog(activity('A')), request('A'));
  assert.equal(D.occupancy(applied.state, 'A'), 1);
  // A fila/cota utiliza serviços Google e é verificada no teste próprio
  // de infraestrutura; nenhum envio de e-mail faz parte da decisão pura.
  assert.equal(D.validateState(applied.state), true);
});

test('15. Outro e-mail não altera inscrição e não recebe dados do cadastro original', () => {
  const state = submit(catalog(activity('A'), activity('B')), request('A')).state;
  for (const overrides of [
    { activityId: 'A' }, { activityId: 'B', authorizeSwap: true },
    { activityId: 'A', kind: 'CANCELAMENTO', confirmCancel: true }
  ]) {
    const denied = submit(state, request(overrides.activityId, { ...overrides, email: 'invasor@example.org' }));
    assert.equal(denied.outcome.code, 'identity_mismatch');
    assert.deepEqual(plain(denied.outcome.changes), []);
    assert.equal(denied.outcome.participant, undefined);
    assert.equal(denied.outcome.activity, undefined);
    assert.equal(denied.outcome.conflicts, undefined);
    assert.equal(JSON.stringify(denied.outcome).includes('participante@example.org'), false);
    assert.equal(D.occupancy(denied.state, 'A'), 1);
  }
});

test('16. Aplicar a mesma operação de catálogo não duplica recursos do domínio', () => {
  const op = { key: 'install-demo-catalog', kind: 'CATALOG', at: AT, activity: activity('A') };
  const state = D.applyOperation(D.createState(), op);
  const again = D.applyOperation(state, op);
  assert.equal(Object.keys(again.activities).length, 1);
  assert.equal(Object.keys(again.operations).length, 1);
  // Duplicidade de Sheets/Forms/gatilhos exige instalação Google repetida;
  // o teste de domínio verifica somente replay do catálogo persistido.
});

test('Normaliza identidade por trim/lowercase, sem alterar pontos ou alias de e-mail', () => {
  assert.equal(D.normalizeEmail(' Pessoa.Teste+evento@Example.ORG '), 'pessoa.teste+evento@example.org');
  const state = submit(catalog(activity('A'), activity('B', {
    start: '2026-10-20T14:00:00-03:00', end: '2026-10-20T16:00:00-03:00'
  })), request('A')).state;
  assert.equal(D.decide(state, request('B', { email: ' PARTICIPANTE@EXAMPLE.ORG ' })).code, 'confirmed');
  for (const email of ['', 'digitado-sem-arroba', 'pessoa @example.org']) {
    assert.equal(D.decide(state, request('A', { email })).code, 'invalid');
  }
});

test('Valida catálogo: datas completas, capacidade inteira positiva, tipos, estados e IDs únicos', () => {
  assert.equal(D.validateActivity(activity('A', { capacity: '2' })).capacity, 2);
  assert.equal(D.validateActivity(activity('A', { type: 'palestra', status: 'encerrada' })).status, 'encerrada');
  for (const overrides of [
    { capacity: 0 }, { capacity: -1 }, { capacity: 1.5 }, { capacity: '1.5' },
    { capacity: true }, { capacity: '' }, { capacity: Infinity },
    { start: '2026-10-19T14:00:00' }, { start: '2026-02-30T14:00:00-03:00' },
    { end: '2026-10-19T14:00:00-03:00' }, { type: 'curso' }, { status: 'lotada' }, { id: '__proto__' }
  ]) {
    assert.throws(() => D.validateActivity(activity('A', overrides)));
  }
  assert.throws(() => D.validateCatalog([activity('A'), activity('A')]), /duplicado/);
});

test('Datas/horários são comparados como instantes completos, inclusive fusos distintos', () => {
  const a = D.validateActivity(activity('A'));
  const b = D.validateActivity(activity('B', { start: '2026-10-19T17:00:00Z', end: '2026-10-19T19:00:00Z' }));
  assert.equal(D.overlaps(a, b), true);
  assert.equal(a.start, b.start);
});

test('Bloqueia reduzir capacidade abaixo da ocupação e mudar horário com inscritos', () => {
  const state = submit(catalog(activity('A', { capacity: 3 })), request('A')).state;
  assert.throws(() => D.applyOperation(state, {
    key: 'bad-time', kind: 'CATALOG', at: AT,
    activity: activity('A', { start: '2026-10-19T13:00:00-03:00' })
  }), /horário/);
  const enough = D.applyOperation(state, {
    key: 'capacity-one', kind: 'CATALOG', at: AT, activity: activity('A', { capacity: 1, title: 'Título corrigido' })
  });
  assert.equal(enough.activities.A.capacity, 1);
  // Duas pessoas ocupam duas vagas; capacidade positiva menor que ocupação.
  const two = submit(state, request('A', { cpf: CPF2, email: 'outra@example.org' })).state;
  assert.throws(() => D.applyOperation(two, {
    key: 'bad-capacity', kind: 'CATALOG', at: AT, activity: activity('A', { capacity: 1 })
  }), /ocupação/);
  assert.equal(D.occupancy(two, 'A'), 2);
});

test('Organização pode corrigir e-mail com conferência do vínculo anterior', () => {
  const state = submit(catalog(activity('A'), activity('B')), request('A')).state;
  assert.throws(() => D.applyOperation(state, {
    key: 'wrong-old-email', kind: 'PARTICIPANT_EMAIL', at: AT,
    participantEmailChange: { cpf: CPF, oldEmail: 'errado@example.org', newEmail: 'novo@example.org' }
  }), /anterior/);
  const next = D.applyOperation(state, {
    key: 'correct-email', kind: 'PARTICIPANT_EMAIL', at: AT,
    participantEmailChange: { cpf: CPF, oldEmail: 'participante@example.org', newEmail: ' NOVO@EXAMPLE.ORG ' }
  });
  assert.equal(next.participants[CPF].email, 'novo@example.org');
  assert.equal(D.decide(next, request('B')).code, 'identity_mismatch');
  assert.equal(D.decide(next, request('A', { kind: 'CANCELAMENTO', email: 'novo@example.org', confirmCancel: true })).code, 'canceled');
});

test('Encerramento global impede inscrição e preserva caminho de cancelamento', () => {
  const state = submit(catalog(activity('A'), activity('B')), request('A')).state;
  const closed = D.applyOperation(state, { key: 'close', kind: 'MODE', at: AT, accepting: false });
  assert.equal(D.decide(closed, request('B')).code, 'closed');
  assert.equal(D.decide(closed, request('A', { kind: 'CANCELAMENTO', confirmCancel: true })).code, 'canceled');
  const opened = D.applyOperation(closed, { key: 'open', kind: 'MODE', at: AT, accepting: true });
  assert.equal(opened.accepting, true);
});

test('Cancelamento exige confirmação e não cria participante sem cadastro', () => {
  const state = catalog(activity('A'));
  const unconfirmed = submit(state, request('A', { kind: 'CANCELAMENTO' }));
  assert.equal(unconfirmed.outcome.code, 'invalid');
  const noActive = submit(state, request('A', { kind: 'CANCELAMENTO', confirmCancel: true }));
  assert.equal(noActive.outcome.code, 'no_active');
  assert.equal(Object.keys(noActive.state.participants).length, 0);
});

test('Alternativa obrigatória ausente ou desconhecida é recusada sem vincular participante', () => {
  const state = catalog(activity('A'));
  const invalid = submit(state, request('A', { invalidAnswer: true }));
  assert.equal(invalid.outcome.code, 'invalid');
  assert.equal(Object.keys(invalid.state.participants).length, 0);
  assert.equal(D.occupancy(invalid.state, 'A'), 0);
});

test('Encerrada, cancelada e inexistente são recusadas em respostas antigas do Forms', () => {
  const state = catalog(activity('A', { status: 'encerrada' }), activity('B', { status: 'cancelada' }));
  assert.equal(D.decide(state, request('A')).code, 'closed');
  assert.equal(D.decide(state, request('B')).code, 'closed');
  assert.equal(D.decide(state, request('INEXISTENTE')).code, 'missing_activity');
});

test('Projeção inválida é detectada sem aceitar superlotação, duplicidade ou conflito', () => {
  const applied = submit(catalog(activity('A', { capacity: 1 })), request('A'));
  const invalid = plain(applied.state);
  const first = Object.values(invalid.registrations)[0];
  invalid.registrations.EXTRA = { ...first, id: 'EXTRA' };
  assert.throws(() => D.validateState(invalid), /Ocupação|duplicada/);
});

test('Cadastro pendente preserva campos desconhecidos e não permite inscrição nem vínculo', () => {
  const draft = activity('PALESTRA', {type: 'palestra', start: '', end: '', capacity: null, status: 'pendente'});
  const normalized = D.validateActivity(draft);
  assert.equal(normalized.capacity, null); assert.equal(normalized.start, ''); assert.equal(normalized.end, '');
  const state = catalog(draft);
  const applied = submit(state, request('PALESTRA'));
  assert.equal(applied.outcome.code, 'closed');
  assert.equal(D.occupancy(applied.state, 'PALESTRA'), 0);
  assert.equal(Object.keys(applied.state.participants).length, 0);
  assert.equal(D.validateState(applied.state), true);
});

test('Atividade pendente só pode ser aberta com início, término e capacidade reais', () => {
  const pending = activity('A', {status: 'pendente', start: '2026-10-28T19:30:00-03:00', end: '', capacity: null});
  assert.throws(() => D.validateActivity({...pending, status: 'aberta'}), /Término/);
  assert.throws(() => D.validateActivity({...pending, status: 'aberta', end: '2026-10-28T21:00:00-03:00'}), /Capacidade/);
  const state = catalog(pending);
  const completed = D.applyOperation(state, {key: 'complete-pending', kind: 'CATALOG', at: AT,
    activity: {...pending, status: 'aberta', end: '2026-10-28T21:00:00-03:00', capacity: 50}});
  assert.equal(submit(completed, request('A')).outcome.code, 'confirmed');
});

test('Pendência permite ausência de campos, mas rejeita capacidade inválida e intervalos invertidos', () => {
  for (const capacity of [0, -1, 1.5, 'abc', false, Infinity]) assert.throws(() => D.validateActivity(activity('A', {status: 'pendente', capacity})), /Capacidade/);
  assert.throws(() => D.validateActivity(activity('A', {status: 'pendente', end: '2026-10-19T13:00:00-03:00'})), /término/);
  assert.throws(() => D.validateActivity(activity('A', {status: 'pendente', start: '2026-02-30T13:00:00-03:00'})), /Início/);
  for (const type of ['competicao', 'programacao']) assert.equal(D.validateActivity(activity('A', {status: 'pendente', type, capacity: null})).type, type);
});

test('Estado confirmado não pode conter snapshot de atividade com campos pendentes', () => {
  const applied = submit(catalog(activity('A')), request('A'));
  const invalid = plain(applied.state);
  const registration = Object.values(invalid.registrations)[0];
  registration.activity = {...registration.activity, status: 'pendente', start: '', end: '', capacity: null};
  assert.throws(() => D.validateState(invalid), /completos/);
});
