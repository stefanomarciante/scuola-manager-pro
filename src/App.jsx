import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './config/firebaseConfig';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import IdleTimer from './components/IdleTimer';
import { RESPONSABILI_ACCOUNTS } from './services/authService';

export default function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Blocchiamo gli utenti anonimi che potresti aver creato in precedenza
      if (currentUser && !currentUser.isAnonymous) {
        setUser(currentUser);
        // Associa il ruolo in base all'email
        const email = currentUser.email.toLowerCase();
        if (RESPONSABILI_ACCOUNTS[email]) {
          setUserRole(RESPONSABILI_ACCOUNTS[email]);
        } else {
          // Se non è nella lista, lo forziamo a uscire
          signOut(auth);
          setUserRole(null);
          setUser(null);
          alert("Account non autorizzato.");
        }
      } else {
        setUser(null);
        setUserRole(null);
      }
      setIsAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  const handleIdleTimeout = () => {
    if (auth.currentUser) {
      signOut(auth);
      alert("Sessione scaduta per inattività. Effettua nuovamente l'accesso.");
    }
  };

  if (isAuthChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f6f9]">
        <div className="text-[#1a365d] font-bold animate-pulse text-lg tracking-wide">
          Verifica autorizzazioni...
        </div>
      </div>
    );
  }

  return (
    <>
      <IdleTimer user={user} onTimeout={handleIdleTimeout} timeoutMinutes={15} />
      {/* Se c'è un utente valido passa alla Dashboard (che conterrà l'algoritmo), altrimenti vai al Login */}
      {user && userRole ? (
        <DashboardPage user={user} userRole={userRole} />
      ) : (
        <LoginPage />
      )}
    </>
  );
}