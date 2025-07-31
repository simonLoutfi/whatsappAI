require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { sendWhatsAppMessage } = require('./whatsappHandler');
const { getGeminiResponse, handleOrderFlow } = require('./geminiHandler');
const { getSession, setSession, clearSession } = require('./sessionHandler');

const app = express();
const port = process.env.PORT || 5000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; 

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
    // Check if message exists
    if (!body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      console.log('No message found in webhook body');
      return res.status(200).json({ status: 'no_message' });
    }

    const messageData = body.entry[0].changes[0].value.messages[0];
    const messageText = messageData.text?.body;
    const phone = messageData.from;

    if (!messageText || !phone) {
      console.log('Missing message text or phone number');
      return res.status(200).json({ status: 'invalid_message' });
    }

    console.log(`Received message from ${phone}: ${messageText}`);

    const session = getSession(phone) || {};
    console.log(`Current session for ${phone}:`, session);

    // Handle cancellation in any language
    const cancelKeywords = {
      en: ['cancel', 'stop', 'abort'],
      ar: ['إلغاء', 'الغاء', 'إStop'],
      es: ['cancelar', 'parar', 'detener'],
      fr: ['annuler', 'arrêter']
    };
    
    const isCancellation = Object.values(cancelKeywords).some(langKeywords => 
      langKeywords.some(word => messageText.toLowerCase().includes(word.toLowerCase()))
    );

    if (isCancellation) {
      console.log(`Cancellation detected for ${phone}`);
      clearSession(phone);
      const response = await getGeminiResponse(phone, "The customer wants to cancel. Acknowledge the cancellation and ask how you can help.");
      await sendWhatsAppMessage(phone, response);
      return res.status(200).json({ status: 'success' });
    }

    let response;

    // Check if we're in an order flow (session has 'step' property)
    if (session.step) {
      console.log(`Continuing order flow for ${phone} at step: ${session.step}`);
      response = await handleOrderFlow(phone, messageText);
    } else {
      console.log(`Using general response for ${phone}`);
      response = await getGeminiResponse(phone, messageText);
    }

    console.log(`Sending response to ${phone}: ${response}`);
    await sendWhatsAppMessage(phone, response);
    
    return res.status(200).json({ status: 'success' });

  } catch (err) {
    console.error('Error handling webhook:', err);
    console.error('Request body:', JSON.stringify(body, null, 2));
    res.status(400).send('Error processing message');
  }
});

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});