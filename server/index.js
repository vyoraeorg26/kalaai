require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Enquiry = require('./models/Enquiry');
const NewsletterSubscriber = require('./models/NewsletterSubscriber');
const { requireAdmin, cookieOptions, sameOriginMutation, cleanText, validEmail, validPhone } = require('./middleware');

const app = express();
const getSiteUrl = () => { try { const u = new URL(process.env.SITE_URL); return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null; } catch (_) { return null; } };
const configuredAdminPasswordHash = process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12) : null;
const recentSubmissions = new Map();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' || process.env.VERCEL === '1' ? 1 : false);
app.use((req, res, next) => { if (process.env.NODE_ENV === 'production' && !req.secure) return res.redirect(308, `${getSiteUrl()}${req.originalUrl}`); next(); });
const isProduction = process.env.NODE_ENV === 'production';
// Keep the storefront available even when deployment secrets have not yet
// been configured. Sensitive API operations validate their own configuration
// and return a clear 503 instead of preventing the entire Vercel function from
// loading (which otherwise makes even the public homepage return 500).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('replace-this')) {
  console.warn('JWT_SECRET is missing or weak; admin authentication will remain unavailable until configured.');
}
if (isProduction && !getSiteUrl()) {
  console.warn('SITE_URL is missing or invalid; configure the canonical HTTPS origin for redirects and SEO URLs.');
}
if (isProduction && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 14 || process.env.ADMIN_PASSWORD === 'decorate@123')) {
  console.warn('ADMIN_PASSWORD is missing or weak; admin login will remain unavailable until configured.');
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://api.razorpay.com'],
      frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: false, preload: false } : false,
}));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '64kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 30 }));
app.use(cookieParser());
app.use(sameOriginMutation);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many login attempts. Try again in 15 minutes.' } });
const publicWriteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many submissions. Please try again later.' } });
const adminWriteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Reuse one MongoDB connection per warm serverless instance. Vercel may freeze
// and resume instances, so do not open a new connection for every request.
let databasePromise = null;
async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required. Configure MongoDB Atlas in the deployment environment.');
  }
  if (!databasePromise) {
    databasePromise = mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 0,
      bufferCommands: false,
    }).then(async () => {
      // Preserve the existing first-run catalogue seeding behavior.
      if (await Product.countDocuments() === 0) {
        const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-products.json'), 'utf8'));
        if (Array.isArray(seed.products) && seed.products.length) {
          await Product.insertMany(seed.products);
          console.log(`Seeded ${seed.products.length} catalogue products`);
        }
      }
      console.log('MongoDB connected');
      return mongoose.connection;
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

// Health is deliberately independent of MongoDB so Vercel can distinguish
// a running function from a database connectivity/configuration problem.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// All data API routes require a working persistent database. Static storefront
// assets and the health check remain available without opening a DB connection.
app.use('/api', asyncRoute(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error('MongoDB connection failed:', { name: error.name });
    res.status(503).json({ message: 'The service is temporarily unavailable. Please try again shortly.' });
  }
}));

const rejectHoneypot = req => Boolean(req.body && (req.body.website || req.body._website));
function preventDuplicateSubmission(req, res, next) {
  const fingerprint = crypto.createHash('sha256').update(`${req.ip}|${JSON.stringify(req.body || {})}|${req.file?.originalname || ''}|${req.file?.size || ''}`).digest('hex');
  const now = Date.now(); const last = recentSubmissions.get(fingerprint);
  if (last && now - last < 45000) {
    if (!req.file) return res.status(409).json({ message: 'This submission was already received. Please wait before trying again.' });
    return fs.unlink(req.file.path, error => {
      if (error) return next(error);
      res.status(409).json({ message: 'This submission was already received. Please wait before trying again.' });
    });
  }
  if (recentSubmissions.size > 4000) for (const [key, time] of recentSubmissions) if (now - time > 45000) recentSubmissions.delete(key);
  recentSubmissions.set(fingerprint, now); next();
}
const validId = value => /^\d+$/.test(String(value)) && Number(value) > 0;

app.get('/api/products', asyncRoute(async (req, res) => {
  const rows = await Product.find({ active: true }).select('-_id -__v -createdAt -updatedAt').sort({ id: 1 }).lean();
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(rows);
}));

const getShippingFeePaise = () => {
  const raw = process.env.SHIPPING_FEE_INR;
  if (typeof raw !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const paise = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(paise) && paise <= 100000000 ? paise : null;
};
const paymentCredentials = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return { keyId: typeof keyId === 'string' && /^rzp_(?:test|live)_[A-Za-z0-9]+$/.test(keyId) ? keyId : null, keySecret: typeof keySecret === 'string' && keySecret.length > 0 ? keySecret : null };
};
const adminWhatsAppNumber = () => {
  const raw = String(process.env.WHATSAPP_ORDER_NUMBER || process.env.WHATSAPP_ADMIN_TO || '919773237770').replace(/\D/g, '');
  return /^\d{8,15}$/.test(raw) ? raw : '919773237770';
};
const paymentAuthorization = (keyId, keySecret) => `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

async function notifyAdminOnWhatsApp(order, event) {
  const { WHATSAPP_ACCESS_TOKEN: accessToken, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_ADMIN_TO: recipient, WHATSAPP_TEMPLATE_NAME: templateName } = process.env;
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v22.0';
  if (!accessToken || !phoneNumberId || !/^\d{8,15}$/.test(recipient || '') || !templateName || !/^[a-zA-Z0-9_]+$/.test(templateName) || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language) || !/^v\d+\.\d+$/.test(apiVersion)) {
    order.whatsappNotificationStatus = 'Not configured';
    await order.save();
    return;
  }

  const items = order.items.map(item => {
    const custom = Object.entries(item.custom || {}).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(', ');
    return `${item.name} x${item.quantity} @ ₹${Number(item.price).toLocaleString('en-IN')}${custom ? ` (${custom})` : ''}`;
  }).join('; ').slice(0, 1000);
  const parameters = [
    order.orderNumber,
    event === 'Checkout started' ? 'Checkout started - payment pending' : 'Payment verified',
    order.customer.name,
    `${order.customer.phone} / ${order.customer.email}`,
    items,
    order.customer.address,
    `₹${Number(order.total).toLocaleString('en-IN')}`,
  ];

  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language },
          components: [{ type: 'body', parameters: parameters.map(text => ({ type: 'text', text: String(text).slice(0, 1024) })) }],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      order.whatsappNotificationStatus = 'Failed';
      console.error('WhatsApp admin notification failed:', { orderNumber: order.orderNumber, status: response.status });
    } else {
      order.whatsappNotificationStatus = event;
    }
  } catch (error) {
    order.whatsappNotificationStatus = 'Failed';
    console.error('WhatsApp admin notification failed:', { orderNumber: order.orderNumber, name: error.name });
  }
  await order.save();
}

app.get('/api/checkout/config', (req, res) => {
  const { keyId, keySecret } = paymentCredentials();
  const shippingFeePaise = getShippingFeePaise();
  const enabled = Boolean(keyId && keySecret && Number.isSafeInteger(shippingFeePaise));
  res.set('Cache-Control', 'no-store').json({
    enabled,
    shippingFee: enabled ? shippingFeePaise / 100 : null,
    keyId: enabled ? keyId : null,
    whatsappNumber: adminWhatsAppNumber(),
    whatsappShippingFee: (getShippingFeePaise() || 0) / 100,
  });
});

app.post('/api/newsletter', publicWriteLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body?.email, 254).toLowerCase();
  if (rejectHoneypot(req)) return res.status(200).json({ message: 'Thank you for subscribing.' });
  if (!validEmail(email)) return res.status(400).json({ message: 'Please enter a valid email address.' });
  try {
    await NewsletterSubscriber.updateOne({ email }, { $setOnInsert: { email } }, { upsert: true, runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  res.status(201).json({ message: 'You are subscribed to Kalaai updates.' });
}));

app.post('/api/checkout/orders', publicWriteLimiter, asyncRoute(async (req, res) => {
  if (rejectHoneypot(req)) return res.status(200).json({ message: 'Thank you. Your request has been received.' });
  const { keyId, keySecret } = paymentCredentials();
  const shippingFeePaise = getShippingFeePaise();
  if (!keyId || !keySecret || !Number.isSafeInteger(shippingFeePaise)) {
    return res.status(503).json({ message: 'Online checkout is not configured. Set Razorpay test keys and a fixed shipping fee.' });
  }
  const body = req.body || {};
  const customer = body.customer || {};
  if (!cleanText(customer.name, 100) || !validEmail(customer.email) || !cleanText(customer.phone, 20) || !validPhone(customer.phone) || !cleanText(customer.address, 500) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
    return res.status(400).json({ message: 'Please provide a valid name, email, phone number, delivery address and cart.' });
  }
  const submittedIds = body.items.map(item => Number(item?.id));
  if (!submittedIds.length || submittedIds.some(id => !validId(id))) return res.status(400).json({ message: 'The cart contains invalid items.' });
  const products = await Product.find({ id: { $in: [...new Set(submittedIds)] }, active: true }).lean();
  const byId = new Map(products.map(product => [product.id, product]));
  let subtotalPaise = 0;
  const safeItems = body.items.map(item => {
    const product = byId.get(Number(item.id));
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 50) throw Object.assign(new Error('A selected product or quantity is no longer valid.'), { status: 400 });
    subtotalPaise += Math.round(product.price * 100) * qty;
    const custom = item.custom && typeof item.custom === 'object' && !Array.isArray(item.custom) ? item.custom : {};
    return { productId: product.id, name: product.name, price: product.price, quantity: qty, custom: Object.fromEntries(Object.entries(custom).slice(0, 8).map(([k, v]) => [cleanText(k, 40), cleanText(String(v ?? ''), 300)])) };
  });
  const totalPaise = subtotalPaise + shippingFeePaise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 100) return res.status(400).json({ message: 'The total amount must be at least ₹1.00.' });
  const safeCustomer = { name: cleanText(customer.name, 100), email: cleanText(customer.email, 254).toLowerCase(), phone: cleanText(customer.phone, 20), address: cleanText(customer.address, 500) };
  const orderNumber = `KL-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  let providerOrder;
  try {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: paymentAuthorization(keyId, keySecret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: totalPaise, currency: 'INR', receipt: orderNumber }),
    });
    if (!response.ok) {
      console.error('Razorpay order creation failed:', { status: response.status });
      return res.status(502).json({ message: 'Could not start payment. Please try again later.' });
    }
    providerOrder = await response.json();
  } catch (error) {
    console.error('Razorpay order creation failed:', { name: error.name });
    return res.status(502).json({ message: 'Could not connect to the payment provider. Please try again later.' });
  }
  if (typeof providerOrder.id !== 'string' || providerOrder.amount !== totalPaise || providerOrder.currency !== 'INR') {
    console.error('Razorpay returned an invalid order response.');
    return res.status(502).json({ message: 'Could not start payment. Please try again later.' });
  }
  const order = await Order.create({
    orderNumber,
    customer: safeCustomer,
    items: safeItems,
    subtotal: subtotalPaise / 100,
    shippingFee: shippingFeePaise / 100,
    total: totalPaise / 100,
    paymentStatus: 'Pending',
    razorpayOrderId: providerOrder.id,
  });
  await notifyAdminOnWhatsApp(order, 'Checkout started');
  res.status(201).json({
    orderNumber: order.orderNumber,
    razorpayOrderId: providerOrder.id,
    keyId,
    amount: totalPaise,
    currency: 'INR',
  });
}));

// WhatsApp order flow: customer gives phone + address, order is saved server-side
// (trusted prices, tamper-proof record) and the customer is sent to the admin's WhatsApp.
app.post('/api/checkout/whatsapp', publicWriteLimiter, asyncRoute(async (req, res) => {
  if (rejectHoneypot(req)) return res.status(200).json({ message: 'Thank you. Your request has been received.' });
  const body = req.body || {};
  const customer = body.customer || {};
  const phone = cleanText(customer.phone, 20);
  const address = cleanText(customer.address, 500);
  if (!phone || !validPhone(phone) || address.length < 10 || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
    return res.status(400).json({ message: 'Please provide a valid phone number, a full delivery address and a non-empty cart.' });
  }
  const submittedIds = body.items.map(item => Number(item?.id));
  if (submittedIds.some(id => !validId(id))) return res.status(400).json({ message: 'The cart contains invalid items.' });
  const products = await Product.find({ id: { $in: [...new Set(submittedIds)] }, active: true }).lean();
  const byId = new Map(products.map(product => [product.id, product]));
  let subtotalPaise = 0;
  const safeItems = body.items.map(item => {
    const product = byId.get(Number(item.id));
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 50) throw Object.assign(new Error('A selected product or quantity is no longer valid.'), { status: 400 });
    subtotalPaise += Math.round(product.price * 100) * qty;
    const custom = item.custom && typeof item.custom === 'object' && !Array.isArray(item.custom) ? item.custom : {};
    return { productId: product.id, name: product.name, price: product.price, quantity: qty, custom: Object.fromEntries(Object.entries(custom).slice(0, 8).map(([k, v]) => [cleanText(k, 40), cleanText(String(v ?? ''), 300)])) };
  });
  const shippingFeePaise = getShippingFeePaise() || 0;
  const totalPaise = subtotalPaise + shippingFeePaise;
  const orderNumber = `KL-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const order = await Order.create({
    orderNumber,
    customer: { name: '', email: '', phone, address },
    items: safeItems,
    subtotal: subtotalPaise / 100,
    shippingFee: shippingFeePaise / 100,
    total: totalPaise / 100,
    paymentStatus: 'Pending',
    whatsappNotificationStatus: 'Customer WhatsApp',
    notes: 'Placed via WhatsApp - payment to be arranged with customer.',
  });
  res.status(201).json({
    orderNumber: order.orderNumber,
    items: safeItems.map(i => ({ name: i.name, price: i.price, quantity: i.quantity, custom: i.custom })),
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    phone,
    address,
    whatsappNumber: adminWhatsAppNumber(),
  });
}));

app.post('/api/checkout/verify', publicWriteLimiter, asyncRoute(async (req, res) => {
  const { keyId, keySecret } = paymentCredentials();
  const { razorpay_order_id: providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!keyId || !keySecret) return res.status(503).json({ message: 'Payment verification is not configured.' });
  if (typeof providerOrderId !== 'string' || providerOrderId.length > 100 || typeof paymentId !== 'string' || paymentId.length > 100 || typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature)) {
    return res.status(400).json({ message: 'Invalid payment response.' });
  }
  const order = await Order.findOne({ razorpayOrderId: providerOrderId });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const expected = crypto.createHmac('sha256', keySecret).update(`${providerOrderId}|${paymentId}`).digest();
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return res.status(400).json({ message: 'Payment verification failed.' });
  }
  if (order.paymentStatus === 'Paid' && order.razorpayPaymentId === paymentId) {
    return res.json({ message: 'Payment already verified.', orderNumber: order.orderNumber });
  }
  if (order.paymentStatus === 'Paid') return res.status(409).json({ message: 'This order has already been paid with a different payment.' });
  let paymentResponse;
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: paymentAuthorization(keyId, keySecret) },
    });
    if (!response.ok) {
      console.error('Razorpay payment lookup failed:', { status: response.status });
      return res.status(502).json({ message: 'Payment status could not be confirmed. Please contact Kalaai before retrying.' });
    }
    paymentResponse = await response.json();
  } catch (error) {
    console.error('Razorpay payment lookup failed:', { name: error.name });
    return res.status(502).json({ message: 'Payment status could not be confirmed. Please contact Kalaai before retrying.' });
  }
  if (paymentResponse.order_id !== providerOrderId || paymentResponse.amount !== Math.round(order.total * 100) || paymentResponse.currency !== 'INR') {
    return res.status(400).json({ message: 'Payment details do not match this order.' });
  }
  if (paymentResponse.status !== 'captured') {
    return res.status(409).json({ message: 'Payment is not captured yet. Please wait for confirmation before shipping.' });
  }
  order.paymentStatus = 'Paid';
  order.razorpayPaymentId = paymentId;
  await order.save();
  await notifyAdminOnWhatsApp(order, 'Payment confirmed');
  res.json({ message: 'Payment verified. Your order is ready for processing.', orderNumber: order.orderNumber });
}));

const uploadDirectory = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const enquiryUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return callback(Object.assign(new Error('Only JPG, PNG, GIF or WebP images are accepted.'), { status: 400 }));
    callback(null, true);
  },
});

async function validateUploadedImage(req, res, next) {
  if (!req.file) return next();
  let handle;
  try {
    handle = await fs.promises.open(req.file.path, 'r');
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const valid = req.file.mimetype === 'image/jpeg'
      ? bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      : req.file.mimetype === 'image/png'
        ? bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : req.file.mimetype === 'image/gif'
          ? bytesRead >= 6 && ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6))
          : req.file.mimetype === 'image/webp'
            ? bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
            : false;
    await handle.close();
    handle = null;
    if (valid) return next();
    await fs.promises.unlink(req.file.path);
    return res.status(400).json({ message: 'The uploaded file does not match a supported image format.' });
  } catch (error) {
    if (handle) await handle.close();
    next(error);
  }
}

app.use('/uploads', express.static(uploadDirectory, { maxAge: isProduction ? '7d' : 0, dotfiles: 'deny' }));

app.post('/api/enquiries', publicWriteLimiter, enquiryUpload.single('referenceImage'), validateUploadedImage, preventDuplicateSubmission, asyncRoute(async (req, res) => {
  if (rejectHoneypot(req)) {
    if (req.file) await fs.promises.unlink(req.file.path);
    return res.status(200).json({ message: 'Thank you. Your enquiry has been received.' });
  }
  const b = req.body || {};
  if (!['custom', 'contact'].includes(b.type || 'custom') || !cleanText(b.name, 100) || !validEmail(b.email) || !validPhone(b.phone) || !cleanText(b.message || b.designDescription, 3000)) {
    return res.status(400).json({ message: 'Please complete the required fields with valid details.' });
  }
  const data = {
    type: b.type || 'custom', name: cleanText(b.name, 100), email: cleanText(b.email, 254).toLowerCase(),
    phone: cleanText(b.phone, 20), category: cleanText(b.category, 100), occasion: cleanText(b.occasion, 100),
    budget: cleanText(b.budget, 60), subject: cleanText(b.subject, 150), message: cleanText(b.message, 3000),
    designDescription: cleanText(b.designDescription, 3000),
  };
  if (req.file) data.referenceImage = { url: `/uploads/${req.file.filename}`, originalName: cleanText(req.file.originalname, 255), mimeType: req.file.mimetype, size: req.file.size };
  await Enquiry.create(data);
  res.status(201).json({ message: 'Thank you. Your enquiry has been sent to Kalaai.' });
}));

app.post('/api/admin/login', loginLimiter, asyncRoute(async (req, res) => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || !process.env.JWT_SECRET) return res.status(503).json({ message: 'Admin authentication is not configured.' });
  const { user, pass } = req.body || {};
  const validUser = typeof user === 'string' && user.length <= 100 && user === username;
  const validPass = typeof pass === 'string' && pass.length <= 256 && await bcrypt.compare(pass, configuredAdminPasswordHash);
  if (!validUser || !validPass) return res.status(401).json({ message: 'Incorrect username or password.' });
  const days = Math.max(1, Math.min(7, Number(process.env.SESSION_DAYS) || 1));
  const token = jwt.sign({ role: 'admin', username }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: `${days}d`, issuer: 'kalaai', audience: 'kalaai-admin' });
  res.cookie('dc_admin', token, { ...cookieOptions(), maxAge: days * 86400000 });
  res.set('Cache-Control', 'no-store');
  res.json({ message: 'Signed in', username });
}));
app.post('/api/admin/logout', (req, res) => { res.clearCookie('dc_admin', cookieOptions()); res.set('Cache-Control', 'no-store'); res.json({ message: 'Signed out' }); });
app.use('/api/admin', requireAdmin, adminWriteLimiter);
app.get('/api/admin/me', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ username: req.admin.username }); });
app.get('/api/admin/stats', asyncRoute(async (req, res) => {
  const [products, orders, enquiries, subscribers, newOrders, newEnquiries, revenue] = await Promise.all([
    Product.countDocuments({ active: true }), Order.countDocuments(), Enquiry.countDocuments(), NewsletterSubscriber.countDocuments(), Order.countDocuments({ status: 'New' }),
    Enquiry.countDocuments({ status: 'New' }), Order.aggregate([{ $match: { paymentStatus: 'Paid' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
  ]);
  res.set('Cache-Control', 'no-store'); res.json({ products, orders, enquiries, subscribers, newOrders, newEnquiries, revenue: revenue[0]?.total || 0 });
}));
app.get('/api/admin/products', asyncRoute(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await Product.find().sort({ id: 1 }).lean()); }));
app.post('/api/admin/products', asyncRoute(async (req, res) => {
  const data = validateProduct(req.body);
  data.id = await nextProductId(); data.slug = cleanText(req.body.slug || `creation-${Date.now()}`, 120);
  const product = await Product.create(data); res.status(201).json(product);
}));
app.put('/api/admin/products/:id', asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID.' });
  const data = validateProduct(req.body);
  const product = await Product.findOneAndUpdate({ id: Number(req.params.id) }, { $set: data }, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found' }); res.json(product);
}));
app.delete('/api/admin/products/:id', asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID.' });
  const product = await Product.findOneAndUpdate({ id: Number(req.params.id) }, { $set: { active: false } }, { new: true });
  if (!product) return res.status(404).json({ message: 'Product not found' }); res.json({ message: 'Product archived' });
}));
app.patch('/api/admin/products/:id', asyncRoute(async (req, res) => {
  if (!validId(req.params.id) || typeof req.body?.active !== 'boolean') return res.status(400).json({ message: 'Invalid product visibility update.' });
  const product = await Product.findOneAndUpdate({ id: Number(req.params.id) }, { $set: { active: req.body.active } }, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.set('Cache-Control', 'no-store').json(product);
}));
app.get('/api/admin/orders', asyncRoute(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await Order.find().sort({ createdAt: -1 }).lean()); }));
app.patch('/api/admin/orders/:id', asyncRoute(async (req, res) => {
  const allowed = ['New', 'Confirmed', 'In Progress', 'Shipped', 'Completed', 'Cancelled'];
  if (!mongoose.isValidObjectId(req.params.id) || !allowed.includes(req.body?.status)) return res.status(400).json({ message: 'Invalid order update.' });
  const order = await Order.findById(req.params.id).select('paymentStatus').lean();
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (['Shipped', 'Completed'].includes(req.body.status) && order.paymentStatus !== 'Paid') return res.status(409).json({ message: 'Payment must be verified before an order can be shipped or completed.' });
  const updated = await Order.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true, runValidators: true });
  res.json(updated);
}));
app.get('/api/admin/enquiries', asyncRoute(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await Enquiry.find().sort({ createdAt: -1 }).lean()); }));
app.get('/api/admin/subscribers', asyncRoute(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await NewsletterSubscriber.find().sort({ createdAt: -1 }).select('email createdAt').lean()); }));
app.patch('/api/admin/enquiries/:id', asyncRoute(async (req, res) => {
  const allowed = ['New', 'Contacted', 'In Progress', 'Closed'];
  if (!mongoose.isValidObjectId(req.params.id) || !allowed.includes(req.body?.status)) return res.status(400).json({ message: 'Invalid enquiry update.' });
  const enquiry = await Enquiry.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true, runValidators: true });
  if (!enquiry) return res.status(404).json({ message: 'Enquiry not found' }); res.json(enquiry);
}));

function validateProduct(body = {}) {
  const name = cleanText(body.name, 120), category = cleanText(body.category, 100), price = Number(body.price);
  if (!name || !category || !Number.isFinite(price) || price < 0 || price > 10000000) throw Object.assign(new Error('Provide a valid product name, category and price.'), { status: 400 });
  const image = cleanText(body.image, 300);
  const images = Array.isArray(body.images) ? body.images.slice(0, 8).map(x => cleanText(x, 300)) : (image ? [image] : []);
  const validImagePath = value => /^\/images\/products\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(value) && fs.existsSync(path.join(publicRoot, value));
  if (!image || !validImagePath(image) || images.some(x => !validImagePath(x))) throw Object.assign(new Error('Product images must use an existing local product image path.'), { status: 400 });
  const list = key => Array.isArray(body[key]) ? body[key].slice(0, 30).map(x => cleanText(String(x), 100)).filter(Boolean) : [];
  return { name, category, productType: cleanText(body.productType, 100), price, description: cleanText(body.description, 2000), image, images, occasions: list('occasions'), personalisationTypes: list('personalisationTypes'), personalised: Boolean(body.personalised), availability: cleanText(body.availability, 100), featured: Boolean(body.featured), tags: list('tags'), active: body.active !== false };
}
async function nextProductId() { const p = await Product.findOne().sort({ id: -1 }).lean(); return (p?.id || 0) + 1; }

const projectRoot = path.join(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
app.use('/images', express.static(path.join(publicRoot, 'images'), { maxAge: isProduction ? '7d' : 0, immutable: isProduction }));
app.use('/styles.css', express.static(path.join(publicRoot, 'styles.css')));
app.use('/src.js', express.static(path.join(publicRoot, 'src.js')));
app.use('/admin.css', express.static(path.join(projectRoot, 'public/admin.css')));
app.use('/admin.js', express.static(path.join(projectRoot, 'public/admin.js')));
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(projectRoot, 'public/admin.html')));
app.get(['/', '/index.html', '/privacy-policy', '/terms-and-conditions', '/faq', '/shipping', '/returns'], (req, res, next) => {
  fs.readFile(path.join(projectRoot, 'views', 'index.html'), 'utf8', (error, html) => {
    if (error) return next(error);
    const siteUrl = (getSiteUrl() || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    res.type('html').send(html.replace('<meta name="kalaai-site-url" content=""/>', `<meta name="kalaai-site-url" content="${siteUrl}"/>`));
  });
});
app.get('/robots.txt', (req, res) => {
  const base = getSiteUrl() ? `Sitemap: ${getSiteUrl()}/sitemap.xml\n` : '';
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${base}`);
});
app.get('/sitemap.xml', (req, res) => {
  if (!getSiteUrl()) return res.status(503).type('text/plain').send('Configure SITE_URL to enable the canonical sitemap.');
  const base = getSiteUrl();
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/privacy-policy','/terms-and-conditions','/faq','/shipping','/returns'].map(route => `<url><loc>${base}${route}</loc></url>`).join('')}</urlset>`);
});
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'The requested API endpoint was not found.' });
  next();
});
app.use((req, res, next) => {
  if (/^\/(server|node_modules|\.git)(\/|$)/i.test(req.path) || ['/package.json', '/package-lock.json', '/.gitignore', '/README.md', '/README.txt'].includes(req.path)) return res.sendStatus(404);
  next();
});
app.use(express.static(publicRoot, { index: 'index.html', dotfiles: 'ignore', etag: true, maxAge: isProduction ? '1h' : 0 }));
app.use((req, res) => res.status(404).sendFile(path.join(projectRoot, 'public/404.html')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large.' });
  if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Reference images must be 5 MB or smaller.' : 'Invalid image upload.' });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ message: 'Invalid request format.' });
  console.error('Request failed:', { method: req.method, path: req.path, status: err.status || 500, name: err.name });
  res.status(err.status || 500).json({ message: err.status && err.status < 500 ? err.message : 'Something went wrong. Please try again later.' });
});

async function start() {
  // MongoMemoryServer is only a local-development fallback. Never use an
  // ephemeral database in production or in Vercel serverless functions.
  if (process.env.NODE_ENV === 'production') {
    await connectToDatabase();
  } else {
    let mongoUri = process.env.MONGODB_URI;
    if (!mongoUri || /^mongodb:\/\/(127\.0\.0\.1|localhost):27017(\/|$)/.test(mongoUri)) {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const memoryMongo = await MongoMemoryServer.create();
      process.env.MONGODB_URI = memoryMongo.getUri();
      console.warn('Using an in-memory MongoDB instance for local development.');
    }
    try {
      await connectToDatabase();
    } catch (error) {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const memoryMongo = await MongoMemoryServer.create();
      process.env.MONGODB_URI = memoryMongo.getUri();
      databasePromise = null;
      await connectToDatabase();
      console.warn('Local MongoDB was unavailable; using in-memory MongoDB.');
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Kalaai listening on port ${port}`));
}

// Vercel imports this file as a serverless function. Local development keeps
// the traditional Express listener through npm run dev / npm start.
if (require.main === module) {
  start().catch(error => {
    console.error('Startup failed:', error.message);
    process.exit(1);
  });
}

module.exports = app;
