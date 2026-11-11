# Textdelege: design

**[Română](#română)** · **[English](#english)**

## Română

Textdelege afișează legislația românească cu tot istoricul ei. Pentru fiecare articol vezi textul, perioada în care s-a aplicat și actul care l-a modificat. Mai jos sunt sursele din care am preluat designul și ce folosim pe site.

### De unde vine designul

**Portaluri de legislație**

| Sursă | Ce am preluat |
| --- | --- |
| [legislation.gov.uk](https://www.legislation.gov.uk/) (Regatul Unit) | O pagină pentru fiecare articol; data în adresă, purtată de toate legăturile paginii; anunțul că citești o formă veche; tabelul de modificări cu filtre și flux Atom; atribuirea pe alineate și evidențierea, afișate doar la cerere. |
| [Légifrance](https://www.legifrance.gouv.fr/) (Franța) | Rândul de stare „În vigoare din …” sub titlu; comparația dintre două versiuni; tema deschisă, închisă sau ca sistemul. |
| [RIS](https://www.ris.bka.gv.at/) (Austria) | Data textului afișat spusă într-o propoziție, nu doar într-o etichetă; adresa permanentă a citării. |
| [Lovdata](https://lovdata.no/) (Norvegia), [LII](https://www.law.cornell.edu/) (SUA) | Cuprinsul actului în stânga, cu filtru; legăturile spre articolul anterior și următor sub text; acțiunile paginii adunate în coloana din dreapta. |
| [lagen.nu](https://lagen.nu/) (Suedia), [dejure.org](https://dejure.org/) (Germania) | Actul care a scris fiecare alineat, afișat discret sub el; panoul de citare cu buton de copiere. |
| [EUR-Lex](https://eur-lex.europa.eu/) (Uniunea Europeană) | Ce am evitat: un șir lung de unelte la fel de importante, fără o acțiune principală. |

**Sisteme de design**

| Sursă | Ce am preluat |
| --- | --- |
| [GOV.UK Design System](https://design-system.service.gov.uk/) (Regatul Unit) | Un singur buton principal pe pagină și două stiluri de butoane; firul de navigare; eticheta deasupra titlului; lista de rezumat; textul inserat și avertismentul; legătura de salt la conținut; inelul galben de focalizare; data scrisă de mână, cu calendarul doar ca ajutor. |
| [DSFR](https://www.systeme-de-design.gouv.fr/) (Franța), [USWDS](https://designsystem.digital.gov/) (SUA), [Canada.ca](https://design.canada.ca/) (Canada), [DKFDS](https://designsystem.dk/) (Danemarca), [NL Design System](https://nldesignsystem.nl/) (Olanda) | Antetul cu marca, un câmp de căutare și puține legături; pe telefon, butoanele „Caută” și „Meniu”; subsolul cu coloane scurte de legături; filtrele grupate într-un panou deasupra listei, cu numărul de rezultate. |
| [Carbon](https://carbondesignsystem.com/) (IBM), [Primer](https://primer.style/) (GitHub), [Polaris](https://polaris.shopify.com/) (Shopify), [Atlassian](https://atlassian.design/), [Codex](https://doc.wikimedia.org/codex/) (Wikimedia) | Starea scrisă în cuvinte și colorată la fel peste tot; etichete scurte, cu verbul la început; tabele fără dungi, cu cifre tabulare; file doar pentru vederi ale aceluiași obiect. |
| [Wikipedia](https://www.wikipedia.org/), [GitHub](https://github.com/) | Comparația cuvânt cu cuvânt, cu textul șters tăiat și cel adăugat subliniat; atribuirea fiecărui rând unui commit, de unde vine „Legea fiecărui alineat”. |
| [MDN](https://developer.mozilla.org/) | Pagina de documentație: cuprins în stânga, text cu lățime limitată, unelte în dreapta, subsol scurt. |

**Litere**: [Source Serif 4](https://github.com/adobe-fonts/source-serif) (Adobe), [IBM Plex Sans](https://github.com/IBM/plex) (IBM, fontul sistemului Carbon), [Caveat](https://github.com/googlefonts/caveat) pentru marcă; mărimile și lungimea rândului după [Practical Typography](https://practicaltypography.com/) (Matthew Butterick).

### Text și litere

- Legea este culeasă cu serif ([Source Serif 4](https://github.com/adobe-fonts/source-serif)), iar interfața cu sans ([IBM Plex Sans](https://github.com/IBM/plex)).
- Un rând de text de lege are cel mult aproximativ 70 de caractere.
- Numerele alineatelor stau într-o margine separată.
- Mărimea textului se alege din „Opțiuni” și se aplică pe tot site-ul.

### Culori

- Culoarea marchează doar o stare, o diferență sau actul care a scris un alineat, iar starea e scrisă și în cuvinte.
- În comparații, textul șters e tăiat, iar cel adăugat e subliniat.
- Temă deschisă și închisă, cu contrast WCAG 2.2 AA în ambele.

| Rol | Deschisă | Închisă | Folosire |
| --- | --- | --- | --- |
| `text` | `#1a1a1a` | `#e6e3dc` | textul |
| `secondary` | `#4a4a4a` | `#c4c0b8` | metadate, etichete |
| `muted` | `#6b6761` | `#9a958c` | numerele alineatelor, titluri mici |
| `page` | `#f5f3ee` | `#141414` | fundalul |
| `paper` | `#ffffff` | `#1d1d1d` | foaia cu textul |
| `mast` | `#0b2a6b` | `#0b2a6b` | antetul |
| `brand` | `#0b2a6b` | `#9db4f0` | legături, butonul principal |
| `accent` | `#f2c230` | `#f2c230` | linia de sub antet, focalizarea, alineatul modificat |
| `danger` | `#b8121f` | `#ff6b7a` | erori, text abrogat |
| `success` | `#1f7a3f` | `#6fcf97` | în vigoare |
| `diff-del` / `diff-ins` | `#8f0c18` / `#12562d` | `#ffb3bb` / `#9fe0b8` | text șters / adăugat |

### Adrese

- Data stă în adresă (`/codul-civil/art-1112/2019-01-01`) și trece în toate legăturile paginii.
- Codurile au și o adresă după nume (`/codul-civil`), pe lângă cea după numărul oficial (`/lege/2009/287`).
- Filtrele goale nu apar în adresă.

### Pagina unui articol

- Starea și perioada stau chiar sub titlu („În vigoare din 13.03.2021”).
- Axa cronologică arată toate versiunile articolului.
- „Legea fiecărui alineat” și „Evidențiază ultima modificare” sunt opționale.
- Pe o formă veche apare un anunț cu data și o legătură spre textul în vigoare.
- Citarea are un singur buton principal, „Copiază citarea”, iar alături „Copiază linkul”, care copiază doar adresa permanentă, și, pe o formă veche, „Textul în vigoare”.
- Sursa oficială și „Raportează o problemă” stau pe un singur rând sub text.

### Așezare

- Cuprinsul stă în stânga, textul la mijloc, iar uneltele în dreapta.
- Coloanele laterale stau fixe și nimic nu se mută după ce pagina s-a încărcat.
- Pe ecranele înguste, coloana din dreapta coboară sub text, iar avertismentul de actualitate apare și sus.
- Butoanele „Derulează la sfârșit” și „Înapoi sus” stau în același loc și apar pe rând.

### Formulare și butoane

- Un singur buton principal pe pagină și doar două stiluri de butoane.
- Butonul unui filtru rămâne inactiv până schimbi ceva.
- La un act, data se alege dintr-o listă care conține doar zilele în care actul s-a schimbat.
- Căutarea înțelege trimiterile scrise ca într-un document (`art. 1112 Codul civil`).

### Accesibilitate

- Site-ul funcționează fără JavaScript.
- Focalizarea din tastatură are un inel galben cu contur închis.
- Există legătură de salt la conținut, titlurile formează o ierarhie corectă, iar căutarea se folosește complet din tastatură.

### Identitate

- Antet bleumarin, marca `textdelege` scrisă de mână ([Caveat](https://github.com/googlefonts/caveat)), fără stemă și fără tricolor.

## English

Textdelege shows Romanian legislation with its full history. For every article you see the text, the period it applied and the act that changed it. Below are the sources the design was taken from and what the site uses.

### Where the design comes from

**Legislation portals**

| Source | What was taken |
| --- | --- |
| [legislation.gov.uk](https://www.legislation.gov.uk/) (United Kingdom) | One page per article; the date in the address, carried by every link on the page; the notice that you are reading an earlier version; the changes table with filters and an Atom feed; attribution by paragraph and highlighting, shown only on request. |
| [Légifrance](https://www.legifrance.gouv.fr/) (France) | The "in force since …" status line under the title; comparison of two versions; light, dark or system theme. |
| [RIS](https://www.ris.bka.gv.at/) (Austria) | The date of the shown text stated in a sentence, not only in a badge; the permanent address of a citation. |
| [Lovdata](https://lovdata.no/) (Norway), [LII](https://www.law.cornell.edu/) (USA) | The contents of the act on the left, with a filter; previous and next links under the text; the page's actions gathered in the right column. |
| [lagen.nu](https://lagen.nu/) (Sweden), [dejure.org](https://dejure.org/) (Germany) | The act that wrote each paragraph, shown quietly under it; the citation panel with a copy button. |
| [EUR-Lex](https://eur-lex.europa.eu/) (European Union) | What was avoided: a long row of equally weighted tools with no main action. |

**Design systems**

| Source | What was taken |
| --- | --- |
| [GOV.UK Design System](https://design-system.service.gov.uk/) (United Kingdom) | One primary button per page and two button styles; breadcrumbs; the caption above the title; the summary list; inset and warning text; the skip link; the yellow focus ring; dates typed by hand, with the calendar only as a help. |
| [DSFR](https://www.systeme-de-design.gouv.fr/) (France), [USWDS](https://designsystem.digital.gov/) (USA), [Canada.ca](https://design.canada.ca/) (Canada), [DKFDS](https://designsystem.dk/) (Denmark), [NL Design System](https://nldesignsystem.nl/) (Netherlands) | The header with the wordmark, one search field and few links; on phones, the "Search" and "Menu" buttons; the footer with short link columns; filters grouped in one panel above the list, with the number of results. |
| [Carbon](https://carbondesignsystem.com/) (IBM), [Primer](https://primer.style/) (GitHub), [Polaris](https://polaris.shopify.com/) (Shopify), [Atlassian](https://atlassian.design/), [Codex](https://doc.wikimedia.org/codex/) (Wikimedia) | Status written in words and coloured the same everywhere; short labels that start with a verb; tables without stripes, with tabular figures; tabs only for views of the same object. |
| [Wikipedia](https://www.wikipedia.org/), [GitHub](https://github.com/) | Word-by-word comparison, with deleted text struck through and added text underlined; attributing every line to a commit, which became "Legea fiecărui alineat". |
| [MDN](https://developer.mozilla.org/) | The documentation page: contents on the left, text with a limited measure, tools on the right, a short footer. |

**Type**: [Source Serif 4](https://github.com/adobe-fonts/source-serif) (Adobe), [IBM Plex Sans](https://github.com/IBM/plex) (IBM, the typeface of the Carbon system), [Caveat](https://github.com/googlefonts/caveat) for the wordmark; sizes and measure after [Practical Typography](https://practicaltypography.com/) (Matthew Butterick).

### Text and type

- The law is set in a serif ([Source Serif 4](https://github.com/adobe-fonts/source-serif)) and the interface in a sans ([IBM Plex Sans](https://github.com/IBM/plex)).
- A line of law text holds about 70 characters at most.
- Paragraph numbers sit in a margin of their own.
- The text size is chosen in "Opțiuni" and applies to the whole site.

### Colour

- Colour marks only a state, a difference or the act that wrote a paragraph, and the state is also written in words.
- In comparisons, deleted text is struck through and added text underlined.
- Light and dark themes, with WCAG 2.2 AA contrast in both.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `text` | `#1a1a1a` | `#e6e3dc` | text |
| `secondary` | `#4a4a4a` | `#c4c0b8` | metadata, labels |
| `muted` | `#6b6761` | `#9a958c` | paragraph numbers, small headings |
| `page` | `#f5f3ee` | `#141414` | the background |
| `paper` | `#ffffff` | `#1d1d1d` | the sheet with the text |
| `mast` | `#0b2a6b` | `#0b2a6b` | the header |
| `brand` | `#0b2a6b` | `#9db4f0` | links, the primary button |
| `accent` | `#f2c230` | `#f2c230` | the rule under the header, focus, a changed paragraph |
| `danger` | `#b8121f` | `#ff6b7a` | errors, repealed text |
| `success` | `#1f7a3f` | `#6fcf97` | in force |
| `diff-del` / `diff-ins` | `#8f0c18` / `#12562d` | `#ffb3bb` / `#9fe0b8` | deleted / added text |

### Addresses

- The date is part of the address (`/codul-civil/art-1112/2019-01-01`) and carries into every link on the page.
- Codes have an address by name (`/codul-civil`) as well as one by the official number (`/lege/2009/287`).
- Empty filters are left out of the address.

### The article page

- The state and the period sit right under the title ("În vigoare din 13.03.2021").
- The timeline shows every version of the article.
- "Legea fiecărui alineat" and "Evidențiază ultima modificare" are optional.
- An earlier version carries a notice with its date and a link to the text in force.
- The citation has one primary button, "Copiază citarea", with "Copiază linkul", which copies only the permanent address, beside it and, on an earlier version, "Textul în vigoare".
- The official source and "Raportează o problemă" share one line under the text.

### Layout

- The contents are on the left, the text in the middle and the tools on the right.
- The side columns are pinned and nothing moves once the page has loaded.
- On narrow screens the right column moves under the text, and the freshness warning also appears at the top.
- "Derulează la sfârșit" and "Înapoi sus" share one place and appear one at a time.

### Forms and buttons

- One primary button per page and only two button styles.
- A filter button stays inactive until something changes.
- On an act, the date is chosen from a list that holds only the days the act changed.
- Search understands references written as in a document (`art. 1112 Codul civil`).

### Accessibility

- The site works without JavaScript.
- Keyboard focus shows a yellow ring with a dark outline.
- There is a skip link, headings form a correct outline, and search works fully from the keyboard.

### Identity

- A navy header, the handwritten `textdelege` wordmark ([Caveat](https://github.com/googlefonts/caveat)), no coat of arms and no national colours.
