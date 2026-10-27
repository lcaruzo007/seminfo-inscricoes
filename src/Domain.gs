/**
 * Regras puras da SEMINFO. Não usa serviços Google e não altera argumentos.
 * A automação grava uma operação inteira no livro oficial antes de publicar
 * suas projeções; aplicar novamente a mesma chave não repete suas alterações.
 */
var SemDomain = (function () {
  'use strict';

  var CONFIRMED = 'confirmada';
  var CANCELED = 'cancelada';
  var SWAPPED = 'cancelada por troca';
  var TYPES = ['oficina', 'palestra', 'competicao', 'programacao'];
  var STATUSES = ['aberta', 'encerrada', 'cancelada', 'pendente'];

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function owns(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function text(value, field, required) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string') throw new Error(field + ' deve ser texto.');
    var result = value.trim();
    if (required && !result) throw new Error(field + ' é obrigatório.');
    return result;
  }

  function identifier(value, field) {
    var result = text(value, field, true);
    // IDs são chaves de objetos: rejeitar nomes especiais evita ambiguidade.
    if (result === '__proto__' || result === 'constructor' || result === 'prototype') {
      throw new Error(field + ' inválido.');
    }
    return result;
  }

  function normalizeCpf(raw) {
    if (typeof raw !== 'string') throw new Error('Informe o CPF como texto.');
    var cpf = raw.replace(/[.\-\s]/g, '');
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) {
      throw new Error('CPF inválido. Confira os onze dígitos.');
    }
    for (var length = 9; length <= 10; length++) {
      var sum = 0;
      for (var index = 0; index < length; index++) {
        sum += Number(cpf.charAt(index)) * (length + 1 - index);
      }
      var digit = (sum * 10) % 11;
      if (digit === 10) digit = 0;
      if (digit !== Number(cpf.charAt(length))) {
        throw new Error('CPF inválido. Confira os dígitos verificadores.');
      }
    }
    return cpf;
  }

  function normalizeEmail(raw) {
    var email = text(raw, 'E-mail verificado', true).toLowerCase();
    // A origem verificada é conferida pela camada Forms, não por esta expressão.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('E-mail verificado ausente ou inválido.');
    }
    return email;
  }

  function instant(raw, field) {
    if (Object.prototype.toString.call(raw) === '[object Date]') {
      if (!isFinite(raw.getTime())) throw new Error(field + ' inválido.');
      return raw.toISOString();
    }
    var value = text(raw, field, true);
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw new Error(field + ' deve incluir data, hora e fuso horário.');
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var hour = Number(match[4]);
    var minute = Number(match[5]);
    var second = Number(match[6] || 0);
    var days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) {
      throw new Error(field + ' inválido.');
    }
    if (match[8] !== 'Z') {
      var offset = match[8].substring(1).split(':');
      if (Number(offset[0]) > 23 || Number(offset[1]) > 59) throw new Error(field + ' com fuso inválido.');
    }
    var milliseconds = Date.parse(value);
    if (!isFinite(milliseconds)) throw new Error(field + ' inválido.');
    return new Date(milliseconds).toISOString();
  }

  function validateActivity(input) {
    if (!input || typeof input !== 'object') throw new Error('Atividade inválida.');
    var status = text(input.status, 'Situação', true).toLowerCase();
    var pending = status === 'pendente';
    var missingCapacity = input.capacity === undefined || input.capacity === null ||
      typeof input.capacity === 'string' && input.capacity.trim() === '';
    var activity = {
      id: identifier(input.id, 'ID da atividade'),
      title: text(input.title, 'Título', true),
      type: text(input.type, 'Tipo', true).toLowerCase(),
      description: text(input.description, 'Descrição', false),
      instructor: text(input.instructor, 'Ministrante', false),
      location: text(input.location, 'Local', false),
      start: pending && (input.start === undefined || input.start === null || input.start === '') ? '' : instant(input.start, 'Início'),
      end: pending && (input.end === undefined || input.end === null || input.end === '') ? '' : instant(input.end, 'Término'),
      capacity: pending && missingCapacity ? null : Number(input.capacity),
      status: status
    };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(activity.id)) throw new Error('ID da atividade deve ter de 1 a 64 letras, números, hífens ou sublinhados.');
    if (TYPES.indexOf(activity.type) < 0) throw new Error('Tipo deve ser oficina, palestra, competicao ou programacao.');
    if (STATUSES.indexOf(activity.status) < 0) throw new Error('Situação deve ser aberta, encerrada, cancelada ou pendente.');
    if (activity.capacity !== null && typeof input.capacity !== 'number' && (typeof input.capacity !== 'string' || !/^\d+$/.test(input.capacity.trim()))) {
      throw new Error('Capacidade deve ser um número inteiro positivo.');
    }
    if (activity.capacity !== null && (!isFinite(activity.capacity) || Math.floor(activity.capacity) !== activity.capacity || activity.capacity < 1 || activity.capacity > 9007199254740991)) {
      throw new Error('Capacidade deve ser um número inteiro positivo.');
    }
    if (activity.start && activity.end && Date.parse(activity.end) <= Date.parse(activity.start)) throw new Error('O término deve ser posterior ao início.');
    if (input.capacityUnit !== undefined) {
      if (['pessoas', 'equipes'].indexOf(input.capacityUnit) < 0) throw new Error('Unidade de capacidade inválida.');
      activity.capacityUnit = input.capacityUnit;
    }
    return activity;
  }

  function validateCatalog(entries) {
    if (!Array.isArray(entries)) throw new Error('O catálogo deve ser uma lista de atividades.');
    var seen = {};
    return entries.map(function (input) {
      var activity = validateActivity(input);
      if (owns(seen, activity.id)) throw new Error('ID de atividade duplicado: ' + activity.id);
      seen[activity.id] = true;
      return activity;
    });
  }

  function createState() {
    return { activities: {}, participants: {}, registrations: {}, operations: {}, accepting: false };
  }

  function normalizedState(state) {
    var result = copy(state || createState());
    result.activities = result.activities || {};
    result.participants = result.participants || {};
    result.registrations = result.registrations || {};
    result.operations = result.operations || {};
    result.accepting = result.accepting === true;
    return result;
  }

  function occupancy(state, activityId) {
    return Object.keys(state.registrations || {}).reduce(function (total, id) {
      var registration = state.registrations[id];
      return total + (registration.status === CONFIRMED && registration.activityId === activityId ? 1 : 0);
    }, 0);
  }

  function confirmedFor(state, cpf) {
    return Object.keys(state.registrations || {}).map(function (id) {
      return state.registrations[id];
    }).filter(function (registration) {
      return registration.status === CONFIRMED && (registration.entityType === 'EQUIPE' ?
        registration.members.some(function (member) { return member.cpf === cpf; }) : registration.cpf === cpf);
    }).map(copy);
  }

  function overlaps(activityA, activityB) {
    return Date.parse(activityA.start) < Date.parse(activityB.end) && Date.parse(activityB.start) < Date.parse(activityA.end);
  }

  function result(code, message, extras) {
    var value = { code: code, message: message, changes: [] };
    Object.keys(extras || {}).forEach(function (key) { value[key] = extras[key]; });
    return value;
  }

  function decide(state, request) {
    var cpf;
    var email;
    var activityId;
    var key;
    var submittedAt;
    var name;
    try {
      if (!request || ['INSCRICAO', 'CANCELAMENTO'].indexOf(request.kind) < 0) throw new Error('Tipo de solicitação inválido.');
      if (request.invalidAnswer === true) throw new Error('Resposta obrigatória ausente ou inválida. Envie uma nova solicitação pelo formulário.');
      cpf = normalizeCpf(request.cpf);
      email = normalizeEmail(request.email);
      activityId = identifier(request.activityId, 'Atividade');
      key = identifier(request.key, 'Chave da solicitação');
      submittedAt = instant(request.submittedAt, 'Data da solicitação');
      if (request.kind === 'INSCRICAO') name = text(request.name, 'Nome completo', true);
    } catch (error) {
      return result('invalid', error.message);
    }

    var participant = owns(state.participants, cpf) ? state.participants[cpf] : null;
    // Conferir a identidade antes de informar atividade, duplicidade ou conflitos.
    if (participant && normalizeEmail(participant.email) !== email) {
      return result('identity_mismatch', 'Não foi possível validar a identidade. Procure o Centro Acadêmico para atendimento.');
    }
    if (owns(state.operations, key) && state.operations[key].outcome) {
      var previous = copy(state.operations[key].outcome);
      previous.replayed = true;
      return previous;
    }

    var active = confirmedFor(state, cpf);
    if (request.kind === 'CANCELAMENTO') {
      if (request.confirmCancel !== true) return result('invalid', 'O cancelamento exige confirmação explícita.');
      if (!participant) return result('no_active', 'Não foi encontrada inscrição ativa para esta solicitação.');
      var matching = active.filter(function (registration) { return registration.activityId === activityId; });
      if (!matching.length) return result('no_active', 'Não foi encontrada inscrição ativa para esta solicitação.');
      if (matching.some(function (registration) { return registration.entityType === 'EQUIPE'; })) return result('invalid', 'O cancelamento de uma equipe deve ser solicitado à organização.');
      var canceledActivity = matching[0].activity || state.activities[activityId];
      return result('canceled', 'Cancelamento concluído. A vaga foi liberada.', {
        activity: copy(canceledActivity),
        canceledActivities: matching.map(function (registration) { return copy(registration.activity || state.activities[registration.activityId]); }),
        changes: matching.map(function (registration) {
          return { type: 'CANCEL', registrationId: registration.id, status: CANCELED, reason: 'Solicitação confirmada pelo participante.' };
        })
      });
    }

    if (!owns(state.activities, activityId)) return result('missing_activity', 'A atividade selecionada não está disponível no cadastro. Procure o Centro Acadêmico.');
    var activity = copy(state.activities[activityId]);
    var extras = { activity: activity };
    if (activity.status === 'pendente') return result('closed', 'Esta atividade está pendente de informações e ainda não recebe inscrições.', extras);
    if (!participant) extras.participant = { cpf: cpf, name: name, email: email };
    if (state.accepting === false || activity.status !== 'aberta') return result('closed', 'As inscrições para esta atividade estão encerradas.', extras);
    if (activity.capacityUnit === 'equipes') return result('invalid', 'Esta atividade recebe inscrições por equipe. Utilize o formulário de equipes.', extras);
    if (active.some(function (registration) { return registration.activityId === activityId; })) {
      return result('duplicate', 'Sua inscrição nesta atividade já está confirmada. Nenhuma vaga adicional foi ocupada.', extras);
    }
    if (occupancy(state, activityId) >= activity.capacity) {
      return result('full', 'A atividade está lotada. Suas inscrições anteriores permanecem válidas.', extras);
    }
    var conflicts = active.filter(function (registration) {
      return overlaps(activity, registration.activity || state.activities[registration.activityId]);
    });
    if (conflicts.length && (request.authorizeSwap !== true || conflicts.some(function (registration) { return registration.entityType === 'EQUIPE'; }))) {
      extras.conflicts = conflicts.map(function (registration) {
        return { registrationId: registration.id, activity: copy(registration.activity || state.activities[registration.activityId]) };
      });
      return result('conflict', 'Há conflito de horário e a troca não foi autorizada. Suas inscrições anteriores permanecem válidas.', extras);
    }
    extras.changes = conflicts.map(function (registration) {
      return { type: 'CANCEL', registrationId: registration.id, status: SWAPPED, reason: 'Troca autorizada para ' + activity.id + '.' };
    });
    extras.changes.push({
      type: 'CONFIRM',
      registration: { id: key + ':inscricao', cpf: cpf, activityId: activity.id, status: CONFIRMED, activity: copy(activity), createdAt: submittedAt }
    });
    if (conflicts.length) {
      extras.canceledActivities = conflicts.map(function (registration) { return copy(registration.activity || state.activities[registration.activityId]); });
      return result('swapped', 'Troca concluída. Todas as inscrições com horário conflitante foram substituídas.', extras);
    }
    return result('confirmed', 'Inscrição confirmada.', extras);
  }

  function validateState(state) {
    var duplicate = {};
    var occupied = {};
    var byParticipant = {};
    Object.keys(state.activities || {}).forEach(function (id) {
      var activity = validateActivity(state.activities[id]);
      if (activity.id !== id) throw new Error('ID da atividade difere da chave do catálogo.');
    });
    Object.keys(state.participants || {}).forEach(function (cpf) {
      var participant = state.participants[cpf];
      if (normalizeCpf(participant.cpf) !== cpf) throw new Error('CPF difere da chave do participante.');
      normalizeEmail(participant.email);
    });
    Object.keys(state.registrations || {}).forEach(function (id) {
      var registration = state.registrations[id];
      if (registration.id !== id) throw new Error('ID da inscrição difere de sua chave.');
      if ([CONFIRMED, CANCELED, SWAPPED].indexOf(registration.status) < 0) throw new Error('Situação de inscrição inválida.');
      if (!owns(state.activities, registration.activityId)) throw new Error('Inscrição referencia atividade inexistente.');
      if (registration.entityType === 'EQUIPE') validateTeamRegistration(registration);
      else if (!owns(state.participants, registration.cpf)) throw new Error('Inscrição referencia participante inexistente.');
      if (registration.status === CONFIRMED) {
        var snapshot = registration.activity || state.activities[registration.activityId];
        validateActivity(snapshot);
        if (!snapshot.start || !snapshot.end || !snapshot.capacity) throw new Error('Inscrição confirmada exige atividade com início, término e capacidade completos.');
        if (snapshot.id !== registration.activityId) throw new Error('Snapshot da atividade incompatível.');
        if ((registration.entityType === 'EQUIPE') !== (state.activities[registration.activityId].capacityUnit === 'equipes')) throw new Error('Inscrição incompatível com a unidade de capacidade.');
        occupied[registration.activityId] = (occupied[registration.activityId] || 0) + 1;
        var cpfs = registration.entityType === 'EQUIPE' ? registration.members.map(function (member) { return member.cpf; }) : [registration.cpf];
        cpfs.filter(function (cpf) { return !!cpf; }).forEach(function (cpf) {
          var pair = cpf + '/' + registration.activityId;
          if (owns(duplicate, pair)) throw new Error('Inscrição ativa duplicada.');
          duplicate[pair] = true;
          if (!byParticipant[cpf]) byParticipant[cpf] = [];
          byParticipant[cpf].push(snapshot);
        });
      }
    });
    Object.keys(state.activities || {}).forEach(function (id) {
      if ((occupied[id] || 0) > state.activities[id].capacity) throw new Error('Ocupação excede a capacidade de ' + id + '.');
    });
    Object.keys(byParticipant).forEach(function (cpf) {
      var activities = byParticipant[cpf];
      for (var index = 0; index < activities.length; index++) {
        for (var other = index + 1; other < activities.length; other++) {
          if (overlaps(activities[index], activities[other])) throw new Error('Participante possui inscrições com conflito de horário.');
        }
      }
    });
    return true;
  }

  function applyOperation(state, operation) {
    return applyOperationToState(normalizedState(state), operation);
  }

  /** Replay usa um estado privado; não copia todo o histórico a cada registro. */
  function replayOperations(operations) {
    var state = createState();
    operations.forEach(function (operation) { applyOperationToState(state, operation); });
    return state;
  }

  function applyOperationToState(next, operation) {
    if (!operation || typeof operation !== 'object') throw new Error('Operação inválida.');
    var key = identifier(operation.key, 'Chave da operação');
    if (owns(next.operations, key)) return next;

    if (operation.kind === 'REQUEST') {
      var outcome = operation.outcome;
      if (!outcome || !Array.isArray(outcome.changes)) throw new Error('Resultado da operação ausente.');
      if (outcome.participant) {
        var participant = copy(outcome.participant);
        participant.cpf = normalizeCpf(participant.cpf);
        participant.email = normalizeEmail(participant.email);
        participant.name = text(participant.name, 'Nome completo', true);
        if (owns(next.participants, participant.cpf)) {
          if (normalizeEmail(next.participants[participant.cpf].email) !== participant.email) throw new Error('A operação tentaria substituir a identidade vinculada.');
        } else next.participants[participant.cpf] = participant;
      }
      outcome.changes.forEach(function (change) {
        if (change.type === 'CANCEL') {
          var existing = next.registrations[change.registrationId];
          if (!existing || existing.status !== CONFIRMED) throw new Error('A inscrição a cancelar não está ativa.');
          if ([CANCELED, SWAPPED].indexOf(change.status) < 0) throw new Error('Situação de cancelamento inválida.');
          existing.status = change.status;
          existing.canceledAt = instant(operation.at || (operation.request && operation.request.submittedAt), 'Data da operação');
          existing.cancellationReason = text(change.reason, 'Justificativa', true);
          existing.cancellationOperation = key;
          existing.updatedAt = existing.canceledAt;
          existing.reason = existing.cancellationReason;
        } else if (change.type === 'CONFIRM') {
          var registration = copy(change.registration);
          if (registration.entityType === 'EQUIPE') registration = validateTeamRegistration(registration);
          identifier(registration.id, 'ID da inscrição');
          if (owns(next.registrations, registration.id)) throw new Error('ID de inscrição já existente.');
          if (registration.status !== CONFIRMED) throw new Error('A nova inscrição deve estar confirmada.');
          if (!(registration.entityType === 'EQUIPE' && registration.administrativeIncomplete === true)) registration.cpf = normalizeCpf(registration.cpf);
          registration.activity = validateActivity(registration.activity);
          registration.createdAt = instant(registration.createdAt, 'Data da inscrição');
          if (registration.activityId !== registration.activity.id) throw new Error('Snapshot da atividade incompatível.');
          next.registrations[registration.id] = registration;
        } else throw new Error('Alteração de inscrição desconhecida.');
      });
    } else if (operation.kind === 'CATALOG') {
      var activity = validateActivity(operation.activity);
      var existingActivity = next.activities[activity.id];
      var occupied = occupancy(next, activity.id);
      if (activity.capacity < occupied) throw new Error('Capacidade não pode ser menor que a ocupação confirmada.');
      if (existingActivity && occupied && (existingActivity.capacityUnit || 'pessoas') !== (activity.capacityUnit || 'pessoas')) throw new Error('Não altere a unidade de capacidade com inscrições confirmadas.');
      if (existingActivity && occupied && (existingActivity.start !== activity.start || existingActivity.end !== activity.end)) {
        throw new Error('Alterações de horário de atividades com inscritos exigem intervenção da organização.');
      }
      next.activities[activity.id] = activity;
      if (next.deletedActivities) delete next.deletedActivities[activity.id];
    } else if (operation.kind === 'PROGRAM_UPDATE') {
      text(operation.reason, 'Justificativa da atualização da programação', true);
      var updatedActivities = validateCatalog(operation.activities);
      updatedActivities.forEach(function (activity) {
        var current = next.activities[activity.id];
        if (activity.capacity < occupancy(next, activity.id)) throw new Error('Capacidade não pode ser menor que a ocupação confirmada de ' + activity.id + '.');
        if (current && occupancy(next, activity.id) && (current.capacityUnit || 'pessoas') !== (activity.capacityUnit || 'pessoas')) {
          throw new Error('Não altere a unidade de capacidade com inscrições confirmadas.');
        }
        next.activities[activity.id] = activity;
      });
      // O lote atualiza todos os horários antes de validar conflitos. O livro conserva os snapshots anteriores.
      Object.keys(next.registrations).forEach(function (id) {
        var registration = next.registrations[id];
        if (registration.status === CONFIRMED && updatedActivities.some(function (activity) { return activity.id === registration.activityId; })) {
          registration.activity = copy(next.activities[registration.activityId]);
        }
      });
    } else if (operation.kind === 'DELETE_ACTIVITY') {
      var activityId = identifier(operation.activityId, 'ID da atividade');
      if (!owns(next.activities, activityId)) throw new Error('Atividade inexistente.');
      if (Object.keys(next.registrations).some(function (id) { return next.registrations[id].activityId === activityId; })) {
        throw new Error('Atividade possui inscrições no histórico. Cancele a atividade ou faça a limpeza completa para começar do zero.');
      }
      delete next.activities[activityId];
      next.deletedActivities = next.deletedActivities || {};
      next.deletedActivities[activityId] = true;
    } else if (operation.kind === 'PARTICIPANT_EMAIL') {
      var change = operation.participantEmailChange;
      if (!change) throw new Error('Alteração de e-mail ausente.');
      var cpf = normalizeCpf(change.cpf);
      if (!owns(next.participants, cpf)) throw new Error('Participante não encontrado.');
      if (normalizeEmail(next.participants[cpf].email) !== normalizeEmail(change.oldEmail)) throw new Error('E-mail anterior não corresponde ao cadastro atual.');
      next.participants[cpf].email = normalizeEmail(change.newEmail);
    } else if (operation.kind === 'MODE') {
      if (typeof operation.accepting !== 'boolean') throw new Error('Modo de inscrições inválido.');
      next.accepting = operation.accepting;
    } else throw new Error('Tipo de operação desconhecido: ' + operation.kind);

    validateState(next);
    next.operations[key] = copy(operation);
    return next;
  }

  function validateTeamRegistration(input) {
    var team = copy(input), seen = {};
    if (team.administrativeIncomplete === true) {
      team.teamName = text(team.teamName, 'Equipe', true);
      if (!Array.isArray(team.members) || team.members.length > 3) throw new Error('Integrantes incompatíveis.');
      team.members.forEach(function (member, index) {
        member.name = text(member.name, 'Nome', false);
        member.cpf = member.cpf ? normalizeCpf(member.cpf) : '';
        if (member.cpf && owns(seen, member.cpf)) throw new Error('CPF repetido dentro da equipe.');
        if (member.cpf) seen[member.cpf] = true;
        member.role = index === 0 ? 'coach' : 'integrante';
      });
      team.cpf = team.members[0] && team.members[0].cpf || '';
      return team;
    }
    team.cpf = normalizeCpf(String(team.cpf || ''));
    team.teamName = text(team.teamName, 'Nome da equipe', true);
    if (team.teamName.length > 200) throw new Error('Nome da equipe excede 200 caracteres.');
    if (!Array.isArray(team.members) || team.members.length < 1 || team.members.length > 3) throw new Error('A equipe deve ter de um a três integrantes.');
    team.members = team.members.map(function (member, index) {
      var parsed = copy(member);
      parsed.name = text(parsed.name, 'Nome do integrante ' + (index + 1), true);
      if (parsed.name.length > 200) throw new Error('Nome do integrante excede 200 caracteres.');
      parsed.cpf = normalizeCpf(parsed.cpf);
      if (seen[parsed.cpf]) throw new Error('CPF repetido dentro da equipe.');
      seen[parsed.cpf] = true;
      parsed.role = index === 0 ? 'coach' : 'integrante';
      return parsed;
    });
    if (team.cpf !== team.members[0].cpf) throw new Error('CPF do coach incompatível com os integrantes.');
    return team;
  }

  function decideTeam(state, request, options) {
    var team, activity;
    var incomplete = options && options.administrativeIncomplete === true;
    try {
      if (!request || request.kind !== 'INSCRICAO_EQUIPE') throw new Error('Tipo de solicitação de equipe inválido.');
      if (request.invalidAnswer) throw new Error((request.importErrors || []).join('; ') || 'Dados da equipe inválidos.');
      identifier(request.key, 'Chave da solicitação');
      var activityId = identifier(request.activityId, 'Atividade');
      var submittedAt = instant(request.submittedAt, 'Data da solicitação');
      var registration = {id: request.key + ':equipe', cpf: request.members[0] && request.members[0].cpf,
        entityType: 'EQUIPE', teamName: request.teamName, teamType: request.teamType || '', members: request.members,
        activityId: activityId, status: CONFIRMED, createdAt: submittedAt};
      // A recuperação administrativa aceita dados ausentes, mantendo as regras de vagas, duplicidade e conflitos.
      if (incomplete) registration.administrativeIncomplete = true;
      team = validateTeamRegistration(registration);
      if (!incomplete && request.declaredSize && request.declaredSize !== team.members.length) throw new Error('Quantidade declarada diferente do número de integrantes identificados.');
      activity = state.activities[activityId];
      if (!activity) return result('missing_activity', 'Atividade de destino não cadastrada.');
      if (activity.capacityUnit !== 'equipes') throw new Error('Configure a capacidade da atividade em equipes.');
    } catch (error) { return result('invalid', error.message); }
    var extras = {activity: copy(activity)};
    if (!state.accepting || activity.status !== 'aberta') return result('closed', 'A atividade não está aberta para inscrições de equipes.', extras);
    var sameName = Object.keys(state.registrations).some(function (id) {
      var previous = state.registrations[id];
      return previous.entityType === 'EQUIPE' && previous.status === CONFIRMED && previous.activityId === team.activityId &&
        previous.teamName.trim().toLowerCase() === team.teamName.trim().toLowerCase();
    });
    var active = [];
    team.members.forEach(function (member) {
      if (member.cpf) active = active.concat(confirmedFor(state, member.cpf));
    });
    if (sameName || active.some(function (registration) { return registration.activityId === team.activityId; })) return result('duplicate', 'Equipe ou integrante já possui inscrição confirmada nesta atividade.', extras);
    if (occupancy(state, team.activityId) >= activity.capacity) return result('full', 'A capacidade de equipes foi atingida. Nenhuma vaga foi ocupada por esta solicitação.', extras);
    if (active.some(function (registration) { return overlaps(activity, registration.activity || state.activities[registration.activityId]); })) return result('conflict', 'Um ou mais integrantes têm conflito de horário. A equipe requer conferência da organização.', extras);
    team.activity = copy(activity);
    extras.changes = [{type: 'CONFIRM', registration: team}];
    return result('confirmed', 'Equipe confirmada. Uma vaga de equipe foi reservada.', extras);
  }

  return {
    normalizeCpf: normalizeCpf,
    normalizeEmail: normalizeEmail,
    validateActivity: validateActivity,
    validateCatalog: validateCatalog,
    createState: createState,
    occupancy: occupancy,
    confirmedFor: confirmedFor,
    overlaps: overlaps,
    decide: decide,
    decideTeam: decideTeam,
    validateState: validateState,
    applyOperation: applyOperation,
    replayOperations: replayOperations
  };
})();
