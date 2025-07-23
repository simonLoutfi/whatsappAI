const axios = require('axios');

const TOKEN = 'EAAULrxtQZB0oBPJLYz8Jdy20ymSnKil2a9NskWokVPH7ZBGr0NFUzWfHWx3kZAYe7VnhHGN5w59Xe0449cvtgtjwcX0aXNnSP6SBKxaZBT7RfySR3XSSxZCZAofPmfYVW78N4ur7GpQxbRpNWZAu2MvdzPWZCrLDIb3HVsgeGXNCggYUQyd6ZA3JzYwD5jtFh8r4IN4d06Ki4KoSvRZBwkefhlxiYtIEZCNcduv3fRcLRsDnmvZArgZDZD';
const PHONE_NUMBER_ID = '1290492105934901';

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
