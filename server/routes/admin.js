'use strict';
const express = require('express');
const ejs = require('ejs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const admins = require('../repo/admins');
const appsRepo = require('../repo/applications');
const membersRepo = require('../repo/members');
const subsRepo = require('../repo/subscribers');
const partnersRepo = require('../repo/partners');
const tokens = require('../tokens');
const email = require('../email');
const V = require('../validate');
const { config } = require('../config');

const LEVELS = { founding: 'Founding Member', member: 'Member', associate: 'Associate' };

function renderPage(res, view, locals) {
  const viewsDir = path.join(__dirname, '..', 'views');
  ejs.renderFile(path.join(viewsDir, view + '.ejs'), locals, (err, body) => {
    if (err) return res.status(500).send(String(err));
    ejs.renderFile(path.join(viewsDir, 'layout.ejs'), Object.assign({ body }, locals), (e2, html) =>
      e2 ? res.status(500).send(String(e2)) : res.send(html));
  });
}

module.exports = function adminRoutes(getDb) {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
  router.use(auth.csrf);

  router.get('/login', (req, res) =>
    renderPage(res, 'admin/login', { title: 'Login', nav: false, error: null, csrfToken: res.locals.csrfToken }));

  router.post('/login', loginLimiter, async (req, res) => {
    const db = await getDb();
    const emailIn = String(req.body.email || '').toLowerCase().trim();
    const admin = await admins.getByEmail(db, emailIn);
    const ok = admin && await auth.verifyPassword(String(req.body.password || ''), admin.password_hash);
    if (!ok) return renderPage(res, 'admin/login', { title: 'Login', nav: false, error: 'Invalid email or password.', csrfToken: res.locals.csrfToken });
    req.session.adminId = admin.id;
    res.redirect('/admin');
  });

  router.post('/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')); });

  router.use(auth.requireAdmin); // everything below requires login

  router.get('/', async (req, res) => {
    const db = await getDb();
    const all = await appsRepo.list(db, {});
    const counts = {
      pending: all.filter(a => a.status === 'pending').length,
      members: (await membersRepo.list(db, {})).length,
      subscribers: (await subsRepo.activeEmails(db)).length,
    };
    renderPage(res, 'admin/dashboard', { title: 'Dashboard', nav: true, csrfToken: res.locals.csrfToken, counts, recent: all.slice(0, 10) });
  });

  return router;
};
