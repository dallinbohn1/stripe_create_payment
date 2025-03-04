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
    // Get the first of next month for billing anchor
    const now = DateTime.now().setZone(TIME_ZONE);
    const firstOfNextMonth = now.plus({ months: 1 }).startOf('month');

    // Create customer in Stripe
    const customer = await stripe.customers.create({
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      metadata: { student_name: studentName, lesson_type: lessonType }
    });

    // Create a subscription set to start billing on the first of next month
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      billing_cycle_anchor: firstOfNextMonth.toSeconds(), // Align to 1st of next month
      proration_behavior: "create_prorations", // Automatically calculates the prorated charge
      payment_behavior: "default_incomplete", // Requires payment setup
      expand: ["latest_invoice.payment_intent"],
    });

    // Retrieve the latest invoice (which includes the prorated charge)
    const invoice = await stripe.invoices.retrieve(subscription.latest_invoice.id);

    // Finalize the invoice so it's immediately chargeable
    await stripe.invoices.finalizeInvoice(invoice.id);

    // Create a checkout session to charge the customer for the prorated amount and set up auto-pay
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "setup", // Sets up future payments without an additional charge
      customer: customer.id,
      success_url: `${CLIENT_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}&customer_id=${customer.id}&lessonType=${encodeURIComponent(lessonType)}`,
      cancel_url: `${CLIENT_URL}/cancellation`,
      metadata: { student_name: studentName, lessonType: lessonType },
      payment_intent_data: {
        setup_future_usage: "off_session" // Ensures the card is stored for automatic charges
      }
    });

    console.log("Subscription created:", subscription.id);
    console.log("Prorated Invoice Finalized:", invoice.id);
    console.log("Stripe Checkout session created:", session.id);

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