const modules = new WeakMap();

export async function openMicrophone(context, deviceId = '') {
  const media = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
    echoCancellation: true, noiseSuppression: true, autoGainControl: false,
    channelCount: 1,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {})
  } });
  let source, processor, destination;
  const close = () => {
    source?.disconnect(); processor?.disconnect(); processor?.port.close();
    media.getTracks().forEach(track => track.stop());
    destination?.stream.getTracks().forEach(track => track.stop());
  };
  try {
    if (!modules.has(context)) {
      const loading = context.audioWorklet.addModule(new URL('./microphoneWorklet.js', document.baseURI).href);
      modules.set(context, loading);
      loading.catch(() => modules.delete(context));
    }
    await modules.get(context);
    source = context.createMediaStreamSource(media);
    processor = new AudioWorkletNode(context, 'boatyard-microphone', { outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    destination = context.createMediaStreamDestination();
    source.connect(processor); processor.connect(destination);
    await context.resume();
    const settings = () => {
      const values = media.getAudioTracks()[0].getSettings();
      return { echoCancellation: values.echoCancellation, noiseSuppression: values.noiseSuppression, autoGainControl: values.autoGainControl };
    };
    return { media, stream: destination.stream, settings, close };
  } catch (error) { close(); throw error; }
}
