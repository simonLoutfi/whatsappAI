import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSession, setSession, clearSession } from './sessionHandler.js';
import { getFaqAndStock, insertOrderWithItems } from './supabaseHandler.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function detectLanguage(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const prompt = `Detect the language of this message and respond ONLY with the ISO 639-1 language code (e.g., 'en', 'es', 'ar'): ${message}`;
  
  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim().toLowerCase();
  } catch (err) {
    console.error('Gemini detectLanguage error:', err);
    return 'en';
  }
}

async function getGeminiResponse(phone, message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  let session = getSession(phone) || {};
  const lang = session.lang || await detectLanguage(message);
  
  // Update language if not set
  if (!session.lang) {
    session.lang = lang;
    setSession(phone, session);
  }

  // Get business data
  const { faq, stock, business_profiles } = await getFaqAndStock();
  const profile = business_profiles[0];

  // Build conversation history
  const conversationHistory = session.conversation || [];
  conversationHistory.push({ role: 'customer', content: message });
  
  // Build context prompt
  let prompt = `You are the customer service agent for ${profile.business_name}. 
Respond in ${lang} using the same style as the customer. Be friendly, professional and helpful.

Business Profile: ${JSON.stringify(profile)}
Available Stock: ${JSON.stringify(stock)}
FAQ Knowledge: ${JSON.stringify(faq)}

Conversation History:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Current Session State: ${JSON.stringify(session)}

Customer Message: ${message}

Provide a helpful response in ${lang} based on this information.`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    // Update conversation history and session
    conversationHistory.push({ role: 'assistant', content: response });
    session.conversation = conversationHistory.slice(-10); // Keep last 10 messages
    setSession(phone, session);
    
    return response;
  } catch (err) {
    console.error('Gemini response error:', err);
    return lang === 'ar' ? "عذرًا، حدث خطأ. يرجى المحاولة لاحقًا" :
           "Sorry, an error occurred. Please try again later.";
  }
}

async function handleOrderFlow(phone, message) {
  let session = getSession(phone) || {};
  const { stock, business_profiles } = await getFaqAndStock();
  const profile = business_profiles[0];
  const lang = session.lang || 'en';

  // Handle cancellation
  if (isCancellation(message, lang)) {
    clearSession(phone);
    return lang === 'ar' ? "تم إلغاء الطلب. كيف يمكنني مساعدتك؟" : 
           "Order cancelled. How can I help you?";
  }

  // Initialize order flow if not started
  if (!session.step) {
    session = {
      step: 'product',
      lang: lang,
      conversation: [{ role: 'customer', content: message }]
    };
    setSession(phone, session);
    return generateOrderQuestion(phone, 'product', stock, profile);
  }

  // Process current step
  let response;
  switch (session.step) {
    case 'product':
      response = await handleProductSelection(phone, message, stock, profile);
      break;
    case 'quantity':
      response = await handleQuantitySelection(phone, message, stock, profile);
      break;
    case 'name':
      response = await handleNameCollection(phone, message);
      break;
    case 'phone':
      response = await handlePhoneCollection(phone, message);
      break;
    case 'address':
      response = await handleAddressCollection(phone, message);
      break;
    case 'notes':
      response = await handleNotesCollection(phone, message);
      break;
    case 'confirm':
      response = await handleOrderConfirmation(phone, message);
      break;
    default:
      clearSession(phone);
      return lang === 'ar' ? "لنبدأ من جديد. كيف يمكنني مساعدتك؟" :
             "Let's start over. How can I help you?";
  }

  return response;
}


async function generateOrderQuestion(phone, step, stock, profile) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const session = getSession(phone);
  const lang = session?.lang || 'en';

  let prompt = `Generate a clear, friendly question in ${lang} for a customer during the ordering process. 
Business: ${JSON.stringify(profile)}
Current Stock: ${JSON.stringify(stock)}
Current Step: ${step}
Session Context: ${JSON.stringify(session)}

Provide ONLY the question to ask the customer for this step.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Order question generation error:', err);
    return lang === 'ar' ? "الرجاء إدخال المعلومات المطلوبة:" : 
           "Please provide the required information:";
  }
}

// Helper functions for order flow steps
async function handleProductSelection(phone, message, stock, profile) {
  const session = getSession(phone);
  const lang = session.lang || 'en';
  
  const selectedProduct = stock.find(item => 
    item.name.toLowerCase() === message.toLowerCase() ||
    item.sku.toString().toLowerCase() === message.trim().toLowerCase()
  );

  if (!selectedProduct) {
    const errorPrompt = `Customer entered invalid product: ${message}. 
      Regenerate product question in ${lang} with error message. 
      Available: ${stock.map(p => `${p.name} (${p.sku})`).join(', ')}`;
    return generateOrderQuestion(phone, 'product_error', stock, profile, errorPrompt);
  }

  setSession(phone, {
    product: selectedProduct.name,
    product_sku: selectedProduct.sku,
    product_price: selectedProduct.price,
    max_quantity: selectedProduct.quantity,
    step: 'quantity'
  });

  return generateOrderQuestion(phone, 'quantity', stock, profile);
}

// Implement similar handlers for other steps...

function isCancellation(message, lang) {
  const cancelKeywords = {
    en: ['cancel', 'stop', 'abort'],
    ar: ['إلغاء', 'الغاء', 'إStop'],
    es: ['cancelar', 'parar', 'detener'],
    fr: ['annuler', 'arrêter']
  };
  
  return cancelKeywords[lang]?.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  ) || cancelKeywords['en'].some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  );
}

export { detectLanguage, getGeminiResponse, handleOrderFlow };