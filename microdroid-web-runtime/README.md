# MicroDroid Web Runtime — PoC 0.1

Protótipo de pesquisa para medir a viabilidade de captura de tela no navegador sem instalar um APK no celular.

## O que esta versão faz
- Detecta contexto seguro (HTTPS/localhost).
- Detecta `navigator.mediaDevices`, `getUserMedia()` e `getDisplayMedia()`.
- Registra user-agent e capacidades no log local.
- Quando a API de captura está disponível, tenta abrir o seletor oficial do navegador e mostra o fluxo retornado.
- Não envia dados a um servidor e não tenta contornar as proteções do Android.

## Limitação conhecida
A matriz de compatibilidade consultada indica que `getDisplayMedia()` não é suportado no Chrome para Android. Assim, esta versão não consegue capturar a tela inteira do celular nesses navegadores. O objetivo inicial é produzir um diagnóstico reproduzível, não fingir que a captura funcionou.

Referências:
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md

## Requisitos
- Node.js 20+ recomendado.
- Navegador moderno.
- HTTPS em dispositivo remoto; `localhost` é considerado contexto seguro.

## Executar localmente
```bash
npm install
npm run dev
```
O Vite mostrará o endereço local e, se disponível, o endereço de rede. Para abrir pelo celular usando o endereço IP do computador, configure HTTPS para um teste confiável; HTTP em um IP de LAN normalmente não é contexto seguro e as APIs de mídia podem ficar indisponíveis.

## Próximas etapas
1. Coletar diagnósticos de um Android real.
2. Testar separadamente a captura web padrão em navegadores desktop.
3. Estudar alternativas nativas oficiais e os requisitos de autorização.
4. Só então implementar sinalização/WebRTC para enviar o fluxo a um receptor remoto.

**Importante:** um `MediaStream` local não é ainda uma transmissão para outro dispositivo. A sinalização WebRTC e o receptor remoto serão uma etapa posterior.
