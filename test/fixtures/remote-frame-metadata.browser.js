import { remoteFrameFooterHeight, writeRemoteFrameMetadata, readRemoteFrameMetadata } from '../../src/shared/remoteFrameMetadata.js';

function check(value, message) { if (!value) throw new Error(message); }
for (const width of [2, 100, 372, 640, 1280]) {
  for (const screenHidden of [false, true]) for (const revision of [0, 1, 65535, Number.MAX_SAFE_INTEGER]) {
    const canvas = document.createElement('canvas');
    const footerHeight = remoteFrameFooterHeight(width);
    canvas.width = width; canvas.height = 100 + footerHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = 'blue'; context.fillRect(0, 0, width, 100);
    const timestamp = 123456789.75;
    writeRemoteFrameMetadata(context, width, canvas.height, revision, timestamp, screenHidden);
    const metadata = readRemoteFrameMetadata(context, width, canvas.height);
    check(metadata?.revision === revision, 'Revision survives all crop widths and safe integer sizes');
    check(metadata?.screenHidden === screenHidden, 'Waiting state belongs to the same decoded frame');
    check(metadata?.timestamp === Math.floor(timestamp), 'Frame time survives all crop widths');
    check(context.getImageData(0, 99, 1, 1).data[2] === 255, 'Footer does not replace image pixels');
    context.fillStyle = 'white'; context.fillRect(0, 100, Math.min(4, width), Math.min(4, width));
    check(readRemoteFrameMetadata(context, width, canvas.height) === null, 'Corrupt metadata cannot select a crop');
  }
}
window.browserTestResult = 'passed';
