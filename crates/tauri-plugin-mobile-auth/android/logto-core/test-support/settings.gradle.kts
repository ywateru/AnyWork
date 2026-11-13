pluginManagement {
    repositories { mavenCentral(); gradlePluginPortal() }
    plugins { id("org.jetbrains.kotlin.jvm") version "2.2.10" }
}
dependencyResolutionManagement { repositories { mavenCentral() } }
rootProject.name = "anywork-logto-core-http-test"
include(":anywork-logto-core")
project(":anywork-logto-core").projectDir = file("..")
