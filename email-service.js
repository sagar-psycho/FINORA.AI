import { EMAILJS_CONFIG } from './firebase-config.js';

let initialized = false;

async function ensureEmailJS() {
  if (!EMAILJS_CONFIG.enabled) return false;
  if (!window.emailjs) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  if (!initialized) {
    window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    initialized = true;
  }
  return true;
}

export async function sendEmail(type, payload = {}) {
  try {
    const ready = await ensureEmailJS();
    const templateId = EMAILJS_CONFIG.templates[type];
    if (!ready || !templateId || !EMAILJS_CONFIG.serviceId) {
      console.info('[FINORA Email disabled/fallback]', type, payload);
      return { ok: true, skipped: true };
    }
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, templateId, payload);
    return { ok: true };
  } catch (error) {
    console.warn('[FINORA Email failed gracefully]', error);
    return { ok: false, error };
  }
}
