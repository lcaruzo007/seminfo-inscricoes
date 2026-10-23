/**
 * Outbox durável. Somente syncNotificationQueueLocked_ cria mensagens, a partir
 * das operações oficiais. Nenhuma reconstrução das projeções apaga esta fila.
 * Todos os métodos *Locked_ exigem o ScriptLock já adquirido pelo chamador.
 */
var EMAIL_HEADERS = [
  'ID', 'OPERACAO', 'CRIADA_EM', 'DESTINATARIO', 'CC', 'ASSUNTO', 'CORPO',
  'SITUACAO', 'TENTATIVAS', 'ERRO', 'PROXIMA_TENTATIVA', 'LEASE_ATE', 'ENVIADA_EM'
];
var EMAIL_SHEET = 'FilaEmails';
var EMAIL_LEASE_MS = 10 * 60 * 1000;

function ensureNotificationSheet_() {
  var spreadsheet = db_();
  var sheet = spreadsheet.getSheetByName(EMAIL_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(EMAIL_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, EMAIL_HEADERS.length).setValues([EMAIL_HEADERS]);
    sheet.setFrozenRows(1);
  }
  var headers = sheet.getRange(1, 1, 1, EMAIL_HEADERS.length).getValues()[0];
  if (headers.join('|') !== EMAIL_HEADERS.join('|')) {
    throw new Error('Estrutura incompatível em FilaEmails; restaure os cabeçalhos antes de continuar.');
  }
  return sheet;
}

function notificationRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  var seen = {};
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, EMAIL_HEADERS.length)
    .getValues().map(function (values, index) {
      var row = { _row: index + 2 };
      EMAIL_HEADERS.forEach(function (header, col) { row[header] = values[col]; });
      if (!row.ID || seen[row.ID]) {
        throw new Error('FilaEmails contém identificador vazio ou duplicado; procure a organização.');
      }
      seen[row.ID] = true;
      if (['pendente', 'processando', 'enviada'].indexOf(String(row.SITUACAO)) < 0) {
        throw new Error('FilaEmails contém situação inválida; procure a organização.');
      }
      return row;
    });
}

function writeNotificationRow_(sheet, row) {
  // Uma única gravação registra conjuntamente estado, lease e contadores.
  var range = sheet.getRange(row._row, 1, 1, EMAIL_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues([EMAIL_HEADERS.map(function (header) {
    return row[header] === undefined || row[header] === null ? '' : row[header];
  })]);
  SpreadsheetApp.flush();
}

function notificationAddress_(address) {
  var normalized = String(address || '').trim().toLowerCase();
  // Cada campo contém um único endereço; rejeita listas e quebras de cabeçalho.
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(normalized) ||
      /^[=+\-@]/.test(normalized)) return '';
  return normalized;
}

function notificationRecipients_(row) {
  var addresses = [notificationAddress_(row.DESTINATARIO)];
  if (!addresses[0]) throw new Error('Destinatário inválido na fila de notificações.');
  if (row.CC) {
    var cc = notificationAddress_(row.CC);
    if (!cc) throw new Error('Endereço de cópia inválido na fila de notificações.');
    if (addresses.indexOf(cc) < 0) addresses.push(cc);
  }
  return addresses.length;
}

/** Sucessos vão apenas ao participante; o CA recebe cópia dos problemas. */
function notificationNeedsCaCopy_(code) {
  return ['confirmed', 'swapped', 'canceled'].indexOf(code) < 0;
}

/**
 * Projeção leve do livro já validado: identifica a última entrada em lotação
 * ainda vigente por atividade. Não usa respostas brutas nem altera inscrições.
 */
function currentCapacityEvents_(operations) {
  var activities = Object.create(null), registrations = Object.create(null);
  var counts = Object.create(null), events = Object.create(null), seen = Object.create(null);
  function full(id) { return !!activities[id] && Number(activities[id].capacity) > 0 && (counts[id] || 0) >= Number(activities[id].capacity); }
  operations.forEach(function (operation) {
    if (seen[operation.key]) return;
    seen[operation.key] = true;
    var before = Object.create(null);
    function touch(id) { if (!Object.prototype.hasOwnProperty.call(before, id)) before[id] = full(id); }
    if (operation.kind === 'CATALOG' && operation.activity) {
      touch(operation.activity.id);
      activities[operation.activity.id] = operation.activity;
    } else if (operation.kind === 'PROGRAM_UPDATE') {
      (operation.activities || []).forEach(function (activity) {
        touch(activity.id);
        activities[activity.id] = activity;
      });
    } else if (operation.kind === 'REQUEST' && operation.outcome) {
      (operation.outcome.changes || []).forEach(function (change) {
        if (change.type === 'CANCEL') {
          var previous = registrations[change.registrationId];
          if (previous) {
            touch(previous);
            counts[previous]--;
            delete registrations[change.registrationId];
          }
        } else if (change.type === 'CONFIRM' && change.registration) {
          var registration = change.registration;
          var id = registration.activityId || (registration.activity && registration.activity.id);
          if (id && !registrations[registration.id]) {
            touch(id);
            registrations[registration.id] = id;
            counts[id] = (counts[id] || 0) + 1;
          }
        }
      });
    }
    Object.keys(before).forEach(function (id) {
      if (!full(id)) delete events[id];
      else if (!before[id]) events[id] = {operation: operation, activity: activities[id], occupancy: counts[id] || 0};
    });
  });
  return Object.keys(events).map(function (id) { return events[id]; });
}

/** Acrescenta avisos ausentes; remove CC de sucessos ainda pendentes. */
function syncNotificationQueueLocked_(operations) {
  var config = getConfig_();
  var sheet = ensureNotificationSheet_();
  var existing = {};
  var queued = Object.create(null);
  notificationRows_(sheet).forEach(function (row) { existing[row.ID] = true; queued[row.ID] = row; });
  var newRows = [];
  operations.forEach(function (operation) {
    if (operation.kind !== 'REQUEST' || !operation.request || !operation.outcome) return;
    var id = 'MAIL:' + operation.key;
    if (existing[id]) {
      // Claims ativos e mensagens já enviadas conservam sua fotografia original.
      if (queued[id] && queued[id].SITUACAO === 'pendente' && queued[id].CC && !notificationNeedsCaCopy_(operation.outcome.code)) {
        queued[id].CC = '';
        writeNotificationRow_(sheet, queued[id]);
      }
      return;
    }
    // E-mail nativo verificado ou e-mail histórico conferido pela organização
    // numa operação administrativa auditada. Sem endereço válido, não há envio.
    var ca = notificationAddress_(config.EMAIL_CA);
    if (!ca) throw new Error('Configure um EMAIL_CA válido antes de criar notificações.');
    var to = notificationAddress_(operation.request.email);
    if (!to && operation.request.kind === 'INSCRICAO_EQUIPE' && notificationNeedsCaCopy_(operation.outcome.code)) to = ca;
    if (!to) return;
    var cc = config.ENVIAR_COPIA_CA === true && notificationNeedsCaCopy_(operation.outcome.code) && ca !== to ? ca : '';
    var message = notificationTemplate_(operation, config);
    newRows.push([
      id, operation.key, operation.at || new Date().toISOString(), to, cc,
      message.subject, message.body, 'pendente', 0, '', '', '', ''
    ]);
    existing[id] = true;
  });
  currentCapacityEvents_(operations).forEach(function (event) {
    var id = 'MAIL:CAPACIDADE:' + event.operation.key + ':' + event.activity.id;
    if (existing[id]) return;
    var ca = notificationAddress_(config.EMAIL_CA);
    if (!ca) throw new Error('Configure um EMAIL_CA válido antes de criar notificações.');
    var body = 'A atividade atingiu sua capacidade de inscrições confirmadas.\n\n' +
      notificationActivityText_(event.activity) + '\nID da atividade: ' + event.activity.id +
      '\nOcupação confirmada: ' + event.occupancy + '/' + event.activity.capacity + (event.activity.capacityUnit === 'equipes' ? ' equipes' : '') +
      '\n\nO sistema bloqueia novas inscrições nesta atividade enquanto não houver vaga. ' +
      'Confira a ocupação e o recebimento do formulário pelo menu SEMINFO.\n\n' +
      'Data do evento: ' + Utilities.formatDate(new Date(event.operation.at), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') +
      '\nSEMINFO — Centro Acadêmico Alan Turing';
    newRows.push([id, event.operation.key, event.operation.at, ca, '',
      'SEMINFO — Capacidade atingida — ' + event.activity.title, body, 'pendente', 0, '', '', '', '']);
    existing[id] = true;
  });
  if (newRows.length) {
    var requiredRows = sheet.getLastRow() + newRows.length;
    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
    }
    var range = sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, EMAIL_HEADERS.length);
    range.setNumberFormat('@');
    range.setValues(newRows);
    SpreadsheetApp.flush();
  }
  return newRows.length;
}

/**
 * Gatilho periódico / menu. O envio ocorre fora do ScriptLock.
 * O claim considera reservas de outras execuções do mesmo projeto. A cota
 * ainda pode ser consumida por outros projetos da mesma conta: trate a falha.
 */
function processarNotificacoes(deadline) {
  requireInstaller_();
  var config = getConfig_();
  if (!notificationAddress_(config.EMAIL_CA)) throw new Error('Configure EMAIL_CA antes dos envios.');
  var configured = Number(config.MAX_EMAILS_POR_EXECUCAO || 10);
  var maximum = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 50) : 10;
  var summary = { enviadas: 0, adiadas: 0, tentativas: 0 };
  // Evita ultrapassar 6 minutos mesmo que os serviços estejam lentos.
  var executionDeadline = Math.min(Date.now() + 4 * 60 * 1000, Number(deadline) || Infinity);
  for (var index = 0; index < maximum && Date.now() < executionDeadline; index++) {
    var job = withLock_(function () { return claimNotificationLocked_(); });
    if (!job) break;
    summary.tentativas++;
    var sendError = '';
    try {
      if (MailApp.getRemainingDailyQuota() < notificationRecipients_(job)) {
        sendError = 'SEM_COTA: aguardando disponibilidade de destinatários.';
      } else {
        var message = {
          to: job.DESTINATARIO,
          subject: job.ASSUNTO,
          body: job.CORPO,
          name: String(config.NOME_REMETENTE || 'SEMINFO — Centro Acadêmico Alan Turing'),
          replyTo: notificationAddress_(config.EMAIL_CA)
        };
        if (job.CC) message.cc = job.CC;
        // MailApp não oferece "from". O remetente é a conta do executor.
        MailApp.sendEmail(message);
      }
    } catch (error) {
      // Exceções do serviço podem trazer endereços: registra só classificação.
      sendError = notificationSafeError_(error);
    }
    var recorded = withLock_(function () { return finishNotificationLocked_(job, sendError); });
    if (recorded && !sendError) summary.enviadas++;
    else summary.adiadas++;
    if (/^SEM_COTA:/.test(sendError)) break;
  }
  return summary;
}

function claimNotificationLocked_() {
  var sheet = ensureNotificationSheet_();
  var rows = notificationRows_(sheet);
  var now = Date.now();
  var reserved = 0;
  rows.forEach(function (row) {
    if (row.SITUACAO !== 'processando') return;
    if (notificationMillis_(row.LEASE_ATE) > now) {
      reserved += notificationRecipients_(row);
    } else {
      row.SITUACAO = 'pendente';
      row.LEASE_ATE = '';
      row.PROXIMA_TENTATIVA = '';
      row.ERRO = 'LEASE_EXPIRADA: interrupção anterior; possível envio sem confirmação.';
      writeNotificationRow_(sheet, row);
    }
  });
  var remaining = MailApp.getRemainingDailyQuota() - reserved;
  var quotaBlocked = null;
  // A lotação precisa chegar ao CA mesmo quando há muitas confirmações na fila.
  rows.sort(function (a, b) {
    return (String(a.ID).indexOf('MAIL:CAPACIDADE:') === 0 ? 0 : 1) -
      (String(b.ID).indexOf('MAIL:CAPACIDADE:') === 0 ? 0 : 1);
  });
  for (var index = 0; index < rows.length; index++) {
    var row = rows[index];
    if (row.SITUACAO !== 'pendente' || notificationMillis_(row.PROXIMA_TENTATIVA) > now) continue;
    var required = notificationRecipients_(row);
    if (remaining < required) {
      if (!quotaBlocked) quotaBlocked = row;
      continue;
    }
    row.SITUACAO = 'processando';
    row.TENTATIVAS = Math.max(0, Number(row.TENTATIVAS) || 0) + 1;
    row.LEASE_ATE = new Date(now + EMAIL_LEASE_MS).toISOString();
    row.PROXIMA_TENTATIVA = '';
    writeNotificationRow_(sheet, row);
    return row;
  }
  // Uma única gravação por claim sem cota evita milhares de writes quando a
  // fila está grande; os demais itens continuam pendentes e serão revisitados.
  if (quotaBlocked) {
    quotaBlocked.ERRO = 'SEM_COTA: aguardando disponibilidade de destinatários.';
    quotaBlocked.PROXIMA_TENTATIVA = new Date(now + 15 * 60 * 1000).toISOString();
    writeNotificationRow_(sheet, quotaBlocked);
  }
  return null;
}

function finishNotificationLocked_(job, errorMessage) {
  var sheet = ensureNotificationSheet_();
  var row = notificationRows_(sheet).filter(function (candidate) { return candidate.ID === job.ID; })[0];
  if (!row || row.SITUACAO !== 'processando' || row.LEASE_ATE !== job.LEASE_ATE ||
      Number(row.TENTATIVAS) !== Number(job.TENTATIVAS)) return false;
  row.LEASE_ATE = '';
  if (!errorMessage) {
    row.SITUACAO = 'enviada';
    row.ENVIADA_EM = new Date().toISOString();
    row.ERRO = '';
    row.PROXIMA_TENTATIVA = '';
  } else {
    row.SITUACAO = 'pendente';
    row.ERRO = String(errorMessage).slice(0, 240);
    var backoffMinutes = Math.min(360, 5 * Math.pow(2, Math.min(Number(row.TENTATIVAS) - 1, 7)));
    if (/^SEM_COTA:/.test(row.ERRO)) backoffMinutes = Math.max(15, backoffMinutes);
    row.PROXIMA_TENTATIVA = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
  }
  writeNotificationRow_(sheet, row);
  return true;
}

function notificationMillis_(value) {
  var millis = value ? new Date(value).getTime() : 0;
  return isNaN(millis) ? 0 : millis;
}

function notificationSafeError_(error) {
  var source = String(error && error.message || error || '').toLowerCase();
  if (/quota|limit|too many|cota/.test(source)) {
    return 'SEM_COTA: limite do serviço de envio; nova tentativa será realizada.';
  }
  if (/authoriz|permission|permiss|access denied/.test(source)) {
    return 'AUTORIZACAO: revise permissões da conta responsável pelos gatilhos.';
  }
  return 'FALHA_ENVIO: serviço indisponível ou envio recusado; nova tentativa será realizada.';
}

function notificationActivityText_(activity) {
  if (!activity) return '';
  var title = String(activity.title || activity.TITULO || activity.id || activity.ID || 'Atividade');
  var start = activity.start || activity.INICIO;
  var end = activity.end || activity.FIM;
  var parts = ['Atividade: ' + title];
  if (start && end && notificationMillis_(start) && notificationMillis_(end)) {
    parts.push('Início: ' + Utilities.formatDate(new Date(start), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'));
    parts.push('Término: ' + Utilities.formatDate(new Date(end), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'));
  }
  parts.push('Local: ' + String(activity.location || activity.LOCAL || 'a informar'));
  return parts.join('\n');
}

function notificationTemplate_(operation, config) {
  var request = operation.request;
  var outcome = operation.outcome;
  var changes = outcome.changes || [];
  var confirmed = changes.filter(function (change) { return change.type === 'CONFIRM'; })[0];
  var activity = outcome.activity || (confirmed && confirmed.registration && confirmed.registration.activity);
  var code = outcome.code;
  var subject;
  var paragraphs = ['Olá!', 'Protocolo da solicitação: ' + String(request.protocol || request.key || operation.key)];
  if (request.kind === 'INSCRICAO_EQUIPE') paragraphs.push('Equipe: ' + String(request.teamName || '(nome não informado)') +
    '\nFormulário original sem e-mail de contato. Aviso administrativo para a organização.');
  switch (code) {
    case 'confirmed':
      subject = 'Inscrição confirmada';
      paragraphs.push('Sua inscrição foi confirmada. A vaga está reservada para você.');
      break;
    case 'swapped':
      subject = 'Troca concluída';
      paragraphs.push('A troca autorizada foi concluída. A nova inscrição está confirmada.');
      var canceled = changes.filter(function (change) { return change.type === 'CANCEL'; });
      paragraphs.push('Inscrições canceladas por troca:\n' + canceled.map(function (change) {
        return notificationActivityText_(change.activity || (change.registration && change.registration.activity)) ||
          'Atividade identificada pela inscrição ' + String(change.registrationId || 'anterior');
      }).join('\n\n'));
      paragraphs.push('Nova inscrição confirmada:');
      break;
    case 'full':
      subject = 'Solicitação recusada por lotação';
      paragraphs.push('A atividade está lotada. Esta solicitação não reservou uma vaga. Suas inscrições anteriores permanecem válidas.');
      break;
    case 'conflict':
      subject = 'Conflito de horário';
      paragraphs.push('A atividade conflita com uma ou mais inscrições confirmadas e a troca não foi autorizada. A solicitação foi recusada e suas inscrições anteriores permanecem válidas.');
      var cancellationUrl = String(config.URL_FORM_CANCELAMENTO_EMAIL || '').trim();
      if (cancellationUrl) {
        paragraphs.push('Se desejar cancelar uma inscrição anterior, utilize o formulário de cancelamento:\n' + cancellationUrl);
        paragraphs.push('Aguarde a confirmação do cancelamento antes de solicitar novamente a atividade desejada. A nova inscrição depende da disponibilidade de vagas.');
      }
      break;
    case 'duplicate':
      subject = 'Inscrição já existente';
      paragraphs.push('Você já possui uma inscrição confirmada nesta atividade. A inscrição existente foi preservada e nenhuma vaga adicional foi ocupada.');
      break;
    case 'canceled':
      subject = 'Cancelamento concluído';
      paragraphs.push('Sua inscrição foi cancelada e a vaga foi liberada.');
      break;
    case 'no_active':
      subject = 'Nenhuma inscrição ativa para cancelar';
      paragraphs.push('Não há inscrição ativa vinculada a esta solicitação. Nenhuma vaga foi alterada; um cancelamento repetido mantém o resultado anterior.');
      break;
    case 'identity_mismatch':
      subject = 'Identidade incompatível';
      paragraphs.push('Não foi possível validar a identidade desta solicitação. Nenhuma inscrição foi alterada. Procure o Centro Acadêmico para conferir seu cadastro.');
      // Não consulta nem inclui nome, e-mail original, inscrição ou atividade.
      activity = null;
      break;
    case 'invalid':
      subject = 'Solicitação inválida';
      paragraphs.push('A solicitação não passou pela validação dos dados ou da confirmação exigida. Confira os dados e envie uma nova solicitação pelo formulário. Se precisar de ajuda, procure o Centro Acadêmico. Nenhuma inscrição foi alterada.');
      activity = null;
      break;
    case 'closed':
      subject = 'Atividade indisponível';
      paragraphs.push('A atividade não está aberta para inscrições. Nenhuma nova vaga foi reservada. Suas inscrições anteriores permanecem válidas.');
      break;
    case 'missing_activity':
      subject = 'Atividade não encontrada';
      paragraphs.push('A atividade informada não está disponível no cadastro. Atualize o formulário e faça uma nova solicitação. Nenhuma inscrição foi alterada.');
      activity = null;
      break;
    case 'failure':
    default:
      subject = 'Solicitação requer atendimento';
      paragraphs.push('O processamento desta solicitação requer conferência. O Centro Acadêmico verificará a situação de suas inscrições. Procure a organização e informe o protocolo acima antes de fazer novas solicitações.');
      activity = null;
  }
  if (activity) paragraphs.push(notificationActivityText_(activity));
  paragraphs.push('Dúvidas e atendimento: responda a esta mensagem ou procure ' + config.EMAIL_CA + '. Alterações e cancelamentos devem ser solicitados pelos formulários oficiais; respostas por e-mail são atendidas pela organização.');
  paragraphs.push('SEMINFO — Centro Acadêmico Alan Turing\nHorários no fuso America/Sao_Paulo.');
  return { subject: 'SEMINFO — ' + subject + ' — ' + String(request.protocol || operation.key), body: paragraphs.join('\n\n') };
}
