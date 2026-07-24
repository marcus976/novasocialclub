'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(s) { return typeof s === 'string' && EMAIL_RE.test(s.trim()); }

function cleanStr(s, max = 500) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function honeypotTripped(body) { return cleanStr(body.website, 200) !== ''; }

function validateApplication(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = {
    first_name: cleanStr(body.fname ?? body.first_name, 80),
    last_name: cleanStr(body.lname ?? body.last_name, 80),
    email: cleanStr(body.email, 160).toLowerCase(),
    phone: cleanStr(body.phone, 40),
    company: cleanStr(body.company, 120),
    profession: cleanStr(body.profession, 120),
    linkedin: cleanStr(body.linkedin, 200),
    area: cleanStr(body.area, 120),
    why: cleanStr(body.why, 2000),
  };
  const errors = [];
  if (!value.first_name) errors.push('First name is required.');
  if (!value.last_name) errors.push('Last name is required.');
  if (!isEmail(value.email)) errors.push('A valid email is required.');
  return { ok: errors.length === 0, spam: false, errors, value };
}

function validateNewsletter(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = { email: cleanStr(body.email, 160).toLowerCase() };
  const errors = isEmail(value.email) ? [] : ['A valid email is required.'];
  return { ok: errors.length === 0, spam: false, errors, value };
}

function validatePartner(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = {
    business: cleanStr(body.business, 160),
    contact_name: cleanStr(body.contact_name ?? body.name, 120),
    email: cleanStr(body.email, 160).toLowerCase(),
    message: cleanStr(body.message, 2000),
  };
  const errors = [];
  if (!value.business) errors.push('Business name is required.');
  if (!isEmail(value.email)) errors.push('A valid email is required.');
  return { ok: errors.length === 0, spam: false, errors, value };
}

module.exports = { isEmail, cleanStr, validateApplication, validateNewsletter, validatePartner };
