import "./style.css";

type CheckState = "ok" | "bad" | "warn" | "pending";
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Elemento #app não encontrado.");

app.innerHTML = `
  <main class="shell">
    <header class="topbar"><div class="brand-mark">MD</div><div class="brand-copy"><div class="eyebrow">LABORATÓRIO EXPERIMENTAL</div><h1>MicroDroid <span>Web Runtime</span></h1></div><span class="version">PROVA DE CONCEITO 0.1</span></header>
    <section class="hero"><div class="hero-copy"><div class="status-pill"><span class="pulse"></span> TESTE DE VIABILIDADE</div><h2>Captura de tela<br /><em>sem instalar um APK.</em></h2><p>Este protótipo mede o que o navegador atual realmente permite. Ele não tenta contornar as proteções do Android nem afirma ter acesso à tela inteira quando a API não existe.</p><div class="actions"><button id="run-checks" class="button secondary">Verificar ambiente</button><button id="capture" class="button primary">Testar captura de tela <span aria-hidden="true">↗</span></button></div></div>
    <div class="device-card"><div class="device-top"><span></span><span></span><span></span><label>PREVIEW LOCAL</label></div><div class="preview" id="preview"><div class="preview-icon">▣</div><strong>Nenhuma captura ativa</strong><p>Quando o navegador fornecer um fluxo de tela, a prévia aparecerá aqui.</p></div><div class="device-bottom"><span class="live-dot"></span><span id="preview-status">Aguardando teste</span></div></div></section>
    <section class="notice" role="status"><div class="notice-icon">i</div><div><strong>Importante sobre Android</strong><p>Chrome para Android atualmente não oferece suporte utilizável a <code>getDisplayMedia()</code>. Se este teste for aberto no próprio celular Android, o resultado pode confirmar essa limitação. O protótipo registra o ambiente e valida navegadores compatíveis.</p></div></section>
    <section class="section-head"><div><div class="eyebrow">DIAGNÓSTICO</div><h3>Capacidades detectadas</h3></div><span id="overall" class="overall">Ainda não verificado</span></section><section class="checks" id="checks"></section>
    <section class="log-section"><div class="section-head compact"><div><div class="eyebrow">REGISTRO</div><h3>Log do experimento</h3></div><button id="clear-log" class="text-button">Limpar log</button></div><pre id="log" aria-live="polite">[inicialização] MicroDroid Web Runtime carregado.</pre></section>
    <footer><span>MICRODROID WEB RUNTIME</span><span>Pesquisa de viabilidade • Nenhum dado é enviado a um servidor</span></footer>
  </main>`;

const checksElement = document.querySelector<HTMLDivElement>("#checks")!;
const logElement = document.querySelector<HTMLPreElement>("#log")!;
const overallElement = document.querySelector<HTMLSpanElement>("#overall")!;
const captureButton = document.querySelector<HTMLButtonElement>("#capture")!;
const runChecksButton = document.querySelector<HTMLButtonElement>("#run-checks")!;
const previewElement = document.querySelector<HTMLDivElement>("#preview")!;
const previewStatus = document.querySelector<HTMLSpanElement>("#preview-status")!;
let activeStream: MediaStream | null = null;

function log(message: string) {
  const timestamp = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  logElement.textContent += `\n[${timestamp}] ${message}`;
  logElement.scrollTop = logElement.scrollHeight;
}
function row(title: string, detail: string, state: CheckState) {
  const labels: Record<CheckState, string> = { ok: "DISPONÍVEL", bad: "INDISPONÍVEL", warn: "PARCIAL", pending: "PENDENTE" };
  const symbols: Record<CheckState, string> = { ok: "✓", bad: "×", warn: "!", pending: "·" };
  return `<article class="check-row"><div class="check-symbol ${state}">${symbols[state]}</div><div class="check-copy"><strong>${title}</strong><p>${detail}</p></div><span class="check-state ${state}">${labels[state]}</span></article>`;
}
function runChecks() {
  const android = /Android/i.test(navigator.userAgent);
  const media = !!navigator.mediaDevices;
  const camera = !!navigator.mediaDevices?.getUserMedia;
  const display = !!navigator.mediaDevices?.getDisplayMedia;
  const secure = window.isSecureContext;
  const rows = [
    row("Contexto seguro (HTTPS)", secure ? "A página está em contexto seguro." : "Use HTTPS ou localhost para habilitar APIs de mídia protegidas.", secure ? "ok" : "bad"),
    row("Navegador identificado", android ? "Android detectado pelo user-agent." : "Não foi detectado Android pelo user-agent.", android ? "warn" : "ok"),
    row("API de mídia", media ? "navigator.mediaDevices está disponível." : "navigator.mediaDevices não está disponível neste contexto.", media ? "ok" : "bad"),
    row("Câmera/microfone", camera ? "getUserMedia() está disponível; o uso ainda exige permissão." : "getUserMedia() não está disponível.", camera ? "ok" : "bad"),
    row("Captura de tela", display ? "getDisplayMedia() existe; isso não garante captura da tela do sistema." : "getDisplayMedia() não está exposto neste navegador.", display ? "warn" : "bad")
  ];
  if (android && !display) rows.push(row("Conclusão preliminar", "Neste navegador Android, a captura integral da tela não pode ser iniciada pela API web padrão.", "bad"));
  else if (display) rows.push(row("Conclusão preliminar", "A API está exposta, mas é necessário testar se a plataforma permite uma captura real.", "warn"));
  else rows.push(row("Conclusão preliminar", "Teste a captura. Em desktop, o navegador normalmente apresenta um seletor de tela, janela ou aba.", "pending"));
  checksElement.innerHTML = rows.join("");
  overallElement.textContent = display && secure ? "Teste de captura possível" : "Limitação detectada";
  log(`Ambiente: ${android ? "Android" : "não Android"}; secureContext=${secure}; mediaDevices=${media}; getUserMedia=${camera}; getDisplayMedia=${display}.`);
  log(`User-Agent: ${navigator.userAgent}`);
}
function stopCapture() {
  activeStream?.getTracks().forEach(track => track.stop()); activeStream = null;
  previewElement.innerHTML = `<div class="preview-icon">▣</div><strong>Nenhuma captura ativa</strong><p>Quando o navegador fornecer um fluxo de tela, a prévia aparecerá aqui.</p>`;
  previewStatus.textContent = "Captura encerrada";
  captureButton.innerHTML = 'Testar captura de tela <span aria-hidden="true">↗</span>';
  captureButton.onclick = () => void startCapture();
  log("Captura encerrada pelo usuário ou pelo navegador.");
}
async function startCapture() {
  if (!window.isSecureContext) { log("ERRO: contexto inseguro. Publique em HTTPS ou use localhost."); alert("A captura exige HTTPS ou localhost. Abra esta página por um endereço seguro."); return; }
  const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
  if (!getDisplayMedia) { log("RESULTADO: getDisplayMedia() não está disponível neste navegador."); alert("Este navegador não disponibiliza a API de captura de tela. No Chrome para Android, a captura integral da tela via web não é suportada atualmente."); return; }
  try {
    log("Solicitando captura. O usuário deve autorizar no diálogo oficial do navegador.");
    activeStream = await getDisplayMedia.call(navigator.mediaDevices, { video: true, audio: false });
    const video = document.createElement("video"); video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = activeStream; video.className = "screen-video";
    previewElement.replaceChildren(video); previewStatus.textContent = "Captura ativa"; captureButton.textContent = "Encerrar captura"; captureButton.onclick = stopCapture;
    log("SUCESSO: o navegador forneceu um MediaStream neste ambiente. Isso não comprova compatibilidade Android universal.");
    activeStream.getVideoTracks()[0]?.addEventListener("ended", stopCapture, { once: true });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log(`FALHA na captura: ${message}`);
    alert(`Não foi possível iniciar a captura.\n\n${message}`);
  }
}
runChecksButton.addEventListener("click", runChecks);
captureButton.addEventListener("click", () => void startCapture());
document.querySelector<HTMLButtonElement>("#clear-log")!.addEventListener("click", () => { logElement.textContent = "[log] Registro limpo."; });
runChecks();
