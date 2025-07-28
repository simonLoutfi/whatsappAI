const axios = require('axios');

const TOKEN = 'EAAULrxtQZB0oBPKKpVtAEtqjm1Ukug4kqwxgb53A18o5aaDgBaXvfDO3IZCPPV0aEvBg1Hr7qEFHeX3urVE1HjzZBI7rUIT4Wf2bmmB5LHnqZANUNduWiOtQn6ZBqbZBIlIBQZBPjFQXCeGRMoC1WYIyZAnATFGv1XlPeafV9gCsvL9TQiOPRDcZBNNJZAfI6NagxKSB3IBhiHVGIDSZBicxcNnNZCnSOKuUuuzMG6vBPnZCwTwrZARWMZD';
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
