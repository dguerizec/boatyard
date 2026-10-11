module.exports = async harness => {
  process.env.BOATYARD_REMOTE_FIXTURE_READONLY = '1';
  await require('./remote-access.main.cjs')(harness);
};
