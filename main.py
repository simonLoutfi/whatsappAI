from flask import Flask, request, jsonify
from whatsapp_handler import send_whatsapp_message
from gemini_handler import classify_message, get_gemini_answer
from supabase_handler import get_faq_stock_and_profile, insert_order
from sessions import set_session, get_session, clear_session

app = Flask(__name__)

VERIFY_TOKEN = "whatsapp_secret_23c8f1a7"  # set the same token in WhatsApp App Settings

@app.route('/webhook', methods=['GET', 'POST'])
def webhook():
    if request.method == 'GET':
        # Verification step
        verify_token = request.args.get("hub.verify_token")
        challenge = request.args.get("hub.challenge")
        if verify_token == VERIFY_TOKEN:
            return challenge, 200
        else:
            return "Verification token mismatch", 403

    # POST handling
    data = request.json
    try:
        message_text = data["entry"][0]["changes"][0]["value"]["messages"][0]["text"]["body"]
        phone_number = data["entry"][0]["changes"][0]["value"]["messages"][0]["from"]
    except (KeyError, IndexError, TypeError):
        return "No valid message received", 400

    classification = classify_message(message_text)

    if classification == 'order':
        handle_order(phone_number, message_text)
    elif classification == 'faq':
        faq, stock, profile = get_faq_stock_and_profile()
        reply = get_gemini_answer(message_text, faq, stock, profile)
        send_whatsapp_message(phone_number, reply)
    else:
        send_whatsapp_message(phone_number, "Sorry, I couldn't understand your request.")

    return jsonify({"status": "success"}), 200


def handle_order(phone, incoming_message):
    step = get_session(phone, "step")

    if step is None:
        set_session(phone, "step", "product")
        send_whatsapp_message(phone, "What product do you want to order?")
        return

    elif step == "product":
        set_session(phone, "product", incoming_message)
        set_session(phone, "step", "quantity")
        send_whatsapp_message(phone, "How many units do you want?")
        return

    elif step == "quantity":
        set_session(phone, "quantity", incoming_message)
        set_session(phone, "step", "address")
        send_whatsapp_message(phone, "What is your delivery address?")
        return

    elif step == "address":
        product = get_session(phone, "product")
        quantity = get_session(phone, "quantity")
        address = incoming_message

        insert_order(phone, product, quantity, address)
        clear_session(phone)

        send_whatsapp_message(phone, f"✅ Your order for {quantity} x {product} to '{address}' has been placed. Thank you!")
        return

    else:
        clear_session(phone)
        send_whatsapp_message(phone, "Let's start over. What product do you want to order?")
        set_session(phone, "step", "product")


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
