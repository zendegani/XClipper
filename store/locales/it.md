tweet2md è un'estensione Chrome open source che trasforma thread, post e articoli di X/Twitter in Markdown pulito per Obsidian, ricerca, workflow AI e archiviazione offline.

Esporta i contenuti con un clic:

- Salva come Markdown
- Copia il Markdown negli appunti
- Invia direttamente a Obsidian
- Scarica le immagini in locale insieme al file .md

Funziona interamente nel browser. Nessuna chiave API, nessun account, nessun tracking, nessuna analytics.

Caratteristiche principali:

- Esporta tweet, thread, tweet citati, thread annidati e lunghi X Articles (ex Notes)
- Markdown pulito compatibile con Obsidian, Logseq, Notion, Hugo e altri workflow basati su Markdown
- Pulsante "Aggiungi a Obsidian" con un clic tramite schema URI obsidian://
- Rich YAML frontmatter con autore, handle, date, source URL, tipo di contenuto e metriche di engagement
- Frontmatter opzionale ottimizzato per Obsidian: autori con wikilink [[@handle]], metadata compatibili con Dataview, e titoli e descrizioni generate automaticamente
- Scarica le immagini incorporate in locale per evitare link rotti
- Cattura link card con titolo, dominio sorgente e immagine di anteprima
- Cattura sondaggi con opzioni, percentuali dei risultati e riga totale voti/stato
- Mantiene struttura e attribuzione dei tweet citati
- Esporta un singolo tweet o un intero thread
- Pulsante di esportazione inline direttamente dentro x.com, più popup della toolbar e menu contestuale del tasto destro
- Template di nomi file personalizzabili con placeholder come {date}, {handle}, {slug} e {type}
- Supporto opzionale per vault Obsidian e relative sottocartelle
- Sottocartella opzionale per i download di Markdown e file multimediali
- Interfaccia multilingue: inglese, spagnolo, tedesco, francese, italiano, russo, giapponese, portoghese (Brasile), cinese (semplificato), hindi, arabo e persiano
- Supporto per modalità chiara e scura

Ideale per:

- Workflow Obsidian e PKM
- Ricerca e archiviazione di riferimenti
- Prompt AI e pipeline RAG
- Creare un "second brain" ricercabile
- Conservare offline contenuti lunghi di X

Limitazioni attuali:

- Video e GIF non vengono esportati come file multimediali riproducibili
- Alcune funzioni potrebbero smettere di funzionare se x.com cambia significativamente la struttura della pagina
- Se installi o aggiorni l'estensione mentre una scheda di x.com è già aperta, ricarica la scheda prima di esportare — è intenzionale, per evitare errori silenziosi su una pagina non inizializzata

Open source:
https://github.com/zendegani/tweet2md

Changelog:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

tweet2md è un progetto open source indipendente e non è affiliato a X o Twitter.
