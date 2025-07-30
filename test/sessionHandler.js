const sessionStore = {};

function setSession(phone, data) {
  if (typeof data === 'object') {
    // Handle full session object
    sessionStore[phone] = {
      data: data,
      timestamp: Date.now()
    };
  } else {
    // Handle key-value pair (backward compatibility)
    if (!sessionStore[phone]) {
      sessionStore[phone] = {
        data: {},
        timestamp: Date.now()
      };
    }
    sessionStore[phone].data[data] = arguments[2];
    sessionStore[phone].timestamp = Date.now();
  }
  console.log(`Session updated for ${phone}:`, sessionStore[phone].data);
}

function getSession(phone) {
  if (!sessionStore[phone]) {
    console.log(`No session found for ${phone}`);
    return undefined;
  }
  sessionStore[phone].timestamp = Date.now(); // Update last access time
  return sessionStore[phone].data;
}

function clearSession(phone) {
  delete sessionStore[phone];
  console.log(`Session cleared for ${phone}`);
}

// Clean up old sessions every hour
setInterval(() => {
  const now = Date.now();
  const TIMEOUT = 30 * 60 * 1000; // 30 minutes
  for (const phone in sessionStore) {
    if (now - sessionStore[phone].timestamp > TIMEOUT) {
      delete sessionStore[phone];
      console.log(`Cleared expired session for ${phone}`);
    }
  }
}, 60 * 60 * 1000);

module.exports = { setSession, getSession, clearSession };