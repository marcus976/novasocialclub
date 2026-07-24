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

  router.get('/applications', async (req, res) => {
    const db = await getDb();
    const status = req.query.status || '';
    const rows = await appsRepo.list(db, status ? { status } : {});
    renderPage(res, 'admin/applications', { title: 'Applications', nav: true, csrfToken: res.locals.csrfToken, rows, status, LEVELS });
  });

  router.get('/applications/:id', async (req, res) => {
    const db = await getDb();
    const a = await appsRepo.getById(db, Number(req.params.id));
    if (!a) return res.status(404).send('Not found');
    renderPage(res, 'admin/application-detail', { title: 'Application', nav: true, csrfToken: res.locals.csrfToken, a, LEVELS });
  });

  router.post('/applications/:id/accept', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const level = String(req.body.level || '');
    if (!LEVELS[level]) return res.status(400).send('Invalid level');
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    await appsRepo.setStatus(db, id, 'accepted', level, new Date());
    const existing = await membersRepo.getByEmail(db, a.email);
    const token = tokens.newToken();
    const expires = tokens.expiryFromNow(7);
    let member;
    if (existing) {
      await membersRepo.setLevel(db, existing.id, level);
      member = await membersRepo.setSetToken(db, existing.id, token, expires);
    } else {
      member = await membersRepo.createFromApplication(db, a, level, token, expires);
    }
    const url = `${config.appBaseUrl}/member/set-password?token=${token}`;
    const t = email.welcomeSetPasswordEmail(member, url);
    await email.sendEmail(db, { to: member.email, subject: t.subject, html: t.html, type: 'welcome_set_password', memberId: member.id });
    res.redirect(`/admin/applications/${id}`);
  });

  router.post('/applications/:id/reject', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    await appsRepo.setStatus(db, id, 'rejected', null, new Date());
    if (req.body.notify === 'on') {
      const t = email.rejectionEmail(a);
      await email.sendEmail(db, { to: a.email, subject: t.subject, html: t.html, type: 'rejection' });
    }
    res.redirect(`/admin/applications/${id}`);
  });

  router.post('/applications/:id/notes', async (req, res) => {
    const db = await getDb();
    await appsRepo.addNote(db, Number(req.params.id), V.cleanStr(req.body.notes, 2000));
    res.redirect(`/admin/applications/${req.params.id}`);
  });

  router.get('/members', async (req, res) => {
    const db = await getDb();
    const q = req.query.q || '';
    const rows = await membersRepo.list(db, q ? { q } : {});
    renderPage(res, 'admin/members', { title: 'Members', nav: true, csrfToken: res.locals.csrfToken, rows, q, LEVELS });
  });

  router.get('/members/:id', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    renderPage(res, 'admin/member-detail', { title: 'Member', nav: true, csrfToken: res.locals.csrfToken, m, LEVELS });
  });

  router.post('/members/:id/level', async (req, res) => {
    const db = await getDb();
    const level = String(req.body.level || '');
    if (!LEVELS[level]) return res.status(400).send('Invalid level');
    await membersRepo.setLevel(db, Number(req.params.id), level);
    res.redirect(`/admin/members/${req.params.id}`);
  });

  router.post('/members/:id/status', async (req, res) => {
    const db = await getDb();
    const status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await membersRepo.setStatus(db, Number(req.params.id), status);
    res.redirect(`/admin/members/${req.params.id}`);
  });

  router.post('/members/:id/resend', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const token = tokens.newToken();
    await membersRepo.setSetToken(db, m.id, token, tokens.expiryFromNow(7));
    const url = `${config.appBaseUrl}/member/set-password?token=${token}`;
    const t = email.welcomeSetPasswordEmail(m, url);
    await email.sendEmail(db, { to: m.email, subject: t.subject, html: t.html, type: 'welcome_set_password', memberId: m.id });
    res.redirect(`/admin/members/${m.id}`);
  });

  router.post('/members/:id/email', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const subject = V.cleanStr(req.body.subject, 200);
    const body = String(req.body.body || '');
    await email.sendEmail(db, { to: m.email, subject, html: `<div style="font-family:Georgia,serif">${body}</div>`, type: 'member_email', memberId: m.id });
    res.redirect(`/admin/members/${m.id}`);
  });

  return router;
};
