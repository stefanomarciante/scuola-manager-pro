# ScuolaManager Pro 🏫

**ScuolaManager Pro** è la piattaforma web gestionale in uso presso l'I.P.S.S.A.T. "Rocco Chinnici" di Nicolosi. L'applicativo semplifica e automatizza la gestione delle sostituzioni dei docenti assenti, la pianificazione delle variazioni di orario (ingressi posticipati/uscite anticipate) e l'organizzazione delle assemblee sindacali. Offre dashboard isolate per i responsabili di ogni singolo plesso, un algoritmo di ricerca sostituti per priorità e strumenti di notifica immediata via WhatsApp ed Email.

---

## 🚀 Guida all'uso di GitHub (Comandi da Terminale)

Qui di seguito sono riportati i comandi essenziali per gestire il codice e sincronizzare il lavoro tra GitHub, il tuo MacBook e il PC Windows.

### ⬇️ 1. Scaricare il codice da GitHub (Importazione)

**A. Se non hai ancora la cartella sul computer (Clonazione da zero):**
Apri il terminale ed esegui questo comando per scaricare tutto il progetto:
```bash
git clone [https://github.com/stefanomarciante/scuola-manager-pro.git](https://github.com/stefanomarciante/scuola-manager-pro.git)
cd scuola-manager-pro
```
**B. Se hai già la cartella e vuoi scaricare gli ultimi aggiornamenti (Pull):
Usa questo comando ogni volta che cambi computer (es. passi da Windows a Mac) per assicurarti di lavorare sull'ultima versione:

```bash
git pull origin main
```

###⬆️ 2. Caricare il codice su GitHub (Salvataggio e Upload)
Dopo aver modificato i file nel tuo editor, apri il terminale nella cartella del progetto ed esegui sempre questi tre comandi in sequenza. Il caricamento innescherà automaticamente anche l'aggiornamento della pagina live su Vercel.

```bash
# 1. Prepara tutti i file modificati
git add .

# 2. Registra le modifiche con un messaggio descrittivo
git commit -m "ES: Aggiunto file README e aggiornato manuale"

# 3. Invia tutto online su GitHub
git push origin main
```
Una volta salvato il file nel tuo editor, apri il Terminale ed esegui i comandi per ripristinarlo su GitHub:

```bash
git add .
git commit -m "Docs: ripristino file README.md"
git push origin main
```

