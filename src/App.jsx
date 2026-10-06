import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';

// ============================================================================
// ⚠️ ATTENZIONE: INSERISCI QUI LE CREDENZIALI DEL TUO PROGETTO FIREBASE ⚠️
// ============================================================================
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyBaGZTDv-BySHEN1M5xUfoRtTB0THlWeC8",
  authDomain: "orario-sostituzioni.firebaseapp.com",
  projectId: "orario-sostituzioni",
  storageBucket: "orario-sostituzioni.firebasestorage.app",
  messagingSenderId: "1078618163394",
  appId: "1:1078618163394:web:6a8750f91d099b092fd35b",
  measurementId: "G-WEYMTMS11S"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'orario-scuola-demo';

const cleanStr = (str) => {
  if (!str) return "";
  return String(str)
    .trim()
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
    .replace(/['`’´]/g, '') 
    .replace(/\s+/g, ' ');  
};

const FASCE_ORARIE = [
  "Tutto il giorno",
  "08:00-08:50", "08:50-09:40", "09:40-10:40", 
  "10:40-11:40", "11:40-12:40", "12:40-13:30", "13:30-14:20"
];

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('DASHBOARD');

  // --- STATO DEL DATABASE INTERNO ---
  const [scheduleDB, setScheduleDB] = useState([]);
  const [contactsDB, setContactsDB] = useState({}); // Rubrica: { "MARCIANTE": { email: "...", telefono: "..." } }
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbMessage, setDbMessage] = useState('');
  const [dbSearchTerm, setDbSearchTerm] = useState('');

  // Editing Inline
  const [editingRow, setEditingRow] = useState(null);
  const [editValue, setEditValue] = useState("");

  // Gestione Contatti Veloce
  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ email: '', telefono: '' });

  // --- STATI DASHBOARD MULTI-ASSENZA ---
  const [targetDay, setTargetDay] = useState('LUNEDI');
  const [absentInput, setAbsentInput] = useState('');
  const [absentTeachers, setAbsentTeachers] = useState([]); 
  const [substitutionsLog, setSubstitutionsLog] = useState([]); 
  
  // Modale Candidati
  const [activeSlotSearch, setActiveSlotSearch] = useState(null);
  const [candidates, setCandidates] = useState([]);

  // --- STATI INSERIMENTO MANUALE (SOSTEGNO/EXTRA) ---
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualEntry, setManualEntry] = useState({ docente: '', giorno: 'LUNEDI', ora: '08:00-08:50', classe: '', tipologia: 'LEZIONE', ruolo: 'SOSTEGNO' });

  useEffect(() => {
    const initAuthAndLoad = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
           await signInWithCustomToken(auth, __initial_auth_token);
        } else {
           await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    };

    initAuthAndLoad();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        await loadDatabaseFromCloud();
      }
    });
    return () => unsubscribe();
  }, []);

  const loadDatabaseFromCloud = async () => {
    setIsSyncing(true);
    setDbMessage("Sincronizzazione orari e contatti in corso...");
    try {
      // 1. Carica Orario (a Chunks)
      const masterRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'plessi_master');
      const masterSnap = await getDoc(masterRef);
      
      let fullDb = [];
      if (masterSnap.exists()) {
        const data = masterSnap.data();
        if (data.chunks) {
            for(let i=0; i<data.chunks; i++) {
                const chunkRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`);
                const chunkSnap = await getDoc(chunkRef);
                if(chunkSnap.exists()) {
                    fullDb = [...fullDb, ...JSON.parse(chunkSnap.data().data)];
                }
            }
        }
      }
      setScheduleDB(fullDb);

      // 2. Carica Contatti (Rubrica)
      const contactsRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'contatti_master');
      const contactsSnap = await getDoc(contactsRef);
      if (contactsSnap.exists()) {
          setContactsDB(contactsSnap.data().directory || {});
      }

      setDbMessage(`✅ Sincronizzato! ${fullDb.length} ore in memoria.`);
    } catch (error) {
      console.error(error);
      setDbMessage("Errore cloud: " + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const saveDatabaseToCloud = async (newScheduleArray) => {
    setIsSyncing(true);
    setDbMessage("Salvataggio nel Cloud in corso (Chunking)...");
    try {
      const CHUNK_SIZE = 800; 
      const chunks = Math.ceil(newScheduleArray.length / CHUNK_SIZE);
      
      let batch = writeBatch(db);

      for (let i = 0; i < chunks; i++) {
          const chunkData = newScheduleArray.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const chunkRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`);
          batch.set(chunkRef, { data: JSON.stringify(chunkData) });
      }

      const masterRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'plessi_master');
      batch.set(masterRef, { chunks: chunks, updatedAt: new Date().toISOString() });
      
      await batch.commit();
      
      setScheduleDB(newScheduleArray);
      setDbMessage(`✅ Salvataggio completato! (${newScheduleArray.length} record in ${chunks} pacchetti)`);
    } catch (error) {
      console.error(error);
      setDbMessage("Errore di salvataggio: " + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const saveContactsToCloud = async (newContactsObj) => {
      try {
          const contactsRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'contatti_master');
          await setDoc(contactsRef, { directory: newContactsObj, updatedAt: new Date().toISOString() });
          setContactsDB(newContactsObj);
          setDbMessage("✅ Rubrica contatti aggiornata con successo.");
          setEditingContact(false);
      } catch (error) {
          console.error("Errore salvataggio contatti:", error);
          setDbMessage("Errore salvataggio contatti.");
      }
  };

  const startEditingClass = (row) => {
      setEditingRow(row.id);
      setEditValue(row.classe);
  };

  const saveEditedClass = (id) => {
      const updatedDb = scheduleDB.map(item => 
          item.id === id ? { ...item, classe: editValue.toUpperCase() } : item
      );
      saveDatabaseToCloud(updatedDb);
      setEditingRow(null);
  };

  const handleFileUpload = (event, ruolo) => {
    const file = event.target.files[0];
    if (!file) return;
    setDbMessage(`Lettura CSV ${ruolo} in corso...`);
    
    Papa.parse(file, {
      skipEmptyLines: true,
      worker: true,
      complete: (results) => {
        try {
          const extractedSlots = processParsedGrid(results.data, ruolo);
          if (ruolo === 'CURRICULARE') {
              saveDatabaseToCloud(extractedSlots);
          } else {
              const newCombinedDb = [...scheduleDB, ...extractedSlots];
              saveDatabaseToCloud(newCombinedDb);
          }
        } catch (err) {
          setDbMessage("Errore formato CSV: " + err.message);
        } finally {
           event.target.value = null; 
        }
      },
      error: (error) => {
        setDbMessage("Impossibile leggere il CSV: " + error.message);
        event.target.value = null;
      }
    });
  };

  const processParsedGrid = (rows, ruolo) => {
    if (rows.length < 2) throw new Error("File CSV vuoto.");
    let maxCols = 0;
    rows.forEach(r => { if (r.length > maxCols) maxCols = r.length; });

    let intestazioneGiorni = [];
    let intestazioneOre = [];
    
    for(let i = 0; i < Math.min(5, rows.length); i++) {
        const rowText = rows[i].join(' ').toUpperCase();
        if(rowText.includes('LUN') || rowText.includes('MAR')) {
            intestazioneGiorni = rows[i];
            intestazioneOre = rows[i+1] || []; 
            break;
        }
    }

    const columnMapping = {};
    let lastKnownDay = "LUNEDI";
    for (let j = 1; j < maxCols; j++) {
        let dayStr = (intestazioneGiorni[j] || '').toUpperCase();
        if (dayStr) {
            if (dayStr.includes('LUN')) lastKnownDay = 'LUNEDI';
            else if (dayStr.includes('MAR')) lastKnownDay = 'MARTEDI';
            else if (dayStr.includes('MER')) lastKnownDay = 'MERCOLEDI';
            else if (dayStr.includes('GIO')) lastKnownDay = 'GIOVEDI';
            else if (dayStr.includes('VEN')) lastKnownDay = 'VENERDI';
            else if (dayStr.includes('SAB')) lastKnownDay = 'SABATO';
        }
        let hourStr = (intestazioneOre[j] || '').trim();
        let fullHeaderStr = dayStr + " " + hourStr;
        let matchedFascia = `Colonna ${j}`;
        
        if (fullHeaderStr.includes('8.00') || fullHeaderStr.includes('8:00') || fullHeaderStr.includes('1°') || fullHeaderStr.includes('1.00')) matchedFascia = '08:00-08:50';
        else if (fullHeaderStr.includes('8.50') || fullHeaderStr.includes('8:50') || fullHeaderStr.includes('2°') || fullHeaderStr.includes('2.00')) matchedFascia = '08:50-09:40';
        else if (fullHeaderStr.includes('9.40') || fullHeaderStr.includes('9:40') || fullHeaderStr.includes('3°') || fullHeaderStr.includes('3.00')) matchedFascia = '09:40-10:40';
        else if (fullHeaderStr.includes('10.40') || fullHeaderStr.includes('10:40') || fullHeaderStr.includes('4°') || fullHeaderStr.includes('4.00')) matchedFascia = '10:40-11:40';
        else if (fullHeaderStr.includes('11.40') || fullHeaderStr.includes('11:40') || fullHeaderStr.includes('5°') || fullHeaderStr.includes('5.00')) matchedFascia = '11:40-12:40';
        else if (fullHeaderStr.includes('12.40') || fullHeaderStr.includes('12:40') || fullHeaderStr.includes('6°') || fullHeaderStr.includes('6.00')) matchedFascia = '12:40-13:30';
        else if (fullHeaderStr.includes('13.30') || fullHeaderStr.includes('13:30') || fullHeaderStr.includes('7°') || fullHeaderStr.includes('7.00')) matchedFascia = '13:30-14:20';
        
        columnMapping[j] = { giorno: lastKnownDay, ora: matchedFascia };
    }

    const flatList = [];
    let startRow = 2; 
    for(let i=0; i<rows.length; i++) {
        if(rows[i] === intestazioneOre) { startRow = i + 1; break; }
    }

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length <= 0) continue;

      let nomeEstratto = String(row[0] || '').trim();
      if (/^\d+$/.test(nomeEstratto) && row.length > 1) {
          nomeEstratto = String(row[1] || '').trim();
      }

      const docente = nomeEstratto ? cleanStr(nomeEstratto) : ''; 
      if (!docente || docente.includes('DOCENTE') || docente.includes('NOME') || /^\d+$/.test(docente)) continue;

      for (let j = 1; j < row.length; j++) {
        const cellContent = row[j] ? String(row[j]).trim() : '';
        if (cellContent !== '') {
          const mapping = columnMapping[j] || { giorno: lastKnownDay, ora: `Col-${j}` };
          flatList.push({
            id: crypto.randomUUID(),
            docente: docente,
            giorno: cleanStr(mapping.giorno),
            ora: mapping.ora,
            classe: cellContent.toUpperCase(), 
            ruolo: ruolo, 
            tipologia: cellContent.toUpperCase().includes('DISP') ? 'A DISPOSIZIONE' : (cellContent.toUpperCase().includes('POT') ? 'POTENZIAMENTO' : 'LEZIONE')
          });
        }
      }
    }
    return flatList;
  };

  const handleAddManualEntry = () => {
      if (!manualEntry.docente || !manualEntry.classe) return alert("Inserisci docente e classe!");
      const newEntry = { ...manualEntry, id: crypto.randomUUID(), docente: cleanStr(manualEntry.docente), classe: manualEntry.classe.toUpperCase() };
      saveDatabaseToCloud([...scheduleDB, newEntry]);
      setShowManualEntry(false);
  }

  const addAbsentTeacher = () => {
      if(!absentInput) return;
      const cleanName = cleanStr(absentInput);
      if(!absentTeachers.includes(cleanName)) {
          setAbsentTeachers([...absentTeachers, cleanName]);
      }
      setAbsentInput('');
  };

  const removeAbsentTeacher = (name) => {
      setAbsentTeachers(absentTeachers.filter(t => t !== name));
  };

  const getUncoveredSlots = () => {
      let slots = scheduleDB.filter(s => s.giorno === targetDay && absentTeachers.some(at => s.docente.includes(at)));
      return slots.filter(slot => !substitutionsLog.some(log => log.originalSlotId === slot.id));
  };

  const openCandidateSearch = (slot) => {
      setActiveSlotSearch(slot);
      
      const orariDelGiorno = scheduleDB.filter(s => s.giorno === targetDay);
      let orariDiQuestaOra = [];
      if (slot.ora === 'Tutto il giorno') {
          orariDiQuestaOra = orariDelGiorno;
      } else {
          orariDiQuestaOra = orariDelGiorno.filter(s => s.ora === slot.ora);
      }
      
      const docentiImpegnati = new Set(orariDiQuestaOra.map(s => s.docente));
      let potentialSubstitutes = [];

      orariDiQuestaOra.forEach(slotCorrente => {
          if (absentTeachers.some(at => slotCorrente.docente.includes(at))) return;

          // REGEX: Match preciso classe ed articolazione (es. 4A ACC)
          const isCompresenza = () => {
              let cleanCandidato = slotCorrente.classe.toUpperCase().replace(/[\s\.\-_]/g, '').replace(/SOSTEGNO|SOST/g, '');
              let cleanScoperta = slot.classe.toUpperCase().replace(/[\s\.\-_]/g, '').replace(/SOSTEGNO|SOST/g, '');
              if (cleanCandidato && cleanScoperta && (cleanCandidato === cleanScoperta || cleanCandidato.includes(cleanScoperta) || cleanScoperta.includes(cleanCandidato))) {
                  return true;
              }
              return false;
          };
          
          if (isCompresenza()) {
              potentialSubstitutes.push({
                  id_cand: `${slotCorrente.docente}-SOST`,
                  docente: slotCorrente.docente,
                  ruoloCandidato: slotCorrente.ruolo,
                  motivazione: `Compresenza: è già in ${slotCorrente.classe} (${slotCorrente.ruolo})`,
                  score: 100
              });
          } else if (slotCorrente.tipologia === 'A DISPOSIZIONE' || slotCorrente.tipologia === 'POTENZIAMENTO') {
              potentialSubstitutes.push({
                  id_cand: `${slotCorrente.docente}-DISP`,
                  docente: slotCorrente.docente,
                  ruoloCandidato: slotCorrente.ruolo,
                  motivazione: `A Disposizione / Potenziamento`,
                  score: 80
              });
          }
      });

      const tuttiDocentiOggi = new Set(orariDelGiorno.map(s => s.docente));
      tuttiDocentiOggi.forEach(doc => {
          if (!docentiImpegnati.has(doc) && !absentTeachers.some(at => doc.includes(at))) {
              potentialSubstitutes.push({
                  id_cand: `${doc}-LIBERO`,
                  docente: doc,
                  ruoloCandidato: 'CURRICULARE',
                  motivazione: `Libero (Buco Orario)`,
                  score: 50
              });
          }
      });

      const uniqueCandsMap = new Map();
      potentialSubstitutes.forEach(item => {
          if (!uniqueCandsMap.has(item.id_cand) || uniqueCandsMap.get(item.id_cand).score < item.score) {
              uniqueCandsMap.set(item.id_cand, item);
          }
      });
      setCandidates(Array.from(uniqueCandsMap.values()).sort((a, b) => b.score - a.score));
  };

  const assignSubstitute = (candidato) => {
      let modalitaBreve = "Ore Eccedenti (a pagamento)";
      if (candidato.score === 100) modalitaBreve = "Compresenza / Sostegno";
      else if (candidato.score === 80) modalitaBreve = candidato.motivazione; 

      const newLog = {
          id: crypto.randomUUID(),
          originalSlotId: activeSlotSearch.id,
          giorno: targetDay,
          ora: activeSlotSearch.ora,
          classe: activeSlotSearch.classe,
          docente_assente: activeSlotSearch.docente,
          docente_sostituto: candidato.docente,
          modalita: modalitaBreve
      };
      setSubstitutionsLog([newLog, ...substitutionsLog]);
      setActiveSlotSearch(null); 
  };

  const inviaNotifica = (log, metodo) => {
      const testoMessaggio = `Gentile Prof. ${log.docente_sostituto},\n\nLe comunichiamo la seguente disposizione di servizio per sostituzione:\n- Giorno: ${log.giorno}\n- Ora: ${log.ora}\n- Classe: ${log.classe}\n- Sostituisce: ${log.docente_assente}\n- Modalità: ${log.modalita}\n\nGrazie per la collaborazione.\nLa Vicepresidenza`;
      
      const contatti = contactsDB[log.docente_sostituto] || {};
      const telefono = contatti.telefono ? contatti.telefono.replace(/\s+/g, '') : '';
      const email = contatti.email || '';

      if (metodo === 'wa') {
          if (telefono) {
              window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
          } else {
              window.open(`https://wa.me/?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
          }
      } else if (metodo === 'mail') {
          const subject = encodeURIComponent(`Disposizione Sostituzione Orario: ${log.giorno} - ${log.ora}`);
          const body = encodeURIComponent(testoMessaggio);
          window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
      } else if (metodo === 'copy') {
          navigator.clipboard.writeText(testoMessaggio).then(() => {
              alert("✅ Messaggio copiato negli appunti!\nIncolla su WhatsApp Web o nella tua email.");
          }).catch(err => {
              alert("Errore copia: " + err);
          });
      }
  };

  const getDataFormattata = () => {
      return new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-800 print:bg-white print:m-0">
      
      {/* ==================== INTESTAZIONE ISTITUZIONALE & TITOLO APP ==================== */}
      <div className="bg-white border-b-4 border-blue-900 shadow-sm print:border-none print:shadow-none mb-6">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-6 print:justify-start">
          
          {/* Logo e Intestazione Ufficiale */}
          <div className="flex items-center gap-6">
            <img src="/logo alberghiero.png" alt="Logo Alberghiero" className="w-24 h-auto print:w-32 object-contain" />
            <div className="flex flex-col text-center md:text-left">
              <h1 className="text-sm md:text-md font-bold text-blue-900 tracking-wider uppercase font-serif">
                Istituto Professionale di Stato per i Servizi Alberghieri e Turistici
              </h1>
              <h2 className="text-xl md:text-2xl font-extrabold text-blue-900 mt-0.5">
                Rocco Chinnici
              </h2>
              <h3 className="text-sm text-blue-800 font-medium">
                Nicolosi
              </h3>
              {/* TITOLO DELL'APPLICAZIONE SOTTO L'INTESTAZIONE */}
              <div className="mt-2 pt-2 border-t border-gray-200">
                <span className="text-xs uppercase tracking-widest bg-blue-100 text-blue-900 font-extrabold px-2.5 py-0.5 rounded-full inline-block">
                  ScuolaManager Pro — Gestione Sostituzioni Plesso
                </span>
              </div>
            </div>
          </div>

          {/* Pulsanti Navigazione (Nascosti in stampa) */}
          <div className="flex w-full md:w-auto space-x-2 bg-gray-100 p-1.5 rounded-xl print:hidden">
            <button onClick={() => setActiveTab('DASHBOARD')} className={`flex-1 md:flex-none px-4 py-3 md:py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'DASHBOARD' ? 'bg-blue-800 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}`}>
              Sostituzioni
            </button>
            <button onClick={() => setActiveTab('DATABASE')} className={`flex-1 md:flex-none px-4 py-3 md:py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'DATABASE' ? 'bg-blue-800 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}`}>
              Database Orari
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-8 print:p-0">
        
        {/* ==================== SCHEDA: DASHBOARD SOSTITUZIONI ==================== */}
        {activeTab === 'DASHBOARD' && (
          <div className="space-y-6">
            
            {/* AREA CONTROLLI */}
            <div className="grid md:grid-cols-3 gap-6 print:hidden">
              <div className="md:col-span-1 bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-fit">
                <h2 className="text-lg font-bold text-gray-800 mb-4">1. Lista Docenti Assenti</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Giorno di Lavoro</label>
                    <select className="w-full border-gray-300 rounded-md shadow-sm p-2 border bg-white focus:border-blue-500" value={targetDay} onChange={(e) => setTargetDay(e.target.value)}>
                      <option value="LUNEDI">Lunedì</option><option value="MARTEDI">Martedì</option><option value="MERCOLEDI">Mercoledì</option>
                      <option value="GIOVEDI">Giovedì</option><option value="VENERDI">Venerdì</option><option value="SABATO">Sabato</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Aggiungi Assente (Cognome)</label>
                    <div className="flex gap-2">
                        <input type="text" placeholder="Es. ROSSI" className="flex-1 border-gray-300 rounded-md shadow-sm p-2 border uppercase" value={absentInput} onChange={(e) => setAbsentInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAbsentTeacher()}/>
                        <button onClick={addAbsentTeacher} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-bold">+</button>
                    </div>
                  </div>
                  
                  {absentTeachers.length > 0 && (
                      <div className="mt-4 border-t pt-4">
                          <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Assenti Registrati:</h3>
                          <div className="flex flex-wrap gap-2">
                              {absentTeachers.map(t => (
                                  <span key={t} className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-2">
                                      {t} <button onClick={()=>removeAbsentTeacher(t)} className="text-red-500 hover:text-red-900">×</button>
                                  </span>
                              ))}
                          </div>
                      </div>
                  )}
                </div>
              </div>

              {/* TABELLONE E MODALE */}
              <div className="md:col-span-2 space-y-6">
                
                {activeSlotSearch && (
                   <div className="bg-blue-50 p-6 rounded-xl shadow-sm border border-blue-200 border-l-4 border-l-blue-600">
                       <div className="flex justify-between items-start mb-4">
                           <div>
                               <h3 className="font-bold text-blue-900 text-lg">Ricerca per {activeSlotSearch.docente}</h3>
                               <p className="text-sm text-blue-700">Ora: {activeSlotSearch.ora} | Classe scoperta: <span className="font-bold">{activeSlotSearch.classe}</span></p>
                           </div>
                           <button onClick={()=>setActiveSlotSearch(null)} className="text-gray-400 hover:text-gray-700 font-bold text-xl">×</button>
                       </div>
                       
                       <div className="max-h-[300px] overflow-y-auto border border-blue-100 rounded bg-white">
                         <table className="min-w-full divide-y divide-gray-200">
                           <thead className="bg-gray-50 sticky top-0">
                             <tr>
                               <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Candidato</th>
                               <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Motivazione Priorità</th>
                               <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Azione</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-gray-100">
                             {candidates.map((c, i) => (
                               <tr key={i} className={c.score === 100 ? 'bg-green-50' : c.score === 80 ? 'bg-blue-50/50' : ''}>
                                 <td className="px-4 py-2 font-bold text-gray-800">{c.docente}</td>
                                 <td className="px-4 py-2 text-xs">
                                     <span className={`px-2 py-1 rounded-full font-semibold ${c.score === 100 ? 'bg-green-100 text-green-800' : c.score === 80 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{c.motivazione}</span>
                                 </td>
                                 <td className="px-4 py-2 text-right">
                                     <button onClick={() => assignSubstitute(c)} className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded">Assegna</button>
                                 </td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       </div>
                   </div>
                )}

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                   <h2 className="text-lg font-bold text-gray-800 mb-4">2. Tabellone Ore Scoperte ({targetDay})</h2>
                   
                   {absentTeachers.length === 0 ? (
                       <p className="text-sm text-gray-500 text-center py-6">Aggiungi un docente assente per vedere le ore da coprire.</p>
                   ) : getUncoveredSlots().length === 0 ? (
                       <div className="bg-green-50 text-green-700 p-4 rounded-lg text-center font-bold border border-green-200">Tutte le ore di {targetDay} sono state coperte con successo! 🎉</div>
                   ) : (
                       <div className="overflow-x-auto border border-gray-200 rounded-lg">
                           <table className="min-w-full divide-y divide-gray-200">
                               <thead className="bg-gray-50">
                                   <tr>
                                       <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Ora</th>
                                       <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Assente</th>
                                       <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Classe</th>
                                       <th className="px-4 py-2 text-right"></th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-gray-100">
                                   {getUncoveredSlots().sort((a,b) => a.ora.localeCompare(b.ora)).map(slot => (
                                       <tr key={slot.id} className="hover:bg-gray-50">
                                           <td className="px-4 py-3 font-medium text-gray-700">{slot.ora}</td>
                                           <td className="px-4 py-3 text-red-600 font-bold">{slot.docente}</td>
                                           <td className="px-4 py-3 font-bold text-gray-900">{slot.classe}</td>
                                           <td className="px-4 py-3 text-right">
                                               <button onClick={() => openCandidateSearch(slot)} className="border border-blue-600 text-blue-600 hover:bg-blue-50 text-xs font-bold px-3 py-1.5 rounded">Cerca Sostituto</button>
                                           </td>
                                       </tr>
                                   ))}
                               </tbody>
                           </table>
                       </div>
                   )}
                </div>
              </div>
            </div>
            
            {/* STAMPA RESOCONTO UFFICIALE */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 print:shadow-none print:border-none print:p-0 mt-8">
                <div className="flex justify-between items-center mb-6 print:hidden">
                    <h2 className="text-xl font-bold text-gray-800">3. Resoconto Ufficiale Sostituzioni</h2>
                    <button onClick={() => window.print()} className="bg-blue-800 hover:bg-blue-900 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-sm transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                        Stampa / Salva PDF
                    </button>
                </div>

                {/* Sottotitolo della Stampa PDF con Data */}
                <div className="hidden print:block mb-6 text-center border-b-2 border-blue-900 pb-4 mt-4">
                    <h1 className="text-xl font-extrabold uppercase tracking-widest text-blue-900">Resoconto Giornaliero Sostituzioni</h1>
                    <p className="text-md mt-1 font-bold capitalize text-gray-800">{targetDay}, {getDataFormattata()}</p>
                </div>

                {substitutionsLog.length === 0 ? (
                    <p className="text-gray-500 italic print:hidden">Nessuna sostituzione completata al momento.</p>
                ) : (
                    <table className="min-w-full divide-y divide-gray-300 border border-gray-300 print:border-2 print:border-black">
                        <thead className="bg-gray-100 print:bg-gray-200">
                            <tr>
                                <th className="px-4 py-3 text-left font-bold text-red-700 border-r border-gray-300">Docente Assente</th>
                                <th className="px-4 py-3 text-left font-bold text-gray-800 border-r border-gray-300">Ora</th>
                                <th className="px-4 py-3 text-left font-bold text-gray-800 border-r border-gray-300">Classe</th>
                                <th className="px-4 py-3 text-left font-bold text-green-700 border-r border-gray-300">Sostituto Assegnato</th>
                                <th className="px-4 py-3 text-left font-bold text-blue-800 border-r border-gray-300">Modalità</th>
                                <th className="px-4 py-3 text-center print:hidden">Notifica Veloce</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {substitutionsLog.sort((a,b) => a.docente_assente.localeCompare(b.docente_assente) || a.ora.localeCompare(b.ora)).map(log => (
                                <tr key={log.id} className="print:break-inside-avoid">
                                    <td className="px-4 py-2 border-r border-gray-300 font-bold text-red-600 bg-red-50/30">{log.docente_assente}</td>
                                    <td className="px-4 py-2 border-r border-gray-300 font-medium">{log.ora}</td>
                                    <td className="px-4 py-2 border-r border-gray-300 font-bold">{log.classe}</td>
                                    <td className="px-4 py-2 border-r border-gray-300 font-bold uppercase text-green-700">{log.docente_sostituto}</td>
                                    <td className="px-4 py-2 border-r border-gray-300 text-sm font-semibold">{log.modalita}</td>
                                    <td className="px-4 py-2 text-center print:hidden flex flex-wrap justify-center gap-1">
                                        <button onClick={()=>inviaNotifica(log, 'wa')} className="bg-green-100 text-green-800 hover:bg-green-200 px-2 py-1 rounded text-xs font-bold" title="Invia su WhatsApp">WA</button>
                                        <button onClick={()=>inviaNotifica(log, 'mail')} className="bg-blue-100 text-blue-800 hover:bg-blue-200 px-2 py-1 rounded text-xs font-bold" title="Invia Email">Mail</button>
                                        <button onClick={()=>inviaNotifica(log, 'copy')} className="bg-gray-200 text-gray-800 hover:bg-gray-300 px-2 py-1 rounded text-xs font-bold" title="Copia Testo">Copia</button>
                                        <button onClick={() => setSubstitutionsLog(substitutionsLog.filter(l => l.id !== log.id))} className="text-red-500 hover:text-red-700 text-xs font-bold underline px-1 py-1 ml-1">Annulla</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                
                <div className="hidden print:flex justify-between mt-16 pt-8">
                    <div className="text-center w-64 border-t border-black pt-2 font-bold">Firma Vicepresidenza</div>
                    <div className="text-center w-64 border-t border-black pt-2 font-bold">Firma Dirigenza</div>
                </div>
            </div>

          </div>
        )}

        {/* ==================== SCHEDA: DATABASE ORARI E RUBRICA ==================== */}
        {activeTab === 'DATABASE' && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden print:hidden">
            <div className="bg-gray-50 p-6 border-b border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                 <h2 className="text-xl font-bold text-gray-900">Database Centrale Orari & Rubrica</h2>
                 <p className="text-gray-600 text-sm mt-1">{dbMessage}</p>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => saveDatabaseToCloud([])} className="px-4 py-2 border border-red-200 text-red-600 rounded-md text-sm font-bold hover:bg-red-50">Svuota DB</button>
                 <button onClick={() => setShowManualEntry(!showManualEntry)} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-md text-sm font-bold hover:bg-blue-200">+ Aggiungi Docente</button>
              </div>
            </div>

            <div className="p-6">
                
                {/* MOTORE DI RICERCA INTELLIGENTE */}
                <div className="mb-6 flex flex-col md:flex-row gap-4 items-center">
                    <input type="text" placeholder="Cerca un docente per nome (es. ROSSI)..." className="w-full md:w-2/3 p-3 border-2 border-blue-400 rounded-lg shadow-sm uppercase focus:ring-blue-500 focus:border-blue-500 font-bold text-blue-900" value={dbSearchTerm} onChange={(e) => setDbSearchTerm(e.target.value.toUpperCase())} />
                    
                    {dbSearchTerm && (
                        <button onClick={() => {
                            setContactForm(contactsDB[dbSearchTerm] || { email: '', telefono: '' });
                            setEditingContact(true);
                        }} className="w-full md:w-1/3 py-3 bg-indigo-100 text-indigo-800 font-bold rounded-lg hover:bg-indigo-200">
                            📞 Modifica Contatti di {dbSearchTerm}
                        </button>
                    )}
                </div>

                {/* MODALE RUBRICA CONTATTI */}
                {editingContact && (
                    <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1">
                            <label className="text-xs font-bold text-indigo-800">Email di {dbSearchTerm}</label>
                            <input type="email" className="w-full p-2 border rounded" value={contactForm.email} onChange={e=>setContactForm({...contactForm, email:e.target.value})} placeholder="es. mario.rossi@scuola.it"/>
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-bold text-indigo-800">Telefono / Cellulare</label>
                            <input type="text" className="w-full p-2 border rounded" value={contactForm.telefono} onChange={e=>setContactForm({...contactForm, telefono:e.target.value})} placeholder="es. 3331234567"/>
                        </div>
                        <button onClick={() => saveContactsToCloud({ ...contactsDB, [dbSearchTerm]: contactForm })} className="px-6 py-2 bg-indigo-600 text-white font-bold rounded hover:bg-indigo-700">Salva Rubrica</button>
                        <button onClick={() => setEditingContact(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded font-bold">Annulla</button>
                    </div>
                )}

                {/* INSERIMENTO MANUALE */}
                {showManualEntry && (
                    <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h3 className="font-bold text-blue-900 mb-3">Inserimento Singolo Docente</h3>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                            <div className="col-span-2 md:col-span-1">
                                <label className="text-xs font-bold text-blue-800">Docente</label>
                                <input type="text" className="w-full p-2 border rounded text-sm uppercase" value={manualEntry.docente} onChange={e=>setManualEntry({...manualEntry, docente:e.target.value})}/>
                            </div>
                            <div className="col-span-1">
                                <label className="text-xs font-bold text-blue-800">Giorno</label>
                                <select className="w-full p-2 border rounded text-sm" value={manualEntry.giorno} onChange={e=>setManualEntry({...manualEntry, giorno:e.target.value})}>
                                    <option value="LUNEDI">LUN</option><option value="MARTEDI">MAR</option><option value="MERCOLEDI">MER</option>
                                    <option value="GIOVEDI">GIO</option><option value="VENERDI">VEN</option><option value="SABATO">SAB</option>
                                </select>
                            </div>
                            <div className="col-span-1">
                                <label className="text-xs font-bold text-blue-800">Ora</label>
                                <select className="w-full p-2 border rounded text-sm" value={manualEntry.ora} onChange={e=>setManualEntry({...manualEntry, ora:e.target.value})}>
                                    {FASCE_ORARIE.slice(1).map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                            <div className="col-span-1">
                                <label className="text-xs font-bold text-blue-800">Classe/Compito</label>
                                <input type="text" placeholder="Es. 3A" className="w-full p-2 border rounded text-sm uppercase" value={manualEntry.classe} onChange={e=>setManualEntry({...manualEntry, classe:e.target.value})}/>
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <button onClick={handleAddManualEntry} className="w-full py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700">Salva Orario</button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid md:grid-cols-2 gap-6 mb-8">
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 bg-gray-50 flex flex-col items-center">
                        <h4 className="font-bold text-gray-700 mb-2">1. Carica Curriculari</h4>
                        <input type="file" accept=".csv" disabled={isSyncing} className="text-sm" onChange={(e) => handleFileUpload(e, 'CURRICULARE')} />
                    </div>
                    <div className="border-2 border-dashed border-green-300 rounded-xl p-6 bg-green-50 flex flex-col items-center">
                        <h4 className="font-bold text-green-800 mb-2">2. Carica Sostegno</h4>
                        <input type="file" accept=".csv" disabled={isSyncing} className="text-sm" onChange={(e) => handleFileUpload(e, 'SOSTEGNO')} />
                    </div>
                </div>

                {/* TABELLA ORARI EDITABILE INLINE */}
                <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-[500px] overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-100 sticky top-0">
                            <tr>
                                <th className="px-4 py-2 text-left font-bold text-gray-600">Docente</th>
                                <th className="px-4 py-2 text-left font-bold text-gray-600">Giorno</th>
                                <th className="px-4 py-2 text-left font-bold text-gray-600">Ora</th>
                                <th className="px-4 py-2 text-left font-bold text-gray-600">Classe (Clicca x Modificare)</th>
                                <th className="px-4 py-2 text-left font-bold text-gray-600">Ruolo</th>
                                <th className="px-4 py-2 text-right">Azione</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {scheduleDB.filter(row => row.docente.includes(dbSearchTerm)).slice(0, 150).map((row) => (
                                <tr key={row.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-1.5 font-medium flex items-center gap-2">
                                        {row.docente}
                                        {contactsDB[row.docente] && (contactsDB[row.docente].email || contactsDB[row.docente].telefono) && <span title="Contatti Salvati" className="text-xs bg-indigo-100 text-indigo-600 rounded-full px-1 py-0.5">📞</span>}
                                    </td>
                                    <td className="px-4 py-1.5 text-gray-600">{row.giorno}</td>
                                    <td className="px-4 py-1.5 text-gray-600">{row.ora}</td>
                                    
                                    {/* CELLA CLASSE EDITABILE INLINE */}
                                    <td className="px-4 py-1.5 font-bold cursor-pointer hover:bg-blue-50 transition-colors" onClick={() => startEditingClass(row)} title="Clicca per modificare la classe">
                                        {editingRow === row.id ? (
                                            <input
                                                type="text"
                                                className="border-2 border-blue-500 rounded px-2 py-1 w-24 text-sm uppercase shadow-sm bg-white"
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onBlur={() => saveEditedClass(row.id)}
                                                onKeyDown={(e) => e.key === 'Enter' && saveEditedClass(row.id)}
                                                autoFocus
                                            />
                                        ) : (
                                            row.classe
                                        )}
                                    </td>
                                    
                                    <td className="px-4 py-1.5">
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${row.ruolo === 'SOSTEGNO' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{row.ruolo}</span>
                                    </td>
                                    <td className="px-4 py-1.5 text-right">
                                        <button onClick={() => { if(confirm("Eliminare questa riga?")) saveDatabaseToCloud(scheduleDB.filter(item => item.id !== row.id)) }} className="text-red-400 hover:text-red-700 font-bold px-2">Elimina</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}