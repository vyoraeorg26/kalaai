# Kalaai — Full-stack website

This project contains the original Kalaai storefront and catalogue photos, plus a Node.js/Express backend, MongoDB persistence, and a password-protected admin dashboard.

## Features

- Existing storefront, catalogue, search, category filters, sort, quick view, cart and wishlist.
- Product catalogue loaded from MongoDB through `GET /api/products`.
- Admin dashboard at **`/admin`** (same as `/admin/`).
- Admin product management: search, add, edit, archive and restore products; update price/category/description/featured settings.
- Razorpay test-mode checkout with server-calculated totals, fixed configured shipping, server-side payment verification, and orders visible in Admin → Orders.
- Admin orders include customer, delivery, line-item and personalisation details and refresh automatically. Optional Meta WhatsApp Cloud API sends the admin an approved-template notification when checkout starts and after payment is verified; it is sent server-to-server and is not a client-editable `wa.me` draft.
- Newsletter addresses saved in MongoDB and visible in Admin → Newsletter. No marketing emails are sent.
- Custom-order and contact enquiries saved in MongoDB and visible in Admin → Enquiries.
- HttpOnly, SameSite=Strict admin session cookie, production Secure cookies, signed/expiring JWTs, login and public-form rate limiting, request-origin checks, server-side validation, and Helmet security headers.
- Privacy Policy, Terms & Conditions draft pages, cookie preference UI, sitemap/robots endpoints, branded 404 page and production HTTPS redirect.

## Requirements

- Node.js 20 or newer
- MongoDB Community Server running locally, or a MongoDB Atlas connection string

## Run locally (Windows / macOS / Linux)

1. Extract the ZIP.
2. Open a terminal in the extracted `kalaai-fullstack` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
5. Edit `.env` and set `MONGODB_URI` if you want to use your own database.
   - Local MongoDB: `mongodb://127.0.0.1:27017/kalaai`
   - MongoDB Atlas: paste your Atlas connection string, replacing the username/password and database name as appropriate.
   - If `MONGODB_URI` is left unset in development, the app now automatically creates a temporary in-memory MongoDB instance so the admin panel and forms can still run locally.
6. Set a unique random `JWT_SECRET` (at least 32 characters), a unique `ADMIN_USERNAME`, and a strong `ADMIN_PASSWORD` (at least 14 characters). The example environment file contains placeholders, not working credentials.
7. To enable test checkout, set a Razorpay **test-mode** Key ID (`rzp_test_...`), its matching Key Secret, and `SHIPPING_FEE_INR` to the fixed shipping charge in rupees (for example `99.00`). Checkout stays disabled until all three values are configured. The secret stays on the server and is never sent to the browser. The app rejects live-mode keys.
8. Optional WhatsApp notifications: configure Meta WhatsApp Cloud API credentials using the `WHATSAPP_*` variables below. Create and get approval for a Utility message template named `kalaai_checkout_notice` (or set another name) with this body and seven placeholders:

   ```text
   Kalaai order update
   Order: {{1}}
   Status: {{2}}
   Customer: {{3}}
   Phone / email: {{4}}
   Items: {{5}}
   Delivery address: {{6}}
   Total: {{7}}
   ```

   Set `WHATSAPP_ADMIN_TO` to the admin's WhatsApp number in international format using digits only, without `+`. Since the server sends the approved template directly to the admin, the client does not open or edit a WhatsApp message. Without valid WhatsApp configuration the order is still saved in the Admin panel; the panel shows the notification status.
9. Start the app:

   ```bash
   npm start
   ```

9. Open `http://localhost:3000` for the storefront and `http://localhost:3000/admin` for the admin panel.

On first successful start, the app imports the 33 bundled catalogue products into MongoDB if the products collection is empty. Subsequent starts do not overwrite your catalogue.

## Admin login

- URL: `/admin`
- Credentials are supplied only through `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables. There is no hard-coded default login.
- Use a unique username and a strong password (at least 14 characters). The server never returns the password to the browser. Keep `.env` out of version control and rotate credentials if exposed.

## Deploying

Deploy the Node app to a host that supports persistent Node.js processes and configure these environment variables in its dashboard: `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `SITE_URL`, `NODE_ENV=production`, and optionally `PORT`, `SESSION_DAYS`, and `TRUST_PROXY=true` only when behind a trusted reverse proxy. `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `SHIPPING_FEE_INR` enable test-mode checkout; use a fixed shipping price that you have chosen and disclosed to customers. The current implementation deliberately accepts only Razorpay test keys, so it is not ready to collect live payments. Use HTTPS in production. Configure MongoDB Atlas network access for the app host. Do not deploy this project as a static-only site (for example, static hosting alone cannot run Express or connect this backend).

## Notes / production checklist

- Razorpay test checkout creates a pending order before payment and marks it paid only after server-side signature and captured-payment verification. Orders cannot be marked shipped or completed until payment is verified. Configure Razorpay webhooks and complete a production payment/security review before enabling live payments.
- Newsletter subscriptions are stored in the app database for the owner to manage. No email or marketing-message service is connected.
- Configure the optional Meta WhatsApp Cloud API variables and an approved matching template to send server-originated order notifications to the admin. Order details are never sent through a client-editable WhatsApp link.
- Product image paths currently point to the bundled catalogue images. The admin editor lets you choose an existing image path; a secure image-upload workflow is not included in this version.
- Email/SMS notifications, shipping-carrier integrations, refunds, customer accounts, and inventory reservation are not configured. Shipping is a fixed fee; the owner must set and communicate the correct amount.
- Configure TLS at the host/load balancer, MongoDB least-privilege credentials and network restrictions, backups, monitoring and alerting before accepting real customer information.
- Complete and approve the Privacy Policy and Terms placeholders, including legal name, contact details, data region, retention/deletion policy, governing law, cancellation/refund and shipping policies.
- Storefront controls use delegated event listeners compatible with the CSP; inline script execution is not allowed.
- `SITE_URL` must be the real canonical HTTPS origin for sitemap and canonical metadata. A valid TLS certificate and hosting configuration cannot be provisioned from this source archive.


## Deploy to Vercel

See [VERCEL-DEPLOYMENT.md](VERCEL-DEPLOYMENT.md) for the full deployment walkthrough, required environment variables, MongoDB Atlas setup, verification checklist and production limitations.

The Vercel deployment uses the root `index.js` Express entrypoint. Static assets are stored under `public/`, while the HTML template is in `views/index.html` so the server can inject the configured canonical `SITE_URL`. The included `vercel.json` explicitly bundles the server, template, seed catalogue and public assets. Set Vercel's Root Directory to the folder containing this `package.json`; leave Build Command and Output Directory blank.
