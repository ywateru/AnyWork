package dev.remoteagent.app.system

import androidx.core.content.FileProvider

/** Separate manifest identity from Wry's capture provider; only our export cache. */
class ExportProvider : FileProvider()
