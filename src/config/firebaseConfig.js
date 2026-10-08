import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
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

export { auth, db };