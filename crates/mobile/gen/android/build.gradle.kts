buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

plugins {
    // Loaded by the pinned kotlin-gradle-plugin:2.2.10 buildscript above.
    // Repeating a plugins-DSL version conflicts with that legacy classpath.
    id("org.jetbrains.kotlin.jvm") apply false
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

