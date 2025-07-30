const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function classifyMessage(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Analyze the following message and classify it strictly as 'order' if it contains purchasing intent 
  (words like 'order', 'buy', 'purchase', 'want to get', or equivalent in any language). Otherwise classify as 'faq'.
  Respond with just 'order' or 'faq' in lowercase. Maintain the original language/style of this message in your analysis: ${message}`;

  try {
    const result = await model.generateContent(prompt);
    const category = result.response.text().toLowerCase().trim();
    return category.includes('order') ? 'order' : 'faq';
  } catch (err) {
    console.error('Gemini classifyMessage error:', err);
    return 'faq'; // fallback
  }
}

async function getGeminiAnswer(question, faq, stock, profile) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are a helpful store assistant.
FAQ: ${JSON.stringify(faq)}
Stock: ${JSON.stringify(stock)}
Business Profile: ${JSON.stringify(profile)}
Answer this customer question clearly: ${question}`;

  try {
    const result = await model.generateContent(prompt);
    const answer = result.response.text().trim();
    console.log('Gemini response:', answer);
    return answer;
  } catch (err) {
    console.error('Gemini getGeminiAnswer error:', err);
    return question.includes('؟') ? "آسف، حدث خطأ ما. الرجاء المحاولة لاحقاً" : 
           /[ء-ي]/.test(question) ? "معذرة، لا يمكنني الإجابة الآن" :
           "I'm sorry, I couldn't get an answer right now.";
  }
}

module.exports = { classifyMessage, getGeminiAnswer };
