plugins { id("com.android.application") }
android {
    namespace = "dev.remoteagent.app"
    compileSdk = 36
    buildFeatures { buildConfig = true }
    defaultConfig { applicationId = "dev.remoteagent.app"; minSdk = 26; targetSdk = 36; versionCode = 11; versionName = "0.1.10" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    signingConfigs {
        if (System.getenv("ANYWORK_ANDROID_KEYSTORE") != null) {
            create("distribution") {
                storeFile = file(System.getenv("ANYWORK_ANDROID_KEYSTORE"))
                storePassword = System.getenv("ANYWORK_ANDROID_STORE_PASSWORD")
                keyAlias = System.getenv("ANYWORK_ANDROID_KEY_ALIAS") ?: "anywork"
                keyPassword = System.getenv("ANYWORK_ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("distribution")
        }
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("web-assets"))
}
val bundleWeb by tasks.registering(Sync::class) {
    from(System.getenv("ANYWORK_ANDROID_WEB_DIR") ?: "../../web/dist")
    into(layout.buildDirectory.dir("web-assets/www"))
    doFirst { check(file((System.getenv("ANYWORK_ANDROID_WEB_DIR") ?: "../../web/dist") + "/index.html").exists()) { "Build the web app first: npm run build" } }
}
tasks.named("preBuild").configure { dependsOn(bundleWeb) }

dependencies {
    implementation("com.wireguard.android:tunnel:1.0.20260102")
    testImplementation("junit:junit:4.13.2")
}
