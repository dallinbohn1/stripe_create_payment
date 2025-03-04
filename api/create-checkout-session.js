const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { DateTime } = require('luxon');

const CLIENT_URL = process.env.CLIENT_URL || "https://www.dallinbohnviolin.com";
const TIME_ZONE = "America/Phoenix";

// Stripe price IDs
const PRICE_ID_MAP = process.env.STRIPE_LIVE_MODE === "true"
  ? {  // Live Mode Price IDs
      "30 Minute Lessons - $150 / Month": 'price_1QweXFIaMu5TUCAvMfkFUcnp',
      "45 Minute Lessons - $225 / Month": 'price_1QweYQIaMu5TUCAv3z4AGnAv',
      "60 Minute Lessons - $300 / Month": 'price_1QweZcIaMu5TUCAv76jQaoON'
    }
  : {  // Test Mode Price IDs
      "30 Minute Lessons - $150 / Month": 'price_1QxCAgIaMu5TUCAvAYJ1hCm0',
      "45 Minute Lessons - $225 / Month": 'price_1QxDDOIaMu5TUCAv38VEqyFU',
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
    // Fetch full price dynamically from Stripe
    const priceObj = await stripe.prices.retrieve(priceId);
    const fullPrice = priceObj.unit_amount; // Price is in cents

    // Get current date/time in Arizona time
    const now = DateTime.now().setZone(TIME_ZONE);
    const firstOfNextMonth = now.plus({ months: 1 }).startOf('month');
    const daysInCurrentMonth = now.daysInMonth;
    const daysRemaining = daysInCurrentMonth - now.day;

    // Calculate prorated amount
    const proratedAmount = Math.round((fullPrice / daysInCurrentMonth) * daysRemaining);

    // Create customer in Stripe
    const customer = await stripe.customers.create({
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      metadata: { student_name: studentName, lesson_type: lessonType }
    });

    // Generate Stripe Checkout session for prorated amount
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer: customer.id,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `Prorated charge for ${lessonType}` },
          unit_amount: proratedAmount
        },
        quantity: 1
      }],
      success_url: `${CLIENT_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}&customer_id=${customer.id}&lessonType=${encodeURIComponent(lessonType)}`,
      cancel_url: `${CLIENT_URL}/cancellation`,
      metadata: { student_name: studentName, lessonType: lessonType }
    });

    console.log("Lesson Type being passed to metadata:", lessonType);

    // After payment, create a subscription for the next month
    const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
    const paymentMethodId = paymentIntent.payment_method;

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: PRICE_ID_MAP[lessonType] }],
      default_payment_method: paymentMethodId,
      billing_cycle_anchor: firstOfNextMonth.toSeconds(),
      proration_behavior: "none",
      payment_behavior: "default_incomplete"
    });

    console.log("Subscription created:", subscription.id);

    // Send checkout URL back to Google Apps Script
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