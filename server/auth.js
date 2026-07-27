'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { config } = require('./config');

async function hashPassword(pw) { return bcrypt.hash(pw, 12); }
async function verifyPassword(pw, hash) { if (!hash) return false; return bcrypt.compare(pw, hash); }

function sessionMiddleware(db) {
  const opts = {
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 1000 * 60 * 60 * 24 * 30 },
  };
  if (db && db.kind === 'pg') {
    const pgSession = require('connect-pg-simple')(session);
    opts.store = new pgSession({ pool: db.pool, createTableIfMissing: true });
  }
  return session(opts);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.redirect('/admin/login');
}

function requireMember(req, res, next) {
  if (req.session && req.session.memberId) return next();
  return res.redirect('/member/login');
}

function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (sent !== req.session.csrfToken) return res.status(403).send('Invalid CSRF token');
  }
  next();
}

module.exports = { hashPassword, verifyPassword, sessionMiddleware, requireAdmin, requireMember, csrf };
