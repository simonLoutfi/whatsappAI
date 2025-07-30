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
    const messageText = body.entry[0].changes[0].value.messages[0].text.body;
    const phone = body.entry[0].changes[0].value.messages[0].from;
    const session = getSession(phone) || {};

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
      clearSession(phone);
      const response = await getGeminiResponse(phone, "The customer wants to cancel. Acknowledge the cancellation and ask how you can help.");
      await sendWhatsAppMessage(phone, response);
      return res.status(200).json({ status: 'success' });
    }

    // Check if we're in an order flow
    const response = session.step 
      ? await handleOrderFlow(phone, messageText)
      : await getGeminiResponse(phone, messageText);

    await sendWhatsAppMessage(phone, response);
    return res.status(200).json({ status: 'success' });

  } catch (err) {
    console.error('Error handling webhook:', err);
    res.status(400).send('No valid message received');
  }
});

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});