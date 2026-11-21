# Kalaai — Vercel deployment

This project keeps the existing Express API and storefront. Vercel runs the Express application as a Node.js Function and serves files in `public/` from its static asset CDN.

## Project layout

- `index.js` — root Express entrypoint detected by Vercel
- `server/index.js` — existing Express app and API routes
- `server/models/` — MongoDB models
- `server/seed-products.json` — initial catalogue data
- `views/index.html` — storefront HTML template; Express injects `SITE_URL`
- `public/` — static CSS, JavaScript, admin assets, logo and product images
- `vercel.json` — explicitly includes server code, the HTML template, seed catalogue and public assets in the function bundle

Do not set a custom Build Command or Output Directory for this Express project. Keep the Vercel Root Directory pointed at the directory containing this `package.json` and root `index.js`.

## 1. MongoDB Atlas

1. Create a MongoDB Atlas cluster and a dedicated database user.
2. Create a database, for example `kalaai`.
3. Copy the application connection string and replace the username, password and database name.
4. In Atlas Network Access, allow connections from your Vercel deployment. Vercel's outbound IPs can vary by plan and configuration; use a supported static-egress option where available. If you temporarily use `0.0.0.0/0`, use a strong database password and a database user restricted to the Kalaai database.

Never use `localhost` or `mongodb://127.0.0.1` for the production `MONGODB_URI`.

## 2. Vercel environment variables

In **Project → Settings → Environment Variables**, add these variables for **Production** (and Preview if you want preview deployments to use a separate test database):

| Variable | Required | Value |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `JWT_SECRET` | Yes | Unique random secret, minimum 32 characters |
| `ADMIN_USERNAME` | Yes | Your admin login username |
| `ADMIN_PASSWORD` | Yes | Unique password, minimum 14 characters |
| `SITE_URL` | Yes | Canonical HTTPS URL, no trailing slash |
| `SESSION_DAYS` | Recommended | `1` |
| `RAZORPAY_KEY_ID` | Optional | Start with your Razorpay test key |
| `RAZORPAY_KEY_SECRET` | Optional | Matching Razorpay secret |
| `SHIPPING_FEE_INR` | Optional for checkout | Fixed shipping amount, e.g. `99.00` |
| `WHATSAPP_ACCESS_TOKEN` | Optional | Meta WhatsApp Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional | Meta WhatsApp Business phone-number ID |
| `WHATSAPP_ADMIN_TO` | Optional | Admin recipient number, international format, digits only |
| `WHATSAPP_TEMPLATE_NAME` | Optional | Approved Utility template name; defaults to `kalaai_checkout_notice` only if configured in `.env` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Optional | Approved template language code, e.g. `en` |
| `WHATSAPP_GRAPH_API_VERSION` | Optional | Graph API version, e.g. `v22.0` |

Generate a strong JWT secret locally in PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `SITE_URL` to the domain that customers will actually use, such as `https://your-project.vercel.app` or your custom domain. Update it if the production domain changes.

Vercel sets `NODE_ENV=production` and `VERCEL=1`. The application automatically trusts Vercel's proxy for HTTPS cookies and secure redirects. Do not set `TRUST_PROXY=true` unless you have separately verified a trusted proxy in another hosting environment.

To enable server-sent admin WhatsApp order updates, create and approve a Meta Utility template named `kalaai_checkout_notice` with seven body placeholders for order number, checkout/payment status, customer, phone/email, items, delivery address and total. Configure the matching template name/language and the WhatsApp environment variables above. Notifications are sent directly by the server to the admin number; customers never receive a prefilled editable `wa.me` message. Orders remain available in Admin → Orders if WhatsApp is not configured or a notification fails.

## 3. Vercel project settings

- **Framework Preset:** Other (or Express if Vercel detects it)
- **Root Directory:** the folder containing this `package.json` and `index.js`
- **Build Command:** leave blank / use the default
- **Output Directory:** leave blank / use the default
- **Install Command:** `npm install` (default is fine)
- **Node.js Version:** 20 or newer

The root `index.js` exports the Express app and is the Vercel-detected entrypoint. `vercel.json` includes the dynamically-read `server/`, `views/` and `public/` files in the function bundle. Do not add an `app.listen()` call to the Vercel entrypoint. The existing `server/index.js` starts a listener only when run directly for local development.

## 4. Deploy

Push the updated project to the GitHub repository connected to Vercel. Then trigger a new Production Deployment.

For later updates from PowerShell:

```powershell
git add -A
git commit -m "Configure Kalaai for Vercel"
git push origin main
```

## 5. Verify the deployment

After deployment, test:

1. `https://YOUR_DOMAIN/` — storefront loads with styling and images.
2. `https://YOUR_DOMAIN/api/health` — returns `{"status":"ok"}` after MongoDB connects.
3. `https://YOUR_DOMAIN/api/products` — returns the catalogue. If the database is empty, the app seeds the existing `server/seed-products.json` catalogue on first successful connection.
4. `https://YOUR_DOMAIN/admin` — admin login page loads.
5. Sign in and verify product, order, enquiry and subscriber views.
6. Test a newsletter signup and enquiry using non-sensitive test details.
7. Test Razorpay with test credentials before enabling live payments.

If `/api/health` returns 503, check the Vercel Function Logs and verify `MONGODB_URI`, Atlas Network Access and database credentials. If the app reports missing production configuration, check `JWT_SECRET`, `ADMIN_PASSWORD` and `SITE_URL`.

## 6. Important production limitations to address

- **Rate limiting:** the existing `express-rate-limit` and duplicate-submission map use per-instance memory. Serverless instances do not share that memory, so these are not a global rate limit. For robust production protection, use a shared Redis-backed store (and shared duplicate-submission storage) before relying on the limits for abuse prevention.
- **Product image uploads:** the current admin code manages product image paths that already exist in `public/images/products`; it does not provide durable image uploads. Vercel's function filesystem is not persistent. If you add uploads later, use object storage such as Vercel Blob or S3-compatible storage.
- **MongoDB:** serverless instances can scale concurrently. The app reuses a Mongoose connection per warm instance and uses a small connection pool. Monitor Atlas connection usage as traffic grows.
- **Razorpay:** start with test credentials and complete an end-to-end test. The API accepts `rzp_test_` and `rzp_live_` key IDs, but do not switch to live credentials until your Razorpay account and webhook/payment operations are configured and verified.
- **Secrets and cookies:** never commit `.env`, cookies, tokens or credentials. The uploaded project archive included a `.env` file and `cookies.txt`; they are deliberately excluded from this deployment package. Rotate the MongoDB password, admin password, JWT secret and any still-valid session cookies if those values were ever committed or shared outside a trusted environment.

## Local development

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The local server can use a local MongoDB URI or create an in-memory MongoDB instance when no local URI is configured. The in-memory database is only a development fallback; it is never used in production.
