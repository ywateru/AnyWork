package dev.remoteagent.app.system

import android.app.Activity
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

@TauriPlugin
class MobileSystemPlugin(activity: Activity) : Plugin(activity)
