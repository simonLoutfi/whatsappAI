const axios = require('axios');

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message }
  };

  try {
    const response = await axios.post(url, payload, { headers });
    console.log(`WhatsApp status: ${response.status} - message sent to ${to}`);
    console.log('Response:', response.data);
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error.response?.data || error.message);
  }
}

module.exports = { sendWhatsAppMessage };
