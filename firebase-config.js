// FINORA Firebase + integration configuration
// Replace the values below with your Firebase web app config from Firebase Console.
export  const firebaseConfig = {
    apiKey: "AIzaSyBrw58Aj4XheFCxurVGiXUf2UtHpgPZjQE",
    authDomain: "personal-finance-manager-a483f.firebaseapp.com",
    projectId: "personal-finance-manager-a483f",
    storageBucket: "personal-finance-manager-a483f.firebasestorage.app",
    messagingSenderId: "667784957660",
    appId: "1:667784957660:web:23910cdd1aaf7ffdf1ae19"
  };

export const SUPER_ADMIN_EMAIL = "kothakulasagar2002@gmail.com";

export const EMAILJS_CONFIG = {
  enabled: false,
  publicKey: "",
  serviceId: "",
  templates: {
    registration: "",
    approved: "",
    rejected: "",
    reset: "",
    statement: "",
    summary: "",
    admin: ""
  }
};

export const APP_CONFIG = {
  appName: "FINORA",
  currency: "INR",
  locale: "en-IN",
  statementStorageEnabled: true,
  pageSize: 8,
  cacheTtlMs: 60000
};
