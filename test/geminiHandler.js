const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = 'AIzaSyAgXyRgMu-SCbHiBidZWwfJE4ZHQpvR-as';
const genAI = new GoogleGenerativeAI(apiKey);

async function classifyMessage(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Classify this message strictly as 'order' if it contains words like 'order', 'buy', 'purchase', 'want to get', or similar purchasing intent. Otherwise classify as 'faq': ${message}`;

  try {
    const result = await model.generateContent(prompt);
    const category = result.response.text().toLowerCase().trim();
    return category.includes('order') ? 'order' : 'faq';
  } catch (err) {
    console.error('Gemini classifyMessage error:', err);
    return 'faq'; // fallback
  }
}

async function getGeminiAnswer(question, faq, stock) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are a helpful store assistant.\nFAQ: ${JSON.stringify(faq)}\nStock: ${JSON.stringify(stock)}\nAnswer this customer question clearly: ${question}`;

  try {
    const result = await model.generateContent(prompt);
    const answer = result.response.text().trim();
    console.log('Gemini response:', answer);
    return answer;
  } catch (err) {
    console.error('Gemini getGeminiAnswer error:', err);
    return "I'm sorry, I couldn't get an answer right now.";
  }
}

module.exports = { classifyMessage, getGeminiAnswer };
