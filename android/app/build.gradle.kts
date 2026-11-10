plugins { id("com.android.application") }
android {
    namespace = "dev.remoteagent.app"
    compileSdk = 36
    buildFeatures { buildConfig = true }
    defaultConfig { applicationId = "dev.remoteagent.app"; minSdk = 26; targetSdk = 36; versionCode = 20; versionName = "0.1.19" }
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
}

dependencies {
    implementation("androidx.browser:browser:1.8.0")
    testImplementation("junit:junit:4.13.2")
}
