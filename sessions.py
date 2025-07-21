session_store = {}

def set_session(phone, key, value):
    if phone not in session_store:
        session_store[phone] = {}
    session_store[phone][key] = value

def get_session(phone, key):
    return session_store.get(phone, {}).get(key)

def clear_session(phone):
    if phone in session_store:
        del session_store[phone]
