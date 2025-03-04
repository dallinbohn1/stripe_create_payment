const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { DateTime } = require('luxon');

const CLIENT_URL = process.env.CLIENT_URL || "https://www.dallinbohnviolin.com";

const PRICE_ID_MAP = process.env.STRIPE_LIVE_MODE === "true"
  ? {  // Live Mode Price IDs
      "30 Minute Lessons - $150 / Month": 'price_1QweXFIaMu5TUCAvMfkFUcnp',
      "45 Minute Lessons - $255 / Month": 'price_1QweYQIaMu5TUCAv3z4AGnAv',
      "60 Minute Lessons - $300 / Month": 'price_1QweZcIaMu5TUCAv76jQaoON'
    }
  : {  // Test Mode Price IDs
      "30 Minute Lessons - $150 / Month": 'price_1QxCAgIaMu5TUCAvAYJ1hCm0',
      "45 Minute Lessons - $255 / Month": 'price_1QxDDOIaMu5TUCAv38VEqyFU',
      "60 Minute Lessons - $300 / Month": 'price_1QxDDfIaMu5TUCAvHi6jUXYu'
    };

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const requiredFields = ["studentName", "customerName", "customerEmail", "customerPhone", "lessonType"];
  for (const field of requiredFields) {
    if (!req.body[field]) {
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  const { studentName, customerName, customerEmail, customerPhone, lessonType } = req.body;
  const priceId = PRICE_ID_MAP[lessonType];

  if (!priceId) {
    return res.status(400).json({ error: "Invalid lesson type selected." });
  }

  try {
    // 1. Create Customer
    const customer = await stripe.customers.create({
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      metadata: { student_name: studentName, lesson_type: lessonType }
    });

    // 2. Generate a Stripe Checkout Session for payment
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',  // 'payment' because we want them to pay now
      line_items: [{
        price: priceId,  // the price for the lesson
        quantity: 1,
      }],
      success_url: `${CLIENT_URL}/thank-you`,  // Redirect on successful payment
      cancel_url: `${CLIENT_URL}/cancellation`,  // Redirect if the user cancels
    });

    res.status(200).json({ checkoutUrl: session.url });

  } catch (error) {
    console.error('Stripe API Error:', error);
    res.status(400).json({
      error: error.message,
      type: error.type,
      code: error.code || "N/A",
      param: error.param || "N/A"
    });
  }
};
