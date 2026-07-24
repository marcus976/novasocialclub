'use strict';
const path = require('path');
const express = require('express');
const { config } = require('./config');

function createApp() {
  const app = express();
  const rootDir = path.join(__dirname, '..');
  // Serve the existing static marketing site from the repo root.
  app.use(express.static(rootDir, { extensions: ['html'] }));
  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`NOVA server listening on :${config.port}`);
  });
}

module.exports = { createApp };
