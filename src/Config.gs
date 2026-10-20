/** SEMINFO: ajuste os valores antes da primeira instalação. */
var SEMINFO_CONFIG = Object.freeze({
  EMAIL_CA: 'cacompifmuz@gmail.com',
  NOME_REMETENTE: 'SEMINFO — Centro Acadêmico Alan Turing',
  ENVIAR_COPIA_CA: true, // Cópia somente de problemas; confirmações, trocas e cancelamentos concluídos não têm CC.
  ID_PLANILHA: '1ir3nRnH9ulhZxI4Eu1yP6uvdgFlfWmZ-gs8zlvN-pCE',
  ID_FORM_INSCRICAO: '',
  ID_FORM_CANCELAMENTO: '1jb4dGQGcCpQyrLthWvCakBtkED8SwG2UC2k3LxoI9eI',
  URL_FORM_CANCELAMENTO_EMAIL: '',
  CSP_RESPONSE_SPREADSHEET_ID: '1tFSDmBp9wsCskM0dIF_ax9-CM6upvodHAYL0xi2QhrA',
  CSP_RESPONSE_SHEET_ID: '858916137',
  IMPORTACAO_CSP_JSON: JSON.stringify({formId: '1oXixuiIIJ1sGVdTgs0uEQVSEaqxEO5NqupTi-4xv2ww', activityId: 'CSP_2026', schema: 'equipes',
    items: {TEAM_TYPE: 742351656, TEAM_NAME: 396811097, TEAM_SIZE: 1358170985, MEMBER1: 98572697, MEMBER2: 1537440165, MEMBER3: 1869818828}}),
  FORMULARIOS_INSCRICAO_JSON: JSON.stringify([
    {id: '1gD2e10L3Zx4cL56TkEIkpgnaP7uX6Qfo1PnAsGYg5fs', activityId: 'ABERTURA_2026', title: 'Abertura — XXI Seminfo', items: {}},
    {id: '1RBZLZRULRV9Tm9ca-IF4jo9-XfqDPDEYW0QXZF2Osj8', activityId: 'OFICINA_GAMEMAKER', title: 'Oficina de Jogos — Ricardo Martins — Tarde', items: {NAME: 859649298, CPF: 760956815, SWAP: 356100908}},
    {id: '1_5SDFy4fo9_Z4VHRGknl9Zk3cKdSpo--qmBGiA3LbGU', activityId: 'OFICINA_JOGOS_NOITE', title: 'Oficina de Jogos — Ricardo Martins — Noite', items: {}},
    {id: '1Gi6L9zhuS_QC1WfdggJ9DKFh7JheOIkuAPJS3CAZROQ', activityId: 'OFICINA_BLENDER', title: 'Oficina de 3D — Caio H.', items: {NAME: 859649298, CPF: 760956815, SWAP: 886894478}},
    {id: '1pxsvR0WlyH3QXcUUYTAhFMTd-FnbsfwekesEED9IxcU', activityId: 'OFICINA_OLLAMA', title: 'Oficina Ollama — Darosa', items: {}},
    {id: '16O4ErOSmYY9X0y0xGdKZ0w9p2WNStUAWb_CF65OuMjs', activityId: 'OFICINA_IA_ALEM_CHAT', title: 'Oficina IA Além do Chat — Rafaela', items: {}},
    {id: '1g-uG-5jHRtSXm7hW5R3ynBVkuCTrKtjnW3heKfz3es8', activityId: 'PALESTRA_BIO', title: 'Palestra Bio — Auditório H', items: {}},
    {id: '1wSyqdk-CWLhizEJI9YkkikDkHkyWoZ6ZfmsCLIZvuQs', activityId: 'OFICINA_SEGURANCA', title: 'Oficina Segurança da Informação — Rafaela', items: {}},
    {id: '1_RzlNsniwp_NryGGu1F5uHOGSLvEYvg_xn4BEXnnNgI', activityId: 'PALESTRA_DANIELE', title: 'Palestra Online — Daniele Tavares', items: {}},
    {id: '14Uf2m_mLeZJSDjX7vgwkiriY5hKbDD9EKuS2EUNM8_Q', activityId: 'PALESTRA_JOHNATAN', title: 'Palestra Online — Johnatan UFLA', items: {}}
  ]),
  CRIAR_FORM_CANCELAMENTO: true,
  MAX_EMAILS_POR_EXECUCAO: 10,
  MAX_SOLICITACOES_POR_EXECUCAO: 30,
  TEMPO_LOCK_MS: 30000,
  FUSO: 'America/Sao_Paulo'
});

var SEMINFO_TABLES = Object.freeze({
  Configuracoes: ['CHAVE', 'VALOR'],
  Atividades: ['ID', 'TITULO', 'TIPO', 'DESCRICAO', 'MINISTRANTE', 'LOCAL', 'INICIO', 'TERMINO', 'CAPACIDADE', 'SITUACAO', 'OCUPACAO'],
  Participantes: ['CPF', 'NOME', 'EMAIL_VERIFICADO'],
  Solicitacoes: ['CHAVE', 'PROTOCOLO', 'FORM_ID', 'RESPOSTA_ID', 'RECEBIDA_EM', 'PROCESSADA_EM', 'TIPO', 'CPF', 'EMAIL', 'ATIVIDADE_ID', 'RESULTADO'],
  Inscricoes: ['ID', 'CPF', 'ATIVIDADE_ID', 'SITUACAO', 'CRIADA_EM', 'ATUALIZADA_EM', 'JUSTIFICATIVA'],
  Equipes: ['ID', 'ATIVIDADE_ID', 'EQUIPE', 'TIPO_EQUIPE', 'COACH_CPF', 'QTD_INTEGRANTES', 'SITUACAO', 'CRIADA_EM', 'JUSTIFICATIVA'],
  IntegrantesEquipes: ['EQUIPE_ID', 'EQUIPE', 'CPF', 'NOME', 'PAPEL', 'TURMA', 'TELEFONE', 'TEXTO_ORIGINAL'],
  Operacoes: ['REGISTRO_JSON'],
  Historico: ['OPERACAO', 'DATA', 'TIPO', 'RESUMO'],
  Erros: ['DATA', 'CONTEXTO', 'CHAVE', 'ERRO']
});

function props_() { return PropertiesService.getScriptProperties(); }

function db_() {
  var id = props_().getProperty('SEMINFO_ID_PLANILHA') || SEMINFO_CONFIG.ID_PLANILHA;
  if (!id) throw new Error('Execute instalarSistema pela planilha que receberá o sistema.');
  return SpreadsheetApp.openById(id);
}

function ensureTable_(name, headers) {
  var sheet = db_().getSheetByName(name) || db_().insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#17324d').setFontColor('#ffffff');
  } else {
    var found = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (JSON.stringify(found) !== JSON.stringify(headers) || sheet.getLastColumn() > headers.length) {
      throw new Error('Aba ' + name + ' tem estrutura incompatível. Nenhum dado será apagado; confira os cabeçalhos.');
    }
  }
  return sheet;
}

function tableRows_(name) {
  var sheet = db_().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values.filter(function(row) { return row.some(function(v) { return v !== ''; }); }).map(function(row) {
    var item = {};
    headers.forEach(function(h, i) { item[h] = row[i]; });
    return item;
  });
}

function safeCell_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' && /^[=+@-]/.test(value)) return "'" + value;
  return value;
}

/** Apenas visões derivadas podem ser regravadas. Nunca use em Operacoes/FilaEmails. */
function writeTable_(name, headers, rows) {
  if (name === 'Operacoes' || name === 'FilaEmails') throw new Error('Registro durável não pode ser reconstruído por writeTable_.');
  var sheet = ensureTable_(name, headers);
  var values = rows.map(function(row) {
    return (Array.isArray(row) ? row : headers.map(function(h) { return row[h]; })).map(safeCell_);
  });
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  if (values.length) {
    if (sheet.getMaxRows() < values.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), values.length + 1 - sheet.getMaxRows());
    sheet.getRange(2, 1, values.length, headers.length).setNumberFormat('@').setValues(values);
  }
}

function getConfig_() {
  var result = Object.assign({}, SEMINFO_CONFIG);
  if (props_().getProperty('SEMINFO_ID_PLANILHA') || SEMINFO_CONFIG.ID_PLANILHA) {
    tableRows_('Configuracoes').forEach(function(row) { if (Object.prototype.hasOwnProperty.call(result, row.CHAVE)) result[row.CHAVE] = row.VALOR; });
  }
  result.ID_PLANILHA = props_().getProperty('SEMINFO_ID_PLANILHA') || result.ID_PLANILHA;
  ['ENVIAR_COPIA_CA', 'CRIAR_FORM_CANCELAMENTO'].forEach(function(key) {
    result[key] = result[key] === true || /^(true|sim)$/i.test(String(result[key]));
  });
  ['MAX_EMAILS_POR_EXECUCAO', 'MAX_SOLICITACOES_POR_EXECUCAO', 'TEMPO_LOCK_MS'].forEach(function(k) {
    result[k] = Number(result[k]);
    if (!Number.isInteger(result[k]) || result[k] < 1) throw new Error('Configuração inválida: ' + k);
  });
  if (result.MAX_EMAILS_POR_EXECUCAO > 50 || result.MAX_SOLICITACOES_POR_EXECUCAO > 100 || result.TEMPO_LOCK_MS > 30000) throw new Error('Configuração de lote/bloqueio excessiva.');
  if (result.FUSO !== 'America/Sao_Paulo') throw new Error('FUSO deve ser America/Sao_Paulo.');
  return result;
}

function setConfig_(key, value) {
  if (!Object.prototype.hasOwnProperty.call(SEMINFO_CONFIG, key)) throw new Error('Chave de configuração desconhecida: ' + key);
  var sheet = ensureTable_('Configuracoes', SEMINFO_TABLES.Configuracoes);
  var rows = tableRows_('Configuracoes');
  var index = rows.findIndex(function(row) { return row.CHAVE === key; });
  var rowNumber = index < 0 ? sheet.getLastRow() + 1 : index + 2;
  sheet.getRange(rowNumber, 1, 1, 2).setNumberFormat('@').setValues([[key, safeCell_(String(value))]]);
}

function withLock_(fn, allowReset, allowPendingOperation) {
  var lock = LockService.getScriptLock();
  lock.waitLock(getConfig_().TEMPO_LOCK_MS);
  try {
    if (!allowReset) assertNoReset_();
    if (!allowPendingOperation) assertNoPendingOperation_();
    return fn();
  }
  finally { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
}

function pendingOperationToken_() {
  return String(Date.now()) + '|' + Math.random().toString(36).slice(2);
}

function clearPendingOperation_(key, token) {
  var properties = props_();
  if (properties.getProperty(key) === token) properties.deleteProperty(key);
}

function assertNoPendingOperation_() {
  var properties = props_();
  var keys = ['SEMINFO_INSTALL_PENDING', 'SEMINFO_FORM_REFRESH_PENDING'];
  keys.forEach(function(key) {
    var value = properties.getProperty(key);
    if (!value) return;
    var startedAt = Number(String(value).split('|')[0]);
    if (Number.isFinite(startedAt) && Date.now() - startedAt > 480000) {
      properties.deleteProperty(key);
      return;
    }
    var operation = key === 'SEMINFO_INSTALL_PENDING' ? 'instalação' : 'atualização dos Forms';
    throw new Error('Há uma ' + operation + ' em andamento ou interrompida. Aguarde e tente novamente.');
  });
}

function assertNoReset_() {
  if (props_().getProperty('SEMINFO_RESET_PENDING')) throw new Error('Limpeza em andamento ou interrompida. Execute limparTudoERecomecar para concluir antes de operar o sistema.');
}

function requireInstaller_(allowReset) {
  var installer = props_().getProperty('SEMINFO_INSTALLER');
  var email = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!installer || !email || installer !== email) throw new Error('Esta operação deve ser executada pela conta que instalou o sistema.');
  if (!allowReset) {
    assertNoReset_();
    assertNoPendingOperation_();
  }
}

function validateMailConfig_() {
  var config = getConfig_();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(config.EMAIL_CA)) throw new Error('Configure EMAIL_CA com um único endereço válido na aba Configuracoes.');
  if (!config.NOME_REMETENTE || String(config.NOME_REMETENTE).length > 150) throw new Error('NOME_REMETENTE inválido.');
  return config;
}

function recordError_(context, key, error) {
  // Sem CPF, e-mail ou conteúdo das respostas nos registros de exceção.
  try {
    ensureTable_('Erros', SEMINFO_TABLES.Erros).appendRow([new Date().toISOString(), context, key || '', safeError_(error)]);
  } catch (_) { console.error('SEMINFO: falha ao registrar erro operacional.'); }
}

function safeError_(error) {
  return String(error && error.message || error || 'Falha desconhecida').replace(/[\w.+-]+@[\w.-]+/g, '[email]').replace(/\b\d{11}\b/g, '[identificador]').slice(0, 600);
}

function protocol_(key) {
  return 'SEM-' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 20).toUpperCase();
}
