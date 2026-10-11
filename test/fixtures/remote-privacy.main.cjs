process.env.BOATYARD_REMOTE_FIXTURE_READONLY = '1';
global.remoteFixturePrivacy = true;
module.exports = require('./remote-access.main.cjs');
