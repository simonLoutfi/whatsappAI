const express = require('express');
const bodyParser = require('body-parser');
const { sendWhatsAppMessage } = require('./whatsappHandler');
const { classifyMessage, getGeminiAnswer } = require('./geminiHandler');
const { getFaqAndStock, insertOrder } = require('./supabaseHandler');
const { getSession, setSession, clearSession } = require('./sessionHandler');

const app = express();
const port = process.env.PORT || 5000;
const VERIFY_TOKEN = 'whatsapp_secret_23c8f1a7';

app.use(bodyParser.json());

app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verification token mismatch');
  }
});

app.post('/', async (req, res) => {
  const body = req.body;

  try {
    const messageText = body.entry[0].changes[0].value.messages[0].text.body;
    const phone = body.entry[0].changes[0].value.messages[0].from;

    // Check if we're in an active order session first
    const currentStep = getSession(phone, 'step');
    if (currentStep && currentStep !== 'product') {
      await handleOrder(phone, messageText);
      return res.status(200).json({ status: 'success' });
    }

    // Only classify if not in an order flow
    const classification = await classifyMessage(messageText);

    if (classification === 'order') {
      await handleOrder(phone, messageText);
    } else if (classification === 'faq') {
      const { faq, stock } = await getFaqAndStock();
      const reply = await getGeminiAnswer(messageText, faq, stock);
      await sendWhatsAppMessage(phone, reply);
    } else {
      await sendWhatsAppMessage(phone, "Sorry, I couldn't understand your request.");
    }

    res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('Error handling webhook:', err);
    res.status(400).send('No valid message received');
  }
});
async function handleOrder(phone, incomingMessage) {
  console.log(`Handling order for ${phone}, message: ${incomingMessage}`); // Debug log
  const step = getSession(phone, 'step');
  console.log(`Current step for ${phone}: ${step}`); // Debug log
  const { stock } = await getFaqAndStock();

  // Handle cancellation at any point
  if (incomingMessage.toLowerCase() === 'cancel') {
    clearSession(phone);
    await sendWhatsAppMessage(phone, "Order cancelled. How can I help you?");
    return;
  }
  if (step) {
    console.log(`Continuing order flow for ${phone} at step ${step}`); // Debug log
    await continueOrderFlow(phone, incomingMessage, step, stock);
    return;
  }

  // Check if we're already in an order flow
  if (step && step !== 'product') {
    // Continue with existing order flow
    await continueOrderFlow(phone, incomingMessage, step, stock);
    return;
  }

  // Start new order flow
  const availableProducts = stock.map(item => `- ${item.name} (SKU: ${item.sku}, ${item.quantity} available)`).join('\n');
  setSession(phone, 'step', 'product');
  await sendWhatsAppMessage(phone, 
    `What product do you want to order? Available products:\n${availableProducts}\n\nType "cancel" to stop.`);
}

async function continueOrderFlow(phone, incomingMessage, step, stock) {
  if (step === 'product') {
    // Enhanced product matching - checks both name and SKU
    const selectedProduct = stock.find(item => 
      item.name.toLowerCase() === incomingMessage.toLowerCase() ||
      item.sku.toString() === incomingMessage.trim()
    );
    
    if (!selectedProduct) {
      await sendWhatsAppMessage(phone, 
        "This product isn't available. Please choose from the list or type 'cancel'.");
      return;
    }
    
    setSession(phone, 'product', selectedProduct.name);
    setSession(phone, 'product_sku', selectedProduct.sku);
    setSession(phone, 'step', 'quantity');
    await sendWhatsAppMessage(phone, 
      `How many units of ${selectedProduct.name} do you want? (Max ${selectedProduct.quantity})`);
    return;
  }

  if (step === 'quantity') {
    // Validate quantity
    const quantity = parseInt(incomingMessage);
    const product = getSession(phone, 'product');
    const productStock = stock.find(item => item.name === product);
    
    if (isNaN(quantity) || quantity <= 0) {
      await sendWhatsAppMessage(phone, "Please enter a valid number greater than 0.");
      return;
    }
    
    if (quantity > productStock.quantity) {
      await sendWhatsAppMessage(phone, 
        `We only have ${productStock.quantity} available. Please enter a smaller quantity.`);
      return;
    }
    
    setSession(phone, 'quantity', quantity);
    setSession(phone, 'step', 'address');
    await sendWhatsAppMessage(phone, "What is your delivery address?");
    return;
  }

  if (step === 'address') {
    // Validate address
    if (incomingMessage.trim().length < 10) {
      await sendWhatsAppMessage(phone, "Please provide a complete address (at least 10 characters).");
      return;
    }
    
    setSession(phone, 'address', incomingMessage);
    setSession(phone, 'step', 'confirm');
    
    const product = getSession(phone, 'product');
    const quantity = getSession(phone, 'quantity');
    
    await sendWhatsAppMessage(phone,
      `Please confirm your order:\n\n${quantity} x ${product}\nAddress: ${incomingMessage}\n\nReply "confirm" to proceed or "cancel" to abort.`);
    return;
  }

  if (step === 'confirm') {
    if (incomingMessage.toLowerCase() === 'confirm') {
      const product = getSession(phone, 'product');
      const sku = getSession(phone, 'product_sku');
      const quantity = getSession(phone, 'quantity');
      const address = getSession(phone, 'address');

      try {
        await insertOrder(phone, `${product} (SKU: ${sku})`, quantity, address);
        clearSession(phone);
        await sendWhatsAppMessage(phone, 
          `✅ Order confirmed!\n\nProduct: ${quantity} x ${product}\nSKU: ${sku}\nAddress: ${address}\n\nThank you for your order!`);
      } catch (error) {
        console.error('Order insertion error:', error);
        await sendWhatsAppMessage(phone, "Failed to process your order. Please try again later.");
      }
    } else {
      clearSession(phone);
      await sendWhatsAppMessage(phone, "Order cancelled. How can I help you?");
    }
    return;
  }

  // Fallback for unexpected states
  clearSession(phone);
  await sendWhatsAppMessage(phone, "Let's start over. How can I help you?");
}

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});
