Kalaai Full-stack Website

This folder contains the storefront, Node.js/Express backend, MongoDB database integration, and admin dashboard. Read README.md for installation and setup instructions.

Admin URL: /admin
Admin username and password: configure ADMIN_USERNAME and ADMIN_PASSWORD in the server environment. No default credentials are supplied.

Important: Copy .env.example to .env, configure MONGODB_URI, ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET and SITE_URL, then run npm install and npm start. The backend requires a running MongoDB database (local MongoDB or MongoDB Atlas). Do not deploy as static-only hosting. Never commit .env or expose server credentials.
