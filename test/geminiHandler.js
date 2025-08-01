const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSession, setSession, clearSession } = require('./sessionHandler');
const { getFaqAndStock, insertOrderWithItems, insertUnknownQuestion } = require('./supabaseHandler');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function detectLanguage(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const prompt = `Detect the language of this message. 
Respond ONLY with one of: en, ar, arabizi, fr

Message: "${message}"`;
  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim().toLowerCase();
  } catch {
    return 'en';
  }
}

async function getGeminiResponse(phone, message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  let session = getSession(phone) || {};
  const lang = session.lang || await detectLanguage(message);

  if (!session.lang) {
    session.lang = lang;
    setSession(phone, session);
  }

  // Cancel order
  if (session.step && isCancellation(message)) {
    clearSession(phone);
    return getCancellationMessage(lang);
  }

  // Continue order flow if already started
  if (session.step) {
    return await handleOrderFlow(phone, message);
  }

  // New order intent
  if (checkOrderIntent(message, lang)) {
    return await initializeOrderFlow(phone, message);
  }

  // Otherwise, general conversation
  return await handleGeneralConversation(phone, message, lang);
}

// FIXED: More comprehensive order intent detection
function checkOrderIntent(message, lang) {
  const lower = message.toLowerCase().trim();
  const arabiziTriggers = ['bade order', 'badde order', 'baddi order', 'bidi order', 'biddi order'];
  const arabicTriggers = ['بدي أطلب', 'أريد أن أطلب', 'عاوز أطلب'];
  const englishTriggers = ['i want to order', 'want to order', 'place order', 'make order', 'order please'];
  const frenchTriggers = ['je veux commander', 'commander', 'passer commande'];

  const triggers =
    lang === 'arabizi' ? arabiziTriggers :
    lang === 'ar' ? arabicTriggers :
    lang === 'fr' ? frenchTriggers :
    englishTriggers;

  if (triggers.some(t => lower === t || lower.includes(t))) return true;

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
  switch (lang) {
    case 'ar': return 'تم إلغاء الطلب.';
    case 'arabizi': return 'Ilgha2 el talab.';
    case 'fr': return 'Commande annulée.';
    default: return 'Order cancelled.';
  }
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

  // Build context prompt for general conversation with confidence assessment
  let prompt = `You are a friendly customer service agent. 
Respond in the detected language style: ${lang}

Language instructions:
- English (en): respond in English
- Arabic script (ar): respond in Arabic script العربية
- Arabizi/Franco-Arabic (arabizi): respond in Arabizi style (Arabic using English letters like "kifak", "chou", "3endak")
- French (fr): respond in French
- Mixed: match their style

IMPORTANT: Be natural and conversational. DO NOT include phrases like "Here's a question you can use" or similar instructional text.

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

Provide a helpful, natural response matching their language style. Keep it conversational and friendly.
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
async function initializeOrderFlow(phone, message) {
  clearSession(phone);
  const session = {
    step: 'product',
    lang: await detectLanguage(message),
    orderStarted: true
  };
  setSession(phone, session);
  return await generateOrderQuestion(phone, 'product');
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

async function generateOrderQuestion(phone, step) {
  const session = getSession(phone);
  const { stock } = await getFaqAndStock();
  const lang = session.lang || 'en';
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  let stepPrompt = '';
  switch (step) {
    case 'product':
      stepPrompt = `Ask the customer, in ${lang}, to choose ONE product from: ${stock.map(p => `${p.name} - ${p.price}`).join(', ')}. Keep it short and friendly. Mention they can type 'cancel'.`;
      break;
    case 'quantity':
      stepPrompt = `Ask in ${lang} how many units of "${session.product}" they want. Max: ${session.max_quantity}. Expect a number.`;
      break;
    case 'name':
      stepPrompt = `Ask in ${lang} for the customer's full name for delivery.`;
      break;
    case 'phone':
      stepPrompt = `Ask in ${lang} for the customer's phone number for delivery contact.`;
      break;
    case 'address':
      stepPrompt = `Ask in ${lang} for the complete delivery address.`;
      break;
    case 'notes':
      stepPrompt = `Ask in ${lang} if they have any special notes or say "none".`;
      break;
    case 'confirm':
      const total = session.product_price * session.quantity;
      stepPrompt = `Summarize the order in ${lang} with: product, qty, price, total, name, phone, address, notes. Ask them to reply YES to confirm or CANCEL to abort.`;
      break;
  }

  try {
    const result = await model.generateContent(stepPrompt);
    return result.response.text().trim();
  } catch {
    return 'Please provide the requested information:';
  }
}

async function handleProductSelection(phone, message, stock, profile) {
  let session = getSession(phone);
  const lang = session.lang || 'en';
  
  console.log(`=== PRODUCT SELECTION ===`);
  console.log(`Message: ${message}`);
  console.log(`Available stock:`, stock.map(s => `${s.name} (${s.sku})`));
  
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

Remind them they can type "cancel" to stop the order. Be direct and helpful. Show the exact product names they can choose from.

Example responses:
- English: "Sorry, I couldn't find that product. Please choose from: [list products]"
- Arabizi: "Asfe, ma la2it hal product. Ikhtaar mn: [list products]"
- Arabic: "آسف، لم أجد هذا المنتج. اختر من: [list products]"
- French: "Désolé, je n'ai pas trouvé ce produit. Choisissez parmi: [list products]"`;
    
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
Generate an error message matching their language style (${lang}) explaining they must enter a positive number.
Product: ${session.product}, Max available: ${maxQuantity}. Remind them they can type "cancel" to stop. Be direct and helpful.

Example responses:
- English: "Please enter a valid number. How many ${session.product} do you want? (Available: ${maxQuantity})"
- Arabizi: "Fadlak add raqam sa7i7. Adeh ${session.product} badak? (Mawjud: ${maxQuantity})"
- Arabic: "يرجى إدخال رقم صحيح. كم ${session.product} تريد؟ (متوفر: ${maxQuantity})"
- French: "Veuillez entrer un nombre valide. Combien de ${session.product} voulez-vous? (Disponible: ${maxQuantity})"`;
    
    return generateOrderQuestion(phone, 'quantity', stock, profile, errorPrompt);
  }

  if (quantity > maxQuantity) {
    const errorPrompt = `Customer requested ${quantity} but only ${maxQuantity} available.
Generate an error message matching their language style (${lang}) explaining the stock limit.
Product: ${session.product}. Remind them they can type "cancel" to stop. Be direct and helpful.

Example responses:
- English: "Sorry, we only have ${maxQuantity} ${session.product} available. How many would you like?"
- Arabizi: "Asfe, 3anna bas ${maxQuantity} ${session.product}. Adeh badak?"
- Arabic: "آسف، لدينا فقط ${maxQuantity} ${session.product}. كم تريد؟"
- French: "Désolé, nous n'avons que ${maxQuantity} ${session.product} disponibles. Combien en voulez-vous?"`;
    
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
Generate an error message matching their language style (${lang}) asking for their full name (at least 2 characters). Remind them they can type "cancel" to stop. Be direct and helpful.

Example responses:
- English: "Please enter your full name (at least 2 characters)"
- Arabizi: "Fadlak add esmak el kamel (aktar mn 2 huruf)"
- Arabic: "يرجى إدخال اسمك الكامل (حرفان على الأقل)"
- French: "Veuillez entrer votre nom complet (au moins 2 caractères)"`;
    
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
Generate an error message matching their language style (${lang}) asking for a valid phone number. Remind them they can type "cancel" to stop. Be direct and helpful.

Example responses:
- English: "Please enter a valid phone number (at least 8 digits)"
- Arabizi: "Fadlak add raqam telefon sa7i7 (aktar mn 8 arqam)"
- Arabic: "يرجى إدخال رقم هاتف صحيح (8 أرقام على الأقل)"
- French: "Veuillez entrer un numéro de téléphone valide (au moins 8 chiffres)"`;
    
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
Generate an error message matching their language style (${lang}) asking for a complete delivery address. Remind them they can type "cancel" to stop. Be direct and helpful.

Example responses:
- English: "Please enter your complete delivery address"
- Arabizi: "Fadlak add 3onwanak el kamel lal tawseel"
- Arabic: "يرجى إدخال عنوانك الكامل للتوصيل"
- French: "Veuillez entrer votre adresse complète de livraison"`;
    
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

function isCancellation(message) {
  const lower = message.toLowerCase();
  return ['cancel', 'stop', 'abort', 'exit', 'إلغاء', 'الغاء'].some(k => lower.includes(k));
}

module.exports = { detectLanguage, getGeminiResponse, handleOrderFlow };