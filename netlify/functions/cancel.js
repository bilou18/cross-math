// netlify/functions/cancel.js
//
// Cancels a Pi payment that never went anywhere (e.g. found pending from a
// previous, interrupted session — see resolveIncompletePayment() in
// script.js). Used so a stuck payment doesn't keep blocking the player
// from starting new ones ("Pending Payment Found").
const axios = require('axios');

exports.handler = async (event) => {
  const PI_API_KEY = process.env.PI_API_KEY;
  try {
    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No body provided' }) };
    }
    const body = JSON.parse(event.body);
    const paymentId = body.paymentId;
    if (!paymentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing paymentId' }) };
    }
    const axiosClient = axios.create({ baseURL: 'https://api.minepi.com' });
    const config = { headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 };
    await axiosClient.post(`/v2/payments/${paymentId}/cancel`, {}, config);
    return { statusCode: 200, body: JSON.stringify({ message: 'Canceled' }) };
  } catch (error) {
    console.error('Error:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Cancel failed: ' + error.message }) };
  }
};
