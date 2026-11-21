require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Product = require('./models/Product');

async function seed() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to seed the catalogue.');
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const seedData = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-products.json'), 'utf8'));
  const count = await Product.countDocuments();
  if (count) {
    console.log(`Seed skipped: ${count} product records already exist.`);
  } else {
    await Product.insertMany(seedData.products);
    console.log(`Seeded ${seedData.products.length} Kalaai products.`);
  }
}

seed()
  .catch(error => {
    console.error('Catalogue seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
