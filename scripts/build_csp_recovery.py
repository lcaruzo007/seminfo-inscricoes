"""Preserva TSVs históricos de IntegrantesEquipes e, opcionalmente, Equipes."""
import argparse
import csv
import json
from pathlib import Path


HEADERS = ["EQUIPE_ID", "EQUIPE", "CPF", "NOME", "PAPEL", "TURMA", "TELEFONE", "TEXTO_ORIGINAL"]
TEAM_HEADERS = ["ID", "ATIVIDADE_ID", "EQUIPE", "TIPO_EQUIPE", "COACH_CPF", "QTD_INTEGRANTES", "SITUACAO", "CRIADA_EM", "JUSTIFICATIVA"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--teams", type=Path, help="TSV da aba Equipes da mesma versão histórica")
    args = parser.parse_args()
    with args.source.open(encoding="utf-8-sig", newline="") as stream:
        rows = [row for row in csv.reader(stream, delimiter="\t") if any(row)]
    if not rows or rows[0] != HEADERS or any(len(row) != len(HEADERS) for row in rows):
        raise SystemExit("O arquivo precisa ter as oito colunas originais de IntegrantesEquipes.")
    if len(rows) < 2:
        raise SystemExit("O arquivo não contém integrantes.")
    team_rows = None
    if args.teams:
        with args.teams.open(encoding="utf-8-sig", newline="") as stream:
            team_rows = [row for row in csv.reader(stream, delimiter="\t") if any(row)]
        if not team_rows or team_rows[0] != TEAM_HEADERS or any(len(row) != len(TEAM_HEADERS) for row in team_rows):
            raise SystemExit("O arquivo --teams precisa ter as nove colunas originais da aba Equipes.")
        if len(team_rows) < 2:
            raise SystemExit("O arquivo --teams não contém equipes.")
    args.output.mkdir(parents=True, exist_ok=True)
    # O diretório fica em dist/: dados pessoais não entram no ZIP do projeto.
    (args.output / "integrantes.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (args.output / "Backup_CSP_Integrantes.tsv").open("w", encoding="utf-8-sig", newline="") as stream:
        csv.writer(stream, delimiter="\t", lineterminator="\n").writerows(rows)
    helper = "/** Dados exportados da versão histórica; execute após atualizar Importacao.gs. */\nfunction prepararBackupCspSalvo() {\n  var memberRows = "
    helper += json.dumps(rows, ensure_ascii=False, indent=2) + ";\n"
    if team_rows:
        (args.output / "equipes.json").write_text(json.dumps(team_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        with (args.output / "Backup_CSP_Equipes.tsv").open("w", encoding="utf-8-sig", newline="") as stream:
            csv.writer(stream, delimiter="\t", lineterminator="\n").writerows(team_rows)
        helper += "  var teamRows = " + json.dumps(team_rows, ensure_ascii=False, indent=2) + ";\n"
        helper += "  return prepararRecuperacaoEquipesCsp(memberRows, teamRows);\n}\n"
    else:
        helper += "  return prepararRecuperacaoEquipesCsp(memberRows);\n}\n"
    (args.output / "RecuperacaoCspSalva.gs").write_text(helper, encoding="utf-8")
    teams = len({row[0] for row in rows[1:]})
    metadata_note = "Os dados da aba Equipes também serão conferidos e preservarão tipo, situação e data original." if team_rows else "Sem --teams, tipo e data original não serão preservados."
    guide = f"""RECUPERAR CSP: {teams} equipes e {len(rows) - 1} integrantes

1. Atualize src/Importacao.gs no mesmo projeto Apps Script instalado.
2. Crie um arquivo RecuperacaoCspSalva.gs e cole o auxiliar desta pasta.
3. Execute prepararBackupCspSalvo pela conta instaladora.
   Ele cria um backup privado protegido e uma prévia; não confirma inscrições.
4. Abra a prévia pelo link do log. Confira as equipes e os resultados previstos.
   CSP_2026 precisa estar cadastrada com horários e capacidade em equipes.
   {metadata_note}
5. Execute importarInscricoesAnterioresCsp. Repita enquanto restantes for maior que zero.
   Se houver pendentesConferencia, confira os dados na prévia antes de prosseguir.

As equipes recuperadas entram no livro Operacoes, mantendo seus IDs originais.
Novas respostas do Form entram junto do backup na próxima prévia/importação.
Não cole os dados apenas na aba IntegrantesEquipes: ela é reconstruída pelo livro.
Não use Começar do zero para recuperar: essa ação limpa os registros operacionais.
O backup Backup_CSP_Salvo_... é separado e não é reescrito pela reconstrução.
Guarde o XLSX/TSV também fora da planilha como cópia independente.
"""
    (args.output / "COMO_RECUPERAR.txt").write_text(guide, encoding="utf-8")
    print(f"Backup preparado: {teams} equipes, {len(rows) - 1} integrantes" +
          (", com metadados da aba Equipes" if team_rows else "") + f". Pasta: {args.output}")


if __name__ == "__main__":
    main()
