"""Valida fontes e testes; atualiza dados e gera a entrega em dist/."""
from pathlib import Path
import json
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
DOCS = ROOT / "docs"
DATA = ROOT / "data"
DIST = ROOT / "dist"
SOURCES = ["Config.gs", "Domain.gs", "Persistence.gs", "Forms.gs", "Notifications.gs", "Admin.gs", "Importacao.gs"]
TESTS = ["domain", "notifications", "forms-install", "persistence"]
PROJECT_NAME = "seminfo-inscricoes"


def run_node(arguments):
    result = subprocess.run(["node", *arguments], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(result.returncode)
    return result.stdout + result.stderr


def main():
    DIST.mkdir(exist_ok=True)
    manifest = json.loads((SRC / "appsscript.json").read_text(encoding="utf-8"))
    assert manifest["timeZone"] == "America/Sao_Paulo"
    assert manifest["runtimeVersion"] == "V8"
    syntax = "const fs=require('node:fs'),vm=require('node:vm'); new vm.Script(process.argv.slice(1).map(p=>fs.readFileSync(p,'utf8')).join('\\n')); process.stdout.write('Sintaxe dos arquivos validada.\\n');"
    logs = ["SEMINFO — verificações locais. Serviços Google simulados.\n", run_node(["-e", syntax, *[str(SRC / name) for name in SOURCES]])]
    total = 0
    outputs = {}
    for suite in TESTS:
        output = run_node([f"tests/{suite}.test.cjs"])
        count = re.search(r"\btests\s+(\d+)", output)
        assert count, f"Contagem não encontrada para {suite}"
        outputs[suite] = int(count.group(1))
        total += outputs[suite]
        logs.extend([f"\n=== {suite} ===\n", output])
        print(f"{suite}: {outputs[suite]} testes aprovados")
    logs.append(f"\nTOTAL: {total} testes aprovados; nenhuma falha. Nenhum teste ao vivo no Google executado.\n")
    (DIST / "test-results.txt").write_text("".join(logs), encoding="utf-8")

    tests_doc = (DOCS / "TESTES.md").read_text(encoding="utf-8")
    tests_doc = re.sub(r"\*\*\d+ testes aprovados, nenhuma falha\*\*", f"**{total} testes aprovados, nenhuma falha**", tests_doc)
    for suite, count in outputs.items():
        tests_doc = re.sub(rf"(\| `tests/{re.escape(suite)}\.test\.cjs` \| )\d+( \|)", rf"\g<1>{count}\2", tests_doc)
    (DOCS / "TESTES.md").write_text(tests_doc, encoding="utf-8")

    metadata_script = "const fs=require('node:fs'),vm=require('node:vm'); const c=vm.createContext({}); for(const f of ['Domain.gs','Config.gs','Admin.gs']) vm.runInContext(fs.readFileSync('src/'+f,'utf8'),c); const program=c.programacaoSeminfo2026_(); process.stdout.write(JSON.stringify({forms:JSON.parse(c.SEMINFO_CONFIG.FORMULARIOS_INSCRICAO_JSON),program,activities:program.map(c.atividadeDaProgramacao_)}));"
    metadata = json.loads(run_node(["-e", metadata_script]))
    assert len(metadata["forms"]) == 10
    assert len({form["id"] for form in metadata["forms"]}) == 10
    assert len(metadata["activities"]) == 18
    for filename, value in [
        ("FORMULARIOS_SEMINFO_2026.json", metadata["forms"]),
        ("PROGRAMACAO_SEMINFO_2026.json", metadata["program"]),
        ("ATIVIDADES_SEMINFO_2026.json", metadata["activities"]),
    ]:
        (DATA / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    samples = ["XXI SEMINFO — CADASTROS\n\n",
               "Para atualizar preservando inscrições, execute atualizarProgramacaoSeminfo2026.\n",
               "Para reiniciar completamente, consulte docs/COMECAR_DO_ZERO.md.\n",
               "No cadastro manual, copie um objeto por vez entre INICIO JSON e FIM JSON.\n",
               "Campos desconhecidos permanecem vazios/null e situação pendente.\n\n"]
    for activity in metadata["activities"]:
        samples.extend([activity["id"] + "\nINICIO JSON\n", json.dumps(activity, ensure_ascii=False, indent=2), "\nFIM JSON\n\n"])
    (DIST / "EXEMPLOS_JSON.txt").write_text("".join(samples), encoding="utf-8")

    delivery = [(ROOT / "README.md").read_text(encoding="utf-8"), "\n---\n\n",
                (DOCS / "MANUAL.md").read_text(encoding="utf-8"), "\n---\n\n",
                (DOCS / "COMECAR_DO_ZERO.md").read_text(encoding="utf-8"), "\n---\n\n# Arquivos de instalação — conteúdo integral\n"]
    for name in SOURCES + ["appsscript.json"]:
        language = "json" if name.endswith(".json") else "javascript"
        delivery.append(f"\n## src/{name}\n\n```{language}\n{(SRC / name).read_text(encoding='utf-8').rstrip()}\n```\n")
    delivery.extend(["\n---\n\n", tests_doc])
    (DIST / "ENTREGA_COMPLETA.md").write_text("".join(delivery), encoding="utf-8")

    files = [ROOT / name for name in ["README.md", ".gitignore", ".gitattributes"]]
    files.extend(SRC / name for name in SOURCES + ["appsscript.json"])
    for folder, pattern in [(DOCS, "*.md"), (DATA, "*.json"), (ROOT / "tests", "*.cjs"), (ROOT / "scripts", "*.py")]:
        files.extend(folder.glob(pattern))
    destination = DIST / f"{PROJECT_NAME}.zip"
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(files):
            archive.write(file, Path(PROJECT_NAME) / file.relative_to(ROOT))
    print(f"TOTAL: {total} testes aprovados. ZIP: {destination}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
