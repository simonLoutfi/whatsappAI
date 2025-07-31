const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSession, setSession, clearSession } = require('./sessionHandler');
const { getFaqAndStock, insertOrderWithItems } = require('./supabaseHandler');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function detectLanguage(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const prompt = `Detect the language of this message. Consider:
- English: standard English
- Arabic: Arabic script (العربية)
- Arabizi/Franco-Arabic: Arabic written in Latin script (like "kifak", "chou", "3endak")
- French: French language
- Mixed: if multiple languages are used

Respond ONLY with one of: en, ar, arabizi, fr, mixed

Message: "${message}"`;
  
  try {
    const result = await model.generateContent(prompt);
    const detected = result.response.text().trim().toLowerCase();
    console.log(`Language detected for "${message}": ${detected}`);
    return detected;
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
  
  // Check if customer wants to make an order
  const orderKeywords = [
    // English
    'order', 'buy', 'purchase', 'want', 'need', 'get',
    // Arabic script
    'طلب', 'شراء', 'أريد', 'بدي', 'عاوز',
    // Arabizi/Franco-Arabic
    'baddi', 'biddi', 'ba2a', 'bade', '3ayz', '3ayez', 'awez',
    // French
    'commander', 'acheter', 'veux', 'voudrais'
  ];
  
  const isOrderIntent = orderKeywords.some(keyword => 
    message.toLowerCase().includes(keyword.toLowerCase())
  );

  // If order intent detected, start order flow
  if (isOrderIntent && !session.step) {
    console.log(`Order intent detected for ${phone}: ${message}`);
    return await initializeOrderFlow(phone, message, stock, profile, lang);
  }
  
  // Build context prompt for general conversation
  let prompt = `You are a friendly customer service agent. 
Respond in the SAME language/style as the customer's message. If they use:
- English: respond in English
- Arabic script: respond in Arabic script
- Arabizi/Franco-Arabic (Arabic in English letters like "kifak", "chou", "3endak"): respond in the same Arabizi style
- French: respond in French  
- Mixed languages: match their style and mix

IMPORTANT: Be natural and conversational. DO NOT include phrases like "Here's a question you can use" or similar instructional text.

Business Profile: ${JSON.stringify(profile)}
Available Stock: ${JSON.stringify(stock)}
FAQ Knowledge: ${JSON.stringify(faq)}

Conversation History:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Customer Message: ${message}

If the customer wants to order something, tell them you'll help them place an order and ask them to specify which product they want from the available stock.

Provide a helpful, natural response matching their language style.`;

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

async function initializeOrderFlow(phone, message, stock, profile, lang) {
  console.log(`Initializing order flow for ${phone}`);
  
  // Initialize order session
  const session = {
    step: 'product',
    lang: lang,
    conversation: [{ role: 'customer', content: message }]
  };
  setSession(phone, session);
  
  return generateOrderQuestion(phone, 'product', stock, profile);
}

async function handleOrderFlow(phone, message) {
  let session = getSession(phone) || {};
  const { stock, business_profiles } = await getFaqAndStock();
  const profile = business_profiles[0];
  const lang = session.lang || 'en';

  console.log(`Handling order flow for ${phone}, step: ${session.step}, message: ${message}`);

  // Handle cancellation
  if (isCancellation(message, lang)) {
    clearSession(phone);
    return lang === 'ar' ? "تم إلغاء الطلب. كيف يمكنني مساعدتك؟" : 
           lang === 'arabizi' ? "Tamma ilgha2 el talab. Kif fi sa3dik?" :
           lang === 'fr' ? "Commande annulée. Comment puis-je vous aider ?" :
           "Order cancelled. How can I help you?";
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

  let prompt;
  
  if (customPrompt) {
    prompt = customPrompt;
  } else {
    // Language instructions based on detected language
    let langInstruction = '';
    switch (lang) {
      case 'ar':
        langInstruction = 'Respond in Arabic script (العربية)';
        break;
      case 'arabizi':
        langInstruction = 'Respond in Arabizi/Franco-Arabic (Arabic using English letters like "kifak", "chou", "3endak")';
        break;
      case 'fr':
        langInstruction = 'Respond in French';
        break;
      case 'mixed':
        langInstruction = 'Match the customer\'s mixed language style';
        break;
      default:
        langInstruction = 'Respond in English';
    }

    switch (step) {
      case 'product':
        prompt = `${langInstruction}. Ask the customer which product they want to order.
Available products: ${stock.map(p => `${p.name} (SKU: ${p.sku}) - ${p.price}`).join(', ')}
Ask them to specify the product name or SKU. Be friendly and direct. DO NOT include instructional phrases.`;
        break;
      case 'quantity':
        prompt = `${langInstruction}. Ask how many units of "${session.product}" they want.
Available stock: ${session.max_quantity} units
Current price: ${session.product_price} per unit. Be direct and friendly.`;
        break;
      case 'name':
        prompt = `${langInstruction}. Ask for the customer's full name for the order. Be direct and friendly.`;
        break;
      case 'phone':
        prompt = `${langInstruction}. Ask for the customer's phone number for delivery contact. Be direct and friendly.`;
        break;
      case 'address':
        prompt = `${langInstruction}. Ask for the customer's complete delivery address. Be direct and friendly.`;
        break;
      case 'notes':
        prompt = `${langInstruction}. Ask if they have any special notes or instructions for the order. Tell them they can say "none" if no notes. Be direct and friendly.`;
        break;
      case 'confirm':
        const totalPrice = session.product_price * session.quantity;
        prompt = `${langInstruction}. Create a simple order confirmation summary with these details:
Product: ${session.product}
Quantity: ${session.quantity}
Unit Price: ${session.product_price}
Total: ${totalPrice}
Customer: ${session.customer_name}
Phone: ${session.customer_phone}
Address: ${session.address}
Notes: ${session.notes || 'None'}

Ask them to reply "YES" to confirm or "CANCEL" to abort. Keep it simple and clear. DO NOT format as an email or include company names.`;
        break;
      default:
        prompt = `${langInstruction}. Generate a helpful message for the ordering process step: ${step}. Be direct and friendly.`;
    }
  }

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Order question generation error:', err);
    return lang === 'ar' ? "الرجاء إدخال المعلومات المطلوبة:" : 
           lang === 'arabizi' ? "Fadlak add el ma3loumat el matloube:" :
           "Please provide the required information:";
  }
}

async function handleProductSelection(phone, message, stock, profile) {
  let session = getSession(phone);
  const lang = session.lang || 'en';
  
  console.log(`Product selection: ${message}, Available stock:`, stock.map(s => s.name));
  
  const selectedProduct = stock.find(item => 
    item.name.toLowerCase().includes(message.toLowerCase()) ||
    item.sku.toString().toLowerCase() === message.trim().toLowerCase() ||
    message.toLowerCase().includes(item.name.toLowerCase())
  );

  if (!selectedProduct) {
    const errorPrompt = `Customer entered invalid product: "${message}". 
Generate a friendly error message matching their language style and ask them to choose from available products.
Available products: ${stock.map(p => `${p.name} (SKU: ${p.sku}) - ${p.price}`).join(', ')}
DO NOT include instructional phrases. Be direct and helpful.`;
    return generateOrderQuestion(phone, 'product', stock, profile, errorPrompt);
  }

  console.log(`Product selected:`, selectedProduct);

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
  const quantity = parseInt(message.trim());
  const maxQuantity = session.max_quantity;

  console.log(`Quantity selection: ${message}, parsed: ${quantity}, max: ${maxQuantity}`);

  if (isNaN(quantity) || quantity <= 0) {
    const errorPrompt = `Customer entered invalid quantity: "${message}". 
Generate an error message matching their language style explaining they must enter a positive number.
Product: ${session.product}, Max available: ${maxQuantity}. BE direct and helpful.`;
    return generateOrderQuestion(phone, 'quantity', stock, profile, errorPrompt);
  }

  if (quantity > maxQuantity) {
    const errorPrompt = `Customer requested ${quantity} but only ${maxQuantity} available.
Generate an error message matching their language style explaining the stock limit.
Product: ${session.product}. Be direct and helpful.`;
    return generateOrderQuestion(phone, 'quantity', stock, profile, errorPrompt);
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

  console.log(`Name collection: ${message}`);

  if (message.trim().length < 2) {
    const errorPrompt = `Customer entered very short name: "${message}". 
Generate an error message matching their language style asking for their full name (at least 2 characters). Be direct and helpful.`;
    return generateOrderQuestion(phone, 'name', null, null, errorPrompt);
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
  const phoneRegex = /^[+]?[\d\s\-\(\)]{8,}$/;

  console.log(`Phone collection: ${message}`);

  if (!phoneRegex.test(message.trim())) {
    const errorPrompt = `Customer entered invalid phone: "${message}". 
Generate an error message matching their language style asking for a valid phone number. Be direct and helpful.`;
    return generateOrderQuestion(phone, 'phone', null, null, errorPrompt);
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

  console.log(`Address collection: ${message}`);

  if (message.trim().length < 5) {
    const errorPrompt = `Customer entered short address: "${message}". 
Generate an error message matching their language style asking for a complete delivery address. Be direct and helpful.`;
    return generateOrderQuestion(phone, 'address', null, null, errorPrompt);
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

  console.log(`Notes collection: ${message}`);

  const noneKeywords = ['none', 'no', 'nothing', 'لا', 'لا شيء', 'ninguno', 'nada', 'aucun', 'rien'];
  const isNone = noneKeywords.some(word => 
    message.toLowerCase().trim() === word.toLowerCase()
  );

  const notes = isNone ? '' : message.trim();

  session = {
    ...session,
    notes: notes,
    step: 'confirm'
  };
  setSession(phone, session);

  return generateOrderQuestion(phone, 'confirm');
}

async function handleOrderConfirmation(phone, message, stock, profile) {
  const session = getSession(phone);
  const lang = session.lang || 'en';

  console.log(`Order confirmation: ${message}, Session:`, session);

  // Check required fields
  if (!session.customer_name || !session.customer_phone || !session.address) {
    console.log('Missing required fields:', {
      name: session.customer_name,
      phone: session.customer_phone,
      address: session.address
    });
    clearSession(phone);
    return lang === 'ar' ? 
      "يبدو أن هناك معلومات ناقصة. لنبدأ الطلب من جديد." :
      "Some details are missing. Let's start the order again.";
  }

  const confirmKeywords = ['yes', 'confirm', 'proceed', 'ok', 'نعم', 'تأكيد', 'sí', 'confirmar', 'oui', 'confirmer'];
  const isConfirmed = confirmKeywords.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  );

  if (isConfirmed) {
    try {
      console.log('Attempting to insert order with:', {
        customer_phone: session.customer_phone,
        customer_whatsapp: phone,
        customer_name: session.customer_name,
        productSku: session.product_sku,
        productName: session.product,
        quantity: session.quantity,
        unitPrice: session.product_price,
        notes: `Address: ${session.address}${session.notes ? `\nNotes: ${session.notes}` : ''}`
      });

      const result = await insertOrderWithItems(
        session.customer_phone,
        phone,
        session.customer_name,
        session.product_sku,
        session.product,
        session.quantity,
        session.product_price,
        `Address: ${session.address}${session.notes ? `\nNotes: ${session.notes}` : ''}`
      );

      console.log('Order inserted successfully:', result);
      
      clearSession(phone);
      
      const totalAmount = session.product_price * session.quantity;
      return `✅ Order Confirmed!\n\n` +
             `Order #: ${result.order_number}\n` +
             `Product: ${session.product}\n` +
             `Quantity: ${session.quantity}\n` +
             `Unit Price: ${session.product_price}\n` +
             `Total: ${totalAmount}\n` +
             `Customer: ${session.customer_name}\n` +
             `Phone: ${session.customer_phone}\n` +
             `Delivery to: ${session.address}\n` +
             `${session.notes ? `Notes: ${session.notes}\n` : ''}` +
             `\nThank you for your order! We'll contact you soon.`;
    } catch (error) {
      console.error('Order insertion failed:', error);
      clearSession(phone);
      return `❌ Order Failed\n\nError: ${error.message}\nPlease try again or contact support.`;
    }
  } else {
    clearSession(phone);
    return lang === 'ar' ? "تم إلغاء الطلب. كيف يمكنني مساعدتك؟" : 
           "Order cancelled. How can I help you?";
  }
}

function isCancellation(message, lang) {
  const cancelKeywords = ['cancel', 'stop', 'abort', 'إلغاء', 'الغاء', 'cancelar', 'parar', 'annuler', 'arrêter'];
  return cancelKeywords.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  );
}

module.exports = { detectLanguage, getGeminiResponse, handleOrderFlow };