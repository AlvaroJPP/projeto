package com.microdroid.broadcaster

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

class ScreenBroadcastService : Service() {
    companion object {
        const val ACTION_START = "com.microdroid.broadcaster.START"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_SIGNALING_URL = "signalingUrl"
        const val EXTRA_ROOM = "room"
        private const val CHANNEL_ID = "microdroid_capture"
        private const val NOTIFICATION_ID = 412
    }

    private val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private var socket: WebSocket? = null
    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var room = ""
    private var hasOffered = false
    private var pendingCandidates = mutableListOf<IceCandidate>()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_START) {
            stopSelf()
            return START_NOT_STICKY
        }
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val resultData = parcelableIntent(intent, EXTRA_RESULT_DATA)
        val url = intent.getStringExtra(EXTRA_SIGNALING_URL).orEmpty()
        room = intent.getStringExtra(EXTRA_ROOM).orEmpty()
        if (resultData == null || url.isBlank() || room.isBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(
                    NOTIFICATION_ID,
                    buildNotification("Preparando captura de tela"),
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } else {
                startForeground(NOTIFICATION_ID, buildNotification("Preparando captura de tela"))
            }

            // ScreenCapturerAndroid obtains MediaProjection from the one-time consent result.
            // Do not call getMediaProjection() here as well: Android 14+ forbids reusing the token.
            startWebRtc(resultData)
            connectSignaling(url)
            updateNotification("Aguardando receptor na sala $room")
        } catch (e: Exception) {
            Log.e("MicroDroid", "Falha ao iniciar o serviço de transmissão", e)
            updateNotification("Falha: ${e.javaClass.simpleName}: ${e.message ?: "sem detalhes"}")
            // Keep the foreground service alive so the error remains visible in the notification.
        } catch (e: LinkageError) {
            Log.e("MicroDroid", "Falha ao carregar a biblioteca nativa de transmissão", e)
            updateNotification("Falha nativa: ${e.javaClass.simpleName}")
            // Keep the foreground service alive so the error remains visible in the notification.
        }
        return START_NOT_STICKY
    }

    @Suppress("DEPRECATION", "UNCHECKED_CAST")
    private fun parcelableIntent(intent: Intent, key: String): Intent? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(key, Intent::class.java) else intent.getParcelableExtra(key)

    private fun startWebRtc(resultData: Intent) {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions())
        eglBase = EglBase.create()
        val eglContext = eglBase!!.eglBaseContext
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglContext))
            .createPeerConnectionFactory()

        val iceServers = listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        peer = factory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                updateNotification("WebRTC: ${state.name.lowercase()}")
            }
            override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState) {}
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                updateNotification("Conexão: ${newState.name.lowercase()}")
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceCandidate(candidate: IceCandidate) {
                sendSignal(JSONObject().put("type", "candidate").put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex))
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: org.webrtc.MediaStream) {}
            override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
            override fun onDataChannel(channel: org.webrtc.DataChannel) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: org.webrtc.RtpReceiver, mediaStreams: Array<out org.webrtc.MediaStream>) {}
            override fun onTrack(transceiver: org.webrtc.RtpTransceiver) {}
        }) ?: error("Não foi possível criar PeerConnection")

        videoSource = factory!!.createVideoSource(false)
        capturer = ScreenCapturerAndroid(resultData, object : MediaProjection.Callback() {
            override fun onStop() { stopSelf() }
        })
        val textureHelper = SurfaceTextureHelper.create("MicroDroidScreenCapture", eglContext)
        capturer!!.initialize(textureHelper, applicationContext, videoSource!!.capturerObserver)
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val width = (metrics.widthPixels / 2).coerceAtLeast(360) and -2
        val height = (metrics.heightPixels / 2).coerceAtLeast(640) and -2
        capturer!!.startCapture(width, height, 20)
        videoTrack = factory!!.createVideoTrack("microdroid-screen", videoSource)
        videoTrack!!.setEnabled(true)
        peer!!.addTrack(videoTrack, listOf("microdroid-screen-stream"))
    }

    private fun connectSignaling(url: String) {
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                sendSignal(JSONObject().put("type", "join").put("room", room).put("role", "broadcaster"))
                updateNotification("Conectado à sinalização; sala $room")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val message = JSONObject(text)
                    when (message.optString("type")) {
                        // The server reports the room state on join. Use it as a second
                        // trigger in addition to peer-joined, so an already-present viewer
                        // cannot leave the broadcaster waiting forever for an offer.
                        "joined" -> {
                            if (message.optInt("peers", 0) > 0) createOffer()
                        }
                        "peer-joined" -> createOffer()
                        "answer" -> {
                            val sdp = message.optString("sdp")
                            peer?.setRemoteDescription(object : SimpleSdpObserver() {
                                override fun onSetSuccess() { flushCandidates() }
                                override fun onSetFailure(error: String) {
                                    updateNotification("Falha ao aplicar resposta WebRTC: $error")
                                }
                            }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
                        }
                        "candidate" -> {
                            val candidate = IceCandidate(message.optString("sdpMid"), message.optInt("sdpMLineIndex"), message.optString("candidate"))
                            if (peer?.remoteDescription != null) peer?.addIceCandidate(candidate) else pendingCandidates.add(candidate)
                        }
                        "error" -> updateNotification("Sinalização: ${message.optString("message")}")
                    }
                } catch (e: Exception) { updateNotification("Mensagem inválida do servidor") }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                updateNotification("Sinalização desconectada: ${t.message ?: "erro"}")
            }
        })
    }

    private fun createOffer() {
        if (hasOffered) return
        hasOffered = true
        peer?.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(description: SessionDescription) {
                peer?.setLocalDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        if (socket == null) {
                            hasOffered = false
                            updateNotification("Oferta pronta, mas a sinalização está desconectada.")
                            return
                        }
                        sendSignal(JSONObject().put("type", "offer").put("sdp", description.description))
                        updateNotification("Oferta WebRTC enviada; aguardando resposta do navegador.")
                    }
                    override fun onSetFailure(error: String) {
                        hasOffered = false
                        updateNotification("Falha ao definir oferta WebRTC: $error")
                    }
                }, description)
            }
            override fun onCreateFailure(error: String) {
                hasOffered = false
                updateNotification("Falha ao criar oferta: $error")
            }
        }, org.webrtc.MediaConstraints())
    }

    private fun flushCandidates() {
        pendingCandidates.forEach { peer?.addIceCandidate(it) }
        pendingCandidates.clear()
    }

    private fun sendSignal(json: JSONObject) {
        json.put("room", room)
        socket?.send(json.toString())
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "Transmissão de tela", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(message: String): Notification {
        val stopIntent = PendingIntent.getService(this, 1, Intent(this, ScreenBroadcastService::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setContentTitle("MicroDroid Broadcaster")
            .setContentText(message)
            .setOngoing(true)
            .addAction(0, "Parar", stopIntent)
            .build()
    }

    private fun updateNotification(message: String) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(message))
    }

    override fun onDestroy() {
        try { socket?.close(1000, "Broadcast stopped") } catch (_: Exception) {}
        try { capturer?.stopCapture() } catch (_: Exception) {}
        try { capturer?.dispose() } catch (_: Exception) {}
        try { videoTrack?.dispose() } catch (_: Exception) {}
        try { videoSource?.dispose() } catch (_: Exception) {}
        try { peer?.close(); peer?.dispose() } catch (_: Exception) {}
        try { factory?.dispose() } catch (_: Exception) {}
        try { eglBase?.release() } catch (_: Exception) {}
        socket = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

open class SimpleSdpObserver : org.webrtc.SdpObserver {
    override fun onCreateSuccess(description: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String) {}
    override fun onSetFailure(error: String) {}
}
