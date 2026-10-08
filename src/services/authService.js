import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../config/firebaseConfig';

export const RESPONSABILI_ACCOUNTS = {
  "vicepresidenza@ipssatchinnicinicolosi.edu.it": { type: 'VICEPRESIDENZA', plesso: 'TUTTI', nome: 'Vicepresidenza / Dirigenza' },
  "prof.digregorio@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'NICOLOSI', nome: 'prof. AlessandroDi Gregorio' },
  "prof.barbarotto@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'NICOLOSI', nome: 'prof. Giuseppina Barbarotto' },
  "prof.spina@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'PEDARA', nome: 'prof. Anna Maria Spina' },
  "prof.paterno@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'PEDARA', nome: 'prof. Salvatore Paternò' },
  "prof.amato@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'TRECASTAGNI', nome: 'prof. Anna Amato' },
  "prof.rao@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'TRECASTAGNI', nome: 'prof. Carmen Rao' },
  "prof.marciante@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'SANTA MARIA DI LICODIA', nome: 'prof. Stefano Marciante' },
  "prof.muratore@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'SANTA MARIA DI LICODIA', nome: 'prof. Antonio Muratore' },
  "prof.condorelli@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: 'SANTA MARIA DI LICODIA', nome: 'prof. Marina Condorelli' },
  "prof.randazzo@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: "PATERNO'", nome: 'prof. Lucia Randazzo' },
  "prof.riccioli@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: "PATERNO'", nome: 'prof. Danilo Riccioli' },
  "prof.simonte@ipssatchinnicinicolosi.edu.it": { type: 'RESPONSABILE', plesso: "PATERNO'", nome: 'prof. Antonino Simonte' },
  "la.tua.email@esempio.it": { type: 'VICEPRESIDENZA', plesso: 'TUTTI', nome: 'Prof. Stefano (Admin)' },
};

export const login = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const userEmail = userCredential.user.email.toLowerCase();
    
    if (!RESPONSABILI_ACCOUNTS[userEmail]) {
      await signOut(auth); // Rifiuta l'accesso se non in whitelist
      throw new Error("Email non autorizzata.");
    }
    return userCredential.user;
  } catch (error) {
    throw new Error(error.message || "Errore di accesso: credenziali non valide.");
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Errore disconnessione:", error);
  }
};