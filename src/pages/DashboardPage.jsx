import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebaseConfig';
import { logout } from '../services/authService';
import { MAPPA_CLASSI_PLESSI } from '../data/schoolConfig';
import logoApp from '../assets/logo-scuola-manager-pro.png';
import logoChinnici from '../assets/logo_chinnici.png';

const appId = 'orario-scuola-demo'; 
const FASCIE_ORARIE_STANDARD = [
  { label: '1ª', orario: '08:00-08:50' }, { label: '2ª', orario: '08:50-09:40' },
  { label: '3ª', orario: '09:40-10:40' }, { label: '4ª', orario: '10:40-11:40' },
  { label: '5ª', orario: '11:40-12:40' }, { label: '6ª', orario: '12:40-13:30' },
  { label: '7ª', orario: '13:30-14:20' }
];

export default function DashboardPage({ user, userRole }) {
  const [activeTab, setActiveTab] = useState('DASHBOARD');
  const [scheduleDB, setScheduleDB] = useState([]);
  const [contactsDB, setContactsDB] = useState({});
  const [isSyncing, setIsSyncing] = useState(false);

  // === STATI DASHBOARD & ASSENZE ===
  const [targetDateStr, setTargetDateStr] = useState(new Date().toISOString().split('T')[0]);
  const [absentInput, setAbsentInput] = useState('');
  const [absenceMode, setAbsenceMode] = useState('INTERA'); 
  const [selectedPartialHours, setSelectedPartialHours] = useState([]);
  const [absentTeachers, setAbsentTeachers] = useState([]);
  const [substitutionsLog, setSubstitutionsLog] = useState([]);
  const [activeSlotSearch, setActiveSlotSearch] = useState(null);
  const [candidates, setCandidates] = useState([]);

  // === STATI ASSEMBLEE ===
  const [assembliesDB, setAssembliesDB] = useState([]);
  const [assemblyTeacherInput, setAssemblyTeacherInput] = useState('');
  const [assemblyDateStr, setAssemblyDateStr] = useState(new Date().toISOString().split('T')[0]);

  // === STATI STORICO ===
  const [historicalLogs, setHistoricalLogs] = useState([]);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(new Date().toISOString().split('T')[0]);

  // === STATI DATABASE ORARI ===
  const [dbMessage, setDbMessage] = useState('');
  const [dbSearchTerm, setDbSearchTerm] = useState('');
  const [dbRuoloTab, setDbRuoloTab] = useState('CURRICULARE'); 
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;
  const [editingRow, setEditingRow] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ email: '', telefono: '' });

  // === FUNZIONI DI SUPPORTO ===
  const determinaPlessoDaClasse = (classeStr) => {
    if (!classeStr) return null;
    const classeClean = classeStr.toUpperCase().replace(/\s+/g, '');
    for (const [plesso, classiArray] of Object.entries(MAPPA_CLASSI_PLESSI)) {
      for (const sigla of classiArray) {
        if (classeClean.includes(sigla.toUpperCase().replace(/\s+/g, ''))) return plesso;
      }
    }
    return null; 
  };

  const getDayName = (dateString) => {
    const d = new Date(dateString);
    const days = ['DOMENICA', 'LUNEDI', 'MARTEDI', 'MERCOLEDI', 'GIOVEDI', 'VENERDI', 'SABATO'];
    return days[d.getDay()];
  };
  const targetDay = getDayName(targetDateStr);
  const assemblyDay = getDayName(assemblyDateStr);

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

  const formatDataEstesa = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  // === INTESTAZIONE STAMPA CONDIVISA ===
  const renderPrintHeader = () => (
    <div className="hidden print:flex justify-between items-start mb-8 border-b-2 border-black pb-4">
        <div className="flex items-center gap-4">
            <img src={logoChinnici} alt="Logo Scuola" className="h-24 w-24 object-contain" />
            <div className="text-left">
                <h1 className="text-md font-bold uppercase leading-tight font-serif">
                    ISTITUTO PROFESSIONALE DI STATO PER I SERVIZI<br/>
                    ALBERGHIERI E TURISTICI<br/>
                    "Rocco Chinnici"<br/>
                    Nicolosi
                </h1>
            </div>
        </div>
        <div className="flex items-center gap-3 text-right">
            <div>
                <h2 className="text-lg font-bold text-teal-600">ScuolaManager Pro</h2>
                <p className="text-xs text-gray-500 uppercase">{userRole?.plesso !== 'NESSUNO' ? `Plesso: ${userRole?.plesso}` : 'Sostituzioni'}</p>
            </div>
            <img src={logoApp} alt="Logo App" className="h-14 w-14 object-contain rounded-md shadow-sm" />
        </div>
    </div>
  );

  // === FIREBASE INITIAL LOAD ===
  useEffect(() => {
    const loadData = async () => {
      setIsSyncing(true);
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
              if(chunkSnap.exists()) fullDb = [...fullDb, ...JSON.parse(chunkSnap.data().data)];
            }
          }
        }
        setScheduleDB(fullDb);

        const contactsRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'contatti_master');
        const contactsSnap = await getDoc(contactsRef);
        if (contactsSnap.exists()) setContactsDB(contactsSnap.data().directory || {});

        const absRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'assenze_master');
        const absSnap = await getDoc(absRef);
        if(absSnap.exists()) setAbsentTeachers(absSnap.data().assenze || []);

        const asmRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'assemblee_master');
        const asmSnap = await getDoc(asmRef);
        if(asmSnap.exists()) setAssembliesDB(asmSnap.data().assemblee || []);

        const histRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'storico_sostituzioni');
        const histSnap = await getDoc(histRef);
        if(histSnap.exists()) {
          const logs = histSnap.data().logs || [];
          setHistoricalLogs(logs);
          setSubstitutionsLog(logs);
        }
      } catch (error) { console.error("Errore Firebase:", error); } 
      finally { setIsSyncing(false); }
    };
    loadData();
  }, []);

  // === SYNC FUNCTIONS ===
  const syncAbsences = async (newArr) => {
    setAbsentTeachers(newArr);
    try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'assenze_master'), { assenze: newArr, updatedAt: new Date().toISOString() }); } catch(e) {}
  };

  const syncAssemblies = async (newArr) => {
    setAssembliesDB(newArr);
    try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'assemblee_master'), { assemblee: newArr }); } catch(e) {}
  };

  const saveHistoricalLogsToCloud = async (newLogsArray) => {
    try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'storico_sostituzioni'), { logs: newLogsArray, updatedAt: new Date().toISOString() }); } catch(e) {}
  };

  const saveContactsToCloud = async (newContactsObj) => {
    try {
        const contactsRef = doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'contatti_master');
        await setDoc(contactsRef, { directory: newContactsObj, updatedAt: new Date().toISOString() });
        setContactsDB(newContactsObj);
        setEditingContact(false);
    } catch (error) {}
  };

  // === FILTRI DI PLESSO PER LA VISUALIZZAZIONE ===
  
  const getFilteredScheduleDB = () => {
    if (userRole?.type === 'VICEPRESIDENZA' || userRole?.plesso === 'TUTTI' || userRole?.type === 'GUEST') return scheduleDB;
    return scheduleDB.filter(s => s.plesso === userRole?.plesso);
  };

  const activeAbsences = absentTeachers.filter(t => t.dataISO === targetDateStr);
  
  // Mostra solo le assenze dei docenti che lavorano nel plesso dell'utente
  const filteredActiveAbsences = activeAbsences.filter(t => {
    if (userRole?.type === 'VICEPRESIDENZA' || userRole?.plesso === 'TUTTI' || userRole?.type === 'GUEST') return true;
    return scheduleDB.some(s => s.giorno === targetDay && s.docente === t.nome && s.plesso === userRole?.plesso);
  });

  // Filtra il Resoconto Sostituzioni per mostrare solo quelle del proprio plesso
  const filteredSubstitutionsLog = substitutionsLog.filter(log => {
    if (userRole?.type === 'VICEPRESIDENZA' || userRole?.plesso === 'TUTTI' || userRole?.type === 'GUEST') return true;
    return log.plesso === userRole?.plesso;
  });

  // Filtra lo Storico per mostrare solo quello del proprio plesso
  const filteredHistoricalLogs = historicalLogs.filter(log => {
    if (userRole?.type === 'VICEPRESIDENZA' || userRole?.plesso === 'TUTTI' || userRole?.type === 'GUEST') return true;
    return log.plesso === userRole?.plesso;
  });

  // Filtra la lista Aderenti Assemblea per il proprio plesso
  const filteredAssemblyTeachers = (assembliesDB.find(a => a.dataISO === assemblyDateStr)?.docenti || []).filter(t => {
    if (userRole?.type === 'VICEPRESIDENZA' || userRole?.plesso === 'TUTTI' || userRole?.type === 'GUEST') return true;
    return scheduleDB.some(s => s.giorno === assemblyDay && s.docente === t && s.plesso === userRole?.plesso);
  });

  // === LOGICA ASSENZE E SOSTITUZIONI ===
  const togglePartialHour = (orarioStr) => {
    setSelectedPartialHours(prev => prev.includes(orarioStr) ? prev.filter(h => h !== orarioStr) : [...prev, orarioStr]);
  };

  const addAbsentTeacher = () => {
    if(!absentInput) return;
    const cleanName = cleanStr(absentInput);
    if(absenceMode === 'PARZIALE' && selectedPartialHours.length === 0) return alert("Seleziona almeno un'ora.");
    
    const existingIndex = absentTeachers.findIndex(t => t.nome === cleanName && t.dataISO === targetDateStr);
    const newRecord = { id: existingIndex >= 0 ? absentTeachers[existingIndex].id : crypto.randomUUID(), nome: cleanName, tipo: absenceMode, ore: absenceMode === 'PARZIALE' ? [...selectedPartialHours] : [], dataISO: targetDateStr };
    
    let updated = [...absentTeachers];
    if (existingIndex >= 0) updated[existingIndex] = newRecord;
    else updated.push(newRecord);
    
    syncAbsences(updated);
    setAbsentInput(''); setSelectedPartialHours([]);
  };

  const getUncoveredSlots = () => {
    const activeDb = getFilteredScheduleDB();
    return activeDb.filter(s => {
      if (s.giorno !== targetDay) return false;
      const absenceRecord = activeAbsences.find(at => s.docente.includes(at.nome));
      if (!absenceRecord) return false;
      return absenceRecord.tipo === 'INTERA' || absenceRecord.ore.includes(s.ora);
    });
  };

  const openCandidateSearch = (slot) => {
      setActiveSlotSearch(slot);
      const activeDb = getFilteredScheduleDB();
      const orariDelGiorno = activeDb.filter(s => s.giorno === targetDay);
      let orariDiQuestaOra = slot.ora === 'Tutto il giorno' ? orariDelGiorno : orariDelGiorno.filter(s => s.ora === slot.ora);
      
      const docentiImpegnati = new Set(orariDiQuestaOra.map(s => s.docente));
      const docentiGiaAssegnatiOggi = substitutionsLog
          .filter(log => log.dataISO === targetDateStr && log.ora === slot.ora)
          .map(log => log.docente_sostituto);
      docentiGiaAssegnatiOggi.forEach(doc => docentiImpegnati.add(doc));

      let potentialSubstitutes = [];

      orariDiQuestaOra.forEach(slotCorrente => {
          if(docentiGiaAssegnatiOggi.includes(slotCorrente.docente)) return;
          const isAssenteInQuestaOra = activeAbsences.some(at => {
              if (!slotCorrente.docente.includes(at.nome)) return false;
              if (at.tipo === 'INTERA') return true;
              return at.ore.includes(slotCorrente.ora);
          });
          if (isAssenteInQuestaOra) return;

          const isStessoPlesso = slotCorrente.plesso === slot.plesso;

          if (classiCorrispondono(slotCorrente.classe, slot.classe)) {
              potentialSubstitutes.push({
                  id_cand: `${slotCorrente.docente}-SOST`,
                  docente: slotCorrente.docente,
                  ruoloCandidato: slotCorrente.ruolo,
                  motivazione: `Compresenza: è in ${slotCorrente.classe}`,
                  score: 100
              });
          }
          else if (isStessoPlesso && (slotCorrente.tipologia === 'A DISPOSIZIONE' || slotCorrente.tipologia === 'POTENZIAMENTO')) {
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
              const isAssenteInQuestaOra = activeAbsences.some(at => {
                  if (!doc.includes(at.nome)) return false;
                  if (at.tipo === 'INTERA') return true;
                  return at.ore.includes(slot.ora);
              });

              if (!isAssenteInQuestaOra) {
                  const slotDelDocenteOggi = orariDelGiorno.filter(s => s.docente === doc);
                  const lavoraNelloStessoPlesso = slotDelDocenteOggi.some(s => s.plesso === slot.plesso);

                  if (lavoraNelloStessoPlesso) {
                      const ruolo = slotDelDocenteOggi.length > 0 ? slotDelDocenteOggi[0].ruolo : 'CURRICULARE';
                      potentialSubstitutes.push({
                          id_cand: `${doc}-LIBERO`,
                          docente: doc,
                          ruoloCandidato: ruolo,
                          motivazione: `Libero (Possibile Buco Orario)`,
                          score: 50
                      });
                  }
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

  const assignSubstitute = async (candidato) => {
      let modalitaBreve = "A Pagamento"; 
      
      if (candidato.score === 100) {
          modalitaBreve = candidato.ruoloCandidato === 'SOSTEGNO' ? "Compresenza (Sostegno)" : "Compresenza";
      } else if (candidato.score === 80) {
          if (candidato.motivazione.toUpperCase().includes('POTENZIAMENTO')) modalitaBreve = "Potenziamento";
          else modalitaBreve = "A Disposizione";
      } else if (candidato.ruoloCandidato === 'SOSTEGNO') {
          modalitaBreve = "A Pagamento (Sostegno)";
      }

      const newLog = {
          id: crypto.randomUUID(),
          originalSlotId: activeSlotSearch.id,
          giorno: targetDay,
          dataISO: targetDateStr,
          ora: activeSlotSearch.ora,
          classe: activeSlotSearch.classe,
          docente_assente: activeSlotSearch.docente,
          docente_sostituto: candidato.docente,
          modalita: modalitaBreve,
          responsabile_firma: userRole.nome,
          plesso: activeSlotSearch.plesso,
          isDraft: true
      };

      const updatedLogs = [newLog, ...substitutionsLog];
      setSubstitutionsLog(updatedLogs);
      setHistoricalLogs(updatedLogs);
      await saveHistoricalLogsToCloud(updatedLogs);
      setActiveSlotSearch(null);
  };

  const pendingDrafts = filteredSubstitutionsLog.some(log => log.isDraft && log.dataISO === targetDateStr);
  
  const confermaSostituzioni = async () => {
    const confirmedLogs = substitutionsLog.map(l => {
      if (l.dataISO === targetDateStr && l.isDraft) {
        // Conferma solo le bozze del plesso del responsabile (o tutte se è la Vicepresidenza)
        if (userRole?.type === 'VICEPRESIDENZA' || userRole?.plesso === 'TUTTI' || l.plesso === userRole?.plesso) {
            return { ...l, isDraft: false };
        }
      }
      return l;
    });
    setSubstitutionsLog(confirmedLogs); setHistoricalLogs(confirmedLogs);
    await saveHistoricalLogsToCloud(confirmedLogs);
    alert("✅ Sostituzioni confermate e salvate in archivio!");
  };

  const removeLog = async (id) => {
    const updated = substitutionsLog.filter(l => l.id !== id);
    setSubstitutionsLog(updated); setHistoricalLogs(updated);
    await saveHistoricalLogsToCloud(updated);
  };

  // === COMUNICAZIONI (WHATSAPP / EMAIL) ===
  const inviaNotificaVirtual = (log, metodo) => {
    const testoMessaggio = `*Sostituzione - IPSSAT Chinnici*\n\nGentile Prof. ${log.docente_sostituto},\nGiorno: ${log.giorno} (${log.dataISO})\nOra: ${log.ora}\nClasse: ${log.classe} (Plesso: ${log.plesso})\nSostituisce: ${log.docente_assente}\n\nFirma: ${log.responsabile_firma}`;
    const contatti = contactsDB[log.docente_sostituto] || {};
    let telefono = contatti.telefono ? contatti.telefono.replace(/\s+/g, '') : '';
    const email = contatti.email || '';

    if (metodo === 'wa') {
        if (telefono) {
           if (!telefono.startsWith('+39') && !telefono.startsWith('39')) telefono = '+39' + telefono;
           else if (telefono.startsWith('39')) telefono = '+' + telefono;
           window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
        } else {
           window.open(`https://wa.me/?text=${encodeURIComponent(testoMessaggio)}`, '_blank');
        }
    } else if (metodo === 'mail') {
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Sostituzione: ${log.giorno} - ${log.ora}`)}&body=${encodeURIComponent(testoMessaggio)}`;
    } else if (metodo === 'copy') {
        navigator.clipboard.writeText(testoMessaggio).then(() => alert("Testo copiato!"));
    }
  };

  // === LOGICA ASSEMBLEE CON CALCOLO ORE E AGGREGAZIONE ===
  const currentAssembly = assembliesDB.find(a => a.dataISO === assemblyDateStr) || { ore: [], docenti: [] };
  const assemblyHours = currentAssembly.ore;
  const assemblyTeachersList = currentAssembly.docenti; // Manteniamo la lista globale intatta

  const updateAssembly = (dataISO, ore, docenti) => {
    const otherAssemblies = assembliesDB.filter(a => a.dataISO !== dataISO);
    syncAssemblies([...otherAssemblies, { dataISO, ore, docenti }]);
  };

  const toggleAssemblyHour = (orarioStr) => {
    const newOre = assemblyHours.includes(orarioStr) ? assemblyHours.filter(h => h !== orarioStr) : [...assemblyHours, orarioStr];
    updateAssembly(assemblyDateStr, newOre, assemblyTeachersList);
  };

  const addAssemblyTeacher = () => {
    if(!assemblyTeacherInput) return;
    const cleanName = cleanStr(assemblyTeacherInput);
    const newDocenti = assemblyTeachersList.includes(cleanName) ? assemblyTeachersList : [...assemblyTeachersList, cleanName];
    updateAssembly(assemblyDateStr, assemblyHours, newDocenti);
    setAssemblyTeacherInput('');
  };

  const getAssemblyImpact = () => {
    const todaySlots = getFilteredScheduleDB().filter(s => s.giorno === assemblyDay);

    const affectedSlots = todaySlots.filter(s =>
        assemblyTeachersList.some(t => s.docente.includes(t)) &&
        assemblyHours.includes(s.ora) &&
        s.tipologia !== 'A DISPOSIZIONE' && s.tipologia !== 'POTENZIAMENTO'
    );

    const estraiAnima = (testo) => {
        let pulito = testo.toUpperCase().replace(/[\s\.\-_]/g, '').replace(/SOSTEGNO|SOST/g, '');
        let match = pulito.match(/^(\d+[A-Z]+)/);
        return match ? match[1] : pulito;
    };

    const slotsConStato = affectedSlots.map(slot => {
        const coTeachers = todaySlots.filter(s =>
            classiCorrispondono(s.classe, slot.classe) &&
            s.ora === slot.ora &&
            s.id !== slot.id &&
            !assemblyTeachersList.some(t => s.docente.includes(t))
        );

        return { ...slot, haCopertura: coTeachers.length > 0, coTeachersNomi: coTeachers.map(c => c.docente).join(', ') };
    });

    const gruppiClasse = {};
    slotsConStato.forEach(slot => {
        const classeBase = estraiAnima(slot.classe);
        if (!gruppiClasse[classeBase]) {
            gruppiClasse[classeBase] = { classeOriginale: slot.classe, plesso: slot.plesso, docentiAderenti: new Set(), oreCoinvolte: new Set(), oreScoperte: new Set(), coperture: {} };
        }
        gruppiClasse[classeBase].docentiAderenti.add(slot.docente);
        gruppiClasse[classeBase].oreCoinvolte.add(slot.ora);
        
        if (slot.haCopertura) {
            if (!gruppiClasse[classeBase].coperture[slot.ora]) gruppiClasse[classeBase].coperture[slot.ora] = [];
            gruppiClasse[classeBase].coperture[slot.ora].push(slot.coTeachersNomi);
        } else {
            gruppiClasse[classeBase].oreScoperte.add(slot.ora);
        }
    });

    const reportFinale = [];
    Object.values(gruppiClasse).forEach(gruppo => {
        const oreScoperteArray = Array.from(gruppo.oreScoperte).sort();
        let status = ''; let note = '';

        if (oreScoperteArray.length === 0) {
            status = 'REGOLARE';
            const copertureTesto = Object.entries(gruppo.coperture).map(([ora, docenti]) => `${ora} coperta da ${docenti[0]}`).join('; ');
            note = `Orario regolare. Rimane a scuola. (${copertureTesto})`;
        } else {
            const firstHourStr = oreScoperteArray[0];
            const lastHourStr = oreScoperteArray[oreScoperteArray.length - 1];

            if (firstHourStr.startsWith('08:00') || firstHourStr.startsWith('08:50')) {
                const endTime = lastHourStr.split('-')[1];
                status = 'INGRESSO POSTICIPATO'; note = `Ingresso posticipato alle ore ${endTime} (Avviso Famiglie)`;
            } else {
                const startTime = firstHourStr.split('-')[0];
                status = 'USCITA ANTICIPATA'; note = `Uscita anticipata alle ore ${startTime} (Avviso Famiglie)`;
            }
        }
        reportFinale.push({ classe: gruppo.classeOriginale, plesso: gruppo.plesso, ora: Array.from(gruppo.oreCoinvolte).sort().join(', '), docente: Array.from(gruppo.docentiAderenti).join(', '), status, note });
    });
    return reportFinale.sort((a,b) => a.classe.localeCompare(b.classe));
  };

  // === LOGICA DATABASE E STORICO (VICEPRESIDENZA) ===
  const svuotaArchivioStorico = async () => {
    if(window.confirm("ATTENZIONE: Sei sicuro di voler svuotare interamente l'archivio storico?")) {
        await saveHistoricalLogsToCloud([]); setHistoricalLogs([]); setSubstitutionsLog([]); syncAbsences([]); syncAssemblies([]);
    }
  };

  const svuotaDatabaseAssoluto = async () => {
    setIsSyncing(true);
    setDbMessage("Eliminazione in corso...");
    try {
      let batch = writeBatch(db);
      for (let i = 0; i < 20; i++) batch.delete(doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`));
      batch.delete(doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'plessi_master'));
      await batch.commit();
      setScheduleDB([]); setDbMessage("Database svuotato.");
    } catch(e) { setDbMessage("Errore: " + e.message); } finally { setIsSyncing(false); }
  };

  const saveDatabaseToCloud = async (newScheduleArray) => {
    setIsSyncing(true); setDbMessage("Salvataggio...");
    try {
      let batch = writeBatch(db);
      for (let i = 0; i < 20; i++) batch.delete(doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`));
      const CHUNK_SIZE = 800; const chunks = Math.ceil(newScheduleArray.length / CHUNK_SIZE);
      for (let i = 0; i < chunks; i++) {
          const chunkData = newScheduleArray.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          batch.set(doc(db, 'artifacts', appId, 'public', 'data', 'orari', `plessi_chunk_${i}`), { data: JSON.stringify(chunkData) });
      }
      batch.set(doc(db, 'artifacts', appId, 'public', 'data', 'orari', 'plessi_master'), { chunks: chunks, updatedAt: new Date().toISOString() });
      await batch.commit();
      setScheduleDB(newScheduleArray); setDbMessage(`Salvato! (${newScheduleArray.length} record)`);
    } catch (error) { setDbMessage("Errore critico: " + error.message); } finally { setIsSyncing(false); }
  };

  const handleFileUpload = (event, ruolo) => {
    const file = event.target.files[0];
    if (!file) return;
    setDbMessage(`Lettura CSV ${ruolo}...`);
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        try {
            const extractedSlots = processParsedGrid(results.data, ruolo);
            if (extractedSlots.length === 0) {
                alert("Attenzione: Il file CSV non contiene orari validi o il formato è errato.");
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
        } finally {
            event.target.value = null; 
        }
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
            id: crypto.randomUUID(), docente: docente, giorno: cleanStr(mapping.giorno), ora: mapping.ora,
            classe: classeFormattata, ruolo: ruolo, tipologia: tipologiaCalc, plesso: plessoCalc
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

  const activeDbForTable = getFilteredScheduleDB();
  const filteredDbRows = activeDbForTable.filter(row => {
      const matchesRuolo = row.ruolo === dbRuoloTab;
      const matchesSearch = row.docente.includes(dbSearchTerm) || row.classe.includes(dbSearchTerm);
      return matchesRuolo && matchesSearch;
  });

  const totalPages = Math.ceil(filteredDbRows.length / itemsPerPage) || 1;
  const paginatedDbRows = filteredDbRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans text-gray-800 print:bg-white">
      {/* HEADER ISTITUZIONALE E NAVIGAZIONE */}
      <header className="bg-white px-6 py-4 flex justify-between items-center shadow-sm border-b border-gray-200 print:hidden">
        <div className="flex items-center space-x-4">
          <img src={logoApp} alt="Logo App" className="w-12 h-12 rounded-lg shadow-sm object-cover" />
          <div>
            <h1 className="text-2xl font-bold">Scuola<span className="text-teal-500">Manager</span> Pro</h1>
            <p className="text-teal-400 text-xs font-bold tracking-widest uppercase mt-0.5">GESTIONE {userRole?.plesso}</p>
          </div>
        </div>
        <div className="text-right flex flex-col items-end">
          <h2 className="font-bold text-[#1a365d] tracking-wide">I.P.S.S.A.T. ROCCO CHINNICI</h2>
          <div className="flex items-center border border-gray-200 rounded-md overflow-hidden bg-white shadow-sm mt-2">
            <span className="px-4 py-1.5 text-sm font-medium text-gray-700">Utente: <strong>{userRole?.nome}</strong></span>
            <button onClick={logout} className="bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600 px-4 py-1.5 text-sm font-bold border-l border-gray-200 transition-colors">ESCI</button>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b border-gray-200 px-6 print:hidden overflow-x-auto">
        <div className="flex space-x-6 min-w-max">
          <button onClick={() => setActiveTab('DASHBOARD')} className={`py-3 px-2 font-bold text-sm border-b-4 transition-colors ${activeTab === 'DASHBOARD' ? 'border-teal-400 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Sostituzioni</button>
          <button onClick={() => setActiveTab('ASSEMBLEE')} className={`py-3 px-2 font-bold text-sm border-b-4 transition-colors ${activeTab === 'ASSEMBLEE' ? 'border-teal-400 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Gestione Assemblee</button>
          <button onClick={() => setActiveTab('STORICO')} className={`py-3 px-2 font-bold text-sm border-b-4 transition-colors ${activeTab === 'STORICO' ? 'border-teal-400 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Archivio Storico</button>
          {userRole?.type === 'VICEPRESIDENZA' && (
            <button onClick={() => setActiveTab('DATABASE')} className={`py-3 px-2 font-bold text-sm border-b-4 transition-colors ${activeTab === 'DATABASE' ? 'border-teal-400 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Database Orari</button>
          )}
        </div>
      </nav>

      <main className="p-6 max-w-[1400px] mx-auto print:p-0">
        
        {/* ================= TAB SOSTITUZIONI ================= */}
        {activeTab === 'DASHBOARD' && (
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* CARD 1: ASSENZE */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-1 h-fit print:hidden">
                 <h3 className="text-lg font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4">1. Docenti Assenti</h3>
                 <input type="date" value={targetDateStr} onChange={(e) => setTargetDateStr(e.target.value)} className="w-full p-2 border border-gray-300 rounded mb-4 focus:outline-none focus:border-teal-500" />
                 
                 <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-4">
                     <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">Aggiungi Assenza (Cognome)</label>
                     <div className="flex mb-3">
                        <input type="text" placeholder="ES. ROSSI" value={absentInput} onChange={(e) => setAbsentInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAbsentTeacher()} className="flex-1 p-2 border border-gray-300 rounded-l uppercase focus:outline-none focus:border-teal-500" />
                        <button onClick={addAbsentTeacher} className="bg-teal-500 text-white px-4 rounded-r font-bold hover:bg-teal-600">+</button>
                     </div>
                     <div className="flex bg-white border border-gray-300 rounded-md overflow-hidden mb-2">
                        <button onClick={() => setAbsenceMode('INTERA')} className={`flex-1 text-xs py-2 font-bold ${absenceMode === 'INTERA' ? 'bg-teal-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>Tutto il giorno</button>
                        <button onClick={() => setAbsenceMode('PARZIALE')} className={`flex-1 text-xs py-2 font-bold ${absenceMode === 'PARZIALE' ? 'bg-teal-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>Permesso</button>
                     </div>
                     {absenceMode === 'PARZIALE' && (
                        <div className="flex flex-wrap gap-1 mt-2">
                           {FASCIE_ORARIE_STANDARD.map(f => (
                              <button key={f.orario} onClick={() => togglePartialHour(f.orario)} className={`px-2 py-1 text-xs font-bold rounded ${selectedPartialHours.includes(f.orario) ? 'bg-teal-500 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>{f.label}</button>
                           ))}
                        </div>
                     )}
                 </div>

                 {filteredActiveAbsences.map(t => (
                    <div key={t.id} className="flex justify-between items-center bg-white border-l-4 border-red-500 shadow-sm p-2 mb-2 rounded-r">
                       <div>
                          <span className="font-bold text-sm block text-gray-800">{t.nome}</span>
                          <span className="text-[10px] text-gray-500">{t.tipo === 'INTERA' ? 'Tutto il giorno' : 'Permesso Parziale'}</span>
                       </div>
                       <button onClick={() => setAbsentTeachers(absentTeachers.filter(a => a.id !== t.id))} className="text-red-400 hover:text-red-600 font-bold px-2 text-lg">&times;</button>
                    </div>
                 ))}
              </div>

              {/* CARD 2: TABELLONE & RICERCA CANDIDATI */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-2 print:hidden">
                 <h3 className="text-lg font-bold text-gray-800 mb-4 border-b border-gray-100 pb-2">2. Tabellone Ore Scoperte ({targetDay})</h3>
                 
                 {/* Modale Inline: Ricerca Candidati */}
                 {activeSlotSearch ? (
                    <div className="bg-teal-50 p-4 rounded-lg border border-teal-200 mb-4 animate-fadeIn">
                       <div className="flex justify-between items-start mb-3 border-b border-teal-100 pb-2">
                          <div>
                             <h4 className="font-bold text-teal-800">Trova sostituto per: {activeSlotSearch.docente}</h4>
                             <p className="text-sm text-teal-600">Ora: {activeSlotSearch.ora} | Classe: <strong>{activeSlotSearch.classe}</strong></p>
                          </div>
                          <button onClick={() => setActiveSlotSearch(null)} className="text-teal-600 hover:text-teal-800 font-bold text-xl leading-none">&times;</button>
                       </div>
                       <div className="max-h-[300px] overflow-y-auto bg-white rounded border border-teal-100">
                          <table className="w-full text-sm text-left">
                             <thead className="bg-teal-100/50 sticky top-0">
                                <tr><th className="p-2 font-semibold">Candidato</th><th className="p-2 font-semibold">Motivazione</th><th className="p-2 text-right font-semibold">Sostituto</th></tr>
                             </thead>
                             <tbody>
                                {candidates.map((c, i) => (
                                   <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                      <td className="p-2 font-bold text-gray-800">
                                         {c.docente}
                                         {c.ruoloCandidato === 'SOSTEGNO' && <span className="ml-1 text-[10px] text-purple-600 font-bold uppercase tracking-wide">({c.ruoloCandidato})</span>}
                                      </td>
                                      <td className="p-2 text-xs">
                                         <span className={`px-2 py-1 rounded font-bold uppercase tracking-wide ${c.score === 100 ? 'bg-green-100 text-green-800' : c.score === 80 ? 'bg-cyan-100 text-cyan-800' : 'bg-gray-100 text-gray-600'}`}>
                                            {c.motivazione}
                                         </span>
                                      </td>
                                      <td className="p-2 text-right">
                                         <button onClick={() => assignSubstitute(c)} className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs font-bold rounded uppercase transition-colors">Assegna</button>
                                      </td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>
                    </div>
                 ) : (
                    <div className="flex-1 overflow-auto">
                       {getUncoveredSlots().length === 0 ? (
                          <div className="h-full flex items-center justify-center border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 min-h-[200px]">
                             <p className="text-gray-400 font-medium">Nessuna ora scoperta presente in tabella.</p>
                          </div>
                       ) : (
                          <table className="w-full text-sm text-left">
                             <thead className="bg-gray-100 border-b border-gray-200">
                                <tr>
                                   <th className="p-3 font-bold text-gray-600">Ora</th>
                                   <th className="p-3 font-bold text-gray-600">Assente</th>
                                   <th className="p-3 font-bold text-gray-600">Classe</th>
                                   <th className="p-3 text-right font-bold text-gray-600">Sostituto</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-100">
                                {getUncoveredSlots().sort((a,b) => a.ora.localeCompare(b.ora)).map(slot => {
                                   const log = substitutionsLog.find(l => l.originalSlotId === slot.id && l.dataISO === targetDateStr);
                                   return (
                                      <tr key={slot.id} className="hover:bg-gray-50">
                                         <td className="p-3 font-semibold text-gray-700">{slot.ora}</td>
                                         <td className="p-3 font-bold text-red-500">{slot.docente}</td>
                                         <td className="p-3 font-bold text-gray-800">{slot.classe}</td>
                                         <td className="p-3 text-right">
                                            {log ? (
                                               <span className="bg-green-100 text-green-700 px-3 py-1 rounded text-xs font-bold">{log.docente_sostituto}</span>
                                            ) : userRole?.type !== 'GUEST' ? (
                                               <button onClick={() => openCandidateSearch(slot)} className="text-teal-600 border border-teal-500 hover:bg-teal-500 hover:text-white px-3 py-1 rounded text-xs font-bold transition-colors">Trova</button>
                                            ) : (
                                               <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 uppercase font-bold rounded-sm">Lettura</span>
                                            )}
                                         </td>
                                      </tr>
                                   )
                                })}
                             </tbody>
                          </table>
                       )}
                    </div>
                 )}
              </div>

              {/* CARD 3: RESOCONTO UFFICIALE E STAMPA */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-3">
                 <div className="flex justify-between items-center mb-4 print:hidden border-b border-gray-100 pb-3">
                    <h3 className="text-lg font-bold text-gray-800">3. Resoconto Ufficiale Sostituzioni</h3>
                    <div className="flex gap-2">
                       {pendingDrafts && (
                          <button onClick={confermaSostituzioni} className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-bold shadow-sm transition-colors flex items-center gap-2">
                             ✅ Conferma Bozze
                          </button>
                       )}
                       <button onClick={() => window.print()} className="bg-[#1a365d] hover:bg-[#12284c] text-white px-4 py-2 rounded text-sm font-bold shadow-sm transition-colors flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                          <span>Stampa PDF</span>
                       </button>
                    </div>
                 </div>

                 {/* Intestazione Stampa Sostituzioni */}
                 {renderPrintHeader()}

                 <div className="hidden print:block mb-6 text-center">
                    <h2 className="text-xl font-bold uppercase text-black">Variazione Orario Giornaliero - Sostituzioni</h2>
                    <p className="text-sm mt-1 text-gray-700 capitalize">Del {formatDataEstesa(targetDateStr)}</p>
                 </div>

                 {filteredSubstitutionsLog.filter(l => l.dataISO === targetDateStr).length === 0 ? (
                    <div className="py-8 text-center text-gray-400 bg-gray-50 border border-dashed border-gray-200 text-sm font-semibold print:hidden">
                       Nessuna sostituzione registrata in questa data.
                    </div>
                 ) : (
                    <table className="w-full text-sm text-left border border-gray-200 print:border-black">
                       <thead className="bg-gray-100 print:bg-white print:border-b-2 print:border-black">
                          <tr>
                             <th className="p-2 border-r">Assente</th>
                             <th className="p-2 border-r">Ora</th>
                             <th className="p-2 border-r">Classe</th>
                             <th className="p-2 border-r text-teal-600 print:text-black">Sostituto</th>
                             <th className="p-2 border-r">Modalità</th>
                             <th className="p-2 text-center print:hidden">Azioni Notifica</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-200 print:divide-black">
                          {filteredSubstitutionsLog.filter(l => l.dataISO === targetDateStr).sort((a,b) => a.docente_assente.localeCompare(b.docente_assente) || a.ora.localeCompare(b.ora)).map(log => (
                             <tr key={log.id} className="hover:bg-gray-50 print:break-inside-avoid">
                                <td className="p-2 border-r text-red-500 font-bold print:text-black">{log.docente_assente}</td>
                                <td className="p-2 border-r font-semibold">{log.ora}</td>
                                <td className="p-2 border-r font-bold">{log.classe} <span className="text-[10px] text-gray-500 font-normal ml-1">({log.plesso})</span></td>
                                <td className="p-2 border-r text-green-600 font-bold print:text-black">{log.docente_sostituto}</td>
                                <td className="p-2 border-r text-xs text-gray-700 font-bold">
                                   {log.isDraft && <span className="bg-yellow-100 text-yellow-800 border border-yellow-200 px-1 py-0.5 rounded font-bold text-[9px] mr-2 print:hidden">BOZZA</span>}
                                   {log.modalita}
                                </td>
                                <td className="p-2 print:hidden flex items-center justify-center gap-1.5">
                                   <button onClick={()=>inviaNotificaVirtual(log, 'wa')} className="bg-[#25D366] text-white hover:bg-[#128C7E] px-2 py-1.5 text-[10px] font-bold uppercase transition-colors rounded shadow-sm" title="WhatsApp Web">WA</button>
                                   <button onClick={()=>inviaNotificaVirtual(log, 'mail')} className="bg-blue-500 text-white hover:bg-blue-600 px-2 py-1.5 text-[10px] font-bold uppercase transition-colors rounded shadow-sm" title="Email">@</button>
                                   <button onClick={()=>inviaNotificaVirtual(log, 'copy')} className="bg-gray-200 text-gray-700 hover:bg-gray-300 px-2 py-1.5 text-[10px] font-bold uppercase transition-colors rounded shadow-sm" title="Copia Testo">Copia</button>
                                   <button onClick={() => removeLog(log.id)} className="text-red-400 hover:text-red-600 font-bold text-lg ml-2 leading-none" title="Elimina">&times;</button>
                                </td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 )}

                 {/* Firme per la stampa */}
                 <div className="hidden print:flex justify-between mt-16">
                     <div className="text-center w-56">
                         <span className="block text-xs font-bold uppercase">Il Responsabile di Plesso</span>
                         <span className="text-xs italic text-gray-700 mt-1 block">{userRole?.nome}</span>
                     </div>
                     <div className="text-center w-56">
                         <span className="block text-xs font-bold uppercase">Il Dirigente Scolastico</span>
                         <span className="text-xs italic text-gray-700 mt-1 block">Firma autografa omessa ai sensi<br/>dell'art. 3 del D. Lgs. n. 39/1993</span>
                     </div>
                 </div>
              </div>
           </div>
        )}

        {/* ================= TAB ASSEMBLEE SINDACALI ================= */}
        {activeTab === 'ASSEMBLEE' && (
           <div className="grid lg:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-1 print:hidden">
                 <h3 className="text-lg font-bold text-gray-800 mb-4 border-b border-gray-100 pb-2">Dati Assemblea</h3>
                 <input type="date" value={assemblyDateStr} onChange={(e) => setAssemblyDateStr(e.target.value)} className="w-full p-2 border border-gray-300 rounded mb-4 focus:outline-none focus:border-teal-500" />
                 
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Seleziona Ore (Durata)</label>
                 <div className="flex flex-wrap gap-1.5 mb-6">
                    {FASCIE_ORARIE_STANDARD.map(f => (
                       <button key={f.orario} onClick={() => toggleAssemblyHour(f.orario)} className={`px-3 py-1.5 text-xs font-bold rounded border ${assemblyHours.includes(f.orario) ? 'bg-teal-500 text-white border-teal-500' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>{f.label}</button>
                    ))}
                 </div>
                 
                 <div className="bg-gray-50 p-3 rounded border border-gray-200 mb-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Aggiungi Docenti Aderenti</label>
                    <div className="flex gap-2">
                       <input type="text" placeholder="Es. ROSSI" value={assemblyTeacherInput} onChange={(e) => setAssemblyTeacherInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAssemblyTeacher()} className="flex-1 p-2 border border-gray-300 rounded uppercase focus:outline-none focus:border-teal-500" />
                       <button onClick={addAssemblyTeacher} className="bg-teal-500 hover:bg-teal-600 text-white px-4 rounded font-bold transition-colors">+</button>
                    </div>
                 </div>

                 <div className="flex flex-wrap gap-2">
                    {filteredAssemblyTeachers.map(t => (
                       <span key={t} className="bg-white border border-gray-200 shadow-sm px-2 py-1.5 text-xs font-bold rounded flex items-center gap-2">
                          {t} <button onClick={() => updateAssembly(assemblyDateStr, assemblyHours, assembliesDB.find(a => a.dataISO === assemblyDateStr).docenti.filter(x => x !== t))} className="text-gray-400 hover:text-red-500 bg-gray-100 px-1 rounded">&times;</button>
                       </span>
                    ))}
                 </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-2">
                 <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-3 print:hidden">
                    <h3 className="text-lg font-bold text-gray-800">Risoluzione Impatto sulle Classi</h3>
                    <button onClick={() => window.print()} className="bg-[#1a365d] text-white px-4 py-2 rounded text-sm font-bold shadow-sm">Stampa Circolare</button>
                 </div>
                 
                 {/* Intestazione Stampa Assemblee */}
                 {renderPrintHeader()}

                 {/* DISPOSITIVO LEGALE PER CIRCOLARE ASSEMBLEA */}
                 <div className="hidden print:block mb-8 text-justify text-sm">
                    <h2 className="text-lg font-bold uppercase text-center mb-4">IL DIRIGENTE SCOLASTICO</h2>
                    <p className="mb-2"><strong>VISTA</strong> l’indizione dell’assemblea sindacale territoriale per il giorno {formatDataEstesa(assemblyDateStr)};</p>
                    <p className="mb-2"><strong>VISTE</strong> le dichiarazioni di adesione del personale docente e valutato l’impatto sull'orario delle lezioni;</p>
                    <p className="mb-2"><strong>RITENUTO</strong> necessario garantire la sicurezza e la vigilanza degli alunni, nonché informare tempestivamente le famiglie circa le variazioni di orario;</p>
                    <h3 className="text-md font-bold text-center my-4">DISPONE</h3>
                    <p className="mb-4">Per il giorno <strong>{formatDataEstesa(assemblyDateStr)}</strong>, le classi del plesso di <strong>{userRole?.plesso}</strong> subiranno le seguenti variazioni di orario. I docenti in servizio nelle ore immediatamente precedenti all’uscita anticipata o successive all’ingresso posticipato cureranno la tempestiva annotazione sul registro di classe e ne verificheranno la presa visione da parte delle famiglie.</p>
                 </div>

                 <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 print:bg-white print:border-b-2 print:border-black">
                       <tr><th className="p-2 font-bold text-gray-600">Classe</th><th className="p-2 font-bold text-gray-600 print:hidden">Ore Impattate</th><th className="p-2 font-bold text-gray-600 print:hidden">Decisione Dettagliata</th><th className="p-2 font-bold text-gray-800 hidden print:table-cell">Disposizione Orario</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 print:divide-gray-300">
                       {getAssemblyImpact().map((slot, i) => (
                          <tr key={i} className="hover:bg-gray-50 print:break-inside-avoid">
                             <td className="p-2 font-bold text-base">{slot.classe}</td>
                             <td className="p-2 font-semibold text-gray-700 print:hidden text-xs">{slot.ora}</td>
                             <td className="p-2 print:hidden">
                                <span className={`text-xs font-bold px-2 py-1.5 rounded border ${slot.status === 'REGOLARE' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{slot.note}</span>
                             </td>
                             <td className="p-2 font-bold text-black hidden print:table-cell">
                                {slot.status === 'REGOLARE' ? 'ORARIO REGOLARE' : slot.note}
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>

                 {/* Firme per la stampa */}
                 <div className="hidden print:flex justify-between mt-16">
                     <div className="text-center w-56">
                         <span className="block text-xs font-bold uppercase">Il Responsabile di Plesso</span>
                         <span className="text-xs italic text-gray-700 mt-1 block">{userRole?.nome}</span>
                     </div>
                     <div className="text-center w-56">
                         <span className="block text-xs font-bold uppercase">Il Dirigente Scolastico</span>
                         <span className="text-xs italic text-gray-700 mt-1 block">Firma autografa omessa ai sensi<br/>dell'art. 3 del D. Lgs. n. 39/1993</span>
                     </div>
                 </div>
              </div>
           </div>
        )}

        {/* ================= TAB ARCHIVIO STORICO ================= */}
        {activeTab === 'STORICO' && (
           <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
                 <div>
                    <h3 className="text-lg font-bold text-gray-800">Archivio Permanente Sostituzioni</h3>
                    <p className="text-xs text-gray-500 font-semibold mt-1">Sincronizzato sul Cloud Firebase</p>
                 </div>
                 <div className="flex gap-4 items-center">
                    <input type="date" value={selectedHistoryDate} onChange={(e) => setSelectedHistoryDate(e.target.value)} className="border border-gray-300 p-2 rounded text-sm focus:outline-none focus:border-teal-500" />
                    {userRole?.type === 'VICEPRESIDENZA' && (
                       <button onClick={svuotaArchivioStorico} className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-500 hover:text-white px-3 py-2 text-xs font-bold uppercase rounded transition-colors">Svuota Storico</button>
                    )}
                 </div>
              </div>
              <div className="overflow-x-auto">
                 <table className="min-w-full text-sm text-left whitespace-nowrap">
                    <thead className="bg-gray-100 border-b border-gray-200">
                       <tr><th className="p-3 font-bold text-gray-600 uppercase text-xs">Data</th><th className="p-3 font-bold text-gray-600 uppercase text-xs">Plesso</th><th className="p-3 font-bold text-gray-600 uppercase text-xs">Assente</th><th className="p-3 font-bold text-gray-600 uppercase text-xs">Ora / Classe</th><th className="p-3 font-bold text-gray-600 uppercase text-xs">Sostituto</th><th className="p-3 font-bold text-gray-600 uppercase text-xs">Firma / Mod.</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                       {filteredHistoricalLogs.filter(log => !selectedHistoryDate || log.dataISO === selectedHistoryDate).map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50">
                             <td className="p-3 font-semibold text-gray-600">{formatDataEstesa(log.dataISO)}</td>
                             <td className="p-3 font-bold text-xs">{log.plesso}</td>
                             <td className="p-3 text-red-500 font-bold">{log.docente_assente}</td>
                             <td className="p-3 font-semibold text-gray-800">{log.ora} <span className="font-bold ml-1">{log.classe}</span></td>
                             <td className="p-3 text-green-600 font-bold">{log.docente_sostituto}</td>
                             <td className="p-3 text-[10px] text-gray-500 font-semibold tracking-wide">
                                <div className="uppercase font-bold text-gray-700">{log.modalita}</div>
                                <div className="text-gray-400 mt-0.5">{log.responsabile_firma}</div>
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
              </div>
           </div>
        )}

        {/* ================= TAB DATABASE ORARI (VICEPRESIDENZA) ================= */}
        {activeTab === 'DATABASE' && userRole?.type === 'VICEPRESIDENZA' && (
           <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex justify-between items-center mb-6 bg-gray-800 text-white p-5 rounded-lg border-b-4 border-teal-500">
                 <div>
                    <h3 className="text-lg font-bold">Gestore Database Orari</h3>
                    <p className="text-xs text-gray-300 mt-1">{dbMessage || "Pannello Amministratore Cloud"}</p>
                 </div>
                 <button onClick={() => { if(window.confirm("ATTENZIONE: Eliminare l'intero database orari?")) svuotaDatabaseAssoluto() }} className="border border-red-500 text-red-400 px-4 py-2 text-xs font-bold uppercase rounded hover:bg-red-500 hover:text-white transition-colors">Svuota Database</button>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-6">
                 <label className="border-2 border-dashed border-gray-300 p-6 bg-gray-50 text-center rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                    <span className="font-bold block text-gray-700">Carica CSV Curriculari</span>
                    <span className="text-[10px] font-semibold text-gray-500 uppercase mt-1 block">Sovrascrive il DB esistente</span>
                    <input type="file" accept=".csv" className="hidden" disabled={isSyncing} onChange={(e) => handleFileUpload(e, 'CURRICULARE')} />
                 </label>
                 <label className="border-2 border-dashed border-gray-300 p-6 bg-gray-50 text-center rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                    <span className="font-bold block text-gray-700">Carica CSV Sostegno</span>
                    <span className="text-[10px] font-semibold text-gray-500 uppercase mt-1 block">Aggiunge al DB esistente</span>
                    <input type="file" accept=".csv" className="hidden" disabled={isSyncing} onChange={(e) => handleFileUpload(e, 'SOSTEGNO')} />
                 </label>
              </div>

              {/* Sezione di Ricerca nel DB Orari */}
              <div className="flex border-b border-gray-200 mb-5">
                  <button onClick={() => { setDbRuoloTab('CURRICULARE'); setCurrentPage(1); }} className={`px-4 py-2 font-bold text-xs uppercase transition-colors border-b-2 ${dbRuoloTab === 'CURRICULARE' ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                      Curriculari <span className="ml-1 bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">{scheduleDB.filter(r => r.ruolo === 'CURRICULARE').length}</span>
                  </button>
                  <button onClick={() => { setDbRuoloTab('SOSTEGNO'); setCurrentPage(1); }} className={`px-4 py-2 font-bold text-xs uppercase transition-colors border-b-2 ${dbRuoloTab === 'SOSTEGNO' ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                      Sostegno <span className="ml-1 bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">{scheduleDB.filter(r => r.ruolo === 'SOSTEGNO').length}</span>
                  </button>
              </div>

              <div className="flex flex-col md:flex-row gap-3 mb-5">
                  <input type="text" placeholder={`Cerca in ${dbRuoloTab.toLowerCase()}...`} className="flex-1 px-3 py-2 bg-white border border-gray-300 text-sm focus:outline-none focus:border-teal-500 uppercase rounded" value={dbSearchTerm} onChange={(e) => { setDbSearchTerm(e.target.value.toUpperCase()); setCurrentPage(1); }} />
                  {dbSearchTerm && (
                      <button onClick={() => {
                          const existingContact = contactsDB[dbSearchTerm] || { email: '', telefono: '' };
                          setContactForm(existingContact);
                          setEditingContact(true);
                      }} className="px-4 py-2 bg-gray-700 text-white font-bold text-xs uppercase hover:bg-gray-800 transition-colors rounded">
                          Rubrica {dbSearchTerm}
                      </button>
                  )}
              </div>

              {editingContact && (
                  <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                      <h3 className="font-bold text-[#333333] mb-2 text-sm uppercase">Contatti: {dbSearchTerm}</h3>
                      <div className="flex gap-2">
                          <input type="email" className="flex-1 p-2 bg-white border border-gray-300 text-sm focus:outline-none focus:border-teal-500 rounded" value={contactForm.email} onChange={e=>setContactForm({...contactForm, email:e.target.value})} placeholder="Email"/>
                          <input type="text" className="flex-1 p-2 bg-white border border-gray-300 text-sm focus:outline-none focus:border-teal-500 rounded" value={contactForm.telefono} onChange={e=>setContactForm({...contactForm, telefono:e.target.value})} placeholder="Cellulare (+39...)"/>
                          <button onClick={() => saveContactsToCloud({ ...contactsDB, [dbSearchTerm]: contactForm })} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold uppercase transition-colors rounded">Salva</button>
                          <button onClick={() => setEditingContact(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-xs font-bold uppercase transition-colors bg-white hover:bg-gray-50 rounded">Annulla</button>
                      </div>
                  </div>
              )}

              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-gray-100 border-b border-gray-200">
                          <tr>
                              <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Docente</th>
                              <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Giorno / Ora</th>
                              <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Classe</th>
                              <th className="px-3 py-2 font-bold text-gray-600 text-xs uppercase">Plesso</th>
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
                                          <input type="text" className="border border-teal-500 px-2 py-0.5 w-24 text-sm uppercase focus:outline-none rounded" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => saveEditedClass(row.id)} onKeyDown={(e) => e.key === 'Enter' && saveEditedClass(row.id)} autoFocus />
                                      ) : (
                                          <span className="text-teal-600 hover:underline" title="Clicca per modificare">{row.classe}</span>
                                      )}
                                  </td>
                                  <td className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide">{row.plesso}</td>
                                  <td className="px-3 py-2 text-right">
                                      <button onClick={() => { if(window.confirm("Eliminare questa ora dal database?")) saveDatabaseToCloud(scheduleDB.filter(item => item.id !== row.id)) }} className="text-red-400 hover:text-red-600 text-xs font-bold uppercase transition-colors">Elimina</button>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>

              {totalPages > 1 && (
                  <div className="flex justify-between items-center mt-4">
                      <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="px-3 py-1 bg-gray-100 text-gray-600 font-bold text-xs uppercase disabled:opacity-50 rounded">Indietro</button>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Pagina {currentPage} di {totalPages}</span>
                      <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-100 text-gray-600 font-bold text-xs uppercase disabled:opacity-50 rounded">Avanti</button>
                  </div>
              )}
           </div>
        )}

      </main>
    </div>
  );
}