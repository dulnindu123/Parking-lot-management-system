import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCesdtF3zGGek4rQhagDLPI-FiocSWRX5I",
  authDomain: "parking-lot-128cc.firebaseapp.com",
  projectId: "parking-lot-128cc",
  storageBucket: "parking-lot-128cc.firebasestorage.app",
  messagingSenderId: "429588449544",
  appId: "1:429588449544:web:324b03887b2426998304bd",
  measurementId: "G-ZRYPDFPKPT"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
