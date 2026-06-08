import { SUPER_ADMIN_EMAIL } from './firebase-config.js';
import { auth, db, hasConfig } from './firebase-core.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, signOut, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, setDoc, getDoc, serverTimestamp, collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { sendEmail } from './email-service.js';

const $ = s => document.querySelector(s);
const msg = $('#authMessage');

function show(text, ok = true) {
  if (!msg) return;
  msg.textContent = text;
  msg.className = 'message show';
  msg.style.borderColor = ok ? 'rgba(32,227,178,.3)' : 'rgba(255,92,122,.35)';
}
function setBusy(form, busy) { form?.querySelectorAll('button,input').forEach(el => el.disabled = busy); }
function friendly(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'Invalid email or password.';
  if (code.includes('email-already-in-use')) return 'This email is already registered.';
  if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
  if (code.includes('popup-closed')) return 'Google login was cancelled.';
  return error?.message || 'Something went wrong. Please try again.';
}
function tab(name) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.authTab === name));
  $('#' + name + 'Form')?.classList.add('active');
}
async function audit(action, meta = {}) {
  if (!db) return;
  try { await addDoc(collection(db, 'auditLogs'), { action, meta, createdAt: serverTimestamp() }); } catch (_) {}
}
async function createUserDocument(user, name = 'User') {
  const email = (user.email || '').toLowerCase();
  const isSuper = email === SUPER_ADMIN_EMAIL.toLowerCase();
  const data = {
    name: name || user.displayName || 'User',
    email,
    role: isSuper ? 'super_admin' : 'user',
    approved: isSuper,
    status: isSuper ? 'active' : 'pending',
    photoURL: user.photoURL || '',
    emailVerified: user.emailVerified || false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, 'users', user.uid), data, { merge: true });
  await audit('User Registration', { uid: user.uid, email, role: data.role, status: data.status });
  await sendEmail('registration', { to_email: email, name: data.name, status: data.status });
  return data;
}
async function getOrCreateUser(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  return createUserDocument(user, user.displayName || 'Google User');
}
async function postLogin(user) {
  const data = await getOrCreateUser(user);
  if (data.status === 'rejected') { show('Your account registration was rejected. Contact administrator.', false); await signOut(auth); return; }
  if (data.status === 'inactive') { show('Your account is inactive. Contact administrator.', false); await signOut(auth); return; }
  if (!data.approved || data.status === 'pending') { show('Your account is awaiting administrator approval.', false); await signOut(auth); return; }
  await setDoc(doc(db, 'users', user.uid), { lastLoginAt: serverTimestamp(), emailVerified: user.emailVerified }, { merge: true });
  await audit('Login', { uid: user.uid, email: user.email });
  location.href = ['admin', 'super_admin'].includes(data.role) ? 'admin.html' : 'dashboard.html';
}

if (!hasConfig) show('Firebase is not configured. Add your Firebase web app keys in firebase-config.js.', false);

document.querySelectorAll('[data-auth-tab]').forEach(b => b.onclick = () => tab(b.dataset.authTab));
$('#showForgot')?.addEventListener('click', e => { e.preventDefault(); tab('forgot'); });
$('#backLogin')?.addEventListener('click', () => tab('login'));
$('#themeToggle')?.addEventListener('click', () => { document.body.classList.toggle('light'); localStorage.setItem('finoraTheme', document.body.classList.contains('light') ? 'light' : 'dark'); });
if (localStorage.finoraTheme === 'light') document.body.classList.add('light');

$('#registerForm')?.addEventListener('submit', async e => {
  e.preventDefault(); if (!hasConfig) return show('Configure Firebase first.', false);
  setBusy(e.currentTarget, true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, $('#regEmail').value.trim(), $('#regPassword').value);
    await createUserDocument(cred.user, $('#regName').value.trim());
    await sendEmailVerification(cred.user).catch(() => {});
    await signOut(auth);
    show('Registration submitted successfully. Waiting for administrator approval.');
  } catch (err) { show(friendly(err), false); }
  finally { setBusy(e.currentTarget, false); }
});

$('#loginForm')?.addEventListener('submit', async e => {
  e.preventDefault(); if (!hasConfig) return show('Configure Firebase first.', false);
  setBusy(e.currentTarget, true);
  try { const cred = await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value); await postLogin(cred.user); }
  catch (err) { show(friendly(err), false); }
  finally { setBusy(e.currentTarget, false); }
});

$('#googleLogin')?.addEventListener('click', async () => {
  if (!hasConfig) return show('Configure Firebase first.', false);
  try { const cred = await signInWithPopup(auth, new GoogleAuthProvider()); await postLogin(cred.user); }
  catch (err) { show(friendly(err), false); }
});

$('#forgotForm')?.addEventListener('submit', async e => {
  e.preventDefault(); if (!hasConfig) return show('Configure Firebase first.', false);
  try { await sendPasswordResetEmail(auth, $('#forgotEmail').value.trim()); await sendEmail('reset', { to_email: $('#forgotEmail').value.trim() }); show('Password reset email sent successfully.'); }
  catch (err) { show(friendly(err), false); }
});

window.addEventListener('online', () => show('You are back online.'));
window.addEventListener('offline', () => show('You are offline. Some actions may be delayed.', false));
