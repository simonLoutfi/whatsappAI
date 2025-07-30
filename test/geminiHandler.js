const { GoogleGenerativeAI } = require('@google/generative-ai');
import { getSession, setSession } from './sessionHandler';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function detectLanguage(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const prompt = `Detect the language of this message and respond ONLY with the ISO 639-1 language code (e.g., 'en', 'es', 'ar'): ${message}`;
  
  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim().toLowerCase();
  } catch (err) {
    console.error('Gemini detectLanguage error:', err);
    return 'en'; // default to English
  }
}

async function getGeminiResponse(phone, message, context = {}) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const session = getSession(phone) || {};
  const lang = session.lang || await detectLanguage(message);
  
  // Update language if not set
  if (!session.lang) {
    setSession(phone, 'lang', lang);
  }

  // Get business data
  const { faq, stock, business_profiles } = await getFaqAndStock();
  const profile = business_profiles[0];

  // Build context prompt
  let prompt = `You are the customer service agent for ${profile.business_name}. 
Respond in ${lang} using the same style as the customer. Be friendly, professional and helpful.

Business Profile: ${JSON.stringify(profile)}
Available Stock: ${JSON.stringify(stock)}
FAQ Knowledge: ${JSON.stringify(faq)}

Current conversation context: ${JSON.stringify(context)}

Customer Message: ${message}

Provide a helpful response in ${lang} based on this information.`;

  // Special handling for order flow steps
  if (session.step) {
    prompt += `\n\nNOTE: The customer is currently at step '${session.step}' in the ordering process. 
Guide them appropriately through the flow.`;
  }

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini response error:', err);
    return lang === 'ar' ? "عذرًا، حدث خطأ. يرجى المحاولة لاحقًا" :
           "Sorry, an error occurred. Please try again later.";
  }
}

async function handleOrderStep(phone, message, step, stock, profile) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const session = getSession(phone);
  const lang = session?.lang || 'en';

  let prompt = `Generate the next message in ${lang} for the ordering process based on:
Current Step: ${step}
Customer Message: ${message}
Session Data: ${JSON.stringify(session)}
Available Stock: ${JSON.stringify(stock)}
Business Profile: ${JSON.stringify(profile)}

Provide ONLY the next message the assistant should send, guiding the customer through the order flow.`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    // Update session based on step completion
    if (step === 'product') {
      const selectedProduct = stock.find(item => 
        item.name.toLowerCase() === message.toLowerCase() ||
        item.sku.toString().toLowerCase() === message.trim().toLowerCase()
      );
      
      if (selectedProduct) {
        setSession(phone, {
          product: selectedProduct.name,
          product_sku: selectedProduct.sku,
          product_price: selectedPrice.price,
          max_quantity: selectedProduct.quantity,
          step: 'quantity'
        });
      }
    }
    // Add other step handling as needed...
    
    return response;
  } catch (err) {
    console.error('Gemini order step error:', err);
    return lang === 'ar' ? "الرجاء إدخال المعلومات المطلوبة:" : 
           "Please provide the required information:";
  }
}

module.exports = { detectLanguage, getGeminiResponse, handleOrderStep };