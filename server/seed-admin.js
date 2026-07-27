'use strict';
const { config } = require('./config');
const { hashPassword } = require('./auth');
const admins = require('./repo/admins');

async function run(db) {
  if (!config.adminEmail || !config.adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required to seed the admin.');
  }
  const hash = await hashPassword(config.adminPassword);
  const admin = await admins.upsert(db, config.adminEmail.toLowerCase(), hash);
  return admin;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const { getDb, closeDb } = require('./db');
    const db = await getDb();
    const a = await run(db);
    console.log(`Admin seeded: ${a.email}`);
    await closeDb();
  })();
}
