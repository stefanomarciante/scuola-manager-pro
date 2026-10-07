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

// ============================================================================
// 🏫 IMPOSTAZIONI PLESSI E CLASSI
// ============================================================================
const PLESSI_LIST = [
  "NICOLOSI",
  "PEDARA",
  "TRECASTAGNI",
  "SANTA MARIA DI LICODIA",
  "PATERNO'"
];

const MAPPA_CLASSI_PLESSI = {
  "PEDARA": ["1C", "2C", "3C CUC", "4C CUC", "5C CUC"],
  "TRECASTAGNI": ["1D", "2D", "3D CUC", "4D CUC", "5D CUC", "3B SALA", "4B SALA", "5B SALA"],
  "SANTA MARIA DI LICODIA": ["1G", "2G", "2H", "3E CUC", "4E CUC", "5E CUC", "3C SALA", "4C SALA", "5C SALA"],
  "PATERNO'": ["1I", "1B S", "2I", "2L", "3F CUC", "4F CUC", "5F CUC", "3D SALA", "4D SALA", "5D SALA"] 
};

const FASCIE_ORARIE_STANDARD = [
    { label: '1ª', orario: '08:00-08:50' },
    { label: '2ª', orario: '08:50-09:40' },
    { label: '3ª', orario: '09:40-10:40' },
    { label: '4ª', orario: '10:40-11:40' },
    { label: '5ª', orario: '11:40-12:40' },
    { label: '6ª', orario: '12:40-13:30' },
    { label: '7ª', orario: '13:30-14:20' }
];

// ============================================================================
// 🔐 ACCOUNT ISTITUZIONALI RESPONSABILI
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

// ============================================================================
// LOGICA DI ASSEGNAZIONE PLESSO
// ============================================================================
const determinaPlessoDaClasse = (classeStr) => {
  if (!classeStr) return null;
  const classeClean = classeStr.toUpperCase().replace(/\s+/g, '');

  for (const [plesso, classiArray] of Object.entries(MAPPA_CLASSI_PLESSI)) {
    for (const sigla of classiArray) {
      const siglaClean = sigla.toUpperCase().replace(/\s+/g, '');
      if (classeClean.includes(siglaClean)) {
        return plesso;
      }
    }
  }
  return null; 
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
  
  // --- STATI PER LE ASSENZE COMPLESSE (Assemblee/Permessi) ---
  const [absentInput, setAbsentInput] = useState('');
  const [absenceMode, setAbsenceMode] = useState('INTERA'); // 'INTERA' o 'PARZIALE'
  const [selectedPartialHours, setSelectedPartialHours] = useState([]);
  const [absentTeachers, setAbsentTeachers] = useState([]); // Array di oggetti: { id, nome, tipo, ore[] }
  
  const [substitutionsLog, setSubstitutionsLog] = useState([]); 
  const [historicalLogs, setHistoricalLogs] = useState([]);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [activeSlotSearch, setActiveSlotSearch] = useState(null);
  const [candidates, setCandidates] = useState([]);

  // --- STATI PER TAB ASSEMBLEE SINDACALI ---
  const [assemblyDay, setAssemblyDay] = useState('LUNEDI');
  const [assemblyHours, setAssemblyHours] = useState([]);
  const [assemblyTeacherInput, setAssemblyTeacherInput] = useState('');
  const [assemblyTeachersList, setAssemblyTeachersList] = useState([]);

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
    setDbMessage("Lettura orari da Firebase...");
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

      setDbMessage(`✅ Orari caricati: ${fullDb.length} record presenti.`);
    } catch (error) {
      setDbMessage("Errore caricamento: " + error.message);
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

  const svuotaDatabaseAssoluto = async () => {
      setIsSyncing(true);
      setDbMessage("Eliminazione totale da Firestore in corso...");
      try {
        let batch = writeBatch(db);
        for (let i = 0; i < 20; i++) {
           const oldChunkRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`);
           batch.delete(oldChunkRef);
        }
        const masterRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'plessi_master');
        batch.delete(masterRef);
        
        await batch.commit();
        setScheduleDB([]);
        setDbMessage("✅ Database svuotato completamente.");
      } catch(e) {
          alert("Errore durante lo svuotamento: " + e.message);
          setDbMessage("Errore: " + e.message);
      } finally {
          setIsSyncing(false);
      }
  };

  const saveDatabaseToCloud = async (newScheduleArray) => {
    setIsSyncing(true);
    setDbMessage("Salvataggio nel Cloud in corso...");
    try {
      let batch = writeBatch(db);
      for (let i = 0; i < 20; i++) {
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
      const errMsg = "Errore critico di salvataggio Firestore: " + error.message;
      setDbMessage(errMsg);
      alert(errMsg); 
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
              let plessoCalc = determinaPlessoDaClasse(newClass);
              if(!plessoCalc) plessoCalc = "NICOLOSI";
              return { ...item, classe: newClass, plesso: plessoCalc };
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
          
          let tipologiaCalc = 'LEZIONE';
          if (classeFormattata.includes('DISP') || classeFormattata === 'D') tipologiaCalc = 'A DISPOSIZIONE';
          else if (classeFormattata.includes('POT') || classeFormattata === 'P') tipologiaCalc = 'POTENZIAMENTO';
          
          let plessoCalc = determinaPlessoDaClasse(classeFormattata); 
          
          flatList.push({
            id: crypto.randomUUID(),
            docente: docente,
            giorno: cleanStr(mapping.giorno),
            ora: mapping.ora,
            classe: classeFormattata, 
            ruolo: ruolo, 
            tipologia: tipologiaCalc,
            plesso: plessoCalc 
          });
        }
      }
    }

    flatList.forEach(slot => {
        if (slot.plesso === null) {
            const oreStessoGiorno = flatList.filter(s => 
                s.docente === slot.docente && 
                s.giorno === slot.giorno && 
                s.id !== slot.id && 
                s.plesso !== null
            );
            
            if (oreStessoGiorno.length > 0) {
                slot.plesso = oreStessoGiorno[0].plesso;
            } else {
                slot.plesso = "NICOLOSI";
            }
        }
    });

    return flatList;
  };

  // --- GESTIONE ASSENZE AVANZATE ---
  const togglePartialHour = (orarioStr) => {
      if(selectedPartialHours.includes(orarioStr)) {
          setSelectedPartialHours(selectedPartialHours.filter(h => h !== orarioStr));
      } else {
          setSelectedPartialHours([...selectedPartialHours, orarioStr]);
      }
  };

  const addAbsentTeacher = () => {
      if(!absentInput) return;
      const cleanName = cleanStr(absentInput);
      
      if(absenceMode === 'PARZIALE' && selectedPartialHours.length === 0) {
          alert("Seleziona almeno un'ora di assenza per il permesso parziale.");
          return;
      }

      const existingIndex = absentTeachers.findIndex(t => t.nome === cleanName);
      const newAbsenceRecord = {
          id: existingIndex >= 0 ? absentTeachers[existingIndex].id : crypto.randomUUID(),
          nome: cleanName,
          tipo: absenceMode, // 'INTERA' o 'PARZIALE'
          ore: absenceMode === 'PARZIALE' ? [...selectedPartialHours] : []
      };

      if (existingIndex >= 0) {
          const updated = [...absentTeachers];
          updated[existingIndex] = newAbsenceRecord;
          setAbsentTeachers(updated);
      } else {
          setAbsentTeachers([...absentTeachers, newAbsenceRecord]);
      }

      setAbsentInput('');
      setAbsenceMode('INTERA');
      setSelectedPartialHours([]);
  };

  const removeAbsentTeacher = (id) => {
      setAbsentTeachers(absentTeachers.filter(t => t.id !== id));
  };

  const getFilteredScheduleDB = () => {
      if (userRole.type === 'VICEPRESIDENZA' || userRole.plesso === 'TUTTI' || userRole.type === 'GUEST') {
          return scheduleDB;
      }
      return scheduleDB.filter(s => s.plesso === userRole.plesso);
  };

  const getUncoveredSlots = () => {
      const activeDb = getFilteredScheduleDB();
      
      let slots = activeDb.filter(s => {
          if (s.giorno !== targetDay) return false;
          
          // Cerca se questo docente è nella lista assenti
          const absenceRecord = absentTeachers.find(at => s.docente.includes(at.nome));
          if (!absenceRecord) return false;
          
          // Se è assente tutto il giorno, il suo slot è scoperto
          if (absenceRecord.tipo === 'INTERA') return true;
          
          // Se è assente parziale, controlliamo se questo slot cade nelle ore selezionate
          if (absenceRecord.tipo === 'PARZIALE' && absenceRecord.ore.includes(s.ora)) return true;
          
          return false;
      });
      
      // Filtriamo quelli già gestiti/sostituiti
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
          // Verifica intelligente assenza: Il docente è assente *in questa specifica ora*?
          const isAssenteInQuestaOra = absentTeachers.some(at => {
              if (!slotCorrente.docente.includes(at.nome)) return false;
              if (at.tipo === 'INTERA') return true;
              return at.ore.includes(slotCorrente.ora);
          });
          if (isAssenteInQuestaOra) return;

          if (classiCorrispondono(slotCorrente.classe, slot.classe)) {
              potentialSubstitutes.push({
                  id_cand: `${slotCorrente.docente}-SOST`,
                  docente: slotCorrente.docente,
                  ruoloCandidato: slotCorrente.ruolo,
                  motivazione: `Compresenza: è in ${slotCorrente.classe}`,
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
          if (!docentiImpegnati.has(doc)) {
              // Controlla se il docente "libero" è in realtà in assemblea sindacale per questa ora
              const isAssenteInQuestaOra = absentTeachers.some(at => {
                  if (!doc.includes(at.nome)) return false;
                  if (at.tipo === 'INTERA') return true;
                  return at.ore.includes(slot.ora); // slot è l'ora scoperta che stiamo cercando di coprire
              });
              
              if (!isAssenteInQuestaOra) {
                  potentialSubstitutes.push({
                      id_cand: `${doc}-LIBERO`,
                      docente: doc,
                      ruoloCandidato: 'CURRICULARE',
                      motivazione: `Libero (Possibile Buco Orario)`,
                      score: 50
                  });
              }
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

  // --- GESTIONE ASSEMBLEE SINDACALI ---
  const toggleAssemblyHour = (orarioStr) => {
      if(assemblyHours.includes(orarioStr)) {
          setAssemblyHours(assemblyHours.filter(h => h !== orarioStr));
      } else {
          setAssemblyHours([...assemblyHours, orarioStr]);
      }
  };

  const addAssemblyTeacher = () => {
      if(!assemblyTeacherInput) return;
      const cleanName = cleanStr(assemblyTeacherInput);
      if(!assemblyTeachersList.includes(cleanName)) {
          setAssemblyTeachersList([...assemblyTeachersList, cleanName]);
      }
      setAssemblyTeacherInput('');
  };

  const removeAssemblyTeacher = (nome) => {
      setAssemblyTeachersList(assemblyTeachersList.filter(t => t !== nome));
  };

  const getAssemblyImpact = () => {
      const activeDb = getFilteredScheduleDB();
      const todaySlots = activeDb.filter(s => s.giorno === assemblyDay);

      // Trova le ore di lezione dei docenti in assemblea in quegli orari
      const affectedSlots = todaySlots.filter(s =>
          assemblyTeachersList.some(t => s.docente.includes(t)) &&
          assemblyHours.includes(s.ora) &&
          s.tipologia !== 'A DISPOSIZIONE' && s.tipologia !== 'POTENZIAMENTO'
      );

      let report = [];
      affectedSlots.forEach(slot => {
          // Cerca se nella stessa classe, stessa ora, c'è un ALTRO docente non in assemblea (es. Sostegno/ITP)
          const coTeachers = todaySlots.filter(s =>
              classiCorrispondono(s.classe, slot.classe) &&
              s.ora === slot.ora &&
              s.id !== slot.id &&
              !assemblyTeachersList.some(t => s.docente.includes(t))
          );

          let status = 'VARIAZIONE';
          let note = '';

          if (coTeachers.length > 0) {
              status = 'REGOLARE';
              note = `Rimane a scuola. Copre: ${coTeachers.map(c => c.docente).join(', ')}`;
          } else {
              // Se non c'è nessuno, calcola se è entrata o uscita
              if (slot.ora.includes('08:00') || slot.ora.includes('08:50') || slot.ora.includes('09:40')) {
                  note = 'INGRESSO POSTICIPATO (Avviso Famiglie)';
              } else {
                  note = 'USCITA ANTICIPATA (Avviso Famiglie)';
              }
          }

          report.push({ ...slot, status, note });
      });

      // Raggruppa e ordina per Classe e poi per Ora
      return report.sort((a,b) => a.classe.localeCompare(b.classe) || a.ora.localeCompare(b.ora));
  };

  const assignSubstitute = async (candidato) => {
      let modalitaBreve = "Ore Eccedenti";
      if (candidato.score === 100) modalitaBreve = "Compresenza";
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
      const testoMessaggio = `*Sostituzione - IPSAT Chinnici*\n\nGentile Prof. ${log.docente_sostituto},\nGiorno: ${log.giorno} (${log.dataISO})\nOra: ${log.ora}\nClasse: ${log.classe} (Plesso: ${log.plesso})\nSostituisce: ${log.docente_assente}\n\nFirma: ${log.responsabile_firma}`;
      
      const contatti = contactsDB[log.docente_sostituto] || {};
      let telefono = contatti.telefono ? contatti.telefono.replace(/\s+/g, '') : '';
      const email = contatti.email || '';

      if (metodo === 'wa') {
          if (telefono) {
             if (!telefono.startsWith('+39') && !telefono.startsWith('39')) {
                 telefono = '+39' + telefono;
             } else if (telefono.startsWith('39')) {
                 telefono = '+' + telefono;
             }
             window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
          } else {
             window.open(`https://wa.me/?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
          }
      } else if (metodo === 'mail') {
          const subject = encodeURIComponent(`Sostituzione: ${log.giorno} - ${log.ora}`);
          const body = encodeURIComponent(testoMessaggio);
          window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
      } else if (metodo === 'copy') {
          navigator.clipboard.writeText(testoMessaggio).then(() => {
              alert("✅ Testo copiato!");
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
    <div className="min-h-screen bg-[#f3f4f6] font-sans text-[#333333] print:bg-white print:m-0">
      
      {/* ⚠️ MODALE LOGIN (Stile Argo) */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-8 max-w-sm w-full shadow-2xl border-t-4 border-[#1bc3c0]">
            <div className="text-center mb-6">
                <svg className="w-12 h-12 text-[#1bc3c0] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                <h3 className="text-xl font-bold text-[#333333]">Accesso Profilo</h3>
                <p className="text-sm text-gray-500 mt-1">Area Riservata Responsabili</p>
            </div>
            
            <div className="space-y-4">
                <input 
                  type="email" 
                  placeholder="Email istituzionale" 
                  className="w-full px-3 py-2 bg-white border border-gray-300 focus:outline-none focus:border-[#1bc3c0] transition-colors"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoFocus
                />
                <input 
                  type="password" 
                  placeholder="Password" 
                  className="w-full px-3 py-2 bg-white border border-gray-300 focus:outline-none focus:border-[#1bc3c0] transition-colors"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
            </div>

            <div className="flex gap-2 mt-8">
              <button onClick={() => setShowLoginModal(false)} className="flex-1 px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 font-semibold text-sm transition-colors uppercase">Annulla</button>
              <button onClick={handleLogin} className="flex-1 bg-[#8cc63f] hover:bg-[#7cb036] text-white py-2 font-semibold text-sm transition-colors uppercase">Accedi</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER BIANCO STILE PORTALE ARGO */}
      <div className="bg-white border-b border-gray-200 shadow-sm print:hidden sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          
          {/* Logo e Titolo (Sinistra) */}
          <div className="flex items-center gap-3">
            <img src="/logo alberghiero.png" alt="Logo" className="h-10 w-auto object-contain" onError={(e)=>{e.target.style.display='none'}} />
            <div className="flex flex-col">
              <h2 className="text-xl font-bold text-gray-600 tracking-tight leading-none mb-0.5">
                Scuola<span className="text-[#1bc3c0]">Manager</span> Pro
              </h2>
              <div className="text-[10px] font-bold text-[#8cc63f] uppercase tracking-wider">
                {userRole.plesso !== 'NESSUNO' ? `Plesso: ${userRole.plesso}` : 'Gestione Sostituzioni'}
              </div>
            </div>
          </div>

          {/* Intestazione Scuola (Destra) */}
          <div className="hidden md:flex flex-col text-right">
             <span className="text-sm font-bold text-[#333333] uppercase tracking-wide">I.P.S.S.A.T. Rocco Chinnici</span>
             <span className="text-xs text-gray-500">Nicolosi • Pedara • Trecastagni • S.M. di Licodia • Paternò</span>
          </div>
        </div>
        
        {/* MENU TABS SQUADRATO */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-1 flex flex-col md:flex-row justify-between md:items-end gap-2 border-t border-gray-100 pt-2">
            
            <div className="flex gap-1 overflow-x-auto w-full md:w-auto">
                <button onClick={() => setActiveTab('DASHBOARD')} className={`px-5 py-2.5 font-semibold text-sm transition-colors border-b-[3px] ${activeTab === 'DASHBOARD' ? 'border-[#1bc3c0] text-[#1bc3c0] bg-[#1bc3c0]/5' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}>Sostituzioni del Giorno</button>
                <button onClick={() => setActiveTab('ASSEMBLEE')} className={`px-5 py-2.5 font-semibold text-sm transition-colors border-b-[3px] ${activeTab === 'ASSEMBLEE' ? 'border-[#1bc3c0] text-[#1bc3c0] bg-[#1bc3c0]/5' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}>Gestione Assemblee</button>
                <button onClick={() => setActiveTab('STORICO')} className={`px-5 py-2.5 font-semibold text-sm transition-colors border-b-[3px] ${activeTab === 'STORICO' ? 'border-[#1bc3c0] text-[#1bc3c0] bg-[#1bc3c0]/5' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}>Archivio Storico</button>
                {userRole.type === 'VICEPRESIDENZA' && (
                  <button onClick={() => setActiveTab('DATABASE')} className={`px-5 py-2.5 font-semibold text-sm transition-colors border-b-[3px] ${activeTab === 'DATABASE' ? 'border-[#1bc3c0] text-[#1bc3c0] bg-[#1bc3c0]/5' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}>Database Orari</button>
                )}
            </div>

            <div className="pb-2">
               {userRole.type === 'GUEST' ? (
                  <button onClick={() => setShowLoginModal(true)} className="flex items-center gap-2 text-sm bg-[#1bc3c0] hover:bg-[#15a5a2] text-white font-semibold px-4 py-2 rounded-sm transition-colors shadow-sm uppercase tracking-wide">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>
                    Accedi al Profilo
                  </button>
              ) : (
                  <div className="flex items-center gap-4 bg-gray-50 px-4 py-2 rounded-sm border border-gray-200">
                      <span className="text-sm font-semibold text-gray-700 hidden lg:block">Utente: <span className="text-[#1bc3c0]">{userRole.nome}</span></span>
                      <button onClick={handleLogout} className="text-gray-500 hover:text-red-500 text-xs font-bold transition-colors uppercase tracking-wide">Esci</button>
                  </div>
              )}
            </div>
        </div>
      </div>

      {/* CONTENITORE PRINCIPALE */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 print:p-0">
        
        {activeTab === 'DASHBOARD' && (
          <div className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6 print:hidden">
              
              {/* PANNELLO SINISTRO: ASSENTI */}
              <div className="lg:col-span-1 bg-white p-5 shadow-sm border border-gray-200 h-fit rounded-sm">
                <div className="flex items-center gap-2 mb-5 pb-3 border-b border-gray-100">
                    <div className="w-8 h-8 rounded-full bg-[#1bc3c0] text-white flex items-center justify-center font-bold text-sm">1</div>
                    <h2 className="text-lg font-bold text-[#333333]">Docenti Assenti</h2>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Giorno di Lavoro</label>
                    <select className="w-full bg-white border border-gray-300 text-gray-800 p-2 focus:outline-none focus:border-[#1bc3c0] transition-colors text-sm" value={targetDay} onChange={(e) => setTargetDay(e.target.value)}>
                      <option value="LUNEDI">Lunedì</option><option value="MARTEDI">Martedì</option><option value="MERCOLEDI">Mercoledì</option>
                      <option value="GIOVEDI">Giovedì</option><option value="VENERDI">Venerdì</option><option value="SABATO">Sabato</option>
                    </select>
                  </div>
                  
                  {userRole.type !== 'GUEST' ? (
                  <div className="bg-gray-50 p-3 border border-gray-200 rounded-sm">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Aggiungi Assenza (Cognome)</label>
                    <div className="flex flex-col gap-3">
                        <input type="text" placeholder="Es. ROSSI" className="w-full bg-white border border-gray-300 p-2 text-sm uppercase focus:outline-none focus:border-[#1bc3c0]" value={absentInput} onChange={(e) => setAbsentInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAbsentTeacher()}/>
                        
                        <div className="flex bg-white border border-gray-300 rounded-sm overflow-hidden">
                            <button onClick={() => setAbsenceMode('INTERA')} className={`flex-1 text-xs py-1.5 font-semibold ${absenceMode === 'INTERA' ? 'bg-[#1bc3c0] text-white' : 'text-gray-500 hover:bg-gray-100'}`}>Tutto il giorno</button>
                            <button onClick={() => setAbsenceMode('PARZIALE')} className={`flex-1 text-xs py-1.5 font-semibold ${absenceMode === 'PARZIALE' ? 'bg-[#1bc3c0] text-white' : 'text-gray-500 hover:bg-gray-100'}`}>Permesso Orario</button>
                        </div>

                        {absenceMode === 'PARZIALE' && (
                            <div className="bg-white p-2 border border-[#1bc3c0] rounded-sm">
                                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">Seleziona le ore di assenza:</p>
                                <div className="flex flex-wrap gap-1">
                                    {FASCIE_ORARIE_STANDARD.map(f => (
                                        <button 
                                            key={f.orario}
                                            onClick={() => togglePartialHour(f.orario)}
                                            className={`px-2 py-1 text-xs font-bold rounded-sm border ${selectedPartialHours.includes(f.orario) ? 'bg-[#1bc3c0] text-white border-[#1bc3c0]' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}
                                        >
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button onClick={addAbsentTeacher} className="w-full bg-[#1bc3c0] hover:bg-[#15a5a2] text-white p-2 text-sm font-bold uppercase transition-colors rounded-sm">
                            Registra Assenza
                        </button>
                    </div>
                  </div>
                  ) : (
                    <div className="p-3 bg-orange-50 border border-orange-200 text-orange-800 text-xs font-semibold">
                      Effettua l'accesso istituzionale per registrare le assenze.
                    </div>
                  )}
                  
                  {absentTeachers.length > 0 && (
                      <div className="mt-4">
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Registro Assenze Odierne:</label>
                          <div className="flex flex-col gap-2">
                              {absentTeachers.map(t => (
                                  <div key={t.id} className="bg-white border border-red-200 flex flex-col p-2 rounded-sm relative">
                                      <div className="flex justify-between items-start">
                                          <span className="font-bold text-red-600 text-sm">{t.nome}</span>
                                          <button onClick={()=>removeAbsentTeacher(t.id)} className="text-red-400 hover:text-red-700 text-lg leading-none font-bold">&times;</button>
                                      </div>
                                      <span className="text-[10px] font-semibold text-gray-500 mt-0.5">
                                          {t.tipo === 'INTERA' ? 'Tutto il giorno' : `Permesso: ${t.ore.map(o => FASCIE_ORARIE_STANDARD.find(f => f.orario === o)?.label).sort().join(', ')}`}
                                      </span>
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}
                </div>
              </div>

              {/* PANNELLO CENTRALE/DESTRA: TABELLONE ORE */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Modale Ricerca Candidato */}
                {activeSlotSearch && (
                   <div className="bg-white p-5 shadow-lg border-l-4 border-[#1bc3c0] relative mb-4">
                       <div className="flex justify-between items-start mb-4">
                           <div>
                               <h3 className="font-bold text-[#333333] text-lg">Trova sostituto per: {activeSlotSearch.docente}</h3>
                               <p className="text-sm text-gray-500">Ora: {activeSlotSearch.ora} | Classe: <span className="font-bold text-gray-700">{activeSlotSearch.classe}</span></p>
                           </div>
                           <button onClick={()=>setActiveSlotSearch(null)} className="text-gray-400 hover:text-gray-600 font-bold text-xl">&times;</button>
                       </div>
                       
                       <div className="max-h-[250px] overflow-y-auto border border-gray-200">
                         <table className="min-w-full text-left text-sm">
                           <thead className="bg-gray-100 sticky top-0 border-b border-gray-200">
                             <tr>
                               <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Candidato</th>
                               <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Priorità (Motivazione)</th>
                               <th className="px-3 py-2"></th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-gray-100 bg-white">
                             {candidates.map((c, i) => (
                               <tr key={i} className="hover:bg-gray-50">
                                 <td className="px-3 py-2 font-semibold text-[#333333]">{c.docente}</td>
                                 <td className="px-3 py-2">
                                     <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide
                                        ${c.score === 100 ? 'bg-green-100 text-green-800 border border-green-200' : 
                                          c.score === 80 ? 'bg-cyan-100 text-cyan-800 border border-cyan-200' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                                         {c.motivazione}
                                     </span>
                                 </td>
                                 <td className="px-3 py-2 text-right">
                                     <button onClick={() => assignSubstitute(c)} className="bg-[#8cc63f] hover:bg-[#7cb036] text-white text-xs font-bold uppercase px-3 py-1.5 transition-colors shadow-sm">Assegna</button>
                                 </td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       </div>
                   </div>
                )}

                <div className="bg-white p-5 shadow-sm border border-gray-200 rounded-sm">
                   <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
                       <div className="w-8 h-8 rounded-full bg-[#1bc3c0] text-white flex items-center justify-center font-bold text-sm">2</div>
                       <h2 className="text-lg font-bold text-[#333333]">Tabellone Ore Scoperte ({targetDay})</h2>
                   </div>
                   
                   {absentTeachers.length === 0 ? (
                       <div className="py-8 text-center text-gray-400 bg-gray-50 border border-dashed border-gray-300 text-sm font-semibold">
                           Nessuna assenza registrata in lista.
                       </div>
                   ) : getUncoveredSlots().length === 0 ? (
                       <div className="bg-green-50 border border-green-200 p-5 text-center text-green-800">
                           <h4 className="font-bold text-base">✅ Tutte le ore di {targetDay} per {userRole.plesso === 'TUTTI' ? "l'Istituto" : userRole.plesso} sono coperte!</h4>
                       </div>
                   ) : (
                       <div className="overflow-x-auto border border-gray-200">
                           <table className="min-w-full text-left text-sm whitespace-nowrap">
                               <thead className="bg-gray-100 border-b border-gray-200">
                                   <tr>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase">Fascia Oraria</th>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase">Docente Assente</th>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase">Classe / Sede</th>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase text-right">Sostituto</th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-gray-100 bg-white">
                                   {getUncoveredSlots().sort((a,b) => a.ora.localeCompare(b.ora)).map(slot => (
                                       <tr key={slot.id} className="hover:bg-[#f9fafb]">
                                           <td className="px-3 py-2.5 font-semibold text-gray-700">{slot.ora}</td>
                                           <td className="px-3 py-2.5 font-bold text-red-600">{slot.docente}</td>
                                           <td className="px-3 py-2.5">
                                              <span className="font-bold text-[#333333]">{slot.classe}</span>
                                              <span className="ml-2 text-[10px] text-gray-500 uppercase tracking-wide">({slot.plesso})</span>
                                           </td>
                                           <td className="px-3 py-2.5 text-right">
                                               {userRole.type !== 'GUEST' ? (
                                                  <button onClick={() => openCandidateSearch(slot)} className="text-[#1bc3c0] border border-[#1bc3c0] hover:bg-[#1bc3c0] hover:text-white text-xs font-bold uppercase px-3 py-1 transition-colors">Trova</button>
                                               ) : (
                                                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 uppercase font-bold">Lettura</span>
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
            
            {/* PANNELLO INFERIORE: RESOCONTO */}
            <div className="bg-white p-5 shadow-sm border border-gray-200 rounded-sm print:shadow-none print:border-none print:p-0">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-5 print:hidden pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                       <div className="w-8 h-8 rounded-full bg-[#1bc3c0] text-white flex items-center justify-center font-bold text-sm">3</div>
                       <h2 className="text-lg font-bold text-[#333333]">Resoconto Ufficiale Sostituzioni</h2>
                    </div>
                    <button onClick={() => window.print()} className="mt-3 sm:mt-0 bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 text-xs font-bold uppercase flex items-center gap-2 transition-colors shadow-sm">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                        Stampa / PDF
                    </button>
                </div>

                <div className="hidden print:block mb-6 text-center border-b border-gray-300 pb-3">
                    <h1 className="text-xl font-bold uppercase text-black">Resoconto Giornaliero Sostituzioni</h1>
                    <p className="text-sm mt-1 text-gray-700 capitalize">{targetDay}, {getDataFormattata()} — Plesso: {userRole.plesso}</p>
                </div>

                {substitutionsLog.length === 0 ? (
                    <div className="py-6 text-center text-gray-400 text-sm font-semibold print:hidden">
                        Nessuna sostituzione registrata al momento.
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-gray-200 print:border-none">
                        <table className="min-w-full text-left text-sm print:text-xs">
                            <thead className="bg-gray-100 text-gray-700 print:bg-white print:border-b-2 print:border-black">
                                <tr>
                                    <th className="px-3 py-2 font-bold text-xs uppercase border-r border-gray-200 print:border-black">Assente</th>
                                    <th className="px-3 py-2 font-bold text-xs uppercase border-r border-gray-200 print:border-black">Ora</th>
                                    <th className="px-3 py-2 font-bold text-xs uppercase border-r border-gray-200 print:border-black">Classe</th>
                                    <th className="px-3 py-2 font-bold text-xs uppercase text-[#1bc3c0] border-r border-gray-200 print:border-black print:text-black">Sostituto</th>
                                    <th className="px-3 py-2 font-bold text-xs uppercase border-r border-gray-200 print:border-black">Modalità</th>
                                    <th className="px-3 py-2 font-bold text-xs uppercase text-center print:hidden">Avvisa Docente</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white print:divide-black">
                                {substitutionsLog.sort((a,b) => a.docente_assente.localeCompare(b.docente_assente) || a.ora.localeCompare(b.ora)).map(log => (
                                    <tr key={log.id} className="print:break-inside-avoid hover:bg-gray-50">
                                        <td className="px-3 py-2 border-r border-gray-200 font-bold text-red-600 print:border-black print:text-black">{log.docente_assente}</td>
                                        <td className="px-3 py-2 border-r border-gray-200 font-semibold print:border-black">{log.ora}</td>
                                        <td className="px-3 py-2 border-r border-gray-200 print:border-black">
                                          <span className="font-bold">{log.classe}</span>
                                          <span className="ml-1 text-[9px] text-gray-500 uppercase tracking-wide">{log.plesso}</span>
                                        </td>
                                        <td className="px-3 py-2 border-r border-gray-200 font-bold text-green-700 print:border-black print:text-black">{log.docente_sostituto}</td>
                                        <td className="px-3 py-2 border-r border-gray-200 text-xs font-semibold text-gray-600 print:border-black print:text-black">{log.modalita}</td>
                                        <td className="px-2 py-2 text-center print:hidden flex justify-center gap-1.5 items-center">
                                            <button onClick={()=>inviaNotificaVirtual(log, 'wa')} className="bg-[#25D366] text-white hover:bg-[#128C7E] px-2 py-1 text-[10px] font-bold uppercase transition-colors" title="WhatsApp Web">WA</button>
                                            <button onClick={()=>inviaNotificaVirtual(log, 'copy')} className="bg-gray-200 text-gray-700 hover:bg-gray-300 px-2 py-1 text-[10px] font-bold uppercase transition-colors" title="Copia Testo">Copia</button>
                                            <button onClick={() => setSubstitutionsLog(substitutionsLog.filter(l => l.id !== log.id))} className="text-gray-400 hover:text-red-500 ml-2" title="Annulla"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                
                <div className="hidden print:flex justify-between mt-16">
                    <div className="text-center w-56 border-t border-black pt-1">
                        <span className="block text-xs font-bold uppercase">Il Responsabile di Plesso</span>
                        <span className="text-xs italic text-gray-700 mt-1 block">{userRole.nome}</span>
                    </div>
                    <div className="text-center w-56 border-t border-black pt-1">
                        <span className="block text-xs font-bold uppercase">La Dirigenza</span>
                        <span className="text-xs italic text-gray-700 mt-1 block">Istituto IPSAT Rocco Chinnici</span>
                    </div>
                </div>
                {substitutionsLog.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-3 print:hidden">💡 Nota: Il pulsante "WA" apre WhatsApp Web/Mobile precompilando il messaggio per il docente.</p>
                )}
            </div>

          </div>
        )}

        {/* TAB GESTIONE ASSEMBLEE SINDACALI */}
        {activeTab === 'ASSEMBLEE' && (
          <div className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6 print:hidden">
              
              {/* SETUP ASSEMBLEA */}
              <div className="lg:col-span-1 bg-white p-5 shadow-sm border border-gray-200 h-fit rounded-sm">
                <div className="flex items-center gap-2 mb-5 pb-3 border-b border-gray-100">
                    <div className="w-8 h-8 rounded-sm bg-[#1bc3c0] text-white flex items-center justify-center font-bold text-sm">A</div>
                    <h2 className="text-lg font-bold text-[#333333]">Dati Assemblea</h2>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Giorno Assemblea</label>
                    <select className="w-full bg-white border border-gray-300 text-gray-800 p-2 focus:outline-none focus:border-[#1bc3c0] transition-colors text-sm" value={assemblyDay} onChange={(e) => setAssemblyDay(e.target.value)}>
                      <option value="LUNEDI">Lunedì</option><option value="MARTEDI">Martedì</option><option value="MERCOLEDI">Mercoledì</option>
                      <option value="GIOVEDI">Giovedì</option><option value="VENERDI">Venerdì</option><option value="SABATO">Sabato</option>
                    </select>
                  </div>
                  
                  <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Seleziona Ore (Durata)</label>
                      <div className="flex flex-wrap gap-1.5">
                          {FASCIE_ORARIE_STANDARD.map(f => (
                              <button 
                                  key={f.orario} onClick={() => toggleAssemblyHour(f.orario)}
                                  className={`px-3 py-1.5 text-xs font-bold rounded-sm border ${assemblyHours.includes(f.orario) ? 'bg-[#8cc63f] text-white border-[#8cc63f]' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}
                              >
                                  {f.label}
                              </button>
                          ))}
                      </div>
                  </div>

                  <div className="bg-gray-50 p-3 border border-gray-200 rounded-sm mt-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Aggiungi Docenti Aderenti</label>
                    <div className="flex gap-2">
                        <input type="text" placeholder="Es. ROSSI" className="w-full bg-white border border-gray-300 p-2 text-sm uppercase focus:outline-none focus:border-[#1bc3c0]" value={assemblyTeacherInput} onChange={(e) => setAssemblyTeacherInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAssemblyTeacher()}/>
                        <button onClick={addAssemblyTeacher} className="bg-[#1bc3c0] hover:bg-[#15a5a2] text-white px-4 py-2 font-bold transition-colors rounded-sm">+</button>
                    </div>
                  </div>
                  
                  {assemblyTeachersList.length > 0 && (
                      <div className="mt-2">
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Lista Aderenti ({assemblyTeachersList.length}):</label>
                          <div className="flex flex-wrap gap-2">
                              {assemblyTeachersList.map(t => (
                                  <span key={t} className="bg-white border border-gray-300 pl-2 pr-1 py-1 text-xs font-bold text-[#333333] flex items-center gap-2 rounded-sm shadow-sm">
                                      {t}
                                      <button onClick={()=>removeAssemblyTeacher(t)} className="text-gray-400 hover:text-red-500 text-sm font-bold bg-gray-100 rounded-sm px-1.5 leading-none">&times;</button>
                                  </span>
                              ))}
                          </div>
                      </div>
                  )}
                </div>
              </div>

              {/* REPORT IMPATTO CLASSI */}
              <div className="lg:col-span-2">
                <div className="bg-white p-5 shadow-sm border border-gray-200 rounded-sm print:shadow-none print:border-none print:p-0">
                   <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 pb-2 border-b border-gray-100 print:hidden">
                       <div className="flex items-center gap-2">
                           <div className="w-8 h-8 rounded-sm bg-[#1bc3c0] text-white flex items-center justify-center font-bold text-sm">B</div>
                           <h2 className="text-lg font-bold text-[#333333]">Risoluzione Impatto sulle Classi</h2>
                       </div>
                       <button onClick={() => window.print()} className="mt-3 sm:mt-0 bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 text-xs font-bold uppercase flex items-center gap-2 transition-colors shadow-sm">
                          Stampa Circolare
                       </button>
                   </div>

                   <div className="hidden print:block mb-6 text-center border-b border-gray-300 pb-3">
                      <h1 className="text-xl font-bold uppercase text-black">Variazione Orario - Assemblea Sindacale</h1>
                      <p className="text-sm mt-1 text-gray-700 capitalize">Giorno: {assemblyDay} — Plesso: {userRole.plesso}</p>
                   </div>

                   {assemblyHours.length === 0 || assemblyTeachersList.length === 0 ? (
                       <div className="py-8 text-center text-gray-400 bg-gray-50 border border-dashed border-gray-300 text-sm font-semibold">
                           Imposta gli orari dell'assemblea e aggiungi almeno un docente per visualizzare il report.
                       </div>
                   ) : getAssemblyImpact().length === 0 ? (
                       <div className="bg-green-50 border border-green-200 p-5 text-center text-green-800">
                           <h4 className="font-bold text-base">Nessuna classe del tuo plesso è impattata da questa assemblea!</h4>
                       </div>
                   ) : (
                       <div className="overflow-x-auto border border-gray-200 print:border-none">
                           <table className="min-w-full text-left text-sm print:text-xs">
                               <thead className="bg-gray-100 border-b border-gray-200 print:bg-white print:border-b-2 print:border-black">
                                   <tr>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase print:border-r print:border-black">Classe</th>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase print:border-r print:border-black">Ora</th>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase print:border-r print:border-black">Docente Aderente</th>
                                       <th className="px-3 py-2.5 font-bold text-gray-600 text-xs uppercase print:border-black">Decisione Sistema</th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-gray-100 bg-white print:divide-gray-300">
                                   {getAssemblyImpact().map((slot, index) => (
                                       <tr key={index} className="hover:bg-[#f9fafb] print:break-inside-avoid">
                                           <td className="px-3 py-2.5">
                                              <span className="font-bold text-[#333333] text-base">{slot.classe}</span>
                                              <span className="ml-2 text-[10px] text-gray-500 uppercase tracking-wide print:hidden">({slot.plesso})</span>
                                           </td>
                                           <td className="px-3 py-2.5 font-semibold text-gray-700">{slot.ora}</td>
                                           <td className="px-3 py-2.5 font-bold text-gray-600">{slot.docente}</td>
                                           <td className="px-3 py-2.5">
                                               {slot.status === 'REGOLARE' ? (
                                                  <div className="text-green-700 font-bold text-xs bg-green-50 p-1.5 border border-green-200 print:border-none print:bg-transparent print:p-0">
                                                      ✅ {slot.note}
                                                  </div>
                                               ) : (
                                                  <div className="text-red-700 font-bold text-xs bg-red-50 p-1.5 border border-red-200 print:border-none print:bg-transparent print:p-0">
                                                      ⚠️ {slot.note}
                                                  </div>
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
          </div>
        )}

        {/* TAB ARCHIVIO STORICO */}
        {activeTab === 'STORICO' && (
          <div className="bg-white shadow-sm border border-gray-200 p-5 min-h-[50vh] rounded-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5 border-b border-gray-100 pb-3">
              <div>
                <h2 className="text-lg font-bold text-[#333333]">Archivio Sostituzioni</h2>
                <p className="text-gray-500 text-xs mt-0.5 font-semibold">Salvataggio permanente su Cloud Firebase</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-gray-500 uppercase">Data:</label>
                <input 
                  type="date" 
                  className="border border-gray-300 p-1.5 text-sm focus:outline-none focus:border-[#1bc3c0] font-semibold" 
                  value={selectedHistoryDate} 
                  onChange={(e) => setSelectedHistoryDate(e.target.value)}
                />
              </div>
            </div>

            {historicalLogs.length === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm font-semibold border border-dashed border-gray-200">Nessun record presente in archivio.</div>
            ) : (
              <div className="overflow-x-auto border border-gray-200">
                <table className="min-w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-100 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Data</th>
                      <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Plesso</th>
                      <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Assente</th>
                      <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Ora / Classe</th>
                      <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Sostituto</th>
                      <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Firma / Mod.</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {historicalLogs
                      .filter(log => !selectedHistoryDate || log.dataISO === selectedHistoryDate)
                      .map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-600 font-semibold">{log.dataISO}</td>
                          <td className="px-3 py-2 font-bold text-[#333333] text-xs">{log.plesso}</td>
                          <td className="px-3 py-2 font-bold text-red-600">{log.docente_assente}</td>
                          <td className="px-3 py-2 font-semibold text-gray-800">{log.ora} <span className="font-bold ml-1">{log.classe}</span></td>
                          <td className="px-3 py-2 font-bold text-green-700">{log.docente_sostituto}</td>
                          <td className="px-3 py-2 text-[10px] text-gray-500 font-semibold tracking-wide">
                             <div className="uppercase">{log.modalita}</div>
                             <div className="text-gray-400 mt-0.5">{log.responsabile_firma}</div>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB DATABASE ORARI (SOLO ADMIN) */}
        {activeTab === 'DATABASE' && userRole.type === 'VICEPRESIDENZA' && (
          <div className="bg-white shadow-sm border border-gray-200 min-h-[50vh] rounded-sm">
            <div className="bg-gray-800 p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b-4 border-[#1bc3c0]">
              <div>
                 <h2 className="text-lg font-bold text-white">Gestore Database Orari</h2>
                 <p className="text-gray-400 text-xs mt-0.5 font-semibold">{dbMessage || "Pannello Amministratore Cloud"}</p>
              </div>
              <button onClick={() => { if(confirm("ATTENZIONE: Eliminare l'intero database orari?")) svuotaDatabaseAssoluto() }} className="px-4 py-1.5 border border-red-500 text-red-400 hover:bg-red-500 hover:text-white text-xs font-bold uppercase transition-colors">Svuota Database</button>
            </div>

            <div className="p-5">
                <div className="flex border-b border-gray-200 mb-5">
                    <button onClick={() => { setDbRuoloTab('CURRICULARE'); setCurrentPage(1); }} className={`px-4 py-2 font-bold text-xs uppercase transition-colors border-b-2 ${dbRuoloTab === 'CURRICULARE' ? 'border-[#1bc3c0] text-[#1bc3c0]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                        Curriculari <span className="ml-1 bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">{scheduleDB.filter(r => r.ruolo === 'CURRICULARE').length}</span>
                    </button>
                    <button onClick={() => { setDbRuoloTab('SOSTEGNO'); setCurrentPage(1); }} className={`px-4 py-2 font-bold text-xs uppercase transition-colors border-b-2 ${dbRuoloTab === 'SOSTEGNO' ? 'border-[#8cc63f] text-[#8cc63f]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                        Sostegno <span className="ml-1 bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">{scheduleDB.filter(r => r.ruolo === 'SOSTEGNO').length}</span>
                    </button>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-6">
                    <label className="border border-dashed border-gray-300 p-5 bg-gray-50 text-center hover:bg-gray-100 cursor-pointer transition-colors">
                        <div className="font-bold text-gray-700 text-sm">Carica CSV Curriculari</div>
                        <p className="text-[10px] font-semibold text-gray-500 uppercase mt-1">Sovrascrive il DB esistente</p>
                        <input type="file" accept=".csv" disabled={isSyncing} className="hidden" onChange={(e) => handleFileUpload(e, 'CURRICULARE')} />
                    </label>
                    <label className="border border-dashed border-gray-300 p-5 bg-gray-50 text-center hover:bg-gray-100 cursor-pointer transition-colors">
                        <div className="font-bold text-gray-700 text-sm">Carica CSV Sostegno</div>
                        <p className="text-[10px] font-semibold text-gray-500 uppercase mt-1">Aggiunge al DB esistente</p>
                        <input type="file" accept=".csv" disabled={isSyncing} className="hidden" onChange={(e) => handleFileUpload(e, 'SOSTEGNO')} />
                    </label>
                </div>

                <div className="flex flex-col md:flex-row gap-3 mb-5">
                    <input type="text" placeholder={`Cerca in ${dbRuoloTab.toLowerCase()}...`} className="flex-1 px-3 py-2 bg-white border border-gray-300 text-sm focus:outline-none focus:border-[#1bc3c0] uppercase" value={dbSearchTerm} onChange={(e) => { setDbSearchTerm(e.target.value.toUpperCase()); setCurrentPage(1); }} />
                    {dbSearchTerm && (
                        <button onClick={() => {
                            const existingContact = contactsDB[dbSearchTerm] || { email: '', telefono: '' };
                            setContactForm(existingContact);
                            setEditingContact(true);
                        }} className="px-4 py-2 bg-gray-700 text-white font-bold text-xs uppercase hover:bg-gray-800 transition-colors">
                            Rubrica {dbSearchTerm}
                        </button>
                    )}
                </div>

                {editingContact && (
                    <div className="mb-5 p-4 bg-gray-50 border border-gray-200">
                        <h3 className="font-bold text-[#333333] mb-2 text-sm uppercase">Contatti: {dbSearchTerm}</h3>
                        <div className="flex gap-2">
                            <input type="email" className="flex-1 p-2 bg-white border border-gray-300 text-sm focus:outline-none focus:border-[#1bc3c0]" value={contactForm.email} onChange={e=>setContactForm({...contactForm, email:e.target.value})} placeholder="Email"/>
                            <input type="text" className="flex-1 p-2 bg-white border border-gray-300 text-sm focus:outline-none focus:border-[#1bc3c0]" value={contactForm.telefono} onChange={e=>setContactForm({...contactForm, telefono:e.target.value})} placeholder="Cellulare (+39...)"/>
                            <button onClick={() => saveContactsToCloud({ ...contactsDB, [dbSearchTerm]: contactForm })} className="px-4 py-2 bg-[#8cc63f] text-white text-xs font-bold uppercase transition-colors">Salva</button>
                            <button onClick={() => setEditingContact(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-xs font-bold uppercase transition-colors bg-white">Annulla</button>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto border border-gray-200">
                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-gray-100 border-b border-gray-200">
                            <tr>
                                <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Docente</th>
                                <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Giorno / Ora</th>
                                <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Classe</th>
                                <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Plesso Assegnato</th>
                                <th className="px-3 py-2 text-right"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {paginatedDbRows.map((row) => (
                                <tr key={row.id} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 font-bold text-[#333333]">
                                        {row.docente} {contactsDB[row.docente] && <span className="text-[10px] text-[#25D366] ml-1" title="Contatto in rubrica">💬</span>}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600 font-semibold">{row.giorno} <span className="text-gray-400 ml-1">({row.ora})</span></td>
                                    <td className="px-3 py-2 font-bold cursor-pointer" onClick={() => startEditingClass(row)}>
                                        {editingRow === row.id ? (
                                            <input type="text" className="border border-[#1bc3c0] px-2 py-0.5 w-24 text-sm uppercase focus:outline-none" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => saveEditedClass(row.id)} onKeyDown={(e) => e.key === 'Enter' && saveEditedClass(row.id)} autoFocus />
                                        ) : (
                                            <span className="text-[#1bc3c0] hover:underline" title="Clicca per modificare">{row.classe}</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide">{row.plesso}</td>
                                    <td className="px-3 py-2 text-right">
                                        <button onClick={() => { if(confirm("Eliminare questa ora dal database?")) saveDatabaseToCloud(scheduleDB.filter(item => item.id !== row.id)) }} className="text-red-400 hover:text-red-600 text-xs font-bold uppercase transition-colors">Elimina</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div className="flex justify-between items-center mt-4">
                        <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="px-3 py-1 bg-gray-100 text-gray-600 font-bold text-xs uppercase disabled:opacity-50">Indietro</button>
                        <span className="text-xs font-semibold text-gray-500 uppercase">Pagina {currentPage} di {totalPages}</span>
                        <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-100 text-gray-600 font-bold text-xs uppercase disabled:opacity-50">Avanti</button>
                    </div>
                )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}