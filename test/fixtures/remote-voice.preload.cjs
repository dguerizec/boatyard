window.voiceFixturePeers = [];
const OriginalPeer = window.RTCPeerConnection;
window.RTCPeerConnection = class extends OriginalPeer {
  constructor(...args) { super(...args); window.voiceFixturePeer = this; window.voiceFixturePeers.push(this); }
};
