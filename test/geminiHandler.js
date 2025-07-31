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

  // Check if customer wants to cancel/stop the order flow
  if (session.step && isCancellation(message, lang)) {
    clearSession(phone);
    return getCancellationMessage(lang);
  }

  // Check if customer wants to start over or have general conversation during order
  if (session.step && isRestartOrGeneralChat(message, lang)) {
    // Clear order session but keep language preference
    const newSession = { lang: session.lang };
    setSession(phone, newSession);
    
    // Handle as general conversation
    return await handleGeneralConversation(phone, message, lang);
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
  
  // Check if customer wants to make an order (be more specific about order intent)
  const isOrderIntent = checkOrderIntent(message, lang);

  // If order intent detected, start order flow
  if (isOrderIntent) {
    console.log(`Order intent detected for ${phone}: ${message}`);
    console.log(`Current session before order:`, session);
    return await initializeOrderFlow(phone, message, stock, profile, lang);
  }
  
  // If there's an active order session but no order intent, continue with order flow
  if (session.step && session.orderStarted) {
    console.log(`Continuing order flow for ${phone}, step: ${session.step}`);
    return await handleOrderFlow(phone, message);
  }
  
  // Handle general conversation
  return await handleGeneralConversation(phone, message, lang, conversationHistory, faq, stock, profile);
}

function checkOrderIntent(message, lang) {
  const orderKeywords = {
    'en': ['i want to order', 'i need to buy', 'i would like to purchase', 'place order', 'make order', 'order please', 'want to order'],
    'ar': ['أريد أن أطلب', 'بدي أطلب', 'عاوز أشتري', 'أريد شراء', 'بدي أشتري'],
    'arabizi': ['baddi order', 'biddi ashtri', 'ba2a order', 'bade order', 'baddi ashtri', 'bade ashtri'],
    'fr': ['je veux commander', 'je voudrais acheter', 'passer commande']
  };

  const keywords = orderKeywords[lang] || orderKeywords['en'];
  const messageLower = message.toLowerCase().trim();
  
  // Check for exact matches first (most reliable)
  const exactMatches = keywords.some(keyword => messageLower === keyword.toLowerCase());
  if (exactMatches) return true;
  
  // Check for partial matches
  const partialMatches = keywords.some(keyword => messageLower.includes(keyword.toLowerCase()));
  if (partialMatches) return true;
  
  // Additional specific checks for arabizi
  if (lang === 'arabizi' || lang === 'mixed') {
    if (messageLower.includes('bade') && messageLower.includes('order')) return true;
    if (messageLower.includes('baddi') && messageLower.includes('order')) return true;
  }
  
  return false;
}

function isRestartOrGeneralChat(message, lang) {
  const restartKeywords = {
    'en': ['hi', 'hello', 'hey', 'start over', 'restart', 'new conversation', 'help', 'info'],
    'ar': ['مرحبا', 'أهلا', 'السلام', 'من جديد', 'مساعدة', 'معلومات'],
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
    'ar': "أهلاً بك! كيف يمكنني مساعدتك؟",
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
    'ar': ['مرحبا', 'أهلا', 'السلام', 'مرحباً', 'اهلاً'],
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

  // Build context prompt for general conversation
  let prompt = `You are a friendly customer service agent. 
Respond in the detected language style: ${lang}

Language instructions:
- English (en): respond in English
- Arabic script (ar): respond in Arabic script العربية
- Arabizi/Franco-Arabic (arabizi): respond in Arabizi style (Arabic using English letters like "kifak", "chou", "3endak")
- French (fr): respond in French
- Mixed: match their style

IMPORTANT: Be natural and conversational. DO NOT include phrases like "Here's a question you can use" or similar instructional text.
CRITICAL: If customer shows any order intent (wants to buy/order something), DO NOT handle the order in conversation. Instead, direct them to use specific order phrases like "I want to order" or "bade order".

Business Profile: ${JSON.stringify(profile)}
Available Stock: ${JSON.stringify(stock)}
FAQ Knowledge: ${JSON.stringify(faq)}

Conversation History:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Customer Message: ${message}

For order requests: Tell them to say "I want to order" (English), "bade order" (Arabizi), "أريد أن أطلب" (Arabic), or "je veux commander" (French) to start the formal ordering process.

Provide a helpful, natural response matching their language style.`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    // Update conversation history and session
    const updatedHistory = conversationHistory || [];
    updatedHistory.push({ role: 'assistant', content: response });
    session.conversation = updatedHistory.slice(-10);
    session.lang = lang;
    setSession(phone, session);
    
    return response;
  } catch (err) {
    console.error('Gemini response error:', err);
    return lang === 'ar' ? "عذرًا، حدث خطأ. يرجى المحاولة لاحقًا" :
           lang === 'arabizi' ? "Asfe, sar ghalat. Jarrib ba3den" :
           lang === 'fr' ? "Désolé, une erreur s'est produite. Réessayez plus tard" :
           "Sorry, an error occurred. Please try again later.";
  }
}

async function initializeOrderFlow(phone, message, stock, profile, lang) {
  console.log(`Initializing order flow for ${phone} with message: ${message}`);
  
  // Initialize order session with step tracking
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

  console.log(`Handling order flow for ${phone}, step: ${session.step}, message: ${message}`);

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
        prompt = `${langInstruction}. The customer wants to place an order. Ask them to choose ONE specific product from the available list.
Available products: ${stock.map(p => `${p.name} (SKU: ${p.sku}) - Price: ${p.price}`).join(', ')}

Say something like "Which product would you like to order?" and list the available products clearly. Ask them to tell you the product name or SKU. Be friendly and direct. Mention they can type "cancel" to stop the order. DO NOT include instructional phrases.`;
        break;
      case 'quantity':
        prompt = `${langInstruction}. Ask how many units of "${session.product}" they want.

IMPORTANT: Make sure to specify that they need to give you a NUMBER only.
Available stock: ${session.max_quantity} units
Current price: ${session.product_price} per unit

Ask them to tell you exactly how many they want (just the number). Be direct and friendly. Remind them they can type "cancel" to stop.

Example responses:
- English: "How many ${session.product} would you like? (Available: ${session.max_quantity})"
- Arabic: "كم وحدة من ${session.product} تريد؟ (متوفر: ${session.max_quantity})"
- Arabizi: "Adeh wahde mn ${session.product} badak? (Mawjud: ${session.max_quantity})"
- French: "Combien de ${session.product} voulez-vous? (Disponible: ${session.max_quantity})"`;
        break;
      case 'name':
        prompt = `${langInstruction}. Ask for the customer's full name for the order.

Ask them to provide their complete name for delivery. Be direct and friendly. Remind them they can type "cancel" to stop.

Example prompts:
- English: "What's your full name for the delivery?"
- Arabic: "ما هو اسمك الكامل للتوصيل؟"  
- Arabizi: "Shu esmak el kamel lal tawseel?"
- French: "Quel est votre nom complet pour la livraison?"`;
        break;
      case 'phone':
        prompt = `${langInstruction}. Ask for the customer's phone number for delivery contact.

Ask them to provide their phone number so delivery can contact them. Be direct and friendly. Remind them they can type "cancel" to stop.

Example prompts:
- English: "What's your phone number for delivery contact?"
- Arabic: "ما هو رقم هاتفك للتواصل عند التوصيل؟"
- Arabizi: "Shu raqam telefonak lal tawseel?"  
- French: "Quel est votre numéro de téléphone pour la livraison?"`;
        break;
      case 'address':
        prompt = `${langInstruction}. Ask for the customer's complete delivery address.

Ask them to provide their full address for delivery. Be direct and friendly. Remind them they can type "cancel" to stop.

Example prompts:
- English: "What's your complete delivery address?"
- Arabic: "ما هو عنوانك الكامل للتوصيل؟"
- Arabizi: "Shu 3onwanak el kamel lal tawseel?"
- French: "Quelle est votre adresse complète de livraison?"`;
        break;
      case 'notes':
        prompt = `${langInstruction}. Ask if they have any special notes or instructions for the order.

Tell them they can add special instructions or say "none"/"la" if no notes needed. Be direct and friendly. Remind them they can type "cancel" to stop.

Example prompts:
- English: "Any special instructions for your order? (or say 'none')"
- Arabic: "أي تعليمات خاصة للطلب؟ (أو قل 'لا')"
- Arabizi: "Ay ta3limat khaseh lal order? (aw 2oul 'la')"
- French: "Des instructions spéciales pour votre commande? (ou dites 'aucun')"`;
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
        prompt = `${langInstruction}. Generate a helpful message for the ordering process step: ${step}. Be direct and friendly. Remind them they can type "cancel" to stop.`;
    }
  }

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
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
  
  console.log(`Product selection: ${message}, Available stock:`, stock.map(s => `${s.name} (${s.sku})`));
  
  // More flexible product matching
  const messageLower = message.toLowerCase().trim();
  const selectedProduct = stock.find(item => {
    const itemNameLower = item.name.toLowerCase();
    const itemSku = item.sku.toString().toLowerCase();
    
    return (
      itemNameLower.includes(messageLower) ||
      messageLower.includes(itemNameLower) ||
      itemSku === messageLower ||
      // Handle common arabizi variations
      (itemNameLower === 'banana' && (messageLower.includes('moz') || messageLower.includes('banana'))) ||
      (itemNameLower === 'apple' && (messageLower.includes('tefeh') || messageLower.includes('teffeh') || messageLower.includes('apple')))
    );
  });

  if (!selectedProduct) {
    console.log(`No product found for: ${message}`);
    const errorPrompt = `Customer entered: "${message}" but we couldn't find a matching product. 
Generate a friendly error message in ${lang} language style and ask them to choose from available products.
Available products: ${stock.map(p => `${p.name} (SKU: ${p.sku}) - Price: ${p.price}`).join(', ')}
Remind them they can type "cancel" to stop the order. BE direct and helpful. Show the exact product names they can choose from.`;
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

  console.log(`Quantity selection: ${message}, parsed: ${quantity}, max: ${maxQuantity}`);

  if (isNaN(quantity) || quantity <= 0) {
    const errorPrompt = `Customer entered invalid quantity: "${message}". 
Generate an error message matching their language style (${lang}) explaining they must enter a positive number.
Product: ${session.product}, Max available: ${maxQuantity}. Remind them they can type "cancel" to stop. BE direct and helpful.`;
    return generateOrderQuestion(phone, 'quantity', stock, profile, errorPrompt);
  }

  if (quantity > maxQuantity) {
    const errorPrompt = `Customer requested ${quantity} but only ${maxQuantity} available.
Generate an error message matching their language style (${lang}) explaining the stock limit.
Product: ${session.product}. Remind them they can type "cancel" to stop. Be direct and helpful.`;
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
Generate an error message matching their language style (${lang}) asking for their full name (at least 2 characters). Remind them they can type "cancel" to stop. Be direct and helpful.`;
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
Generate an error message matching their language style (${lang}) asking for a valid phone number. Remind them they can type "cancel" to stop. Be direct and helpful.`;
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
Generate an error message matching their language style (${lang}) asking for a complete delivery address. Remind them they can type "cancel" to stop. Be direct and helpful.`;
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
      lang === 'arabizi' ? 
      "Baddo ma3loumat naxi. Yalla nbalesh el order mn jedid." :
      lang === 'fr' ?
      "Il semble qu'il manque des informations. Recommençons la commande." :
      "Some details are missing. Let's start the order again.";
  }

  const confirmKeywords = ['yes', 'confirm', 'proceed', 'ok', 'نعم', 'تأكيد', 'aywa', 'sí', 'confirmar', 'oui', 'confirmer'];
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
    'إلغاء', 'الغاء', 'توقف', 'خروج',
    'cancel', 'wa2if', 'stop', 'khalas',
    'cancelar', 'parar', 'salir',
    'annuler', 'arrêter', 'sortir'
  ];
  return cancelKeywords.some(word => 
    message.toLowerCase().includes(word.toLowerCase())
  );
}

module.exports = { detectLanguage, getGeminiResponse, handleOrderFlow };