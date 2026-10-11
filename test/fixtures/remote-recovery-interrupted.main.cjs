process.env.BOATYARD_REMOTE_FIXTURE_READONLY = '1';
global.remoteFixtureRecovery = true;
global.remoteFixtureInterrupted = true;
module.exports = require('./remote-access.main.cjs');
