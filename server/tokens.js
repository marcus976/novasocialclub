'use strict';
const crypto = require('crypto');

function newToken() { return crypto.randomBytes(32).toString('hex'); }
function expiryFromNow(days) { return new Date(Date.now() + days * 24 * 60 * 60 * 1000); }

module.exports = { newToken, expiryFromNow };
