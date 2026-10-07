import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';

// ============================================================================
// ⚠️ CREDENZIALI FIREBASE
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

const PLESSI_LIST = [
  "NICOLOSI",
  "PEDARA",
  "TRECASTAGNI",
  "SANTA MARIA DI LICODIA",
  "PATERNO'"
];

// ============================================================================
// 🗺️ MAPPA CLASSI -> PLESSI (Modifica qui le tue classi!)
// ============================================================================
const MAPPA_CLASSI_PLESSI = {
  "PEDARA": ["1C", "2C", "3C CUC", "4C CUC", "5C CUC"],
  "TRECASTAGNI": ["1D", "2D", "3D CUC", "4D CUC", "5D CUC", "3B SALA", "4B SALA", "5B SALA"],
  "SANTA MARIA DI LICODIA": ["1G", "2G", "2H", "3E CUC", "4E CUC", "5E CUC", "3C SALA", "4C SALA", "5C SALA"],
  "PATERNO'": ["1I", "1B S", "2I", "2L", "3F CUC", "4F CUC", "5F CUC", "3D SALA", "4D SALA", "5D SALA"] 
};


// ============================================================================
// 🔐 ACCOUNT ISTITUZIONALI RESPONSABILI (Firebase Auth)
// ============================================================================
const RESPONSABILI_ACCOUNTS = {
  "vicepresidenza@ipssatchinnicinicolosi.edu.it": { type: 'VICEPRESIDENZA', plesso: 'TUTTI', nome: 'Vicepresidenza / Dirigenza' },
  "prof.digregorio@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'NICOLOSI', nome: 'prof. AlessandroDi Gregorio' },
  "resp.pedara@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'PEDARA', nome: 'Resp. Plesso Pedara' },
  "resp.trecastagni@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'TRECASTAGNI', nome: 'Resp. Plesso Trecastagni' },
  "prof.marciante@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'SANTA MARIA DI LICODIA', nome: 'prof.Stefano Marciante' },
  "resp.paterno@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: "PATERNO'", nome: 'Resp. Plesso Paternò' },
  "la.tua.email@esempio.it": { type: 'VICEPRESIDENZA', plesso: 'TUTTI', nome: 'Prof. Stefano (Admin)' },
};

const determinaPlessoDaClasse = (classeStr) => {
  if (!classeStr) return "NICOLOSI";
  const classeClean = classeStr.toUpperCase().replace(/\s+/g, '');

  for (const [plesso, classiArray] of Object.entries(MAPPA_CLASSI_PLESSI)) {
    for (const sigla of classiArray) {
      const siglaClean = sigla.toUpperCase().replace(/\s+/g, '');
      if (classeClean.includes(siglaClean)) {
        return plesso;
      }
    }
  }
  return "NICOLOSI"; 
};

const cleanStr = (str) => {
  if (!str) return "";
  return String(str).trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['`’´]/g, '').replace(/\s+/g, ' ');  
};

const classiCorrispondono = (classeA, classeB) => {
  if (!classeA || !classeB) return false;
  const estraiAnima = (testo) => {
    let pulito = testo.toUpperCase().replace(/[\s\.\-_]/g, '').replace(/SOSTEGNO|SOST/g, '');
    let match = pulito.match(/^(\d+[A-Z]+)/);
    return match ? match[1] : pulito;
  };
  return estraiAnima(classeA) === estraiAnima(classeB);
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('DASHBOARD');

  const [userRole, setUserRole] = useState({ type: 'GUEST', plesso: 'NESSUNO', nome: 'Visitatore (Sola Lettura)' });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [scheduleDB, setScheduleDB] = useState([]);
  const [contactsDB, setContactsDB] = useState({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbMessage, setDbMessage] = useState('');
  const [dbSearchTerm, setDbSearchTerm] = useState('');
  
  const [dbRuoloTab, setDbRuoloTab] = useState('CURRICULARE'); 
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  const [editingRow, setEditingRow] = useState(null);
  const [editValue, setEditValue] = useState("");

  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ email: '', telefono: '' });

  const [targetDay, setTargetDay] = useState('LUNEDI');
  const [absentInput, setAbsentInput] = useState('');
  const [absentTeachers, setAbsentTeachers] = useState([]); 
  const [substitutionsLog, setSubstitutionsLog] = useState([]); 
  const [historicalLogs, setHistoricalLogs] = useState([]);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [activeSlotSearch, setActiveSlotSearch] = useState(null);
  const [candidates, setCandidates] = useState([]);

  useEffect(() => {
    const initAuthAndLoad = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuthAndLoad();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        if (user.email && RESPONSABILI_ACCOUNTS[user.email.toLowerCase()]) {
            setUserRole(RESPONSABILI_ACCOUNTS[user.email.toLowerCase()]);
        } else {
            setUserRole({ type: 'GUEST', plesso: 'NESSUNO', nome: 'Visitatore (Sola Lettura)' });
        }
        await loadDatabaseFromCloud();
        await loadHistoricalLogsFromCloud();
      } else {
        setCurrentUser(null);
        setUserRole({ type: 'GUEST', plesso: 'NESSUNO', nome: 'Visitatore (Sola Lettura)' });
      }
    });
    return () => unsubscribe();
  }, []);

  const loadDatabaseFromCloud = async () => {
    setIsSyncing(true);
    setDbMessage("Sincronizzazione orari e contatti in corso...");
    try {
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

  const loadHistoricalLogsFromCloud = async () => {
    try {
      const historyRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'storico_sostituzioni');
      const historySnap = await getDoc(historyRef);
      if (historySnap.exists()) {
        setHistoricalLogs(historySnap.data().logs || []);
      }
    } catch (error) {}
  };

  const saveHistoricalLogsToCloud = async (newLogsArray) => {
    try {
      const historyRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'storico_sostituzioni');
      await setDoc(historyRef, { logs: newLogsArray, updatedAt: new Date().toISOString() });
      setHistoricalLogs(newLogsArray);
    } catch (error) {
      console.error("Errore salvataggio storico:", error);
    }
  };

  const saveDatabaseToCloud = async (newScheduleArray) => {
    setIsSyncing(true);
    setDbMessage("Salvataggio nel Cloud in corso (Eliminazione vecchi dati e Chunking)...");
    try {
      let batch = writeBatch(db);

      // PULIZIA PROFONDA: Elimina fisicamente i vecchi pacchetti da Firestore per evitare ingorghi
      for (let i = 0; i < 15; i++) {
         const oldChunkRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`);
         batch.delete(oldChunkRef);
      }

      const CHUNK_SIZE = 800; 
      const chunks = Math.ceil(newScheduleArray.length / CHUNK_SIZE);
      
      for (let i = 0; i < chunks; i++) {
          const chunkData = newScheduleArray.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const chunkRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`);
          batch.set(chunkRef, { data: JSON.stringify(chunkData) });
      }

      const masterRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'plessi_master');
      batch.set(masterRef, { chunks: chunks, updatedAt: new Date().toISOString() });
      
      await batch.commit();
      setScheduleDB(newScheduleArray);
      setDbMessage(`✅ Salvataggio completato! (${newScheduleArray.length} record)`);
    } catch (error) {
      console.error(error);
      const errMsg = "Errore critico di salvataggio Firestore: " + error.message;
      setDbMessage(errMsg);
      alert(errMsg); // Pop-up visibile se ci sono permessi errati
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

  const handleLogin = async () => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      const email = userCredential.user.email.toLowerCase();
      
      if (RESPONSABILI_ACCOUNTS[email]) {
        setUserRole(RESPONSABILI_ACCOUNTS[email]);
        setShowLoginModal(false);
        setLoginEmail('');
        setLoginPassword('');
      } else {
        alert("Questa email non è autorizzata come responsabile di plesso.");
        await signOut(auth); 
        await signInAnonymously(auth); 
      }
    } catch (error) {
      alert("Errore di accesso: Controlla che l'Email istituzionale e la Password siano corrette.");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    await signInAnonymously(auth);
  };

  const startEditingClass = (row) => {
      setEditingRow(row.id);
      setEditValue(row.classe);
  };

  const saveEditedClass = (id) => {
      const updatedDb = scheduleDB.map(item => {
          if(item.id === id) {
              const newClass = editValue.toUpperCase();
              return { ...item, classe: newClass, plesso: determinaPlessoDaClasse(newClass) };
          }
          return item;
      });
      saveDatabaseToCloud(updatedDb);
      setEditingRow(null);
  };

  const handleFileUpload = (event, ruolo) => {
    const file = event.target.files[0];
    if (!file) return;
    setDbMessage(`Lettura CSV ${ruolo} in corso...`);
    
    Papa.parse(file, {
      skipEmptyLines: true,
      // RIMOSSO worker: true per evitare blocchi silenti del browser su Mac/Vercel
      complete: (results) => {
        try {
          const extractedSlots = processParsedGrid(results.data, ruolo);
          
          if (extractedSlots.length === 0) {
              alert("Attenzione: Il file CSV non contiene orari validi o il formato è errato. Nessun dato salvato.");
              setDbMessage("Nessun orario estratto.");
              return;
          }

          if (ruolo === 'CURRICULARE') {
              saveDatabaseToCloud(extractedSlots);
          } else {
              const newCombinedDb = [...scheduleDB, ...extractedSlots];
              saveDatabaseToCloud(newCombinedDb);
          }
        } catch (err) {
          alert("Errore durante l'elaborazione del CSV: " + err.message);
          setDbMessage("Errore formato CSV: " + err.message);
        } finally {
           event.target.value = null; 
        }
      },
      error: (error) => {
        alert("Impossibile leggere il file CSV: " + error.message);
        setDbMessage("Errore di caricamento.");
        event.target.value = null;
      }
    });
  };

  const processParsedGrid = (rows, ruolo) => {
    if (rows.length < 2) throw new Error("File CSV troppo corto o vuoto.");
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
          const classeFormattata = cellContent.toUpperCase();
          
          flatList.push({
            id: crypto.randomUUID(),
            docente: docente,
            giorno: cleanStr(mapping.giorno),
            ora: mapping.ora,
            classe: classeFormattata, 
            ruolo: ruolo, 
            tipologia: classeFormattata.includes('DISP') ? 'A DISPOSIZIONE' : (classeFormattata.includes('POT') ? 'POTENZIAMENTO' : 'LEZIONE'),
            plesso: determinaPlessoDaClasse(classeFormattata)
          });
        }
      }
    }
    return flatList;
  };

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

  const getFilteredScheduleDB = () => {
      if (userRole.type === 'VICEPRESIDENZA' || userRole.plesso === 'TUTTI' || userRole.type === 'GUEST') {
          return scheduleDB;
      }
      return scheduleDB.filter(s => s.plesso === userRole.plesso);
  };

  const getUncoveredSlots = () => {
      const activeDb = getFilteredScheduleDB();
      let slots = activeDb.filter(s => s.giorno === targetDay && absentTeachers.some(at => s.docente.includes(at)));
      return slots.filter(slot => !substitutionsLog.some(log => log.originalSlotId === slot.id));
  };

  const openCandidateSearch = (slot) => {
      setActiveSlotSearch(slot);
      
      const activeDb = getFilteredScheduleDB();
      const orariDelGiorno = activeDb.filter(s => s.giorno === targetDay);
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

          if (classiCorrispondono(slotCorrente.classe, slot.classe)) {
              potentialSubstitutes.push({
                  id_cand: `${slotCorrente.docente}-SOST`,
                  docente: slotCorrente.docente,
                  ruoloCandidato: slotCorrente.ruolo,
                  motivazione: `Compresenza: è già in ${slotCorrente.classe} (${slotCorrente.ruolo})`,
                  score: 100
              });
          } 
          else if (slotCorrente.tipologia === 'A DISPOSIZIONE' || slotCorrente.tipologia === 'POTENZIAMENTO') {
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
                  motivazione: `Libero (Buco Orario / Ora a pagamento)`,
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

  const assignSubstitute = async (candidato) => {
      let modalitaBreve = "Ore Eccedenti (a pagamento)";
      if (candidato.score === 100) modalitaBreve = "Compresenza / Sostegno";
      else if (candidato.score === 80) modalitaBreve = candidato.motivazione; 

      const newLog = {
          id: crypto.randomUUID(),
          originalSlotId: activeSlotSearch.id,
          giorno: targetDay,
          dataISO: new Date().toISOString().split('T')[0],
          ora: activeSlotSearch.ora,
          classe: activeSlotSearch.classe,
          docente_assente: activeSlotSearch.docente,
          docente_sostituto: candidato.docente,
          modalita: modalitaBreve,
          responsabile_firma: userRole.nome,
          plesso: activeSlotSearch.plesso 
      };

      const updatedLogs = [newLog, ...substitutionsLog];
      setSubstitutionsLog(updatedLogs);
      
      const updatedHistory = [newLog, ...historicalLogs];
      await saveHistoricalLogsToCloud(updatedHistory);

      setActiveSlotSearch(null); 
  };

  const inviaNotificaVirtual = (log, metodo) => {
      const testoMessaggio = `*Disposizione Sostituzione - IPSAT Chinnici*\nGentile Prof. ${log.docente_sostituto},\n\nGiorno: ${log.giorno} (${log.dataISO})\nOra: ${log.ora}\nClasse: ${log.classe} (Plesso: ${log.plesso})\nSostituisce: ${log.docente_assente}\nModalità: ${log.modalita}\n\nFirma: ${log.responsabile_firma}`;
      
      const contatti = contactsDB[log.docente_sostituto] || {};
      const telefono = contatti.telefono ? contatti.telefono.replace(/\s+/g, '') : '';
      const email = contatti.email || '';

      if (metodo === 'wa') {
          if (telefono) window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
          else window.open(`https://wa.me/?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
      } else if (metodo === 'mail') {
          const subject = encodeURIComponent(`Disposizione Sostituzione: ${log.giorno} - ${log.ora}`);
          const body = encodeURIComponent(testoMessaggio);
          window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
      } else if (metodo === 'copy') {
          navigator.clipboard.writeText(testoMessaggio).then(() => {
              alert("✅ Testo copiato! Ora incollalo dove preferisci.");
          });
      }
  };

  const getDataFormattata = () => {
      return new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  const activeDbForTable = getFilteredScheduleDB();
  const filteredDbRows = activeDbForTable.filter(row => {
      const matchesRuolo = row.ruolo === dbRuoloTab;
      const matchesSearch = row.docente.includes(dbSearchTerm) || row.classe.includes(dbSearchTerm);
      return matchesRuolo && matchesSearch;
  });

  const totalPages = Math.ceil(filteredDbRows.length / itemsPerPage) || 1;
  const paginatedDbRows = filteredDbRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-800 print:bg-white print:m-0">
      
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-100">
            <h3 className="text-xl font-bold text-blue-950 mb-2">Accesso Istituzionale</h3>
            <p className="text-sm text-gray-600 mb-6">Inserisci l'indirizzo email istituzionale e la password per accedere come responsabile.</p>
            
            <input 
              type="email" 
              placeholder="Email (es. prof@ipssat...)" 
              className="w-full p-3 border-2 border-blue-300 rounded-xl mb-3 focus:border-blue-600 outline-none font-medium"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              autoFocus
            />
            <input 
              type="password" 
              placeholder="Password" 
              className="w-full p-3 border-2 border-blue-300 rounded-xl mb-6 focus:border-blue-600 outline-none"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />

            <div className="flex gap-3">
              <button onClick={() => setShowLoginModal(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-bold transition-all">Annulla</button>
              <button onClick={handleLogin} className="flex-1 bg-blue-800 hover:bg-blue-900 text-white py-3 rounded-xl font-bold transition-all shadow-md">Accedi</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-b-4 border-blue-900 shadow-sm print:border-none print:shadow-none mb-6">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-6 print:justify-start">
          
          <div className="flex items-center gap-6">
            <img src="/logo alberghiero.png" alt="Logo Alberghiero" className="w-24 h-auto print:w-32 object-contain" onError={(e)=>{e.target.style.display='none'}} />
            <div className="flex flex-col text-center md:text-left">
              <h1 className="text-sm md:text-md font-bold text-blue-950 tracking-wide uppercase font-serif">
                Istituto Professionale di Stato per i Servizi Alberghieri e Turistici
              </h1>
              <h2 className="text-2xl md:text-3xl font-extrabold text-blue-900 mt-0.5 tracking-tight">
                Rocco Chinnici
              </h2>
              <h3 className="text-sm text-blue-800 font-semibold uppercase tracking-wider">
                Nicolosi {userRole.plesso !== 'TUTTI' && `— Plesso: ${userRole.plesso}`}
              </h3>
              <div className="mt-3 pt-2 border-t border-gray-200 flex items-center gap-3">
                <span className="text-xs uppercase tracking-widest bg-blue-100 text-blue-900 font-extrabold px-3 py-1 rounded-full inline-block shadow-xs">
                  ScuolaManager Pro — Gestione Sostituzioni
                </span>
                {userRole.type === 'GUEST' ? (
                    <button 
                      onClick={() => setShowLoginModal(true)} 
                      className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-1.5 rounded-full shadow-sm transition-all print:hidden"
                    >
                      🔒 Login Responsabili
                    </button>
                ) : (
                    <button 
                      onClick={handleLogout} 
                      className="text-xs bg-gray-100 hover:bg-red-50 text-gray-700 hover:text-red-700 font-bold px-3 py-1.5 rounded-full border border-gray-300 transition-all print:hidden"
                    >
                      👤 {userRole.nome} (Esci)
                    </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap w-full md:w-auto gap-2 bg-gray-100 p-1.5 rounded-xl print:hidden">
            <button onClick={() => setActiveTab('DASHBOARD')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'DASHBOARD' ? 'bg-blue-800 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}`}>
              Sostituzioni
            </button>
            <button onClick={() => setActiveTab('STORICO')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'STORICO' ? 'bg-blue-800 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}`}>
              Archivio Storico
            </button>
            {userRole.type === 'VICEPRESIDENZA' && (
              <button onClick={() => setActiveTab('DATABASE')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'DATABASE' ? 'bg-blue-800 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}`}>
                Database Orari
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-8 print:p-0">
        
        {activeTab === 'DASHBOARD' && (
          <div className="space-y-6">
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
                  
                  {userRole.type !== 'GUEST' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Aggiungi Assente (Cognome)</label>
                    <div className="flex gap-2">
                        <input type="text" placeholder="Es. ROSSI" className="flex-1 border-gray-300 rounded-md shadow-sm p-2 border uppercase" value={absentInput} onChange={(e) => setAbsentInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAbsentTeacher()}/>
                        <button onClick={addAbsentTeacher} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-bold shadow-sm">+</button>
                    </div>
                  </div>
                  ) : (
                    <div className="p-3 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md text-sm font-medium">
                      Effettua il login come responsabile per gestire le assenze.
                    </div>
                  )}
                  
                  {absentTeachers.length > 0 && (
                      <div className="mt-4 border-t border-gray-100 pt-4 bg-gray-50 -mx-6 px-6 pb-6 rounded-b-xl">
                          <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Assenti Registrati:</h3>
                          <div className="flex flex-wrap gap-2">
                              {absentTeachers.map(t => (
                                  <span key={t} className="bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm">
                                      {t} <button onClick={()=>removeAbsentTeacher(t)} className="text-red-400 hover:text-red-900 bg-white rounded-full w-5 h-5 flex items-center justify-center border border-red-100">×</button>
                                  </span>
                              ))}
                          </div>
                      </div>
                  )}
                </div>
              </div>

              <div className="md:col-span-2 space-y-6">
                
                {activeSlotSearch && (
                   <div className="bg-blue-50 p-6 rounded-xl shadow-md border border-blue-200 border-l-4 border-l-blue-600">
                       <div className="flex justify-between items-start mb-4">
                           <div>
                               <h3 className="font-bold text-blue-900 text-lg">Ricerca per {activeSlotSearch.docente}</h3>
                               <p className="text-sm text-blue-800">Ora: {activeSlotSearch.ora} | Classe scoperta: <span className="font-bold bg-white px-2 py-0.5 rounded shadow-sm">{activeSlotSearch.classe}</span></p>
                           </div>
                           <button onClick={()=>setActiveSlotSearch(null)} className="text-gray-400 hover:text-gray-700 font-bold text-xl">×</button>
                       </div>
                       
                       <div className="max-h-[350px] overflow-y-auto border border-blue-100 rounded-lg bg-white shadow-sm">
                         <table className="min-w-full divide-y divide-gray-200">
                           <thead className="bg-gray-50 sticky top-0">
                             <tr>
                               <th className="px-4 py-3 text-left text-xs font-bold text-gray-500">Candidato ({userRole.plesso})</th>
                               <th className="px-4 py-3 text-left text-xs font-bold text-gray-500">Motivazione Priorità</th>
                               <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">Azione</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-gray-100">
                             {candidates.map((c, i) => (
                               <tr key={i} className={`hover:bg-gray-50 ${c.score === 100 ? 'bg-green-50/30' : c.score === 80 ? 'bg-blue-50/20' : ''}`}>
                                 <td className="px-4 py-3 font-bold text-gray-800">{c.docente}</td>
                                 <td className="px-4 py-3 text-xs">
                                     <span className={`px-2 py-1 rounded-md font-semibold ${c.score === 100 ? 'bg-green-100 text-green-800' : c.score === 80 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{c.motivazione}</span>
                                 </td>
                                 <td className="px-4 py-3 text-right">
                                     <button onClick={() => assignSubstitute(c)} className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded shadow-sm transition-colors">Assegna</button>
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
                       <p className="text-sm text-gray-500 text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200">Aggiungi un docente assente per vedere le ore da coprire in questa sede.</p>
                   ) : getUncoveredSlots().length === 0 ? (
                       <div className="bg-green-50 text-green-700 p-6 rounded-lg text-center font-bold border border-green-200 text-lg shadow-sm">✅ Tutte le ore di {targetDay} per {userRole.plesso} sono coperte!</div>
                   ) : (
                       <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
                           <table className="min-w-full divide-y divide-gray-200">
                               <thead className="bg-gray-50">
                                   <tr>
                                       <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Ora</th>
                                       <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Assente</th>
                                       <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Classe (Plesso)</th>
                                       <th className="px-4 py-3 text-right"></th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-gray-100 bg-white">
                                   {getUncoveredSlots().sort((a,b) => a.ora.localeCompare(b.ora)).map(slot => (
                                       <tr key={slot.id} className="hover:bg-blue-50 transition-colors">
                                           <td className="px-4 py-3 font-medium text-gray-700">{slot.ora}</td>
                                           <td className="px-4 py-3 text-red-600 font-bold">{slot.docente}</td>
                                           <td className="px-4 py-3">
                                              <span className="font-bold text-gray-900">{slot.classe}</span>
                                              <span className="ml-2 text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-semibold">{slot.plesso}</span>
                                           </td>
                                           <td className="px-4 py-3 text-right">
                                               {userRole.type !== 'GUEST' ? (
                                                  <button onClick={() => openCandidateSearch(slot)} className="border-2 border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white text-xs font-bold px-4 py-1.5 rounded transition-all">Cerca Sostituto</button>
                                               ) : (
                                                  <span className="text-[10px] text-gray-400 font-bold uppercase border border-gray-200 px-2 py-1 rounded">Sola Lettura</span>
                                               )}
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
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 print:shadow-none print:border-none print:p-0 mt-8">
                <div className="flex justify-between items-center mb-6 print:hidden">
                    <h2 className="text-xl font-bold text-gray-800">3. Resoconto Ufficiale Sostituzioni</h2>
                    <button onClick={() => window.print()} className="bg-blue-800 hover:bg-blue-900 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-sm transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                        Stampa PDF / Cartaceo
                    </button>
                </div>

                <div className="hidden print:block mb-6 text-center border-b-2 border-blue-900 pb-4 mt-4">
                    <h1 className="text-xl font-extrabold uppercase tracking-widest text-blue-900">Resoconto Giornaliero Sostituzioni</h1>
                    <p className="text-md mt-1 font-bold capitalize text-gray-800">{targetDay}, {getDataFormattata()} — Plesso: {userRole.plesso}</p>
                </div>

                {substitutionsLog.length === 0 ? (
                    <p className="text-gray-500 italic print:hidden text-center py-6 bg-gray-50 rounded-lg">Nessuna sostituzione completata al momento.</p>
                ) : (
                    <table className="min-w-full divide-y divide-gray-300 border border-gray-300 print:border-2 print:border-black shadow-sm print:shadow-none">
                        <thead className="bg-gray-100 print:bg-gray-200">
                            <tr>
                                <th className="px-4 py-3 text-left font-bold text-red-700 border-r border-gray-300">Docente Assente</th>
                                <th className="px-4 py-3 text-left font-bold text-gray-800 border-r border-gray-300">Ora</th>
                                <th className="px-4 py-3 text-left font-bold text-gray-800 border-r border-gray-300">Classe (Sede)</th>
                                <th className="px-4 py-3 text-left font-bold text-green-700 border-r border-gray-300">Sostituto Assegnato</th>
                                <th className="px-4 py-3 text-left font-bold text-blue-800 border-r border-gray-300">Modalità</th>
                                <th className="px-4 py-3 text-center print:hidden">Avvisa Docente (Smart)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {substitutionsLog.sort((a,b) => a.docente_assente.localeCompare(b.docente_assente) || a.ora.localeCompare(b.ora)).map(log => (
                                <tr key={log.id} className="print:break-inside-avoid hover:bg-gray-50">
                                    <td className="px-4 py-3 border-r border-gray-300 font-bold text-red-600 bg-red-50/50">{log.docente_assente}</td>
                                    <td className="px-4 py-3 border-r border-gray-300 font-medium">{log.ora}</td>
                                    <td className="px-4 py-3 border-r border-gray-300">
                                      <span className="font-bold">{log.classe}</span>
                                      <span className="ml-1 text-[10px] text-gray-500">({log.plesso})</span>
                                    </td>
                                    <td className="px-4 py-3 border-r border-gray-300 font-bold uppercase text-green-700">{log.docente_sostituto}</td>
                                    <td className="px-4 py-3 border-r border-gray-300 text-xs font-semibold text-gray-700">{log.modalita}</td>
                                    <td className="px-4 py-2 text-center print:hidden flex flex-wrap justify-center gap-1.5 items-center">
                                        <button onClick={()=>inviaNotificaVirtual(log, 'wa')} className="bg-green-100 text-green-800 hover:bg-green-200 hover:shadow-sm px-2 py-1 rounded text-xs font-bold transition-all border border-green-200" title="Invia tramite WhatsApp">📱 WA</button>
                                        <button onClick={()=>inviaNotificaVirtual(log, 'mail')} className="bg-blue-100 text-blue-800 hover:bg-blue-200 hover:shadow-sm px-2 py-1 rounded text-xs font-bold transition-all border border-blue-200" title="Invia Email">✉️ Mail</button>
                                        <button onClick={()=>inviaNotificaVirtual(log, 'copy')} className="bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow-sm px-2 py-1 rounded text-xs font-bold transition-all border border-gray-300" title="Copia Testo per Telegram/Altro">📋 Copia</button>
                                        <button onClick={() => setSubstitutionsLog(substitutionsLog.filter(l => l.id !== log.id))} className="text-red-400 hover:text-red-700 text-[10px] font-bold underline px-1 ml-2">Annulla</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                
                <div className="hidden print:flex justify-between mt-16 pt-8">
                    <div className="text-center w-64 border-t-2 border-black pt-2 font-bold">
                        Il Responsabile di Plesso<br/>
                        <span className="text-sm font-medium text-gray-600">{userRole.nome}</span>
                    </div>
                    <div className="text-center w-64 border-t-2 border-black pt-2 font-bold">
                        La Dirigenza / Vicepresidenza<br/>
                        <span className="text-sm font-medium text-gray-600">Istituto IPSAT Rocco Chinnici</span>
                    </div>
                </div>
            </div>

          </div>
        )}

        {activeTab === 'STORICO' && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-200 pb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Archivio Storico Sostituzioni</h2>
                <p className="text-gray-500 text-sm mt-1">Tutte le sostituzioni effettuate rimangono salvate in modo permanente nel Cloud Firebase.</p>
              </div>
              <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg border border-gray-200">
                <label className="text-sm font-bold text-gray-700">Filtra per Data:</label>
                <input 
                  type="date" 
                  className="p-2 border border-gray-300 rounded-md font-medium focus:border-blue-500 outline-none" 
                  value={selectedHistoryDate} 
                  onChange={(e) => setSelectedHistoryDate(e.target.value)}
                />
              </div>
            </div>

            {historicalLogs.length === 0 ? (
              <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <span className="text-4xl block mb-3">🗄️</span>
                  <p className="text-gray-500 font-medium">Nessun record presente nello storico cloud.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold text-gray-600 uppercase tracking-wider">Data</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-600 uppercase tracking-wider">Plesso</th>
                      <th className="px-4 py-3 text-left font-bold text-red-700 uppercase tracking-wider">Assente</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-600 uppercase tracking-wider">Ora / Classe</th>
                      <th className="px-4 py-3 text-left font-bold text-green-700 uppercase tracking-wider">Sostituto</th>
                      <th className="px-4 py-3 text-left font-bold text-blue-800 uppercase tracking-wider">Modalità & Firma</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {historicalLogs
                      .filter(log => !selectedHistoryDate || log.dataISO === selectedHistoryDate)
                      .map((log) => (
                        <tr key={log.id} className="hover:bg-blue-50 transition-colors">
                          <td className="px-4 py-3 font-mono font-medium text-gray-600 bg-gray-50/50">{log.dataISO}</td>
                          <td className="px-4 py-3 font-bold text-blue-900">{log.plesso}</td>
                          <td className="px-4 py-3 font-bold text-red-600">{log.docente_assente}</td>
                          <td className="px-4 py-3 font-medium">{log.ora} <span className="font-bold">({log.classe})</span></td>
                          <td className="px-4 py-3 font-bold text-green-700 uppercase">{log.docente_sostituto}</td>
                          <td className="px-4 py-3 text-xs">
                            <span className="font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded">{log.modalita}</span>
                            <div className="text-gray-400 mt-1 italic">Firmato: {log.responsabile_firma}</div>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'DATABASE' && userRole.type === 'VICEPRESIDENZA' && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden print:hidden">
            <div className="bg-blue-900 p-6 border-b border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                 <h2 className="text-xl font-bold text-white">Database Centrale Orari & Rubrica</h2>
                 <p className="text-blue-200 text-sm mt-1">{dbMessage}</p>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => { if(confirm("⚠️ ATTENZIONE: Sei sicuro di voler SVUOTARE l'intero database e resettare tutto a zero?")) saveDatabaseToCloud([]) }} className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-bold hover:bg-red-700 shadow-sm transition-colors">Svuota DB</button>
              </div>
            </div>

            <div className="p-6">
                
                <div className="flex border-b border-gray-200 mb-6 gap-2">
                    <button 
                        onClick={() => { setDbRuoloTab('CURRICULARE'); setCurrentPage(1); }}
                        className={`pb-3 px-6 font-bold text-sm border-b-4 transition-all rounded-t-md ${dbRuoloTab === 'CURRICULARE' ? 'border-blue-800 text-blue-900 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                        📚 Docenti Curriculari ({scheduleDB.filter(r => r.ruolo === 'CURRICULARE').length})
                    </button>
                    <button 
                        onClick={() => { setDbRuoloTab('SOSTEGNO'); setCurrentPage(1); }}
                        className={`pb-3 px-6 font-bold text-sm border-b-4 transition-all rounded-t-md ${dbRuoloTab === 'SOSTEGNO' ? 'border-green-600 text-green-800 bg-green-50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                        🤝 Docenti Sostegno ({scheduleDB.filter(r => r.ruolo === 'SOSTEGNO').length})
                    </button>
                </div>

                <div className="mb-6 flex flex-col md:flex-row gap-4 items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <div className="w-full md:w-2/3">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Cerca Docente o Classe</label>
                        <input type="text" placeholder={`Cerca in ${dbRuoloTab.toLowerCase()} (es. ROSSI o 4A)...`} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm uppercase focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-bold text-blue-900 outline-none transition-all" value={dbSearchTerm} onChange={(e) => { setDbSearchTerm(e.target.value.toUpperCase()); setCurrentPage(1); }} />
                    </div>
                    
                    {dbSearchTerm && (
                        <div className="w-full md:w-1/3 mt-5">
                            <button onClick={() => {
                                const existingContact = contactsDB[dbSearchTerm] || { email: '', telefono: '' };
                                setContactForm(existingContact);
                                setEditingContact(true);
                            }} className="w-full py-3 bg-indigo-100 text-indigo-800 font-bold rounded-lg hover:bg-indigo-200 border border-indigo-200 shadow-sm transition-colors">
                                📞 Gestisci Contatti di {dbSearchTerm}
                            </button>
                        </div>
                    )}
                </div>

                {editingContact && (
                    <div className="mb-8 p-6 bg-indigo-50 border-2 border-indigo-200 rounded-xl shadow-inner">
                        <h3 className="font-bold text-indigo-900 mb-4 text-lg flex items-center gap-2">📱 Rubrica: {dbSearchTerm}</h3>
                        <div className="flex flex-col md:flex-row gap-4 items-end">
                            <div className="flex-1 w-full">
                                <label className="text-xs font-bold text-indigo-800 uppercase tracking-wider">Indirizzo Email</label>
                                <input type="email" className="w-full p-3 border border-indigo-200 rounded-lg shadow-sm outline-none focus:border-indigo-500" value={contactForm.email} onChange={e=>setContactForm({...contactForm, email:e.target.value})} placeholder="es. mario.rossi@scuola.it"/>
                            </div>
                            <div className="flex-1 w-full">
                                <label className="text-xs font-bold text-indigo-800 uppercase tracking-wider">Numero di Telefono (WhatsApp)</label>
                                <input type="text" className="w-full p-3 border border-indigo-200 rounded-lg shadow-sm outline-none focus:border-indigo-500" value={contactForm.telefono} onChange={e=>setContactForm({...contactForm, telefono:e.target.value})} placeholder="es. 3331234567"/>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto mt-4 md:mt-0">
                                <button onClick={() => saveContactsToCloud({ ...contactsDB, [dbSearchTerm]: contactForm })} className="flex-1 md:flex-none px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 transition-colors">Salva Dati</button>
                                <button onClick={() => setEditingContact(false)} className="flex-1 md:flex-none px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-colors">Annulla</button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid md:grid-cols-2 gap-6 mb-8">
                    <div className="border-2 border-dashed border-blue-300 rounded-xl p-6 bg-blue-50 flex flex-col items-center justify-center text-center hover:bg-blue-100 transition-colors cursor-pointer relative">
                        <span className="text-2xl mb-2">📚</span>
                        <h4 className="font-bold text-blue-900 mb-1">Carica CSV Curriculari</h4>
                        <p className="text-xs text-blue-700">Sovrascrive i dati esistenti</p>
                        <input type="file" accept=".csv" disabled={isSyncing} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'CURRICULARE')} />
                    </div>
                    <div className="border-2 border-dashed border-green-300 rounded-xl p-6 bg-green-50 flex flex-col items-center justify-center text-center hover:bg-green-100 transition-colors cursor-pointer relative">
                        <span className="text-2xl mb-2">🤝</span>
                        <h4 className="font-bold text-green-900 mb-1">Carica CSV Sostegno</h4>
                        <p className="text-xs text-green-700">Aggiunge al database esistente</p>
                        <input type="file" accept=".csv" disabled={isSyncing} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'SOSTEGNO')} />
                    </div>
                </div>

                <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-100 sticky top-0 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 text-left font-bold text-gray-600 uppercase tracking-wider">Docente</th>
                                <th className="px-4 py-3 text-left font-bold text-gray-600 uppercase tracking-wider">Giorno / Ora</th>
                                <th className="px-4 py-3 text-left font-bold text-blue-700 uppercase tracking-wider">Classe (Clicca x Modificare)</th>
                                <th className="px-4 py-3 text-left font-bold text-gray-600 uppercase tracking-wider">Plesso Assegnato</th>
                                <th className="px-4 py-3 text-left font-bold text-gray-600 uppercase tracking-wider">Ruolo</th>
                                <th className="px-4 py-3 text-right">Azione</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {paginatedDbRows.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="text-center py-12 text-gray-400 font-medium">Nessun record trovato. Carica un CSV o cambia termine di ricerca.</td>
                                </tr>
                            ) : (
                                paginatedDbRows.map((row) => (
                                    <tr key={row.id} className="hover:bg-blue-50/50 transition-colors">
                                        <td className="px-4 py-2 font-bold text-gray-800 flex items-center gap-2">
                                            {row.docente}
                                            {contactsDB[row.docente] && (contactsDB[row.docente].email || contactsDB[row.docente].telefono) && <span title="Contatti Salvati" className="text-[10px] bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5 border border-indigo-200">📞 INFO</span>}
                                        </td>
                                        <td className="px-4 py-2 font-medium text-gray-600">{row.giorno} ({row.ora})</td>
                                        
                                        <td className="px-4 py-2 font-extrabold cursor-pointer hover:bg-blue-100 transition-colors text-blue-900" onClick={() => startEditingClass(row)} title="Clicca per modificare la classe.">
                                            {editingRow === row.id ? (
                                                <input
                                                    type="text"
                                                    className="border-2 border-blue-500 rounded px-2 py-1 w-24 text-sm uppercase shadow-sm bg-white outline-none"
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
                                        
                                        <td className="px-4 py-2">
                                            <span className={`text-[10px] px-2 py-1 rounded font-bold border ${row.plesso === 'NICOLOSI' ? 'bg-gray-100 border-gray-200 text-gray-700' : 'bg-purple-100 border-purple-200 text-purple-800'}`}>
                                                {row.plesso}
                                            </span>
                                        </td>
                                        
                                        <td className="px-4 py-2">
                                            <span className={`text-[10px] font-bold px-2 py-1 rounded border ${row.ruolo === 'SOSTEGNO' ? 'bg-green-100 border-green-200 text-green-800' : 'bg-gray-100 border-gray-200 text-gray-700'}`}>{row.ruolo}</span>
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            <button onClick={() => { if(confirm("Eliminare questa singola ora?")) saveDatabaseToCloud(scheduleDB.filter(item => item.id !== row.id)) }} className="text-red-400 hover:text-red-700 hover:bg-red-50 font-bold px-3 py-1 rounded transition-colors text-xs">Elimina</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div className="flex justify-between items-center mt-6 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg shadow-sm">
                        <button 
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className={`px-4 py-2 rounded font-bold text-sm transition-colors ${currentPage === 1 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-800 text-white hover:bg-blue-900 shadow-sm'}`}
                        >
                            ← Indietro
                        </button>
                        <span className="text-sm font-semibold text-gray-700">
                            Pagina <span className="text-blue-700 font-bold">{currentPage}</span> di {totalPages} (Totale record: {filteredDbRows.length})
                        </span>
                        <button 
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className={`px-4 py-2 rounded font-bold text-sm transition-colors ${currentPage === totalPages ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-800 text-white hover:bg-blue-900 shadow-sm'}`}
                        >
                            Avanti →
                        </button>
                    </div>
                )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
}