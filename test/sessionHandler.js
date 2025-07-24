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
  console.log(`Session set for ${phone}:`, { [key]: value }); // Debug log
}

function getSession(phone, key) {
  if (!sessionStore[phone]) {
    console.log(`No session found for ${phone}`); // Debug log
    return undefined;
  }
  console.log(`Session get for ${phone}:`, { [key]: sessionStore[phone].data[key] }); // Debug log
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