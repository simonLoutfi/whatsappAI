import google.generativeai as genai

genai.configure(api_key="")

def classify_message(message):
    model = genai.GenerativeModel("gemini-2.0-flash")
    prompt = f"Classify the message strictly as 'order' or 'faq': {message}"
    response = model.generate_content(prompt)
    category = response.text.lower()
    return "order" if "order" in category else "faq"

def get_gemini_answer(question, faq, stock, profile):
    model = genai.GenerativeModel("gemini-1.5-flash-latest")
    prompt = f"""You are a helpful store assistant.
FAQ: {faq}
Stock: {stock}
Business Profile: {profile}
Answer this customer question clearly: {question}"""
    response = model.generate_content(prompt)
    print(f"Gemini response: {response.text}")
    return response.text.strip()

