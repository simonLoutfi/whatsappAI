const sessionStore = {};

function setSession(phone, key, value) {
  if (!sessionStore[phone]) {
    sessionStore[phone] = {};
  }
  sessionStore[phone][key] = value;
}

function getSession(phone, key) {
  return sessionStore[phone]?.[key];
}

function clearSession(phone) {
  delete sessionStore[phone];
}

module.exports = { setSession, getSession, clearSession };
