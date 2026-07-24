const { _makePglite } = require('../server/db');
const { migrate } = require('../server/migrate');

async function freshDb() {
  const db = await _makePglite();
  await migrate(db);
  return db;
}

module.exports = { freshDb };
