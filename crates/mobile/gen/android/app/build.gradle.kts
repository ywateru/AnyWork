import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// The JNI implementation must match the shim selected by the Rust lockfile.
abstract class RustlsVerifierVersion : ValueSource<String, RustlsVerifierVersion.Params> {
    interface Params : ValueSourceParameters {
        val lockFile: RegularFileProperty
    }

    override fun obtain(): String {
        val blocks = parameters.lockFile.get().asFile.readText().split("[[package]]")
        val block = blocks.single { it.lineSequence().any { line -> line == "name = \"rustls-platform-verifier-android\"" } }
        return Regex("(?m)^version = \"([^\"]+)\"$").find(block)?.groupValues?.get(1)
            ?: error("rustls-platform-verifier-android version missing from Cargo.lock")
    }
}

val rustlsVerifierVersion = providers.of(RustlsVerifierVersion::class.java) {
    parameters.lockFile.set(layout.projectDirectory.file("../../../../../Cargo.lock"))
}

repositories {
    maven {
        url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
        content { includeModule("org.rustls", "rustls-platform-verifier") }
    }
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 37
    ndkVersion = "27.2.12479018"
    namespace = "dev.remoteagent.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "dev.remoteagent.app"
        minSdk = 26
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (System.getenv("ANYWORK_ANDROID_KEYSTORE") != null) {
            create("distribution") {
                storeFile = file(System.getenv("ANYWORK_ANDROID_KEYSTORE"))
                storePassword = System.getenv("ANYWORK_ANDROID_STORE_PASSWORD")
                keyPassword = System.getenv("ANYWORK_ANDROID_KEY_PASSWORD")
                keyAlias = System.getenv("ANYWORK_ANDROID_KEY_ALIAS") ?: "anywork"
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.findByName("distribution")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("org.rustls:rustls-platform-verifier:${rustlsVerifierVersion.get()}")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
