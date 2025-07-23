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

  if (!step) {
    setSession(phone, 'step', 'product');
    await sendWhatsAppMessage(phone, 'What product do you want to order?');
    return;
  }

  if (step === 'product') {
    setSession(phone, 'product', incomingMessage);
    setSession(phone, 'step', 'quantity');
    await sendWhatsAppMessage(phone, 'How many units do you want?');
    return;
  }

  if (step === 'quantity') {
    setSession(phone, 'quantity', incomingMessage);
    setSession(phone, 'step', 'address');
    await sendWhatsAppMessage(phone, 'What is your delivery address?');
    return;
  }

  if (step === 'address') {
    const product = getSession(phone, 'product');
    const quantity = getSession(phone, 'quantity');
    const address = incomingMessage;

    await insertOrder(phone, product, quantity, address);
    clearSession(phone);

    await sendWhatsAppMessage(phone, `✅ Your order for ${quantity} x ${product} to '${address}' has been placed. Thank you!`);
    return;
  }

  clearSession(phone);
  setSession(phone, 'step', 'product');
  await sendWhatsAppMessage(phone, "Let's start over. What product do you want to order?");
}

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});
