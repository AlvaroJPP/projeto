const $ = (id) => document.getElementById(id);
const signalInput = $('signal');
// HTTP -> WS e HTTPS -> WSS, usando o mesmo host/porta do receptor web.
if (signalInput && !signalInput.value.trim()) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  signalInput.value = `${wsProtocol}//${window.location.host}`;
}
const roomInput = $('room');
const status = $('status');
const video = $('screen');
const live = $('live');
const connectButton = $('connect');
const disconnectButton = $('disconnect');
let socket = null;
let peer = null;
let room = '';
let pendingCandidates = [];

function setStatus(message) { status.textContent = message; }
function setLive(value) { live.textContent = value ? 'AO VIVO' : 'OFFLINE'; live.classList.toggle('live', value); }
function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, room }));
}
function makePeer() {
  peer?.close();
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => setStatus('Toque no vídeo para iniciar a reprodução.'));
      setLive(true);
      setStatus('Vídeo recebido por WebRTC.');
    }
  };
  peer.onicecandidate = (event) => {
    if (event.candidate) send({ type: 'candidate', candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex });
  };
  peer.onconnectionstatechange = () => {
    const state = peer?.connectionState;
    if (state === 'connected') setStatus('Conexão WebRTC estabelecida.');
    if (state === 'failed') setStatus('WebRTC falhou. Verifique rede/NAT; pode ser necessário configurar TURN.');
    if (state === 'disconnected' || state === 'closed') setLive(false);
  };
}
async function handleMessage(message) {
  switch (message.type) {
    case 'joined':
      setStatus(message.peers ? 'Sala conectada; negociando transmissão…' : 'Sala conectada. Agora inicie a transmissão no APK.');
      break;
    case 'peer-joined':
      setStatus('Broadcaster conectado; aguardando oferta WebRTC…');
      break;
    case 'offer':
      if (!peer) makePeer();
      await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      for (const candidate of pendingCandidates) await peer.addIceCandidate(candidate);
      pendingCandidates = [];
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({ type: 'answer', sdp: answer.sdp });
      setStatus('Oferta recebida; resposta enviada. Conectando…');
      break;
    case 'candidate': {
      const candidate = { candidate: message.candidate, sdpMid: message.sdpMid, sdpMLineIndex: message.sdpMLineIndex };
      if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
      else pendingCandidates.push(candidate);
      break;
    }
    case 'peer-left':
      setLive(false);
      video.srcObject = null;
      peer?.close(); peer = null;
      setStatus('O outro participante saiu da sala.');
      break;
    case 'error': setStatus(`Servidor: ${message.message || 'erro desconhecido'}`); break;
  }
}
connectButton.addEventListener('click', () => {
  room = roomInput.value.trim();
  const url = signalInput.value.trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(room)) return setStatus('Use uma sala com 3 a 80 letras, números, _ ou -.');
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) return setStatus('A URL deve começar com ws:// ou wss://.');
  try {
    socket = new WebSocket(url);
    connectButton.disabled = true;
    disconnectButton.disabled = false;
    socket.onopen = () => { send({ type: 'join', role: 'viewer' }); setStatus('Conectado ao servidor de sinalização. Entrando na sala…'); };
    socket.onmessage = async (event) => {
      try { await handleMessage(JSON.parse(event.data)); }
      catch (error) { console.error(error); setStatus(`Erro na negociação WebRTC: ${error.message || error}`); }
    };
    socket.onerror = () => setStatus('Falha no WebSocket. Confira URL, rede e TLS/WSS.');
    socket.onclose = () => { connectButton.disabled = false; disconnectButton.disabled = true; setStatus('Desconectado do servidor de sinalização.'); };
  } catch (error) { setStatus(`URL inválida: ${error.message || error}`); }
});
disconnectButton.addEventListener('click', disconnect);
function disconnect() {
  try { socket?.close(); } catch {}
  try { peer?.close(); } catch {}
  socket = null; peer = null; video.srcObject = null; setLive(false);
  connectButton.disabled = false; disconnectButton.disabled = true;
  setStatus('Desconectado.');
}
window.addEventListener('beforeunload', disconnect);
