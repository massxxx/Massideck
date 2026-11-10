# MassiDeck

Il telefono diventa una **pulsantiera per il PC** (come uno Stream Deck): tasti grandi per aprire programmi e siti, comandare la musica e il volume, scrivere testi pronti, bloccare o spegnere il PC.

## Scarica

- **PC Windows:** [MassiDeck.exe](https://github.com/massxxx/massideck/releases/latest/download/MassiDeck.exe)
- **Telefono Android:** [MassiDeck.apk](https://github.com/massxxx/massideck/releases/latest/download/MassiDeck.apk)
- **Qualsiasi telefono (anche iPhone):** nessuna installazione, basta il browser (vedi sotto).

## Come si usa

1. Sul PC avvia **MassiDeck.exe**.
   - Se compare *«Windows ha protetto il PC»*: **Ulteriori informazioni › Esegui comunque**.
   - Se il firewall chiede il permesso: spunta **Reti private** e consenti.
2. Si apre una pagina sul PC con il **QR**, l'**indirizzo** (es. `192.168.1.20:8765`) e il **PIN**.
3. Telefono e PC devono essere sullo **stesso Wi-Fi**. Poi:
   - **App Android:** aprila, premi *Cerca il PC sul Wi-Fi* (o scrivi l'indirizzo), metti il PIN.
   - **Browser:** inquadra il QR con la fotocamera, oppure scrivi l'indirizzo nel browser. Dal menu del browser: *Aggiungi a schermata Home*.
4. Premi i tasti. Con **✏️** li modifichi (tocca un tasto per cambiarlo, **＋** per aggiungerne uno, il nome della pagina per rinominarla).
   Si possono modificare anche dalla pagina sul PC: le modifiche si sincronizzano da sole.

Nella pagina del PC c'è anche **Avvia con Windows**, che fa partire MassiDeck da solo all'accensione.

## Cosa può fare un tasto

| Tipo | Esempi |
|---|---|
| Programma | Spotify, Chrome, Word, Excel, PowerPoint, Outlook, qualsiasi programma del menu Start |
| Sito web | Gmail, Drive, Documenti, Fogli, Calendar, Maps, YouTube, Classroom, Meet |
| Cartella o file | Documenti, Download, Desktop, una cartella di progetto |
| Musica e volume | Play/pausa, brano successivo/precedente, volume ±, muto |
| Scrivi testo | email, firma, saluti: viene scritto dove si trova il cursore |
| Sistema | blocca, screenshot, ritaglio, mostra desktop, gestione attività, sospendi, riavvia, spegni (con conferma e 15 s per annullare) |
| Combinazione tasti | `ctrl+c`, `alt+tab`, `win+e`, `ctrl+shift+t`… |

## Sicurezza

Il PC accetta comandi solo da chi conosce il **PIN** (4 cifre). Dalla pagina del PC puoi fare **Nuovo PIN** per scollegare tutti i telefoni. Dopo 5 PIN sbagliati bisogna aspettare un minuto.

## Com'è fatto

- `pc/massideck.py` — programma per il PC (solo Python standard, comandi Windows con ctypes). Tasti salvati in `%APPDATA%\MassiDeck\tasti.json`.
- `web/` — la pagina dei tasti, la stessa per PC, browser del telefono e app.
- `.github/workflows/app.yml` — costruisce `MassiDeck.exe` (PyInstaller) e `MassiDeck.apk` (Capacitor) a ogni modifica.
