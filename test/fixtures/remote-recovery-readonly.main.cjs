process.env.BOATYARD_REMOTE_FIXTURE_READONLY = '1';
global.remoteFixtureRecovery = true;
module.exports = require('./remote-access.main.cjs');
