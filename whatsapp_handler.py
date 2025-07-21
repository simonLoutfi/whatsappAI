import requests

TOKEN = "EAAULrxtQZB0oBPJLYz8Jdy20ymSnKil2a9NskWokVPH7ZBGr0NFUzWfHWx3kZAYe7VnhHGN5w59Xe0449cvtgtjwcX0aXNnSP6SBKxaZBT7RfySR3XSSxZCZAofPmfYVW78N4ur7GpQxbRpNWZAu2MvdzPWZCrLDIb3HVsgeGXNCggYUQyd6ZA3JzYwD5jtFh8r4IN4d06Ki4KoSvRZBwkefhlxiYtIEZCNcduv3fRcLRsDnmvZArgZDZD"
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
