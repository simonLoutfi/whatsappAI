const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSession, setSession, clearSession } = require('./sessionHandler');
const { getFaqAndStock, insertOrderWithItems, insertUnknownQuestion } = require('./supabaseHandler');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function detectLanguage(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const prompt = `Detect the language of this message. Consider:
- English: standard English
- Arabic: Arabic script (العربية) - ANY message containing Arabic letters/script
- Arabizi/Franco-Arabic: Arabic written in Latin script (like "kifak", "chou", "3endak", "bade", "baddi")
- French: French language
- Mixed: if multiple languages are used

IMPORTANT: If the message contains ANY Arabic script characters (العربية), classify it as "ar" even if it has some Latin characters.

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
  
  // Update language if not set OR if customer switches to Arabic
  const currentLang = await detectLanguage(message);
  if (!session.lang || currentLang === 'ar') {
    session.lang = currentLang;
    setSession(phone, session);
  }

  // Check if customer wants to cancel/stop the order flow
  if (session.step && isCancellation(message, session.lang)) {
    clearSession(phone);
    return getCancellationMessage(session.lang);
  }

  // Check if customer wants to start over or have general conversation during order
  if (session.step && isRestartOrGeneralChat(message, session.lang)) {
    // Clear order session but keep language preference
    const newSession = { lang: session.lang };
    setSession(phone, newSession);
    
    // Handle as general conversation
    return await handleGeneralConversation(phone, message, session.lang);
  }

  // If in order flow, continue with order handling
  if (session.step) {
    return await handleOrderFlow(phone, message);
  }

  // Get business data
  const { faq, stock, business_profiles } = await getFaqAndStock();
  const profile = business_profiles[0];

  // Build conversation history
  const conversationHistory = session.conversation || [];
  conversationHistory.push({ role: 'customer', content: message });
  
  // Check if customer wants to make an order - FIXED VERSION
  const isOrderIntent = checkOrderIntent(message, session.lang);

  // If order intent detected, start order flow - FIXED
  if (isOrderIntent) {
    console.log(`Order intent detected for ${phone}: ${message} (lang: ${session.lang})`);
    console.log(`Current session before order:`, session);
    return await initializeOrderFlow(phone, message, stock, profile, session.lang);
  }
  
  // Handle general conversation
  return await handleGeneralConversation(phone, message, session.lang, conversationHistory, faq, stock, profile);
}

// FIXED: More comprehensive order intent detection
function checkOrderIntent(message, lang) {
  const orderKeywords = {
    'en': [
      'i want to order', 'i need to buy', 'i would like to purchase', 
      'place order', 'make order', 'order please', 'want to order',
      'i\'d like to order', 'can i order', 'let me order'
    ],
    'ar': [
      'أريد أن أطلب', 'بدي أطلب', 'عاوز أشتري', 'أريد شراء', 
      'بدي أشتري', 'بدي أطلب منك', 'عايز أطلب', 'بدي اطلب'
    ],
    'arabizi': [
      'baddi order', 'biddi ashtri', 'ba2a order', 'bade order', 
      'baddi ashtri', 'bade ashtri', 'bidi order', 'bidi ashtri',
      'biddi order', 'ba2a ashtri', 'badde order', 'badde ashtri'
    ],
    'fr': [
      'je veux commander', 'je voudrais acheter', 'passer commande',
      'je veux acheter', 'commander', 'acheter'
    ]
  };

  const keywords = orderKeywords[lang] || orderKeywords['en'];
  const messageLower = message.toLowerCase().trim();
  
  console.log(`Checking order intent for: "${messageLower}" in language: ${lang}`);
  console.log(`Keywords to check:`, keywords);
  
  // Check for exact matches first (most reliable)
  for (const keyword of keywords) {
    if (messageLower === keyword.toLowerCase()) {
      console.log(`Exact match found: "${keyword}"`);
      return true;
    }
  }
  
  // Check for partial matches
  for (const keyword of keywords) {
    if (messageLower.includes(keyword.toLowerCase())) {
      console.log(`Partial match found: "${keyword}"`);
      return true;
    }
  }
  
  // Additional specific checks for arabizi variations
  if (lang === 'arabizi' || lang === 'mixed') {
    const arabiziPatterns = [
      /\b(bade|badde|baddi|bidi|biddi|ba2a)\s+(order|ashtri)\b/i,
      /\byalla\s+(bade|badde|baddi)\s+(order|ashtri)\b/i
    ];
    
    for (const pattern of arabiziPatterns) {
      if (pattern.test(messageLower)) {
        console.log(`Arabizi pattern match found: ${pattern}`);
        return true;
      }
    }
  }
  
  console.log(`No order intent found for: "${messageLower}"`);
  return false;
}

function isRestartOrGeneralChat(message, lang) {
  const restartKeywords = {
    'en': ['hi', 'hello', 'hey', 'start over', 'restart', 'new conversation', 'help', 'info'],
    'ar': ['مرحبا', 'أهلا', 'السلام', 'من جديد', 'مساعدة', 'معلومات', 'مراحب', 'مرحباً'],
    'arabizi': ['marhaba', 'ahla', 'kifak', 'shu', 'help', 'info'],
    'fr': ['salut', 'bonjour', 'aide', 'info', 'recommencer']
  };

  const keywords = restartKeywords[lang] || restartKeywords['en'];
  const messageLower = message.toLowerCase().trim();
  
  return keywords.some(keyword => 
    messageLower === keyword.toLowerCase() || 
    messageLower.startsWith(keyword.toLowerCase())
  );
}

function getCancellationMessage(lang) {
  const messages = {
    'ar': "تم إلغاء الطلب. أهلاً بك! كيف يمكنني مساعدتك؟",
    'arabizi': "Tamma ilgha2 el talab. Ahla bik! Kif fi sa3dik?",
    'fr': "Commande annulée. Salut! Comment puis-je vous aider?",
    'en': "Order cancelled. Hey there! How can I help you?"
  };
  return messages[lang] || messages['en'];
}

function getGreetingMessage(lang) {
  const greetings = {
    'ar': "أهلاً وسهلاً! كيف يمكنني مساعدتك؟",
    'arabizi': "Ahla bik! Kif fi sa3dik?",
    'fr': "Salut! Comment puis-je vous aider?",
    'en': "Hey there! How can I help you?"
  };
  return greetings[lang] || greetings['en'];
}

async function handleGeneralConversation(phone, message, lang, conversationHistory = [], faq = [], stock = [], profile = {}) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  let session = getSession(phone) || {};

  // Check if this is a greeting
  const greetingKeywords = {
    'en': ['hi', 'hello', 'hey'],
    'ar': ['مرحبا', 'أهلا', 'السلام', 'مرحباً', 'اهلاً', 'مراحب', 'اهلا'],
    'arabizi': ['marhaba', 'ahla', 'kifak', 'shu', 'hai', 'hello'],
    'fr': ['salut', 'bonjour']
  };

  const keywords = greetingKeywords[lang] || greetingKeywords['en'];
  const messageLower = message.toLowerCase().trim();
  const isGreeting = keywords.some(keyword => 
    messageLower === keyword.toLowerCase() || 
    messageLower.startsWith(keyword.toLowerCase())
  );

  if (isGreeting) {
    return getGreetingMessage(lang);
  }

  // Build context prompt for general conversation with confidence assessment
  let prompt = `You are a friendly customer service agent. 
Respond in the detected language style: ${lang}

Language instructions:
- English (en): respond in English
- Arabic script (ar): respond ONLY in Arabic script العربية - NO Latin letters, NO mixed language
- Arabizi/Franco-Arabic (arabizi): respond in Arabizi style (Arabic using English letters like "kifak", "chou", "3endak")
- French (fr): respond in French
- Mixed: match their style

CRITICAL ARABIC INSTRUCTIONS:
- If lang is "ar", you MUST respond ONLY in Arabic script (العربية)
- Do NOT mix Arabic and Latin letters when lang is "ar"
- Use proper Arabic vocabulary for products: تفاح (apple), موز (banana), خوخ (peach)
- When customer says they don't understand English, respond purely in Arabic

IMPORTANT: Be natural and conversational. Give ONE clear, direct response. DO NOT include multiple examples or instructional phrases.

CRITICAL ORDER INSTRUCTIONS:
- If customer shows ANY order intent (wants to buy/order something), respond naturally but remind them to use these EXACT phrases:
  * English: "I want to order"
  * Arabizi: "bade order" 
  * Arabic: "أريد أن أطلب"
  * French: "je veux commander"
- DO NOT try to handle orders in general conversation
- Be helpful but redirect clearly to the order phrases

CONFIDENCE ASSESSMENT:
After your response, on a NEW LINE, add exactly one of these confidence indicators:
- CONFIDENT: if you can answer the question well using the provided business data
- UNCERTAIN: if you're not sure about the answer or it's not covered in the business data
- UNKNOWN: if you cannot answer the question at all or need more information

Business Profile: ${JSON.stringify(profile)}
Available Stock: ${JSON.stringify(stock)}
FAQ Knowledge: ${JSON.stringify(faq)}

Conversation History:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Customer Message: ${message}

Provide ONE helpful, natural response matching their language style. Keep it conversational and friendly.
Remember to add the confidence indicator on a new line at the end.`;

  try {
    const result = await model.generateContent(prompt);
    const fullResponse = result.response.text().trim();
    
    // Parse response and confidence level
    const lines = fullResponse.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    const confidenceIndicators = ['CONFIDENT', 'UNCERTAIN', 'UNKNOWN'];
    
    let confidence = 'CONFIDENT'; // default
    let response = fullResponse;
    
    // Check if last line contains confidence indicator
    if (confidenceIndicators.some(indicator => lastLine.includes(indicator))) {
      confidence = confidenceIndicators.find(indicator => lastLine.includes(indicator)) || 'CONFIDENT';
      // Remove confidence line from response
      response = lines.slice(0, -1).join('\n').trim();
    }
    
    console.log(`=== CONVERSATION CONFIDENCE ASSESSMENT ===`);
    console.log(`Message: ${message}`);
    console.log(`Confidence: ${confidence}`);
    console.log(`Language: ${lang}`);
    
    // If confidence is UNCERTAIN or UNKNOWN, save question to FAQ for admin review
    if (confidence === 'UNCERTAIN' || confidence === 'UNKNOWN') {
      try {
        await insertUnknownQuestion(message, lang, confidence);
        console.log(`Unknown question saved to FAQ: ${message}`);
      } catch (error) {
        console.error('Failed to save unknown question:', error);
        // Don't fail the conversation if FAQ insertion fails
      }
    }
    
    // Update conversation history and session
    const updatedHistory = conversationHistory || [];
    updatedHistory.push({ role: 'assistant', content: response });
    session.conversation = updatedHistory.slice(-10);
    session.lang = lang;
    setSession(phone, session);
    
    return response;
  } catch (err) {
    console.error('Gemini response error:', err);
    
    // Save the question as unknown since we couldn't process it
    try {
      await insertUnknownQuestion(message, lang, 'UNKNOWN');
      console.log(`Error case - Unknown question saved to FAQ: ${message}`);
    } catch (faqError) {
      console.error('Failed to save unknown question in error case:', faqError);
    }
    
    return lang === 'ar' ? "عذرًا، حدث خطأ. يرجى المحاولة لاحقًا" :
           lang === 'arabizi' ? "Asfe, sar ghalat. Jarrib ba3den" :
           lang === 'fr' ? "Désolé, une erreur s'est produite. Réessayez plus tard" :
           "Sorry, an error occurred. Please try again later.";
  }
}

// FIXED: Cleaner order flow initialization
async function initializeOrderFlow(phone, message, stock, profile, lang) {
  console.log(`=== INITIALIZING ORDER FLOW ===`);
  console.log(`Phone: ${phone}`);
  console.log(`Message: ${message}`);
  console.log(`Language: ${lang}`);
  
  // Clear any existing session and start fresh
  clearSession(phone);
  
  // Initialize clean order session
  const session = {
    step: 'product',
    lang: lang,
    conversation: [{ role: 'customer', content: message }],
    orderStarted: true,
    timestamp: new Date().toISOString()
  };
  setSession(phone, session);
  
  console.log(`Order session initialized:`, session);
  
  return generateOrderQuestion(phone, 'product', stock, profile);
}

async function handleOrderFlow(phone, message) {
  let session = getSession(phone) || {};
  const { stock, business_profiles } = await getFaqAndStock();
  const profile = business_profiles[0];
  const lang = session.lang || 'en';

  console.log(`=== HANDLING ORDER FLOW ===`);
  console.log(`Phone: ${phone}`);
  console.log(`Step: ${session.step}`);
  console.log(`Message: ${message}`);
  console.log(`Language: ${lang}`);

  // Handle cancellation
  if (isCancellation(message, lang)) {
    clearSession(phone);
    return getCancellationMessage(lang);
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
      return lang === 'ar' ? "لنبدأ من جديد. أهلاً بك! كيف يمكنني مساعدتك؟" :
             lang === 'arabizi' ? "Yalla nbalesh mn jedid. Ahla bik! Kif fi sa3dik?" :
             lang === 'fr' ? "Recommençons. Salut! Comment puis-je vous aider?" :
             "Let's start over. Hey there! How can I help you?";
  }

  return response;
}

async function generateOrderQuestion(phone, step, stock, profile, customPrompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const session = getSession(phone);
  const lang = session?.lang || 'en';

  console.log(`=== GENERATING ORDER QUESTION ===`);
  console.log(`Step: ${step}`);
  console.log(`Language: ${lang}`);

  let prompt;
  
  if (customPrompt) {
    prompt = customPrompt;
  } else {
    // Language instructions based on detected language
    let langInstruction = '';
    switch (lang) {
      case 'ar':
        langInstruction = 'Respond ONLY in Arabic script (العربية) - NO Latin letters, NO mixed language';
        break;
      case 'arabizi':
        langInstruction = 'Respond in Arabizi/Franco-Arabic (Arabic using English letters like "kifak", "chou", "3endak", "badak")';
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

    // CRITICAL: Added instruction to prevent multiple examples
    const commonInstruction = `${langInstruction}. 

IMPORTANT: Provide ONLY ONE clear, direct response. Do NOT include multiple examples or formats. Be conversational and natural.`;

    switch (step) {
      case 'product':
        prompt = `${commonInstruction} The customer wants to place an order. Ask them to choose ONE specific product from the available list.

Available products: ${stock.map(p => `${p.name} (SKU: ${p.sku}) - Price: ${p.price}`).join(', ')}

Ask which product they want and list the available products clearly. Ask them to tell you the product name or SKU. Be friendly and direct. Mention they can type "cancel" to stop the order.

If language is Arabic (ar), use Arabic names for products: تفاح (apple), موز (banana), خوخ (peach)`;
        break;
      case 'quantity':
        prompt = `${commonInstruction}. Ask how many units of "${session.product}" they want.

Make sure to specify that they need to give you a NUMBER only.
Available stock: ${session.max_quantity} units
Current price: ${session.product_price} per unit

Ask them to tell you exactly how many they want (just the number). Be direct and friendly. Remind them they can type "cancel" to stop.`;
        break;
      case 'name':
        prompt = `${commonInstruction}. Ask for the customer's full name for the order.

Ask them to provide their complete name for delivery. Be direct and friendly. Remind them they can type "cancel" to stop.`;
        break;
      case 'phone':
        prompt = `${commonInstruction}. Ask for the customer's phone number for delivery contact.

Ask them to provide their phone number so delivery can contact them. Be direct and friendly. Remind them they can type "cancel" to stop.`;
        break;
      case 'address':
        prompt = `${commonInstruction}. Ask for the customer's complete delivery address.

Ask them to provide their full address for delivery. Be direct and friendly. Remind them they can type "cancel" to stop.`;
        break;
      case 'notes':
        prompt = `${commonInstruction}. Ask if they have any special notes or instructions for the order.

Tell them they can add special instructions or say "none"/"la" if no notes needed. Be direct and friendly. Remind them they can type "cancel" to stop.`;
        break;
      case 'confirm':
        const totalPrice = session.product_price * session.quantity;
        prompt = `${commonInstruction}. Create a simple order confirmation summary with these details:
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
        prompt = `${commonInstruction}. Generate a helpful message for the ordering process step: ${step}. Be direct and friendly. Remind them they can type "cancel" to stop.`;
    }
  }

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    console.log(`Generated question: ${response}`);
    return response;
  } catch (err) {
    console.error('Order question generation error:', err);
    return lang === 'ar' ? "الرجاء إدخال المعلومات المطلوبة:" : 
           lang === 'arabizi' ? "Fadlak add el ma3loumat el matloube:" :
           lang === 'fr' ? "Veuillez fournir les informations requises:" :
           "Please provide the required information:";
  }
}

async function handleProductSelection(phone, message, stock, profile) {
  let session = getSession(phone);
  const lang = session.lang || 'en';
  
  console.log(`=== PRODUCT SELECTION ===`);
  console.log(`Message: ${message}`);
  console.log(`Available stock:`, stock.map(s => `${s.name} (${s.sku})`));
  
  // More flexible product matching including Arabic names
  const messageLower = message.toLowerCase().trim();
  const selectedProduct = stock.find(item => {
    const itemNameLower = item.name.toLowerCase();
    const itemSku = item.sku.toString().toLowerCase();
    
    return (
      itemNameLower.includes(messageLower) ||
      messageLower.includes(itemNameLower) ||
      itemSku === messageLower ||
      // Handle common arabizi variations
      (itemNameLower === 'banana' && (messageLower.includes('moz') || messageLower.includes('banana') || messageLower.includes('موز'))) ||
      (itemNameLower === 'apple' && (messageLower.includes('tefeh') || messageLower.includes('teffeh') || messageLower.includes('apple') || messageLower.includes('تفاح'))) ||
      (itemNameLower === 'peach' && (messageLower.includes('darra') || messageLower.includes('peach') || messageLower.includes('خوخ')))
    );
  });

  if (!selectedProduct) {
    console.log(`No product found for: ${message}`);
    const errorPrompt = `Customer entered: "${message}" but we couldn't find a matching product. 

Generate ONE friendly error message in ${lang} language style and ask them to choose from available products.
Available products: ${stock.map(p => `${p.name} (SKU: ${p.sku}) - Price: ${p.price}`).join(', ')}

If language is Arabic (ar), use Arabic names: تفاح (apple), موز (banana), خوخ (peach)

Remind them they can type "cancel" to stop the order. Be direct and helpful. Show the exact product names they can choose from.

IMPORTANT: Provide ONLY ONE response, not multiple examples.`;
    
    return generateOrderQuestion(phone, 'product', stock, profile, errorPrompt);
  }

  console.log(`Product selected:`, selectedProduct);

  session = {
    ...session,
    product: selectedProduct.name,
    product_sku: selectedProduct.sku,
    product_price: selectedProduct.price,
    max_quantity: selectedProduct.quantity,
    step: 'quantity',
    orderStarted: true
  };
  setSession(phone, session);

  return generateOrderQuestion(phone, 'quantity', stock, profile);
}

async function handleQuantitySelection(phone, message, stock, profile) {
  let session = getSession(phone);
  const lang = session.lang || 'en';
  const quantity = parseInt(message.trim());
  const maxQuantity = session.max_quantity;

  console.log(`=== QUANTITY SELECTION ===`);
  console.log(`Message: ${message}, parsed: ${quantity}, max: ${maxQuantity}`);

  if (isNaN(quantity) || quantity <= 0) {
    const errorPrompt = `Customer entered invalid quantity: "${message}". 
Generate ONE error message matching their language style (${lang}) explaining they must enter a positive number.
Product: ${session.product}, Max available: ${maxQuantity}. Remind them they can type "cancel" to stop. Be direct and helpful.

IMPORTANT: Provide ONLY ONE response, not multiple examples.`;
    
    return generateOrderQuestion(phone, 'quantity', stock, profile, errorPrompt);
  }

  if (quantity > maxQuantity) {
    const errorPrompt = `Customer requested ${quantity} but only ${maxQuantity} available.
Generate ONE error message matching their language style (${lang}) explaining the stock limit.
Product: ${session.product}. Remind them they can type "cancel" to stop. Be direct and helpful.

IMPORTANT: Provide ONLY ONE response, not multiple examples.`;
    
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

  console.log(`=== NAME COLLECTION ===`);
  console.log(`Message: ${message}`);

  if (message.trim().length < 2) {
    const errorPrompt = `Customer entered very short name: "${message}". 
Generate ONE error message matching their language style (${lang}) asking for their full name (at least 2 characters). Remind them they can type "cancel" to stop. Be direct and helpful.

IMPORTANT: Provide ONLY ONE response, not multiple examples.`;
    
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

  console.log(`=== PHONE COLLECTION ===`);
  console.log(`Message: ${message}`);

  if (!phoneRegex.test(message.trim())) {
    const errorPrompt = `Customer entered invalid phone: "${message}". 
Generate ONE error message matching their language style (${lang}) asking for a valid phone number. Remind them they can type "cancel" to stop. Be direct and helpful.

IMPORTANT: Provide ONLY ONE response, not multiple examples.`;
    
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

  console.log(`=== ADDRESS COLLECTION ===`);
  console.log(`Message: ${message}`);

  if (message.trim().length < 5) {
    const errorPrompt = `Customer entered short address: "${message}". 
Generate ONE error message matching their language style (${lang}) asking for a complete delivery address. Remind them they can type "cancel" to stop. Be direct and helpful.

IMPORTANT: Provide ONLY ONE response, not multiple examples.`;
    
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

  console.log(`=== NOTES COLLECTION ===`);
  console.log(`Message: ${message}`);

  const noneKeywords = ['none', 'no', 'nothing', 'لا', 'لا شيء', 'mafi', 'wala shi', 'ninguno', 'nada', 'aucun', 'rien'];
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

  console.log(`=== ORDER CONFIRMATION ===`);
  console.log(`Message: ${message}`);
  console.log(`Session:`, session);

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
      lang === 'arabizi' ? 
      "Baddo ma3loumat naxi. Yalla nbalesh el order mn jedid." :
      lang === 'fr' ?
      "Il semble qu'il manque des informations. Recommençons la commande." :
      "Some details are missing. Let's start the order again.";
  }

  const confirmKeywords = ['yes', 'confirm', 'proceed', 'ok', 'نعم', 'تأكيد', 'موافق', 'aywa', 'sí', 'confirmar', 'oui', 'confirmer'];
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
      const successMessages = {
        'ar': `✅ تم تأكيد الطلب!\n\nرقم الطلب: ${result.order_number}\nالمنتج: ${session.product}\nالكمية: ${session.quantity}\nسعر الوحدة: ${session.product_price}\nالإجمالي: ${totalAmount}\nالاسم: ${session.customer_name}\nالهاتف: ${session.customer_phone}\nالتوصيل إلى: ${session.address}\n${session.notes ? `ملاحظات: ${session.notes}\n` : ''}\nشكراً لك! سنتواصل معك قريباً.`,
        'arabizi': `✅ Order Confirmed!\n\nOrder #: ${result.order_number}\nProduct: ${session.product}\nQuantity: ${session.quantity}\nUnit Price: ${session.product_price}\nTotal: ${totalAmount}\nIsm: ${session.customer_name}\nTelefon: ${session.customer_phone}\nTawseel 3ala: ${session.address}\n${session.notes ? `Notes: ${session.notes}\n` : ''}\nShukran! Ra7 nit2asal ma3ak 2ariban.`,
        'fr': `✅ Commande Confirmée!\n\nCommande #: ${result.order_number}\nProduit: ${session.product}\nQuantité: ${session.quantity}\nPrix unitaire: ${session.product_price}\nTotal: ${totalAmount}\nClient: ${session.customer_name}\nTéléphone: ${session.customer_phone}\nLivraison à: ${session.address}\n${session.notes ? `Notes: ${session.notes}\n` : ''}\nMerci! Nous vous contacterons bientôt.`,
        'en': `✅ Order Confirmed!\n\nOrder #: ${result.order_number}\nProduct: ${session.product}\nQuantity: ${session.quantity}\nUnit Price: ${session.product_price}\nTotal: ${totalAmount}\nCustomer: ${session.customer_name}\nPhone: ${session.customer_phone}\nDelivery to: ${session.address}\n${session.notes ? `Notes: ${session.notes}\n` : ''}\nThank you for your order! We'll contact you soon.`
      };
      
      return successMessages[lang] || successMessages['en'];
    } catch (error) {
      console.error('Order insertion failed:', error);
      clearSession(phone);
      const errorMessages = {
        'ar': `❌ فشل الطلب\n\nخطأ: ${error.message}\nيرجى المحاولة مرة أخرى أو الاتصال بالدعم.`,
        'arabizi': `❌ Order Failed\n\nError: ${error.message}\nJarrib tani aw ittasil bel support.`,
        'fr': `❌ Commande Échouée\n\nErreur: ${error.message}\nVeuillez réessayer ou contacter le support.`,
        'en': `❌ Order Failed\n\nError: ${error.message}\nPlease try again or contact support.`
      };
      return errorMessages[lang] || errorMessages['en'];
    }
  } else {
    clearSession(phone);
    return getCancellationMessage(lang);
  }
}

function isCancellation(message, lang) {
  const cancelKeywords = [
    'cancel', 'stop', 'abort', 'quit', 'exit',
    'إلغاء', 'الغاء', 'توقف', 'خروج', 'إيقاف',
    'cancel', 'wa2if', 'stop', 'khalas',
    'cancelar', 'parar', 'salir',
    'annuler', 'arrêter', 'sortir'
  ];
  return cancelKeywords.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  );
}

module.exports = { detectLanguage, getGeminiResponse, handleOrderFlow };