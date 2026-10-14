# MicroDroid Broadcaster (MVP)

Transmissor Android por `MediaProjection` + WebRTC e receptor web simples.

## O que esta versão faz
- Solicita a autorização oficial do Android para compartilhar a tela.
- Mantém a captura em um foreground service do tipo `mediaProjection`.
- Captura a tela com `ScreenCapturerAndroid` e publica vídeo por WebRTC.
- Usa uma sala curta para parear o APK e o navegador.
- O navegador recebe o vídeo em `web/`.

## Limitações importantes
- Este é um MVP de código-fonte, não um APK compilado. Não foi possível compilar aqui porque este ambiente não tem Android SDK/Gradle instalado.
- A dependência WebRTC inclui binários nativos; o APK final provavelmente será maior que 1 MB. O tamanho depende de ABI, minificação e empacotamento.
- O servidor de sinalização abaixo não retransmite vídeo; apenas encaminha mensagens de negociação WebRTC. Para redes diferentes, STUN pode não bastar: configure TURN em produção.
- O servidor de sinalização de exemplo não tem autenticação, TLS próprio ou proteção contra abuso. Use somente em teste controlado. Para acesso remoto, coloque-o atrás de HTTPS/WSS e implemente autenticação e limites.
- Android exige confirmação do usuário em cada sessão de captura. O sistema pode ocultar conteúdo protegido/DRM.

## Requisitos
- Android Studio atual com SDK Android 35 ou superior.
- JDK 17 ou superior para Gradle/Android.
- Node.js 20+ para o servidor de sinalização.

## 1. Iniciar sinalização

```bash
cd signaling
npm install
npm start
```

Por padrão, o servidor serve o receptor web e a sinalização WebSocket na mesma porta `8080`. Abra `http://IP_DO_SERVIDOR:8080` e conecte o WebSocket no mesmo host/porta.

- Mesmo Wi-Fi: use o IP local do computador/servidor, por exemplo `ws://192.168.1.10:8080`.
- Página publicada em HTTPS: o navegador normalmente exige `wss://`. Coloque o sinalizador atrás de um proxy TLS (Caddy/Nginx/Cloudflare Tunnel) e use o endereço `wss://...`.

## 2. Abrir o Android

Abra a pasta `android/` no Android Studio, espere o Gradle sincronizar e execute no aparelho. Na URL de sinalização, use a mesma origem do túnel convertida para WebSocket: `https://exemplo...` vira `wss://exemplo...` (não acrescente `/` no final). O projeto usa `minSdk 26`, `compileSdk 35` e `targetSdk 35`.

Na tela do app:
1. Informe o WebSocket de sinalização.
2. Informe o mesmo código de sala que usará no navegador.
3. Toque em **Iniciar transmissão**.
4. Confirme o diálogo de captura de tela do Android.

O serviço permanece em primeiro plano durante a captura. Use **Parar transmissão** para encerrar.

## 3. Abrir o receptor web

O receptor já é servido pelo mesmo servidor de sinalização. Abra `http://localhost:8080` ou `http://IP_DO_SERVIDOR:8080`. O campo WebSocket é preenchido automaticamente com o mesmo host e porta; se a página estiver em HTTPS, usa `wss://`.

## Porta única para OpenTunnel

Execute apenas `cd signaling` e `npm start`. O servidor usa a porta `8080` por padrão, serve `web/` e aceita WebSocket na mesma porta. No OpenTunnel, exponha somente a porta `8080`.

## Arquitetura de sinalização

O broadcaster cria a oferta quando o receptor entra na mesma sala. O servidor encaminha `offer`, `answer` e `candidate` ao outro participante. O vídeo trafega diretamente por WebRTC quando a rede permite; o servidor de sinalização não transporta o vídeo.

## Segurança antes de publicar

Não exponha o exemplo publicamente sem autenticação por token, WSS, rate limiting, validação de salas, TURN com credenciais temporárias e uma política de expiração de sessões.
