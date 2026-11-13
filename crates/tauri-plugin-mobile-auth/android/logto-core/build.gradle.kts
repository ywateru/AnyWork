plugins {
    `java-library`
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin { jvmToolchain(17) }

dependencies {
    // Versions and scopes from the pinned upstream catalog/module.
    api("org.bitbucket.b_c:jose4j:0.9.6")
    implementation("com.squareup.okhttp3:okhttp:4.11.0") {
        version { strictly("4.11.0") }
    }
    implementation("com.google.code.gson:gson:2.10.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.11.0")
}

tasks.test { maxParallelForks = 1 }
