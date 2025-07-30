require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { sendWhatsAppMessage } = require('./whatsappHandler');
const { getGeminiResponse, handleOrderStep } = require('./geminiHandler');
const { getFaqAndStock, insertOrderWithItems } = require('./supabaseHandler');
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

    // If in order flow, handle the step
    if (session.step) {
      const { stock, business_profiles } = await getFaqAndStock();
      const profile = business_profiles[0];
      
      // Special handling for confirmation step
      if (session.step === 'confirm') {
        const confirmKeywords = {
          en: ['confirm', 'yes', 'proceed'],
          ar: ['تأكيد', 'نعم', 'متابعة'],
          es: ['confirmar', 'sí', 'proceder'],
          fr: ['confirmer', 'oui', 'continuer']
        };
        
        const isConfirmation = Object.values(confirmKeywords).some(langKeywords => 
          langKeywords.some(word => messageText.toLowerCase().includes(word.toLowerCase()))
        );

        if (isConfirmation) {
          try {
            const result = await insertOrderWithItems(
              session.customer_phone || phone,
              phone,
              session.customer_name,
              session.product_sku,
              session.product,
              session.quantity,
              session.product_price,
              session.address,
              session.notes
            );

            clearSession(phone);
            const response = await getGeminiResponse(phone, `The customer confirmed their order. Send a confirmation message with these details: 
              Order #${result.order_number}, 
              Product: ${result.product_name}, 
              Quantity: ${result.quantity}, 
              Total: ${result.total_amount}`);
            await sendWhatsAppMessage(phone, response);
          } catch (error) {
            const response = await getGeminiResponse(phone, `The order failed with error: ${error.message}. Apologize and ask the customer to try again.`);
            await sendWhatsAppMessage(phone, response);
          }
          return res.status(200).json({ status: 'success' });
        } else {
          clearSession(phone);
          const response = await getGeminiResponse(phone, "The customer didn't confirm the order. Acknowledge the cancellation.");
          await sendWhatsAppMessage(phone, response);
          return res.status(200).json({ status: 'success' });
        }
      }

      // Handle other order steps
      const response = await handleOrderStep(phone, messageText, session.step, stock, profile);
      await sendWhatsAppMessage(phone, response);
      return res.status(200).json({ status: 'success' });
    }

    // For new messages, let Gemini handle everything
    const { faq, stock, business_profiles } = await getFaqAndStock();
    const context = {
      faq,
      stock,
      business_profile: business_profiles[0],
      is_new_conversation: !session.lang
    };

    const response = await getGeminiResponse(phone, messageText, context);
    await sendWhatsAppMessage(phone, response);

    res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('Error handling webhook:', err);
    res.status(400).send('No valid message received');
  }
});

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});