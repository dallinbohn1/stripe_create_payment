const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { DateTime } = require('luxon');

const CLIENT_URL = process.env.CLIENT_URL || "https://www.dallinbohnviolin.com";
const TIME_ZONE = "America/Phoenix";
// One-time registration / enrollment fee in cents ($35)
const REGISTRATION_FEE_CENTS = 3500;

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
    const productObj = await stripe.products.retrieve(priceObj.product);
    const fullPrice = priceObj.unit_amount; // Price is in cents

    // Get current date/time in Arizona time
    const now = DateTime.now().setZone(TIME_ZONE);
    const firstOfNextMonth = now.plus({ months: 1 }).startOf('month');
    const daysInCurrentMonth = now.daysInMonth;
    const daysRemaining = daysInCurrentMonth - now.day;

    // Calculate prorated amount dynamically
    const proratedAmount = Math.round((fullPrice / daysInCurrentMonth) * daysRemaining);

    // Create customer in Stripe
    const customer = await stripe.customers.create({
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      metadata: { student_name: studentName, lesson_type: lessonType }
    });

    // Create a checkout session to charge the prorated amount immediately
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer: customer.id,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: productObj.name,
            description: productObj.description,
            images: productObj.images,
          },
          unit_amount: REGISTRATION_FEE_CENTS,
        },
        quantity: 1,
      }],
      success_url: `${CLIENT_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}&customer_id=${encodeURIComponent(customer.id)}&lessonType=${encodeURIComponent(lessonType)}`,
      cancel_url: `${CLIENT_URL}/cancellation`,
      payment_intent_data: {
        setup_future_usage: "off_session" // Ensures the card is stored for future use
      }
    });

    console.log("Stripe Checkout session created:", session.id);

    // Wait for the checkout session to complete
    const sessionRetrieved = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["payment_intent"]
    });

    const paymentIntent = sessionRetrieved.payment_intent;
    if (paymentIntent && paymentIntent.payment_method) {
      // Attach the payment method to the customer
      await stripe.paymentMethods.attach(paymentIntent.payment_method, {
        customer: customer.id
      });

      // Update the customer to set this payment method as default
      await stripe.customers.update(customer.id, {
        invoice_settings: { default_payment_method: paymentIntent.payment_method }
      });

      console.log("Payment method attached to customer:", paymentIntent.payment_method);
    }

    // Create a subscription set to start billing on the first of next month
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      billing_cycle_anchor: firstOfNextMonth.toSeconds(), // Align to 1st of next month
      proration_behavior: "none", // No additional proration needed
      payment_behavior: "default_incomplete", // Requires payment setup
      default_payment_method: paymentIntent?.payment_method, // Ensures subscription uses the saved method
      expand: ["latest_invoice.payment_intent"],
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
