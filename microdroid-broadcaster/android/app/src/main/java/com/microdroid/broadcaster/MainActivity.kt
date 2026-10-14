package com.microdroid.broadcaster

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : Activity() {
    private lateinit var signalingUrl: EditText
    private lateinit var roomCode: EditText
    private lateinit var status: TextView
    private val captureRequestCode = 741

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 742)
        }
        buildUi()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 36, 28, 28)
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFFF7F4FC.toInt())
        }
        root.addView(TextView(this).apply {
            text = "MicroDroid Broadcaster"
            textSize = 24f
            setTextColor(0xFF211A2C.toInt())
        }, match())
        root.addView(TextView(this).apply {
            text = "Transmita a tela deste Android para o MicroDroid Web Runtime. A captura só começa após sua autorização."
            textSize = 14f
            setPadding(0, 12, 0, 22)
        }, match())
        signalingUrl = EditText(this).apply {
            hint = "WebSocket: wss://sua-url-publica"
            setSingleLine(true)
            setText(getPreferences(MODE_PRIVATE).getString("signal", ""))
        }
        root.addView(signalingUrl, match())
        roomCode = EditText(this).apply {
            hint = "Código da sala (ex.: sala-123)"
            setSingleLine(true)
            setText(getPreferences(MODE_PRIVATE).getString("room", "sala-123"))
        }
        root.addView(roomCode, match())
        val start = Button(this).apply {
            text = "Iniciar transmissão"
            setOnClickListener { requestCapture() }
        }
        root.addView(start, match())
        root.addView(Button(this).apply {
            text = "Parar transmissão"
            setOnClickListener {
                stopService(Intent(this@MainActivity, ScreenBroadcastService::class.java))
                status.text = "Transmissão encerrada."
            }
        }, match())
        status = TextView(this).apply {
            text = "Pronto para conectar."
            textSize = 14f
            setPadding(0, 20, 0, 0)
        }
        root.addView(status, match())
        setContentView(root)
    }

    private fun requestCapture() {
        val url = signalingUrl.text.toString().trim()
        val room = roomCode.text.toString().trim()
        if (!(url.startsWith("ws://") || url.startsWith("wss://"))) {
            Toast.makeText(this, "Informe uma URL ws:// ou wss:// válida", Toast.LENGTH_LONG).show()
            return
        }
        if (room.isBlank()) {
            Toast.makeText(this, "Informe o código da sala", Toast.LENGTH_LONG).show()
            return
        }
        getPreferences(MODE_PRIVATE).edit().putString("signal", url).putString("room", room).apply()
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        status.text = "Aguardando autorização do Android…"
        @Suppress("DEPRECATION")
        startActivityForResult(manager.createScreenCaptureIntent(), captureRequestCode)
    }

    @Deprecated("Activity result API kept minimal for the MVP")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != captureRequestCode) return
        if (resultCode != RESULT_OK || data == null) {
            status.text = "Captura cancelada: nenhuma tela foi compartilhada."
            return
        }
        val service = Intent(this, ScreenBroadcastService::class.java).apply {
            action = ScreenBroadcastService.ACTION_START
            putExtra(ScreenBroadcastService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenBroadcastService.EXTRA_RESULT_DATA, data)
            putExtra(ScreenBroadcastService.EXTRA_SIGNALING_URL, signalingUrl.text.toString().trim())
            putExtra(ScreenBroadcastService.EXTRA_ROOM, roomCode.text.toString().trim())
        }
        ContextCompat.startForegroundService(this, service)
        status.text = "Autorização recebida. Conectando ao receptor…"
    }

    private fun match() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
        bottomMargin = 12
    }
}
