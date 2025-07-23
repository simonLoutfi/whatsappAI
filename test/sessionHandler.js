const sessionStore = {};

function setSession(phone, key, value) {
  if (!sessionStore[phone]) {
    sessionStore[phone] = {
      data: {},
      timestamp: Date.now()
    };
  }
  sessionStore[phone].data[key] = value;
  sessionStore[phone].timestamp = Date.now();
}

function getSession(phone, key) {
  if (!sessionStore[phone]) return undefined;
  return sessionStore[phone].data[key];
}

function clearSession(phone) {
  delete sessionStore[phone];
}

// Clean up old sessions every hour
setInterval(() => {
  const now = Date.now();
  const TIMEOUT = 30 * 60 * 1000; // 30 minutes
  for (const phone in sessionStore) {
    if (now - sessionStore[phone].timestamp > TIMEOUT) {
      delete sessionStore[phone];
    }
  }
}, 60 * 60 * 1000);

module.exports = { setSession, getSession, clearSession };