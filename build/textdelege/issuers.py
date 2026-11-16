import re

from .extract import Article

KIND_WORDS = {
    "Decizia": "Decizia",
    "Norma": "Norma",
    "Regulament": "Regulamentul",
    "Circulara": "Circulara",
    "Hotărârea": "Hotărârea",
    "Instrucțiuni": "Instrucțiunile",
    "Metodologie": "Metodologia",
    "Procedura": "Procedura",
    "Ghid": "Ghidul",
    "Criterii": "Criteriile",
    "Precizări": "Precizările",
    "Protocol": "Protocolul",
}

ISSUERS = {
    "bnr": "BNR",
    "asf": "ASF",
    "csa": "CSA",
    "orda": "ORDA",
    "guvern": "Guvernului",
    "cna": "CNA",
    "cnvm": "CNVM",
    "csspp": "CSSPP",
    "sanatate": "Ministerului Sănătății",
    "concurenta": "Consiliului Concurenței",
    "finante": "Ministerului Finanțelor",
    "ancom": "ANCOM",
    "agricultura": "Ministerului Agriculturii",
    "anrgn": "ANRGN",
    "educatie": "Ministerului Educației",
    "anre": "ANRE",
    "mediu": "Ministerului Mediului",
    "ansvsa": "ANSVSA",
    "cnas": "CNAS",
    "interne": "Ministerului Afacerilor Interne",
    "munca": "Ministerului Muncii",
    "transporturi": "Ministerului Transporturilor",
    "economie": "Ministerului Economiei",
    "anaf": "ANAF",
    "dezvoltare": "Ministerului Dezvoltării",
    "aparare": "Ministerului Apărării Naționale",
    "metrologie": "BRML",
    "justitie": "Ministerului Justiției",
    "imm": "autorității pentru IMM-uri",
    "fgdb": "FGDB",
    "ins": "INS",
    "cncan": "CNCAN",
    "sport": "autorității pentru sport",
    "cifga": "CIFGA",
    "aep": "AEP",
    "dizabilitati": "autorității pentru persoanele cu dizabilități",
    "penitenciare": "ANP",
    "cultura": "Ministerului Culturii",
    "comunicatii": "Ministerului Comunicațiilor",
    "senat": "Senatului",
    "externe": "Ministerului Afacerilor Externe",
    "achizitii": "autorității pentru achiziții publice",
    "vama": "Autorității Vamale",
    "camera": "Camerei Deputaților",
    "fonduri": "Ministerului Fondurilor Europene",
    "copii": "autorității pentru protecția copilului",
    "fps": "FPS",
    "iccj": "ÎCCJ",
    "fga": "FGA",
    "turism": "autorității pentru turism",
    "familie": "Ministerului Familiei",
    "anpc": "ANPC",
    "ancpi": "ANCPI",
    "anrsc": "ANRSC",
    "anrm": "ANRM",
    "osim": "OSIM",
    "offshore": "ACROPO",
    "parchet": "Ministerului Public",
    "privatizare": "Agenției Naționale pentru Privatizare",
    "anfp": "ANFP",
    "revolutionari": "Secretariatului de Stat pentru Problemele Revoluționarilor",
    "sts": "STS",
    "sri": "SRI",
    "onjn": "ONJN",
    "adr": "ADR",
    "aspaas": "ASPAAS",
    "inaltifunctionari": "Comisiei de concurs pentru înalții funcționari publici",
    "ccir": "CCIR",
    "macroprudential": "CNSM",
    "hipica": "Autorității Hipice Naționale",
    "anofm": "ANOFM",
    "dapl": "Departamentului pentru Administrație Publică Locală",
    "spp": "SPP",
    "isc": "ISC",
    "prognoza": "Comisiei Naționale de Prognoză",
    "romi": "Agenției Naționale pentru Romi",
    "rezervestat": "Administrației Naționale a Rezervelor de Stat",
    "cncd": "CNCD",
    "cnpp": "CNPP",
    "europene": "autorității pentru afaceri europene",
    "functiepublica": "Ministerului Funcției Publice",
    "anmcs": "ANMCS",
    "cinematografie": "Centrului Național al Cinematografiei",
    "curteadeconturi": "Curții de Conturi",
    "fgdspp": "FGDSPP",
    "onpcsb": "ONPCSB",
    "antidoping": "Agenției Naționale Antidoping",
    "rur": "RUR",
    "geodezi": "Ordinului Geodezilor",
    "cafr": "CAFR",
    "infrastructura": "Departamentului pentru Proiecte de Infrastructură",
    "arhitecti": "Ordinului Arhitecților",
    "disciplinafunctionari": "Comisiei de disciplină pentru înalții funcționari publici",
    "inspectiajudiciara": "Inspecției Judiciare",
    "integritate": "ANI",
}

_LABEL = re.compile(
    "^(" + "|".join(re.escape(word) for word in KIND_WORDS) + r") ([a-z][a-z0-9-]*)(?=\s|$)"
)


def issuer_label(label: str) -> str:
    match = _LABEL.match(label)
    if not match:
        return label
    kind, slug = match.groups()
    issuer = ISSUERS.get(slug, slug.upper())
    return f"{KIND_WORDS[kind]} {issuer}{label[match.end():]}"


def relabel_articles(articles: list[Article]) -> None:
    """Rewrite the law labels cached from commit author names, in place."""
    for article in articles:
        for version in article.versions:
            version.law_label = issuer_label(version.law_label)
        if article.repealed_by_label:
            article.repealed_by_label = issuer_label(article.repealed_by_label)
