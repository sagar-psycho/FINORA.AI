import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

const hasConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const app = hasConfig ? (getApps()[0] || initializeApp(firebaseConfig)) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const storage = app ? getStorage(app) : null;

if (auth) setPersistence(auth, browserLocalPersistence).catch(console.warn);
if (db) enableIndexedDbPersistence(db).catch(() => {});
if (app) isSupported().then(ok => ok && getAnalytics(app)).catch(() => {});

export { app, auth, db, storage, hasConfig };
