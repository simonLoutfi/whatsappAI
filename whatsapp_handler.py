import requests

TOKEN = "EAAULrxtQZB0oBPBRThj4hsbMCirm2TStPZCVeEJF3RyhyA4roZC7WPaR3arYETvWVO12hHXPYplSA5jFE5ZCTWTnPAPfonU0WfDYsmjpoY1bvGpqQCeAvkpw0ZAC2wBmxBvWp1M1qGFHakqZCEtBm9bwvp2yDZBuFSofZC4LUEZBBjGEjZBtYjDVOZCKlHtdN0UXuNMz4v0ewdNBG5JfrINybGZBNlOnJbNArhcW7X0ZBGWxQW48BwNMZD"
PHONE_NUMBER_ID = "1290492105934901"

def send_whatsapp_message(to, message):
    url = f"https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages"
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": message}
    }
    response = requests.post(url, headers=headers, json=payload)
    print(f"WhatsApp status: {response.status_code}, response: {response.json()}")
