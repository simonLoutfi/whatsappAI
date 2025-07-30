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
    session.conversation = conversationHistory.slice(-10);
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
      response = await handleOrderConfirmation(phone, message, stock, profile);
      break;
    default:
      clearSession(phone);
      return lang === 'ar' ? "لنبدأ من جديد. كيف يمكنني مساعدتك؟" :
             "Let's start over. How can I help you?";
  }

  return response;
}

async function generateOrderQuestion(phone, step, stock, profile, customPrompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const session = getSession(phone);
  const lang = session?.lang || 'en';

  let prompt = customPrompt || `Generate a clear, friendly question in ${lang} for a customer during the ordering process. 
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

async function handleProductSelection(phone, message, stock, profile) {
  let session = getSession(phone);
  const lang = session.lang || 'en';
  
  const selectedProduct = stock.find(item => 
    item.name.toLowerCase() === message.toLowerCase() ||
    item.sku.toString().toLowerCase() === message.trim().toLowerCase()
  );

  if (!selectedProduct) {
    const errorPrompt = `Customer entered invalid product: ${message}. 
      Regenerate product question in ${lang} with friendly error message. 
      Available products: ${stock.map(p => `${p.name} (${p.sku})`).join(', ')}`;
    return generateOrderQuestion(phone, 'product_error', stock, profile, errorPrompt);
  }

  session = {
    ...session,
    product: selectedProduct.name,
    product_sku: selectedProduct.sku,
    product_price: selectedProduct.price,
    max_quantity: selectedProduct.quantity,
    step: 'quantity'
  };
  setSession(phone, session);

  return generateOrderQuestion(phone, 'quantity', stock, profile);
}

async function handleQuantitySelection(phone, message, stock, profile) {
  let session = getSession(phone);
  const lang = session.lang || 'en';
  const quantity = parseInt(message);
  const maxQuantity = session.max_quantity || stock.find(p => p.name === session.product)?.quantity || 0;

  if (isNaN(quantity)) {
    const errorPrompt = `Customer entered invalid quantity: ${message}. 
      Regenerate quantity question in ${lang} explaining they must enter a number. 
      Product: ${session.product}, Max available: ${maxQuantity}`;
    return generateOrderQuestion(phone, 'quantity_error', stock, profile, errorPrompt);
  }

  if (quantity <= 0) {
    const errorPrompt = `Customer entered quantity (${quantity}) must be positive. 
      Regenerate quantity question in ${lang} explaining this requirement. 
      Product: ${session.product}`;
    return generateOrderQuestion(phone, 'quantity_error', stock, profile, errorPrompt);
  }

  if (quantity > maxQuantity) {
    const errorPrompt = `Customer entered quantity (${quantity}) exceeds available stock (${maxQuantity}). 
      Regenerate quantity question in ${lang} explaining the stock limit. 
      Product: ${session.product}`;
    return generateOrderQuestion(phone, 'quantity_error', stock, profile, errorPrompt);
  }

  session = {
    ...session,
    quantity: quantity,
    step: 'name'
  };
  setSession(phone, session);

  return generateOrderQuestion(phone, 'name', stock, profile);
}

async function handleNameCollection(phone, message) {
  let session = getSession(phone);
  const lang = session.lang || 'en';

  if (message.trim().length < 3) {
    const errorPrompt = `Customer entered very short name: ${message}. 
      Regenerate name question in ${lang} explaining they need at least 3 characters.`;
    return generateOrderQuestion(phone, 'name_error', null, null, errorPrompt);
  }

  session = {
    ...session,
    customer_name: message.trim(),
    step: 'phone'
  };
  setSession(phone, session);

  return generateOrderQuestion(phone, 'phone');
}

async function handlePhoneCollection(phone, message) {
  let session = getSession(phone);
  const lang = session.lang || 'en';
  const phoneRegex = /^[+]?[\d\s-]{8,}$/;

  if (!phoneRegex.test(message)) {
    const errorPrompt = `Customer entered invalid phone: ${message}. 
      Regenerate phone question in ${lang} explaining they need a valid number.`;
    return generateOrderQuestion(phone, 'phone_error', null, null, errorPrompt);
  }

  session = {
    ...session,
    customer_phone: message.trim(),
    step: 'address'
  };
  setSession(phone, session);

  return generateOrderQuestion(phone, 'address');
}

async function handleAddressCollection(phone, message) {
  let session = getSession(phone);
  const lang = session.lang || 'en';

  if (message.trim().length < 10) {
    const errorPrompt = `Customer entered short address: ${message}. 
      Regenerate address question in ${lang} explaining they need complete address.`;
    return generateOrderQuestion(phone, 'address_error', null, null, errorPrompt);
  }

  session = {
    ...session,
    address: message.trim(),
    step: 'notes'
  };
  setSession(phone, session);

  return generateOrderQuestion(phone, 'notes');
}

async function handleNotesCollection(phone, message) {
  let session = getSession(phone);
  const lang = session.lang || 'en';

  const noneKeywords = {
    en: ['none', 'no', 'nothing'],
    ar: ['لا', 'لا شيء'],
    es: ['ninguno', 'nada'],
    fr: ['aucun', 'rien']
  };

  const notes = noneKeywords[lang]?.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  ) ? '' : message;

  session = {
    ...session,
    notes: notes,
    step: 'confirm'
  };
  setSession(phone, session);

  // Generate confirmation message
  const confirmationPrompt = `Generate order confirmation in ${lang} with these details:
  - Product: ${session.product}
  - Quantity: ${session.quantity}
  - Price: ${session.product_price}
  - Total: ${session.product_price * session.quantity}
  - Name: ${session.customer_name}
  - Phone: ${session.customer_phone}
  - Address: ${session.address}
  - Notes: ${notes || 'None'}
  
  Ask customer to confirm (yes/no) or cancel.`;

  return generateOrderQuestion(phone, 'confirm', null, null, confirmationPrompt);
}

async function handleOrderConfirmation(phone, message, stock, profile) {
  const session = getSession(phone);
  const lang = session.lang || 'en';

  const confirmKeywords = {
    en: ['yes', 'confirm', 'proceed'],
    ar: ['نعم', 'تأكيد'],
    es: ['sí', 'confirmar'],
    fr: ['oui', 'confirmer']
  };

  const isConfirmed = confirmKeywords[lang]?.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  );

  if (isConfirmed) {
    try {
      const result = await insertOrderWithItems(
        session.customer_phone,
        phone,
        session.customer_name,
        session.product_sku,
        session.product,
        session.quantity,
        session.product_price,
        session.notes
      );

      clearSession(phone);
      
      return lang === 'ar' 
        ? `✅ تم تأكيد الطلب!\n\nرقم الطلب: ${result.order_number}\nالمنتج: ${result.product_name}\nالكمية: ${result.quantity}\nالمجموع: ${result.total_amount}\n\nشكرًا لطلبك!` 
        : `✅ Order Confirmed!\n\nOrder #: ${result.order_number}\nProduct: ${result.product_name}\nQuantity: ${result.quantity}\nTotal: ${result.total_amount}\n\nThank you for your order!`;
    } catch (error) {
      clearSession(phone);
      return lang === 'ar' 
        ? `❌ فشل في تأكيد الطلب\n\nالخطأ: ${error.message}\nالرجاء المحاولة مرة أخرى` 
        : `❌ Order Failed\n\nError: ${error.message}\nPlease try again`;
    }
  } else {
    clearSession(phone);
    return lang === 'ar' 
      ? "تم إلغاء الطلب. كيف يمكنني مساعدتك؟" 
      : "Order cancelled. How can I help you?";
  }
}

function isCancellation(message, lang) {
  const cancelKeywords = {
    en: ['cancel', 'stop', 'abort'],
    ar: ['إلغاء', 'الغاء'],
    es: ['cancelar', 'parar'],
    fr: ['annuler', 'arrêter']
  };
  
  return cancelKeywords[lang]?.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  );
}

export { detectLanguage, getGeminiResponse, handleOrderFlow };