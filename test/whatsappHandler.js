const axios = require('axios');

const TOKEN = 'EAAULrxtQZB0oBPKmWyNsOe65XfUqVgw6nn66HDZCCmMBL2B3etcbxMnbZA1WL3q7Qitpaa8TiMDMsQ17I5UQ4lX2M3YR5uzRwZBcraHJbYTZBiu849w0j3EzKGn0E2tS6CnB1fMMiqYokhZBeRR5iZBWhTUO9IhnzjZBmU67EDUmPCUcZCDn5tMlxceuO7Ht2LUFM2mXi5bYwRdjr7F3Tz19d7ZCHclSzynJh1xRuxgI31gY3UWQZDZD';
const PHONE_NUMBER_ID = '658554300685107';

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
