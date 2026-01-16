
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// TODO: Substitua pelas credenciais do seu projeto Firebase Console
// Console -> Configurações do Projeto -> Seus Aplicativos -> Web App
const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "seu-projeto.firebaseapp.com",
    projectId: "seu-projeto",
    storageBucket: "seu-projeto.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
