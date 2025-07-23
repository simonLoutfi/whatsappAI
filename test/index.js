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
  const step = getSession(phone, 'step');
  const { stock } = await getFaqAndStock(); // Get available products

  // If user sends "cancel" at any point, reset the flow
  if (incomingMessage.toLowerCase() === 'cancel') {
    clearSession(phone);
    await sendWhatsAppMessage(phone, "Order cancelled. How can I help you?");
    return;
  }

  if (!step) {
    // Start new order flow
    const availableProducts = stock.map(item => `- ${item.name} (${item.quantity} available)`).join('\n');
    setSession(phone, 'step', 'product');
    await sendWhatsAppMessage(phone, 
      `What product do you want to order? Available products:\n${availableProducts}\n\nType "cancel" to stop.`);
    return;
  }

  if (step === 'product') {
    // Validate product exists
    const selectedProduct = stock.find(item => 
      item.name.toLowerCase() === incomingMessage.toLowerCase());
    
    if (!selectedProduct) {
      await sendWhatsAppMessage(phone, 
        "This product isn't available. Please choose from the list or type 'cancel'.");
      return;
    }
    
    setSession(phone, 'product', selectedProduct.name);
    setSession(phone, 'step', 'quantity');
    await sendWhatsAppMessage(phone, 
      `How many units of ${selectedProduct.name} do you want? (Max ${selectedProduct.quantity})`);
    return;
  }

  if (step === 'quantity') {
    // Validate quantity is a number and within available stock
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
    // Validate address isn't empty
    if (incomingMessage.trim().length < 10) {
      await sendWhatsAppMessage(phone, "Please provide a complete address (at least 10 characters).");
      return;
    }

    const product = getSession(phone, 'product');
    const quantity = getSession(phone, 'quantity');
    const address = incomingMessage;

    try {
      await insertOrder(phone, product, quantity, address);
      clearSession(phone);
      await sendWhatsAppMessage(phone, 
        `✅ Order confirmed!\n\nProduct: ${quantity} x ${product}\nAddress: ${address}\n\nThank you for your order!`);
    } catch (error) {
      console.error('Order insertion error:', error);
      await sendWhatsAppMessage(phone, "Failed to process your order. Please try again later.");
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
