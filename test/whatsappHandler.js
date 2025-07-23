const axios = require('axios');

const TOKEN = 'EAAULrxtQZB0oBPOj8SIkwJtjxGu9fyfaDCdYhBhMxNsHLbmFTlUMpzvpjLI1ciQI67xLP5kMiWQMTQmRZBTpeJgN365bMw3BXTy4RKxbE4W80yZA2GmCoZAMNaN31eowB5pWA34qVYgcwTOhmQVMcdw8gqiqaeB3lkqckxTPAEHlwsE50U5arqfTV5GZCkJnV3l9uNHIkNFV2foZBQmnE1dxak1queTU8zXSkb0yboYDLcpAZDZD';
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
