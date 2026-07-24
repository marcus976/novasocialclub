'use strict';
const path = require('path');
const express = require('express');
const { config } = require('./config');

function createApp(opts = {}) {
  const app = express();
  const rootDir = path.join(__dirname, '..');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const dbForSession = opts.db || null;
  app.use(require('./auth').sessionMiddleware(dbForSession));

  const getDb = opts.db ? async () => opts.db : require('./db').getDb;

  app.use('/', require('./routes/public')(getDb));
  app.get('/portal.css', (req, res) => res.type('css').sendFile(path.join(__dirname, 'public-admin.css')));
  app.use('/admin', require('./routes/admin')(getDb));
  app.use(express.static(rootDir, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong.');
  });
  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`NOVA server listening on :${config.port}`);
  });
}

module.exports = { createApp };
