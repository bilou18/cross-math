// netlify/functions/approve.js
//
// Server-side leg of every Pi payment's "approval" step. The Pi SDK calls
// this (via onReadyForServerApproval in script.js) right after the player
// confirms a payment in the native Pi payment sheet, but before any Pi
// actually moves. We just forward the approval to the Pi Platform API
// using our app's secret API key, which the client never has access to.
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

    await axiosClient.post(`/v2/payments/${paymentId}/approve`, {}, config);
    return { statusCode: 200, body: JSON.stringify({ message: 'Approved' }) };
  } catch (error) {
    console.error('Error:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Approval failed: ' + error.message }) };
  }
};
