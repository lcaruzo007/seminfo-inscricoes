/** Recuperacao pontual das equipes ausentes da lista antiga enviada pela organizacao. */
var SEMINFO_EQUIPES_FALTANTES_LISTA_ANTIGA = [
  {
    "teamName": "coffee = [\"Caf\u00e9\", \"P\u00e3o de Queijo\", \"Bolo de Fub\u00e1\", \"Suco de Laranja\", \"Sandu\u00edche\",\"Guaran\u00e1\", \"Bolo de chocolate\", \"Biscoito\",\"Rosca\"] while True:   if len(coffee) > 0:     coffee.pop()   else:     break",
    "teamType": "T\u00e9cnico em inform\u00e1tica",
    "declaredSize": 3,
    "submittedAt": "2026-10-07T16:46:44-03:00",
    "rawMembers": [
      "Lucas Pereira de Morais 119.855.866-06",
      "Ana Julia de Oliveira Cipriano 179.298.466-95",
      "Bianca Cruz de Melo 131.820.036-90"
    ]
  },
  {
    "teamName": "Printf(\"Nome da Equipe: %d\", nome);",
    "teamType": "T\u00e9cnico em inform\u00e1tica",
    "declaredSize": 3,
    "submittedAt": "2026-10-07T17:35:48-03:00",
    "rawMembers": [
      "Pedro Augusto Esteves Leite 173.226.296.98",
      "Ranieri dos Reis da Silva F\u00e1tima 164.039.926.78",
      "Luis Ot\u00e1vio Ruela Rodrigues 172.336.856.30"
    ]
  },
  {
    "teamName": "os aurudos",
    "teamType": "T\u00e9cnico em inform\u00e1tica",
    "declaredSize": 3,
    "submittedAt": "2026-10-08T09:40:09-03:00",
    "rawMembers": [
      "Felipe Yuji Murakami Pires130.567.769-29",
      "Raul Jos\u00e9 Peixoto Tozzi Filho \n147.176.596-27",
      "Bruno Vinicius Povoa Arruda 138.227.886-16"
    ]
  },
  {
    "teamName": "Bab\u00e1s da Catarina",
    "teamType": "Ci\u00eancia da Computa\u00e7\u00e3o",
    "declaredSize": 3,
    "submittedAt": "2026-10-08T21:13:38-03:00",
    "rawMembers": [
      "Rafaela Alves Magalh\u00e3es - 09958441608",
      "Eduardo Mello Imakawa - 17420218676",
      "Ana Clara Andreassa de Souza"
    ]
  } ,
{
  "teamName": "Cquer+",
  "teamType": "T\u00e9cnico em inform\u00e1tica",
  "declaredSize": 3,
  "submittedAt": "2026-10-20T08:09:12-03:00",
  "rawMembers": [
    "Carlos Eduardo Rabello, \n169.777.656-66,\n INFO F,\n35 99892-6905",
    "Julia Tejada,\n134.444.636-18,\nINFO F,\n35 99874-0202",
    "Milenna Augusta de Oliveira,\n139.472.796-80,\nINFO F,\n35 99258-0358"
  ]
}
];

/** Executar uma vez; repetir nao duplica equipes nem reativa cancelamentos. */
function importarEquipesFaltantesListaAntigaCsp() {
  requireInstaller_();
  var source = getCspImportSource_();
  if (source.schema !== 'equipes' || source.activityId !== 'CSP_2026') throw new Error('Configure a importacao por equipes da CSP_2026.');
  var report = withLock_(function () {
    var journal = readJournal_();
    assertCspImportDestination_(journal.state, source);
    var unit = cspTeamUnitOperation_(journal.state, source);
    if (unit) { commitOperationLocked_(journal, unit); journal = readJournal_(); }
    var results = [];
    function sameName(name) { return String(name).trim().toLowerCase(); }
    SEMINFO_EQUIPES_FALTANTES_LISTA_ANTIGA.forEach(function (entry) {
      var responseId = 'LISTA_ANTIGA_' + hash_(entry.teamName + ':' + entry.submittedAt).slice(0, 32);
      var key = source.formId + ':' + responseId;
      var existing = Object.values(journal.state.registrations).filter(function (team) {
        return team.entityType === 'EQUIPE' && team.activityId === source.activityId &&
          (sameName(team.teamName) === sameName(entry.teamName) || sameName(team.teamName) === sameName(entry.teamName.slice(0, 200)));
      })[0];
      if (existing || journal.byKey[key]) {
        results.push({equipe: entry.teamName, resultado: existing ? existing.status : journal.byKey[key].outcome.code, jaExistia: true});
        return;
      }
      var members = [], errors = [];
      entry.rawMembers.forEach(function (raw, index) {
        try { var member = parseCspTeamMember_(raw, index + 1); if (member) members.push(member); }
        catch (error) { errors.push(String(error.message || error)); }
      });
      var request = {key: key, kind: 'INSCRICAO_EQUIPE', activityId: source.activityId,
        formId: source.formId, responseId: responseId, protocol: protocol_(key), submittedAt: entry.submittedAt,
        name: entry.teamName, teamName: entry.teamName, teamType: entry.teamType, email: '',
        cpf: members[0] && members[0].cpf || '', members: members, declaredSize: entry.declaredSize,
        rawMembers: entry.rawMembers, invalidAnswer: errors.length > 0 || entry.teamName.length > 200,
        importErrors: errors, identitySource: 'RECUPERACAO_LISTA_ANTIGA_ORGANIZACAO'};
      var outcome = cspImportOutcome_(journal.state, request);
      if (outcome.code === 'confirmed') {
        var operation = cspImportOperation_(request, outcome);
        operation.reason = 'Recuperacao das equipes ausentes a partir da lista antiga fornecida pela organizacao.';
        commitOperationLocked_(journal, operation);
        journal = readJournal_();
      }
      results.push({equipe: entry.teamName, resultado: outcome.code, motivo: outcome.message, jaExistia: false});
    });
    rebuildViewsLocked_(journal);
    return {equipes: results, importadasAgora: results.filter(function (entry) { return !entry.jaExistia && entry.resultado === 'confirmed'; }).length,
      ocupacao: SemDomain.occupancy(journal.state, source.activityId)};
  });
  try { refreshFormsSafely_(); } catch (error) { report.pendenciaFormulario = safeError_(error); }
  console.log(JSON.stringify(report, null, 2));
  return report;
}
